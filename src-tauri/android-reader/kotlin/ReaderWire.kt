// Brought to u by MidManStudio
//
// How the read-aloud service and the app's page talk. No Android classes: tested on a plain JVM.
//
//   page -> phone: calls on window.MidNoteReader (see ReaderBridge.kt): start(...), pause(), resume() ...
//   phone -> page: one JSON text per change, handed to window.__midnoteReaderEvent(text):
//       {"type":"state","status":"reading","id":"...","index":3,"count":40,"message":null}
//
// The text of the pieces travels as ONE string, pieces separated by the character U+001E (RECORD SEPARATOR). A piece may
// itself hold line breaks (the app joins short lines into one piece), so a newline cannot be the separator.
package com.midmanstudio.midnote

object ReaderWire {
    const val PIECE_SEPARATOR = '\u001e'

    /** The pieces from the one string the page sends: split at the separator, trimmed, empty ones dropped. */
    fun parsePieces(joined: String): List<String> =
        joined.split(PIECE_SEPARATOR).map { it.trim() }.filter { it.isNotEmpty() }

    /** A decimal number from the page, or `fallback` when it is missing, not a number, or not finite. */
    fun parseFloat(text: String?, fallback: Float, min: Float, max: Float): Float {
        val v = text?.trim()?.toFloatOrNull() ?: return fallback
        if (v.isNaN() || v.isInfinite()) return fallback
        return Math.max(min, Math.min(max, v))
    }

    /** `s` as a JSON string literal, quotes included. Control characters and the two that can break a script are escaped. */
    fun jsonString(s: String): String {
        val out = StringBuilder(s.length + 2)
        out.append('"')
        for (c in s) {
            when (c) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\n' -> out.append("\\n")
                '\r' -> out.append("\\r")
                '\t' -> out.append("\\t")
                '\u2028' -> out.append("\\u2028")
                '\u2029' -> out.append("\\u2029")
                else -> if (c < ' ') out.append(String.format("\\u%04x", c.toInt())) else out.append(c)
            }
        }
        out.append('"')
        return out.toString()
    }

    fun stateJson(s: ReaderState): String =
        "{\"type\":\"state\",\"status\":" + jsonString(s.status.wire) +
            ",\"id\":" + (if (s.id == null) "null" else jsonString(s.id)) +
            ",\"index\":" + s.index +
            ",\"count\":" + s.count +
            ",\"message\":" + (if (s.message == null) "null" else jsonString(s.message)) + "}"

    /** The JavaScript the phone runs in the page to deliver one event. `json` is already a JSON text. */
    fun deliverScript(json: String): String =
        "window.__midnoteReaderEvent&&window.__midnoteReaderEvent(" + jsonString(json) + ")"
}
