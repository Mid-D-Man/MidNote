// Brought to u by MidManStudio
//
// The reading state machine behind MidNote's background read-aloud (ReaderService.kt). NO Android classes in here, so it
// is tested on a plain JVM (src-tauri/android-reader/test/ReaderCoreTest.kt).
//
// A session is a list of PIECES (sentence-sized texts the app cut the note into) and a position (`index`). The core
// only decides what the speech engine should do next; the service owns the engine, the notification and the audio focus.
//
//   idle -> starting -> reading <-> paused
//                          \-> done          stop() from anywhere -> idle
//
// Every request to the engine carries a GENERATION number. pause / seek / stop / resume start a new generation, and a
// callback from an older one (the engine reporting that the piece we just cut off was stopped) is ignored. That is what
// keeps "I paused it" from looking like "the engine failed".
//
// LOOK-AHEAD: when piece i starts, piece i+1 is queued behind it, so there is no gap between sentences. Pause, seek and
// stop flush the queue.
package com.midmanstudio.midnote

enum class ReaderStatus(val wire: String) {
    IDLE("idle"),
    STARTING("starting"),
    READING("reading"),
    PAUSED("paused"),
    DONE("done")
}

/** What the app and the notification show. `message` is set when something went wrong (the status is then paused or idle). */
data class ReaderState(
    val status: ReaderStatus,
    val id: String?,
    val title: String,
    val index: Int,
    val count: Int,
    val message: String?
)

/** The speech engine as the core sees it. The service implements it with Android's TextToSpeech. */
interface ReaderEngine {
    /** Speak piece `index`. `flush` = cut off whatever is being spoken or queued first; otherwise wait behind it. */
    fun speak(generation: Long, index: Int, text: String, flush: Boolean)

    /** Silence the engine and empty its queue. */
    fun stop()
}

interface ReaderListener {
    fun onState(state: ReaderState)
}

class ReaderCore(private val engine: ReaderEngine, private val listener: ReaderListener) {
    private var pieces: List<String> = emptyList()
    private var id: String? = null
    private var title: String = ""
    private var index = 0
    private var status = ReaderStatus.IDLE
    private var message: String? = null

    /** Bumped by every start / pause / resume / seek / stop: older engine callbacks are ignored. */
    private var generation = 0L

    /** The highest piece handed to the engine in this generation. */
    private var queuedTo = -1

    val state: ReaderState
        get() = ReaderState(status, id, title, index, pieces.size, message)

    val active: Boolean
        get() = status == ReaderStatus.STARTING || status == ReaderStatus.READING

    // ------------------------------------------------------------------ requests

    /** Begin a new session at piece `from` (clamped). An empty list is refused with a message. */
    fun start(newId: String, newTitle: String, newPieces: List<String>, from: Int) {
        halt()
        if (newPieces.isEmpty()) {
            pieces = emptyList()
            id = null
            title = ""
            index = 0
            status = ReaderStatus.IDLE
            message = "There is nothing to read."
            publish()
            return
        }
        pieces = newPieces
        id = newId
        title = newTitle
        index = clamp(from)
        message = null
        begin()
    }

    fun pause() {
        if (!active) return
        halt()
        status = ReaderStatus.PAUSED
        publish()
    }

    /** Resume from the START of the piece we were on (Android's engine cannot pause mid-sentence). */
    fun resume() {
        when (status) {
            ReaderStatus.PAUSED -> {
                message = null
                begin()
            }
            ReaderStatus.DONE -> replay()
            else -> {}
        }
    }

    /** Read the whole thing again from the first piece. */
    fun replay() {
        if (pieces.isEmpty()) return
        halt()
        index = 0
        message = null
        begin()
    }

    /** Jump to piece `to`. While reading it reads on from there; while paused it only moves where Resume starts. */
    fun seek(to: Int) {
        if (pieces.isEmpty()) return
        val target = clamp(to)
        when (status) {
            ReaderStatus.STARTING, ReaderStatus.READING -> {
                halt()
                index = target
                begin()
            }
            ReaderStatus.PAUSED, ReaderStatus.DONE -> {
                index = target
                status = ReaderStatus.PAUSED
                message = null
                publish()
            }
            ReaderStatus.IDLE -> {}
        }
    }

    fun next() {
        if (pieces.isEmpty() || status == ReaderStatus.IDLE) return
        if (index + 1 >= pieces.size) {
            // past the last piece: that is the end of the reading
            halt()
            index = pieces.size - 1
            status = ReaderStatus.DONE
            publish()
        } else {
            seek(index + 1)
        }
    }

    fun previous() {
        if (pieces.isEmpty() || status == ReaderStatus.IDLE) return
        seek(index - 1)
    }

    /** End the session: silence, forget the text. */
    fun stop() {
        if (status == ReaderStatus.IDLE && id == null) return
        halt()
        pieces = emptyList()
        id = null
        title = ""
        index = 0
        status = ReaderStatus.IDLE
        message = null
        publish()
    }

    /** The engine or the phone could not do it (no speech engine installed, ...). Ends the session with a message. */
    fun fail(text: String) {
        halt()
        pieces = emptyList()
        id = null
        title = ""
        index = 0
        status = ReaderStatus.IDLE
        message = text
        publish()
    }

    // --------------------------------------------------------------- engine callbacks

    fun onEngineStart(gen: Long, piece: Int) {
        if (gen != generation || !active) return
        status = ReaderStatus.READING
        index = clamp(piece)
        publish()
        val ahead = index + 1
        if (ahead < pieces.size && queuedTo < ahead) {
            queuedTo = ahead
            engine.speak(generation, ahead, pieces[ahead], false)
        }
    }

    fun onEngineDone(gen: Long, piece: Int) {
        if (gen != generation || !active) return
        val ahead = piece + 1
        if (ahead >= pieces.size) {
            index = pieces.size - 1
            status = ReaderStatus.DONE
            publish()
        } else if (queuedTo < ahead) {
            // nothing was queued behind it (the look-ahead had not happened yet): hand over the next piece now
            index = ahead
            queuedTo = ahead
            engine.speak(generation, ahead, pieces[ahead], false)
        }
        // else: the engine already has the next piece and will report its start
    }

    fun onEngineError(gen: Long, piece: Int, text: String) {
        if (gen != generation || !active) return
        halt()
        index = clamp(piece)
        status = ReaderStatus.PAUSED
        message = text
        publish()
    }

    /** The engine was silenced by something else (another app took the speech engine, a call, ...): pause where we are. */
    fun onEngineInterrupted(gen: Long, piece: Int) {
        if (gen != generation || !active) return
        halt()
        index = clamp(piece)
        status = ReaderStatus.PAUSED
        publish()
    }

    // ----------------------------------------------------------------------- inside

    private fun begin() {
        generation += 1
        status = ReaderStatus.STARTING
        queuedTo = index
        publish()
        engine.speak(generation, index, pieces[index], true)
    }

    /** Silence the engine and make every callback from now on belong to an older generation. */
    private fun halt() {
        generation += 1
        queuedTo = -1
        engine.stop()
    }

    private fun clamp(i: Int): Int = if (pieces.isEmpty()) 0 else Math.max(0, Math.min(i, pieces.size - 1))

    private fun publish() = listener.onState(state)
}
