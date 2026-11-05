// Brought to u by MidManStudio
//
// Read aloud that keeps going with the screen off or the app in the background, with a media notification (title, previous /
// pause-play / next / stop, a progress bar) in the pull-down shade and on the lock screen.
//
//   * A FOREGROUND SERVICE of type mediaPlayback owns the whole reading: Android's TextToSpeech, the piece-by-piece loop
//     (ReaderCore.kt), audio focus, a CPU wake lock while it speaks, a MediaSession and the notification. The app's page does
//     not drive anything: when the app goes to the background the page is paused, so a loop written in JavaScript would stall.
//   * The page only sends commands (ReaderBridge.kt) and listens to state changes.
//   * Started from the app while it is on screen (the user tapped Read aloud), which Android 12+ requires for foreground
//     services. Android 13+ does not need the notification permission for media notifications.
//
// This file is NOT part of the Tauri template: src-tauri/android-reader/install.py copies it next to MainActivity.kt in the
// generated Android project on every build and rewrites the package line to match.
package com.midmanstudio.midnote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale

class ReaderService : Service(), ReaderEngine, ReaderListener {

    private val main = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var ttsFailed = false
    private var core: ReaderCore? = null
    private var session: MediaSession? = null
    private var audioManager: AudioManager? = null
    private var focusRequest: AudioFocusRequest? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var noisyRegistered = false
    private var foregroundStarted = false
    private var lastStartId = 0

    /** Commands that arrived before the speech engine finished starting; run once it is ready. */
    private val waiting = ArrayList<Runnable>()

    // what the next piece is spoken with
    private var voiceId = ""
    private var rate = 1.0f
    private var pitch = 1.0f

    // ---------------------------------------------------------------- service life

    override fun onCreate() {
        super.onCreate()
        ReaderHub.service = this
        audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        createChannel()
        session = try {
            MediaSession(this, "MidNoteReader").apply {
                setCallback(sessionCallback)
                setPlaybackState(playbackState(ReaderStatus.IDLE, 0))
            }
        } catch (e: Exception) {
            Log.e(TAG, "MediaSession unavailable", e)
            null
        }
        // The notification must exist within seconds of startForegroundService(): show a first one at once.
        startForegroundNow(buildNotification(ReaderState(ReaderStatus.STARTING, null, "Read aloud", 0, 0, null)))
        core = ReaderCore(this, this)
        tts = try {
            TextToSpeech(applicationContext, TextToSpeech.OnInitListener { status -> main.post { onTtsInit(status) } })
        } catch (e: Exception) {
            Log.e(TAG, "TextToSpeech failed", e)
            null
        }
        if (tts == null) {
            ttsFailed = true
            main.post { failToStart("This phone has no text-to-speech engine.") }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        lastStartId = startId
        when (intent?.action) {
            ACTION_START -> whenReady { startSessionFromHub() }
            ACTION_PLAY -> core?.resume()
            ACTION_PAUSE -> core?.pause()
            ACTION_TOGGLE -> toggle()
            ACTION_NEXT -> core?.next()
            ACTION_PREVIOUS -> core?.previous()
            ACTION_STOP -> core?.stop()
        }
        return START_NOT_STICKY // a reading that was killed is not worth guessing at: the user starts it again
    }

    override fun onDestroy() {
        ReaderHub.service = null
        releaseAudio()
        unregisterNoisy()
        try {
            tts?.stop()
            tts?.shutdown()
        } catch (e: Exception) {
            Log.w(TAG, "TTS shutdown", e)
        }
        tts = null
        session?.isActive = false
        session?.release()
        session = null
        main.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    // ------------------------------------------------------------------ commands from the page

    /** Run `block` now, or as soon as the speech engine has started. */
    fun whenReady(block: () -> Unit) {
        if (ttsReady) block() else waiting.add(Runnable { block() })
    }

    fun command(block: (ReaderCore) -> Unit) {
        val c = core ?: return
        whenReady { block(c) }
    }

    private fun startSessionFromHub() {
        val request = ReaderHub.takePending() ?: return
        voiceId = request.voiceId
        rate = request.rate
        pitch = request.pitch
        core?.start(request.id, request.title, request.pieces, request.index)
        session?.setMetadata(
            MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, request.title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, "MidNote")
                .putLong(MediaMetadata.METADATA_KEY_DURATION, request.pieces.size * POSITION_UNIT)
                .build()
        )
    }

    fun applySettings(newVoice: String, newRate: Float, newPitch: Float) {
        voiceId = newVoice
        rate = newRate
        pitch = newPitch
    }

    private fun toggle() {
        val c = core ?: return
        if (c.active) c.pause() else c.resume()
    }

    // ------------------------------------------------------------------- speech engine

    private fun onTtsInit(status: Int) {
        if (status != TextToSpeech.SUCCESS) {
            ttsFailed = true
            failToStart("The phone's text-to-speech engine could not start.")
            return
        }
        tts?.setOnUtteranceProgressListener(progress)
        ttsReady = true
        val queued = ArrayList(waiting)
        waiting.clear()
        for (r in queued) r.run()
    }

    private fun failToStart(message: String) {
        waiting.clear()
        ReaderHub.takePending()
        core?.fail(message)
    }

    private val progress = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {
            val u = parse(utteranceId) ?: return
            main.post { core?.onEngineStart(u.first, u.second) }
        }

        override fun onDone(utteranceId: String?) {
            val u = parse(utteranceId) ?: return
            main.post { core?.onEngineDone(u.first, u.second) }
        }

        @Deprecated("Superseded by onError(String, Int)")
        override fun onError(utteranceId: String?) {
            val u = parse(utteranceId) ?: return
            main.post { core?.onEngineError(u.first, u.second, "The speech engine reported an error.") }
        }

        override fun onError(utteranceId: String?, errorCode: Int) {
            val u = parse(utteranceId) ?: return
            main.post { core?.onEngineError(u.first, u.second, describe(errorCode)) }
        }

        override fun onStop(utteranceId: String?, interrupted: Boolean) {
            val u = parse(utteranceId) ?: return
            // our own stops move to a newer generation first, so this only reaches the core when something else did it
            if (interrupted) main.post { core?.onEngineInterrupted(u.first, u.second) }
        }
    }

    override fun speak(generation: Long, index: Int, text: String, flush: Boolean) {
        val engine = tts
        if (engine == null || !ttsReady) {
            main.post { core?.onEngineError(generation, index, "The speech engine is not ready.") }
            return
        }
        if (flush && !requestAudio()) {
            main.post { core?.onEngineError(generation, index, "Another app is using the audio right now.") }
            return
        }
        acquireWake()
        selectVoice(engine)
        engine.setSpeechRate(rate)
        engine.setPitch(pitch)
        val queueMode = if (flush) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD
        val result = engine.speak(text, queueMode, null, utteranceId(generation, index))
        if (result != TextToSpeech.SUCCESS) {
            main.post { core?.onEngineError(generation, index, "The speech engine refused to speak. Try a different voice.") }
        }
    }

    override fun stop() {
        try {
            tts?.stop()
        } catch (e: Exception) {
            Log.w(TAG, "TTS stop", e)
        }
    }

    private fun selectVoice(engine: TextToSpeech) {
        if (voiceId.isEmpty() || voiceId == "default") return
        try {
            val voices = engine.voices ?: return
            for (v in voices) {
                if (v.name == voiceId) {
                    engine.voice = v
                    return
                }
            }
            // the voice was removed from the phone: keep the engine's current one (the app lists voices fresh each time)
        } catch (e: Exception) {
            Log.w(TAG, "voice selection", e)
        }
    }

    private fun describe(code: Int): String = when (code) {
        TextToSpeech.ERROR_NOT_INSTALLED_YET -> "The voice is still downloading."
        TextToSpeech.ERROR_NETWORK, TextToSpeech.ERROR_NETWORK_TIMEOUT -> "This voice needs the internet."
        TextToSpeech.ERROR_INVALID_REQUEST -> "The speech engine could not read that text."
        TextToSpeech.ERROR_SERVICE -> "The speech engine stopped."
        TextToSpeech.ERROR_OUTPUT -> "The speech engine could not play the sound."
        TextToSpeech.ERROR_SYNTHESIS -> "The speech engine could not make the sound."
        else -> "The speech engine reported an error."
    }

    // ------------------------------------------------------------------ state changes

    override fun onState(state: ReaderState) {
        ReaderHub.publish(state)
        updateSession(state)
        when (state.status) {
            ReaderStatus.READING, ReaderStatus.STARTING -> {
                registerNoisy()
                startOrUpdateNotification(state)
            }
            ReaderStatus.PAUSED -> {
                releaseWake()
                startOrUpdateNotification(state)
            }
            ReaderStatus.DONE, ReaderStatus.IDLE -> finish()
        }
    }

    /** Nothing left to show: let go of everything and end the service. The page has already been told. */
    private fun finish() {
        releaseAudio()
        releaseWake()
        unregisterNoisy()
        session?.isActive = false
        stopForegroundCompat()
        // stopSelf(startId) only stops the service if no newer start command has arrived: a new Read aloud tapped the
        // moment the last one finished must not be killed with it
        stopSelf(lastStartId)
    }

    // --------------------------------------------------------------------- audio focus

    private fun requestAudio(): Boolean {
        val am = audioManager ?: return true
        if (focusRequest != null) return true // already ours
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        // TRANSIENT, not GAIN: the speech engine is another process and asks for its own focus to play the sound. With a
        // permanent claim it would take it from us and we would stop the very sentence we asked for (the TTS plugin found
        // the same thing).
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(attributes)
            .setOnAudioFocusChangeListener { change ->
                when (change) {
                    AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> main.post { core?.pause() }
                    else -> {} // ducking: speech at a lower volume is not worth hearing, but it is not worth stopping for either
                }
            }
            .build()
        val granted = am.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        if (granted) focusRequest = request
        return granted
    }

    private fun releaseAudio() {
        val am = audioManager
        val request = focusRequest
        if (am != null && request != null) am.abandonAudioFocusRequest(request)
        focusRequest = null
    }

    // ------------------------------------------------------------------------ wake lock

    private fun acquireWake() {
        if (wakeLock?.isHeld == true) return
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
            val lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MidNote:reader")
            lock.setReferenceCounted(false)
            lock.acquire(WAKE_LIMIT_MS) // never forever, even if something goes wrong
            wakeLock = lock
        } catch (e: Exception) {
            Log.w(TAG, "wake lock", e)
        }
    }

    private fun releaseWake() {
        try {
            if (wakeLock?.isHeld == true) wakeLock?.release()
        } catch (e: Exception) {
            Log.w(TAG, "wake lock release", e)
        }
        wakeLock = null
    }

    // ------------------------------------------------- headphones unplugged: stop talking

    private val noisy = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) core?.pause()
        }
    }

    private fun registerNoisy() {
        if (noisyRegistered) return
        registerReceiver(noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY))
        noisyRegistered = true
    }

    private fun unregisterNoisy() {
        if (!noisyRegistered) return
        try {
            unregisterReceiver(noisy)
        } catch (e: Exception) {
            Log.w(TAG, "unregister", e)
        }
        noisyRegistered = false
    }

    // ----------------------------------------------------------------- media session

    private val sessionCallback = object : MediaSession.Callback() {
        override fun onPlay() { main.post { core?.resume() } }
        override fun onPause() { main.post { core?.pause() } }
        override fun onStop() { main.post { core?.stop() } }
        override fun onSkipToNext() { main.post { core?.next() } }
        override fun onSkipToPrevious() { main.post { core?.previous() } }
        override fun onSeekTo(pos: Long) { main.post { core?.seek((pos / POSITION_UNIT).toInt()) } }
    }

    private fun updateSession(state: ReaderState) {
        val s = session ?: return
        s.setPlaybackState(playbackState(state.status, state.index))
        s.isActive = state.status == ReaderStatus.STARTING || state.status == ReaderStatus.READING || state.status == ReaderStatus.PAUSED
    }

    /** The piece number is shown as the position: one piece = one second on the shade's progress bar. */
    private fun playbackState(status: ReaderStatus, index: Int): PlaybackState {
        val code = when (status) {
            ReaderStatus.STARTING, ReaderStatus.READING -> PlaybackState.STATE_PLAYING
            ReaderStatus.PAUSED -> PlaybackState.STATE_PAUSED
            else -> PlaybackState.STATE_STOPPED
        }
        val actions = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
            PlaybackState.ACTION_STOP or PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS or
            PlaybackState.ACTION_SEEK_TO
        return PlaybackState.Builder()
            .setActions(actions)
            .setState(code, index * POSITION_UNIT, 0f) // speed 0: the bar moves when a new sentence starts, not on its own
            .build()
    }

    // ---------------------------------------------------------------------- notification

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        val channel = NotificationChannel(CHANNEL_ID, "Read aloud", NotificationManager.IMPORTANCE_LOW)
        channel.description = "Controls for the note MidNote is reading to you"
        channel.setShowBadge(false)
        manager.createNotificationChannel(channel)
    }

    private fun startForegroundNow(notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        foregroundStarted = true
    }

    private fun startOrUpdateNotification(state: ReaderState) {
        val notification = buildNotification(state)
        if (!foregroundStarted) {
            startForegroundNow(notification)
        } else {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            manager?.notify(NOTIFICATION_ID, notification)
        }
    }

    @Suppress("DEPRECATION")
    private fun stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(Service.STOP_FOREGROUND_REMOVE)
        } else {
            stopForeground(true)
        }
        foregroundStarted = false
    }

    private fun buildNotification(state: ReaderState): Notification {
        val playing = state.status == ReaderStatus.STARTING || state.status == ReaderStatus.READING
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
        val title = if (state.title.isEmpty()) "Read aloud" else state.title
        val progress = if (state.count > 0) "Sentence ${state.index + 1} of ${state.count}" else "Starting…"
        builder
            .setSmallIcon(R.drawable.midnote_reader_small)
            .setContentTitle(title)
            .setContentText(if (state.status == ReaderStatus.PAUSED) "Paused · $progress" else progress)
            .setContentIntent(openAppIntent())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .addAction(action(android.R.drawable.ic_media_previous, "Previous", ACTION_PREVIOUS, 1))
            .addAction(
                if (playing) action(android.R.drawable.ic_media_pause, "Pause", ACTION_PAUSE, 2)
                else action(android.R.drawable.ic_media_play, "Play", ACTION_PLAY, 3)
            )
            .addAction(action(android.R.drawable.ic_media_next, "Next", ACTION_NEXT, 4))
            .addAction(action(android.R.drawable.ic_menu_close_clear_cancel, "Stop", ACTION_STOP, 5))
        val style = Notification.MediaStyle().setShowActionsInCompactView(0, 1, 2)
        session?.let { style.setMediaSession(it.sessionToken) }
        builder.setStyle(style)
        return builder.build()
    }

    @Suppress("DEPRECATION")
    private fun action(icon: Int, label: String, action: String, code: Int): Notification.Action {
        val intent = Intent(this, ReaderService::class.java).setAction(action)
        val pending = PendingIntent.getService(this, code, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return Notification.Action.Builder(icon, label, pending).build()
    }

    private fun openAppIntent(): PendingIntent {
        val intent = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    // ---------------------------------------------------------------------------- misc

    private fun utteranceId(generation: Long, index: Int) = "r$generation:$index"

    private fun parse(id: String?): Pair<Long, Int>? {
        if (id == null || !id.startsWith("r")) return null
        val colon = id.indexOf(':')
        if (colon < 2) return null
        val g = id.substring(1, colon).toLongOrNull() ?: return null
        val i = id.substring(colon + 1).toIntOrNull() ?: return null
        return Pair(g, i)
    }

    companion object {
        private const val TAG = "MidNoteReader"
        private const val CHANNEL_ID = "midnote_reader"
        private const val NOTIFICATION_ID = 7421
        private const val POSITION_UNIT = 1000L
        private const val WAKE_LIMIT_MS = 4L * 60L * 60L * 1000L

        const val ACTION_START = "com.midmanstudio.midnote.reader.START"
        const val ACTION_PLAY = "com.midmanstudio.midnote.reader.PLAY"
        const val ACTION_PAUSE = "com.midmanstudio.midnote.reader.PAUSE"
        const val ACTION_TOGGLE = "com.midmanstudio.midnote.reader.TOGGLE"
        const val ACTION_NEXT = "com.midmanstudio.midnote.reader.NEXT"
        const val ACTION_PREVIOUS = "com.midmanstudio.midnote.reader.PREVIOUS"
        const val ACTION_STOP = "com.midmanstudio.midnote.reader.STOP"
    }
}
