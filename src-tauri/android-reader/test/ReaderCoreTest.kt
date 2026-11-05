// Brought to u by MidManStudio
//
// Tests for ReaderCore.kt and ReaderWire.kt. Plain Kotlin, no Android: run with
//   kotlinc ../kotlin/ReaderCore.kt ../kotlin/ReaderWire.kt ReaderCoreTest.kt -include-runtime -d test.jar && java -jar test.jar
package com.midmanstudio.midnote

var passed = 0
var failed = 0

fun check(name: String, ok: Boolean, detail: String = "") {
    if (ok) passed++ else {
        failed++
        println("FAIL $name $detail")
    }
}

class FakeEngine : ReaderEngine {
    class Call(val gen: Long, val index: Int, val text: String, val flush: Boolean)

    val calls = ArrayList<Call>()
    var stops = 0
    override fun speak(generation: Long, index: Int, text: String, flush: Boolean) {
        calls.add(Call(generation, index, text, flush))
    }

    override fun stop() {
        stops++
    }

    val last: Call get() = calls[calls.size - 1]
}

class Rec : ReaderListener {
    val states = ArrayList<ReaderState>()
    override fun onState(state: ReaderState) {
        states.add(state)
    }

    val last: ReaderState get() = states[states.size - 1]
}

class Rig {
    val engine = FakeEngine()
    val rec = Rec()
    val core = ReaderCore(engine, rec)
    val pieces = listOf("one", "two", "three")
    fun start(from: Int = 0) = core.start("n1", "My note", pieces, from)
    val gen: Long get() = engine.last.gen
}

fun desc(s: ReaderState) = "${s.status} ${s.index}/${s.count} ${s.message}"

fun main() {
    // ---- start
    run {
        val r = Rig()
        r.start()
        check("start: speaks piece 0 flushing", r.engine.calls.size == 1 && r.engine.last.index == 0 && r.engine.last.flush && r.engine.last.text == "one")
        check("start: state starting", r.rec.last.status == ReaderStatus.STARTING && r.rec.last.index == 0 && r.rec.last.count == 3 && r.rec.last.id == "n1" && r.rec.last.title == "My note", desc(r.rec.last))
        check("start: silences the engine first", r.engine.stops == 1)
        check("start: active", r.core.active)
    }
    run {
        val r = Rig(); r.start(99)
        check("start clamps high", r.rec.last.index == 2 && r.engine.last.index == 2, desc(r.rec.last))
        val r2 = Rig(); r2.start(-5)
        check("start clamps low", r2.rec.last.index == 0)
    }
    run {
        val r = Rig(); r.core.start("x", "t", emptyList(), 0)
        check("start with nothing: idle + message", r.rec.last.status == ReaderStatus.IDLE && r.rec.last.message == "There is nothing to read." && r.engine.calls.isEmpty(), desc(r.rec.last))
        check("start with nothing: not active", !r.core.active)
    }

    // ---- the normal run with look-ahead
    run {
        val r = Rig(); r.start()
        val g = r.gen
        r.core.onEngineStart(g, 0)
        check("reading after the engine starts", r.rec.last.status == ReaderStatus.READING && r.rec.last.index == 0)
        check("look-ahead queues piece 1 behind", r.engine.calls.size == 2 && r.engine.last.index == 1 && !r.engine.last.flush && r.engine.last.gen == g)
        r.core.onEngineDone(g, 0)
        check("done with a queued next: nothing more is sent", r.engine.calls.size == 2)
        check("done with a queued next: still reading", r.rec.last.status == ReaderStatus.READING)
        r.core.onEngineStart(g, 1)
        check("piece 1 starts: index moves", r.rec.last.index == 1 && r.rec.last.status == ReaderStatus.READING)
        check("look-ahead queues piece 2", r.engine.calls.size == 3 && r.engine.last.index == 2 && !r.engine.last.flush)
        r.core.onEngineDone(g, 1)
        r.core.onEngineStart(g, 2)
        check("last piece: no look-ahead", r.engine.calls.size == 3)
        r.core.onEngineDone(g, 2)
        check("finished: done at the last piece", r.rec.last.status == ReaderStatus.DONE && r.rec.last.index == 2, desc(r.rec.last))
        check("finished: not active", !r.core.active)
        val n = r.engine.calls.size
        r.core.onEngineStart(g, 1); r.core.onEngineDone(g, 1)
        check("after done, late callbacks are ignored", r.engine.calls.size == n && r.rec.last.status == ReaderStatus.DONE)
    }
    run {
        val r = Rig(); r.start()
        val g = r.gen
        r.core.onEngineDone(g, 0) // the engine finished piece 0 without ever reporting its start
        check("done before look-ahead: next piece handed over", r.engine.calls.size == 2 && r.engine.last.index == 1 && !r.engine.last.flush)
        check("done before look-ahead: index moved", r.rec.last.index == 1 || r.core.state.index == 1, desc(r.core.state))
    }
    run {
        val r = Rig(); r.core.start("n", "t", listOf("only"), 0)
        val g = r.gen
        r.core.onEngineStart(g, 0)
        check("single piece: no look-ahead", r.engine.calls.size == 1)
        r.core.onEngineDone(g, 0)
        check("single piece: done", r.rec.last.status == ReaderStatus.DONE && r.rec.last.index == 0)
    }

    run {
        val r = Rig(); r.start()
        val g = r.gen
        r.core.onEngineStart(g, 0); r.core.onEngineStart(g, 0)
        check("a repeated start event does not queue the next piece twice", r.engine.calls.size == 2, r.engine.calls.size.toString())
    }

    // ---- pause / resume
    run {
        val r = Rig(); r.start()
        val g = r.gen
        r.core.onEngineStart(g, 0); r.core.onEngineStart(g, 1)
        val stopsBefore = r.engine.stops
        r.core.pause()
        check("pause: state paused at the piece being spoken", r.rec.last.status == ReaderStatus.PAUSED && r.rec.last.index == 1, desc(r.rec.last))
        check("pause: engine silenced", r.engine.stops == stopsBefore + 1)
        check("pause: not active", !r.core.active)
        val calls = r.engine.calls.size
        r.core.onEngineDone(g, 1); r.core.onEngineStart(g, 2); r.core.onEngineError(g, 1, "boom"); r.core.onEngineInterrupted(g, 1)
        check("pause: callbacks of the cut-off generation are ignored", r.engine.calls.size == calls && r.rec.last.status == ReaderStatus.PAUSED && r.rec.last.message == null && r.rec.last.index == 1, desc(r.rec.last))
        r.core.resume()
        check("resume: speaks the SAME piece again, flushing, in a new generation", r.engine.last.index == 1 && r.engine.last.flush && r.engine.last.gen != g)
        check("resume: starting", r.rec.last.status == ReaderStatus.STARTING && r.rec.last.index == 1)
        val g2 = r.gen
        r.core.onEngineStart(g, 1)
        check("resume: the old generation still cannot move it", r.rec.last.status == ReaderStatus.STARTING)
        r.core.onEngineStart(g2, 1)
        check("resume: new generation does", r.rec.last.status == ReaderStatus.READING)
    }
    run {
        val r = Rig(); r.start()
        val n = r.rec.states.size
        r.core.pause(); r.core.pause()
        check("pause while starting works once", r.rec.last.status == ReaderStatus.PAUSED && r.rec.states.size == n + 1)
        r.core.resume(); r.core.resume()
        check("resume twice: second one is ignored", r.engine.calls.size == 2)
    }
    run {
        val r = Rig()
        r.core.pause(); r.core.resume(); r.core.stop(); r.core.next(); r.core.previous(); r.core.seek(1); r.core.replay()
        check("commands with no session do nothing", r.rec.states.isEmpty() && r.engine.calls.isEmpty() && r.engine.stops == 0)
    }

    run {
        val r = Rig(); r.start()
        val old = r.gen
        r.core.onEngineStart(old, 0)
        r.core.pause(); r.core.resume()
        val fresh = r.gen
        r.core.onEngineError(old, 0, "stale error")
        check("a stale error cannot pause the resumed reading", r.rec.last.status == ReaderStatus.STARTING && r.rec.last.message == null, desc(r.rec.last))
        r.core.onEngineInterrupted(old, 0)
        check("a stale interruption cannot pause the resumed reading", r.rec.last.status == ReaderStatus.STARTING, desc(r.rec.last))
        r.core.onEngineDone(old, 0)
        check("a stale done cannot move the resumed reading", r.rec.last.status == ReaderStatus.STARTING && r.engine.last.gen == fresh)
        r.core.onEngineError(fresh, 0, "real error")
        check("the current generation's error does pause it", r.rec.last.status == ReaderStatus.PAUSED && r.rec.last.message == "real error")
    }
    run {
        val r = Rig(); r.start()
        val old = r.gen
        r.core.seek(1)
        r.core.onEngineStart(old, 0)
        check("a start from before a seek cannot move the position", r.rec.last.index == 1 && r.rec.last.status == ReaderStatus.STARTING, desc(r.rec.last))
        r.core.onEngineDone(old, 0)
        check("a done from before a seek is ignored", r.engine.calls.size == 2 && r.rec.last.index == 1)
    }

    // ---- seek / next / previous
    run {
        val r = Rig(); r.start()
        val g = r.gen
        r.core.onEngineStart(g, 0)
        val stopsBeforeSeek = r.engine.stops
        r.core.seek(2)
        check("seek while reading: the engine is silenced first", r.engine.stops == stopsBeforeSeek + 1)
        check("seek while reading: reads on from there", r.engine.last.index == 2 && r.engine.last.flush && r.rec.last.index == 2 && r.rec.last.status == ReaderStatus.STARTING, desc(r.rec.last))
        r.core.onEngineStart(g, 0); r.core.onEngineDone(g, 0)
        check("seek: callbacks from before it are ignored", r.rec.last.index == 2 && r.rec.last.status == ReaderStatus.STARTING)
        r.core.seek(-3)
        check("seek clamps low", r.rec.last.index == 0)
        r.core.seek(50)
        check("seek clamps high", r.rec.last.index == 2)
    }
    run {
        val r = Rig(); r.start(); r.core.pause()
        val calls = r.engine.calls.size
        r.core.seek(2)
        check("seek while paused: moves the position only", r.rec.last.status == ReaderStatus.PAUSED && r.rec.last.index == 2 && r.engine.calls.size == calls)
        r.core.resume()
        check("seek while paused, then resume: starts at that piece", r.engine.last.index == 2 && r.engine.last.flush)
    }
    run {
        val r = Rig(); r.start()
        val g = r.gen
        r.core.onEngineStart(g, 0)
        r.core.next()
        check("next: piece 1", r.rec.last.index == 1 && r.engine.last.index == 1 && r.engine.last.flush)
        r.core.previous()
        check("previous: piece 0", r.rec.last.index == 0 && r.engine.last.index == 0)
        r.core.previous()
        check("previous at the start stays at piece 0", r.rec.last.index == 0)
        r.core.seek(2)
        val stops = r.engine.stops
        r.core.next()
        check("next past the end: done at the last piece, engine silenced", r.rec.last.status == ReaderStatus.DONE && r.rec.last.index == 2 && r.engine.stops == stops + 1, desc(r.rec.last))
    }

    // ---- stop / replay / done
    run {
        val r = Rig(); r.start()
        val g = r.gen
        r.core.onEngineStart(g, 0)
        r.core.stop()
        check("stop: idle, session forgotten", r.rec.last.status == ReaderStatus.IDLE && r.rec.last.id == null && r.rec.last.count == 0 && r.rec.last.title == "")
        val n = r.rec.states.size
        r.core.onEngineDone(g, 0); r.core.onEngineStart(g, 1)
        r.core.resume(); r.core.next(); r.core.stop()
        check("after stop nothing happens", r.rec.states.size == n)
    }
    run {
        val r = Rig(); r.start()
        val g = r.gen
        r.core.onEngineStart(g, 0); r.core.onEngineDone(g, 0); r.core.onEngineStart(g, 1); r.core.onEngineDone(g, 1); r.core.onEngineStart(g, 2); r.core.onEngineDone(g, 2)
        r.core.replay()
        check("replay: from the first piece", r.rec.last.status == ReaderStatus.STARTING && r.rec.last.index == 0 && r.engine.last.index == 0 && r.engine.last.flush)
    }
    run {
        val r = Rig(); r.start()
        val g = r.gen
        r.core.onEngineStart(g, 0); r.core.onEngineDone(g, 0); r.core.onEngineStart(g, 1); r.core.onEngineDone(g, 1); r.core.onEngineStart(g, 2); r.core.onEngineDone(g, 2)
        r.core.resume()
        check("resume when done = replay", r.engine.last.index == 0 && r.rec.last.index == 0)
    }
    run {
        val r = Rig(); r.start()
        val g = r.gen
        r.core.onEngineStart(g, 0); r.core.onEngineDone(g, 0); r.core.onEngineStart(g, 1); r.core.onEngineDone(g, 1); r.core.onEngineStart(g, 2); r.core.onEngineDone(g, 2)
        r.core.seek(1)
        check("seek when done: paused at that piece", r.rec.last.status == ReaderStatus.PAUSED && r.rec.last.index == 1)
    }

    // ---- errors and interruptions
    run {
        val r = Rig(); r.start()
        val g = r.gen
        r.core.onEngineStart(g, 0); r.core.onEngineDone(g, 0); r.core.onEngineStart(g, 1)
        r.core.onEngineError(g, 1, "The voice is still downloading.")
        check("error: paused at the failing piece with the message", r.rec.last.status == ReaderStatus.PAUSED && r.rec.last.index == 1 && r.rec.last.message == "The voice is still downloading.", desc(r.rec.last))
        val calls = r.engine.calls.size
        r.core.onEngineStart(g, 2); r.core.onEngineDone(g, 1)
        check("error: later callbacks ignored", r.engine.calls.size == calls && r.rec.last.index == 1)
        r.core.resume()
        check("error: resume retries that piece and clears the message", r.engine.last.index == 1 && r.rec.last.message == null)
    }
    run {
        val r = Rig(); r.start()
        val g = r.gen
        r.core.onEngineStart(g, 0)
        r.core.onEngineInterrupted(g, 0)
        check("interrupted: paused with no message", r.rec.last.status == ReaderStatus.PAUSED && r.rec.last.message == null && r.rec.last.index == 0)
    }
    run {
        val r = Rig(); r.start()
        r.core.fail("This phone has no text-to-speech engine.")
        check("fail: idle with the message", r.rec.last.status == ReaderStatus.IDLE && r.rec.last.message == "This phone has no text-to-speech engine." && r.rec.last.id == null)
    }

    // ---- a new session replaces the old one
    run {
        val r = Rig(); r.start()
        val g = r.gen
        r.core.onEngineStart(g, 0)
        r.core.start("n2", "Other", listOf("a", "b"), 0)
        check("new session: new id and count", r.rec.last.id == "n2" && r.rec.last.count == 2 && r.rec.last.title == "Other" && r.rec.last.status == ReaderStatus.STARTING)
        val n = r.engine.calls.size
        r.core.onEngineStart(g, 1); r.core.onEngineDone(g, 0)
        check("new session: the old one's callbacks are ignored", r.engine.calls.size == n && r.rec.last.index == 0)
    }
    run {
        val r = Rig(); r.start()
        check("generations only go up", r.engine.calls[0].gen > 0)
        r.core.pause(); r.core.resume(); r.core.seek(1)
        var up = true
        for (i in 1 until r.engine.calls.size) if (r.engine.calls[i].gen <= r.engine.calls[i - 1].gen) up = false
        check("generations strictly increase across pause/resume/seek", up)
    }
    run {
        val r = Rig(); r.start()
        r.core.onEngineStart(r.gen, 99)
        check("an out-of-range piece from the engine is clamped", r.rec.last.index == 2)
    }

    // ---- wire
    check("parsePieces: splits at the separator, trims, drops empties", ReaderWire.parsePieces(" a \u001e\u001e b\u001e  \u001ec") == listOf("a", "b", "c"), ReaderWire.parsePieces(" a \u001e\u001e b\u001e  \u001ec").toString())
    check("parsePieces: line breaks stay inside a piece", ReaderWire.parsePieces("one\ntwo\u001ethree\r\nfour") == listOf("one\ntwo", "three\r\nfour"), ReaderWire.parsePieces("one\ntwo\u001ethree\r\nfour").toString())
    check("parsePieces: empty", ReaderWire.parsePieces("").isEmpty() && ReaderWire.parsePieces(" \u001e ").isEmpty() && ReaderWire.parsePieces("\n").isEmpty())
    check("separator is U+001E", ReaderWire.PIECE_SEPARATOR == '\u001e')
    check("parseFloat: ok", ReaderWire.parseFloat("1.5", 1f, 0.1f, 4f) == 1.5f)
    check("parseFloat: trims", ReaderWire.parseFloat(" 2 ", 1f, 0.1f, 4f) == 2f)
    check("parseFloat: junk falls back", ReaderWire.parseFloat("fast", 1.25f, 0.1f, 4f) == 1.25f)
    check("parseFloat: null falls back", ReaderWire.parseFloat(null, 1.25f, 0.1f, 4f) == 1.25f)
    check("parseFloat: NaN falls back", ReaderWire.parseFloat("NaN", 1.25f, 0.1f, 4f) == 1.25f)
    check("parseFloat: Infinity falls back", ReaderWire.parseFloat("Infinity", 1.25f, 0.1f, 4f) == 1.25f)
    check("parseFloat: clamps high", ReaderWire.parseFloat("99", 1f, 0.1f, 4f) == 4f)
    check("parseFloat: clamps low", ReaderWire.parseFloat("0", 1f, 0.1f, 4f) == 0.1f)
    check("jsonString: plain", ReaderWire.jsonString("abc") == "\"abc\"")
    check("jsonString: quote and backslash", ReaderWire.jsonString("a\"b\\c") == "\"a\\\"b\\\\c\"", ReaderWire.jsonString("a\"b\\c"))
    check("jsonString: newline, return, tab", ReaderWire.jsonString("a\nb\rc\td") == "\"a\\nb\\rc\\td\"")
    check("jsonString: other control character", ReaderWire.jsonString("a\u0001b") == "\"a\\u0001b\"", ReaderWire.jsonString("a\u0001b"))
    check("jsonString: line separators are escaped", ReaderWire.jsonString("a\u2028b\u2029c") == "\"a\\u2028b\\u2029c\"")
    check("jsonString: unicode passes through", ReaderWire.jsonString("héllo 👩‍💻") == "\"héllo 👩‍💻\"")
    val st = ReaderState(ReaderStatus.PAUSED, "id\"1", "T", 3, 40, null)
    check("stateJson exact", ReaderWire.stateJson(st) == "{\"type\":\"state\",\"status\":\"paused\",\"id\":\"id\\\"1\",\"index\":3,\"count\":40,\"message\":null}", ReaderWire.stateJson(st))
    val st2 = ReaderState(ReaderStatus.IDLE, null, "", 0, 0, "Oops \"x\"")
    check("stateJson null id and a message", ReaderWire.stateJson(st2) == "{\"type\":\"state\",\"status\":\"idle\",\"id\":null,\"index\":0,\"count\":0,\"message\":\"Oops \\\"x\\\"\"}", ReaderWire.stateJson(st2))
    check("deliverScript wraps the json as one string", ReaderWire.deliverScript("{\"a\":\"b\"}") == "window.__midnoteReaderEvent&&window.__midnoteReaderEvent(\"{\\\"a\\\":\\\"b\\\"}\")", ReaderWire.deliverScript("{\"a\":\"b\"}"))
    for (s in ReaderStatus.values()) check("wire name of ${s.name}", s.wire == s.name.toLowerCase())

    println("pass $passed fail $failed")
    if (failed > 0) System.exit(1)
}
