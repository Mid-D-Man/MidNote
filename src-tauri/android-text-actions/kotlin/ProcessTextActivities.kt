// Brought to u by MidManStudio
//
// MidNote's two entries in Android's text-selection menu (select text in any app and open its "..." menu):
//   "MidNote: Read aloud"   and   "MidNote: Make a note"
//
// Android lists every activity that has an intent-filter for android.intent.action.PROCESS_TEXT there. Each of the two classes
// below is such an activity (src-tauri/android-text-actions/install.py writes the manifest entries). They show nothing: they
// take the selected text, hand it to MidNote as a link, and finish at once.
//
//   midnote://text/read?id=<fresh id>&t=<text, percent-encoded>[&cut=1]
//   midnote://text/note?id=<fresh id>&t=<text, percent-encoded>[&cut=1]
//
// The link goes to MainActivity, where the deep-link plugin already reports every midnote:// link to the page (the widget's
// buttons use the same door). The page (src/lib/utils/textLinks.ts) never creates anything from the link itself and ignores an
// id it has seen, because Android can hand a link over again. The activities return no result, so the app the text was
// selected in leaves it unchanged.
package com.midmanstudio.midnote

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import java.net.URLEncoder
import java.util.UUID

/** The parts that do not need Android: what is taken from a selection and the link it becomes. */
object ProcessTextCore {
    /**
     * The longest selection taken, in characters (the page cuts at the same number: src/lib/utils/textLinks.ts). The link travels in an
     * Intent, a Binder transaction of about 1 MB with the text held as UTF-16: 30000 characters of Chinese or Japanese become about
     * 270000 characters of link (540 KB), which fits; twice that would not and Android would refuse to start the app.
     */
    const val MAX_CHARS = 30000

    class Selection(val text: String, val cut: Boolean)

    /** The text to send, or null when there is nothing usable. Control characters go (a tab and a line feed stay); a long text is cut. */
    fun select(raw: CharSequence?): Selection? {
        if (raw == null) return null
        val cleaned = StringBuilder(raw.length)
        for (i in 0 until raw.length) {
            val ch = raw[i]
            if (ch == '\n' || ch == '\t' || (ch >= ' ' && ch != '\u007f')) cleaned.append(ch)
        }
        val text = cleaned.toString()
        if (text.isBlank()) return null
        if (text.length <= MAX_CHARS) return Selection(text, false)
        var end = MAX_CHARS
        // never end in the middle of a character that takes two chars
        if (Character.isHighSurrogate(text[end - 1])) end -= 1
        return Selection(text.substring(0, end), true)
    }

    /** Percent-encoding where a space is %20 (the page reads the link with URLSearchParams, which would turn a + into a space). */
    fun encode(text: String): String = URLEncoder.encode(text, "UTF-8").replace("+", "%20")

    fun link(mode: String, id: String, text: String, cut: Boolean): String =
        "midnote://text/" + mode + "?id=" + id + "&t=" + encode(text) + (if (cut) "&cut=1" else "")
}

/** Takes the selection from the intent, opens MidNote with the link and finishes. */
abstract class ProcessTextActivity(private val mode: String) : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            forward()
        } catch (e: Exception) {
            Log.w("MidNoteText", "could not hand the selection to MidNote", e)
        } finally {
            finish()
        }
    }

    private fun forward() {
        val selection = ProcessTextCore.select(intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)) ?: return
        val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return
        val id = UUID.randomUUID().toString().replace("-", "")
        launch.action = Intent.ACTION_VIEW
        launch.data = Uri.parse(ProcessTextCore.link(mode, id, selection.text, selection.cut))
        startActivity(launch)
    }
}

class ProcessTextReadActivity : ProcessTextActivity("read")

class ProcessTextNoteActivity : ProcessTextActivity("note")
