// Brought to u by MidManStudio
//
// The door between MidNote's page and the read-aloud service.
//
//   page -> phone   window.MidNoteReader.start(...) / pause() / resume() / ...   (ReaderBridge, below)
//   phone -> page   window.__midnoteReaderEvent(json)                            (ReaderHub.publish)
//
// ReaderBridge.install(...) is called from MainActivity.onWebViewCreate (src-tauri/android-reader/install.py adds that
// override to the generated MainActivity.kt). The page only ever loads MidNote's own files, so it is the only caller.
package com.midmanstudio.midnote

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import java.lang.ref.WeakReference

/** State shared by the bridge (page side) and the service. */
object ReaderHub {
    class Request(
        val id: String,
        val title: String,
        val pieces: List<String>,
        val index: Int,
        val voiceId: String,
        val rate: Float,
        val pitch: Float
    )

    val main = Handler(Looper.getMainLooper())

    @Volatile
    var service: ReaderService? = null

    @Volatile
    private var webView: WeakReference<WebView>? = null

    @Volatile
    private var lastState: String = ReaderWire.stateJson(ReaderState(ReaderStatus.IDLE, null, "", 0, 0, null))

    private var pending: Request? = null

    fun attach(view: WebView) {
        webView = WeakReference(view)
    }

    fun lastStateJson(): String = lastState

    /** The service asks for the request that started it. The text can be long, so it is not sent inside the Intent. */
    @Synchronized
    fun takePending(): Request? {
        val r = pending
        pending = null
        return r
    }

    @Synchronized
    private fun setPending(r: Request?) {
        pending = r
    }

    /** Tell the page. Runs the script on the WebView's own thread. */
    fun publish(state: ReaderState) {
        val json = ReaderWire.stateJson(state)
        lastState = json
        deliver(json)
    }

    private fun deliver(json: String) {
        val view = webView?.get() ?: return
        view.post {
            try {
                view.evaluateJavascript(ReaderWire.deliverScript(json), null)
            } catch (e: Exception) {
                Log.w("MidNoteReader", "event not delivered", e)
            }
        }
    }

    /** Start (or restart) a reading. Must be called while the app is on screen: Android 12+ will not start a foreground service from the background. */
    fun start(context: Context, request: Request) {
        setPending(request)
        val intent = Intent(context, ReaderService::class.java).setAction(ReaderService.ACTION_START)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
        } catch (e: Exception) {
            Log.e("MidNoteReader", "service did not start", e)
            setPending(null)
            publish(ReaderState(ReaderStatus.IDLE, null, "", 0, 0, "Android did not let MidNote start reading in the background."))
        }
    }

    /** Run a command on the service's thread; ignored when no reading is going on. */
    fun command(block: (ReaderCore) -> Unit) {
        main.post { service?.command(block) }
    }
}

class ReaderBridge(private val context: Context) {

    @JavascriptInterface
    fun available(): String = "1"

    @JavascriptInterface
    fun start(id: String, title: String, pieces: String, index: Int, voiceId: String, rate: String, pitch: String) {
        val list = ReaderWire.parsePieces(pieces)
        if (list.isEmpty()) {
            ReaderHub.publish(ReaderState(ReaderStatus.IDLE, null, "", 0, 0, "There is nothing to read."))
            return
        }
        ReaderHub.start(
            context,
            ReaderHub.Request(
                id,
                title,
                list,
                index,
                voiceId,
                ReaderWire.parseFloat(rate, 1.0f, 0.1f, 4.0f),
                ReaderWire.parseFloat(pitch, 1.0f, 0.1f, 4.0f)
            )
        )
    }

    @JavascriptInterface
    fun pause() = ReaderHub.command { it.pause() }

    @JavascriptInterface
    fun resume() = ReaderHub.command { it.resume() }

    @JavascriptInterface
    fun replay() = ReaderHub.command { it.replay() }

    @JavascriptInterface
    fun stop() = ReaderHub.command { it.stop() }

    @JavascriptInterface
    fun seek(index: Int) = ReaderHub.command { it.seek(index) }

    @JavascriptInterface
    fun next() = ReaderHub.command { it.next() }

    @JavascriptInterface
    fun previous() = ReaderHub.command { it.previous() }

    /** New voice / speed / pitch for the pieces spoken from now on. */
    @JavascriptInterface
    fun settings(voiceId: String, rate: String, pitch: String) {
        val r = ReaderWire.parseFloat(rate, 1.0f, 0.1f, 4.0f)
        val p = ReaderWire.parseFloat(pitch, 1.0f, 0.1f, 4.0f)
        ReaderHub.main.post { ReaderHub.service?.applySettings(voiceId, r, p) }
    }

    /** The last state sent to the page: lets the page catch up after it was paused or reloaded while the service kept reading. */
    @JavascriptInterface
    fun state(): String = ReaderHub.lastStateJson()

    companion object {
        /** Called from MainActivity.onWebViewCreate. */
        fun install(activity: Activity, webView: WebView) {
            ReaderHub.attach(webView)
            webView.addJavascriptInterface(ReaderBridge(activity.applicationContext), "MidNoteReader")
        }
    }
}
