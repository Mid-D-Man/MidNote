// Brought to u by MidManStudio
//
// MidNote's two entries in Android's text-selection menu (select text in any app and open its "..." menu):
//   "MidNote: Read aloud"   and   "MidNote: Make a note"
//
// Android lists every activity that has an intent-filter for android.intent.action.PROCESS_TEXT there. Each of the two classes
// below is such an activity (src-tauri/android-text-actions/install.py writes the manifest entries). They draw nothing and
// finish at once.
//
//   Read aloud  runs WITHOUT opening MidNote: the selection is cut into spoken pieces (SelectionReader) and handed straight to
//               the read-aloud service (ReaderHub.start, src-tauri/android-reader), which shows its media notification and
//               keeps reading with the screen off. The voice, speed and pitch are the ones last used in the app (ReaderPrefs).
//               This file is only installed in this form when the reader's Kotlin is in the build (install.py checks):
//               otherwise ProcessTextActivities.forward.txt is installed, which hands the text to the app instead.
//   Make a note hands the text to MidNote as a link, midnote://text/note?id=<fresh id>&t=<text, percent-encoded>[&cut=1],
//               which goes to MainActivity, where the deep-link plugin already reports every midnote:// link to the page (the
//               widget's buttons use the same door). The page (src/lib/utils/textLinks.ts) never creates anything from the link
//               itself and ignores an id it has seen, because Android can hand a link over again.
// Neither returns a result, so the app the text was selected in leaves it unchanged.
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
     * The longest selection taken for a note, in characters (the page cuts at the same number: src/lib/utils/textLinks.ts). The link travels in an
     * Intent, a Binder transaction of about 1 MB with the text held as UTF-16: 30000 characters of Chinese or Japanese become about
     * 270000 characters of link (540 KB), which fits; twice that would not and Android would refuse to start the app.
     */
    const val MAX_CHARS = 30000

    class Selection(val text: String, val cut: Boolean)

    /** The text to send, or null when there is nothing usable. Control characters go (a tab and a line feed stay); a long text is cut. */
    fun select(raw: CharSequence?, maxChars: Int = MAX_CHARS): Selection? {
        if (raw == null) return null
        val cleaned = StringBuilder(raw.length)
        for (i in 0 until raw.length) {
            val ch = raw[i]
            if (ch == '\n' || ch == '\t' || (ch >= ' ' && ch != '\u007f')) cleaned.append(ch)
        }
        val text = cleaned.toString()
        if (text.isBlank()) return null
        if (text.length <= maxChars) return Selection(text, false)
        var end = maxChars
        // never end in the middle of a character that takes two chars
        if (Character.isHighSurrogate(text[end - 1])) end -= 1
        return Selection(text.substring(0, end), true)
    }

    /** Percent-encoding where a space is %20 (the page reads the link with URLSearchParams, which would turn a + into a space). */
    fun encode(text: String): String = URLEncoder.encode(text, "UTF-8").replace("+", "%20")

    fun link(mode: String, id: String, text: String, cut: Boolean): String =
        "midnote://text/" + mode + "?id=" + id + "&t=" + encode(text) + (if (cut) "&cut=1" else "")
}

/**
 * A selection cut into the pieces the read-aloud service speaks. The same idea as the page's splitForSpeech (src/lib/utils/speech.ts):
 * a blank line starts a new paragraph, the lines of one paragraph are joined, a paragraph is cut after sentence ends, and sentences are
 * packed into pieces of at most MAX_PIECE_CHARS (Android's engine refuses a piece over 4000 characters). No Android classes: tested
 * on a plain JVM.
 */
object SelectionReader {
    const val MAX_PIECE_CHARS = 1200

    /** A selection this long is read; the rest is left (it all travels in memory, not in an Intent). */
    const val MAX_READ_CHARS = 200000

    private fun isEnd(c: Char): Boolean = c == '.' || c == '!' || c == '?' || c == '\u3002' || c == '\uFF01' || c == '\uFF1F' || c == '\u2026'

    private fun isCjkEnd(c: Char): Boolean = c == '\u3002' || c == '\uFF01' || c == '\uFF1F'

    private fun isCloser(c: Char): Boolean = c == '"' || c == '\'' || c == ')' || c == ']' || c == '\u201D' || c == '\u2019'

    /** One paragraph cut after each sentence end (a full stop inside "3.5" or "a.b" is not one: a space has to follow, except after CJK marks). */
    fun sentences(paragraph: String): List<String> {
        val out = ArrayList<String>()
        val cur = StringBuilder()
        var i = 0
        val n = paragraph.length
        while (i < n) {
            val c = paragraph[i]
            cur.append(c)
            if (isEnd(c)) {
                while (i + 1 < n && isCloser(paragraph[i + 1])) {
                    i++
                    cur.append(paragraph[i])
                }
                if (i + 1 >= n || paragraph[i + 1].isWhitespace() || isCjkEnd(c)) {
                    val s = cur.toString().trim()
                    if (s.isNotEmpty()) out.add(s)
                    cur.setLength(0)
                }
            }
            i++
        }
        val rest = cur.toString().trim()
        if (rest.isNotEmpty()) out.add(rest)
        return out
    }

    /** A run longer than `max` cut into parts of at most `max`, never in the middle of a character that takes two chars. */
    fun hardSplit(s: String, max: Int): List<String> {
        val out = ArrayList<String>()
        var start = 0
        while (start < s.length) {
            var end = Math.min(start + max, s.length)
            if (end < s.length && Character.isHighSurrogate(s[end - 1])) end -= 1
            if (end <= start) end = Math.min(start + max, s.length)
            val part = s.substring(start, end).trim()
            if (part.isNotEmpty()) out.add(part)
            start = end
        }
        return out
    }

    fun pieces(text: String, max: Int = MAX_PIECE_CHARS): List<String> {
        val out = ArrayList<String>()
        val paragraphs = text.replace("\r\n", "\n").replace('\r', '\n').split(Regex("\n[ \t]*\n"))
        for (paragraph in paragraphs) {
            val joined = paragraph.split('\n').map { it.trim() }.filter { it.isNotEmpty() }.joinToString(" ")
            if (joined.isEmpty()) continue
            val cur = StringBuilder()
            for (sentence in sentences(joined)) {
                if (sentence.length > max) {
                    if (cur.isNotEmpty()) {
                        out.add(cur.toString())
                        cur.setLength(0)
                    }
                    out.addAll(hardSplit(sentence, max))
                    continue
                }
                if (cur.isNotEmpty() && cur.length + 1 + sentence.length > max) {
                    out.add(cur.toString())
                    cur.setLength(0)
                }
                if (cur.isNotEmpty()) cur.append(' ')
                cur.append(sentence)
            }
            if (cur.isNotEmpty()) out.add(cur.toString())
        }
        return out
    }
}

/** "MidNote: Read aloud": starts the read-aloud service with the selection and finishes. MidNote itself is not opened. */
class ProcessTextReadActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            read()
        } catch (e: Exception) {
            Log.w("MidNoteText", "could not start reading the selection", e)
        } finally {
            finish()
        }
    }

    private fun read() {
        val selection = ProcessTextCore.select(intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT), SelectionReader.MAX_READ_CHARS) ?: return
        val pieces = SelectionReader.pieces(selection.text)
        if (pieces.isEmpty()) return
        val saved = ReaderPrefs.load(applicationContext)
        val id = UUID.randomUUID().toString().replace("-", "")
        // a visible activity may start the foreground service (Android 12+ refuses it from the background): this one is on screen right now
        ReaderHub.start(applicationContext, ReaderHub.Request(id, "Selected text", pieces, 0, saved.voiceId, saved.rate, saved.pitch))
    }
}

/** "MidNote: Make a note": opens MidNote with the text as a link and finishes. */
class ProcessTextNoteActivity : Activity() {
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
        launch.data = Uri.parse(ProcessTextCore.link("note", id, selection.text, selection.cut))
        startActivity(launch)
    }
}
