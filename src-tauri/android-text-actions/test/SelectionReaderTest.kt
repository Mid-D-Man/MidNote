// Brought to u by MidManStudio
//
// Tests for the parts of kotlin/ProcessTextActivities.kt that need no Android: ProcessTextCore and SelectionReader. The test
// script (run_kotlin_tests.sh) cuts those two objects out of the file and compiles them with this file:
//   kotlinc pure.kt SelectionReaderTest.kt -include-runtime -d test.jar && java -jar test.jar
package com.midmanstudio.midnote

var passed = 0
var failed = 0

fun check(name: String, ok: Boolean, detail: String = "") {
    if (ok) passed++ else {
        failed++
        println("FAIL $name $detail")
    }
}

fun main() {
    // ---- sentences
    check("three sentences", SelectionReader.sentences("Hello world. How are you? Fine!") == listOf("Hello world.", "How are you?", "Fine!"))
    check("a decimal point is not a sentence end", SelectionReader.sentences("It costs 3.5 million dollars.") == listOf("It costs 3.5 million dollars."))
    check("closing quotes stay with their sentence", SelectionReader.sentences("He said \"go.\" Then he left.") == listOf("He said \"go.\"", "Then he left."))
    check("CJK full stops need no space", SelectionReader.sentences("\u4f60\u597d\u3002\u518d\u89c1\uff01") == listOf("\u4f60\u597d\u3002", "\u518d\u89c1\uff01"))
    check("no final stop", SelectionReader.sentences("First one. And then") == listOf("First one.", "And then"))
    check("only spaces", SelectionReader.sentences("   ").isEmpty())
    check("ellipsis char", SelectionReader.sentences("Well\u2026 maybe.") == listOf("Well\u2026", "maybe."))
    check("a stop at the very end", SelectionReader.sentences("Done.") == listOf("Done."))
    check("a.b is one", SelectionReader.sentences("see a.b now") == listOf("see a.b now"))

    // ---- hardSplit
    val parts = SelectionReader.hardSplit("a".repeat(25), 10)
    check("hardSplit sizes", parts.map { it.length } == listOf(10, 10, 5))
    val pair = "\uD83D\uDE00" // one emoji = two chars
    val emoji = SelectionReader.hardSplit("ab" + pair + pair + "cd", 3)
    check("hardSplit never cuts an emoji", emoji.all { p -> !(p.isNotEmpty() && Character.isHighSurrogate(p.last())) && !(p.isNotEmpty() && Character.isLowSurrogate(p.first())) }, emoji.toString())
    check("hardSplit keeps all characters", emoji.joinToString("") == "ab" + pair + pair + "cd")
    check("hardSplit of nothing", SelectionReader.hardSplit("", 5).isEmpty())

    // ---- pieces
    check("empty text", SelectionReader.pieces("").isEmpty())
    check("blank text", SelectionReader.pieces("  \n \n\t\n").isEmpty())
    check("one short line is one piece", SelectionReader.pieces("Just this.") == listOf("Just this."))
    check("lines of one paragraph are joined", SelectionReader.pieces("one\ntwo\nthree") == listOf("one two three"))
    check("a blank line starts a new piece", SelectionReader.pieces("First para.\n\nSecond para.") == listOf("First para.", "Second para."))
    check("windows line endings", SelectionReader.pieces("A.\r\n\r\nB.") == listOf("A.", "B."))
    check("a blank line with spaces in it", SelectionReader.pieces("A.\n   \nB.") == listOf("A.", "B."))
    val sentence = "This is a sentence of moderate length. "
    val long = sentence.repeat(100).trim()
    val packed = SelectionReader.pieces(long, 200)
    check("every piece fits", packed.all { it.length <= 200 }, packed.map { it.length }.toString())
    check("pieces are whole sentences", packed.all { it.endsWith(".") })
    check("nothing is lost", packed.joinToString(" ") == long)
    check("more than one piece", packed.size > 5)
    val hugeRun = "x".repeat(5000)
    val cut = SelectionReader.pieces(hugeRun, 1200)
    check("a run with no stops is hard-split", cut.map { it.length } == listOf(1200, 1200, 1200, 1200, 200))
    val mixed = SelectionReader.pieces("Short one. " + "y".repeat(300) + ". Short two.", 100)
    check("a long sentence between short ones", mixed.first() == "Short one." && mixed.last() == "Short two." && mixed.map { it.length } == listOf(10, 100, 100, 100, 1, 10), mixed.map { it.length }.toString())
    check("the default piece size is below the engine limit", SelectionReader.MAX_PIECE_CHARS < 4000)
    val para1 = "Alpha. ".repeat(3).trim()
    val para2 = "Beta. ".repeat(3).trim()
    check("paragraphs are never merged", SelectionReader.pieces(para1 + "\n\n" + para2, 1200) == listOf(para1, para2))

    // ---- select (ProcessTextCore)
    check("null is nothing", ProcessTextCore.select(null) == null)
    check("blank is nothing", ProcessTextCore.select("  \n ") == null)
    check("control characters go, tab and newline stay", ProcessTextCore.select("a\u0001b\tc\nd\u007fe")!!.text == "ab\tc\nde")
    check("under the limit is not cut", !ProcessTextCore.select("hello")!!.cut)
    val over = ProcessTextCore.select("z".repeat(50), 20)!!
    check("over the limit is cut", over.cut && over.text.length == 20)
    val emojiText = "a".repeat(19) + pair + pair
    val emojiSel = ProcessTextCore.select(emojiText, 20)!!
    check("a cut never ends inside an emoji", emojiSel.cut && !Character.isHighSurrogate(emojiSel.text.last()), emojiSel.text.length.toString())
    check("the read limit is larger than the note limit", SelectionReader.MAX_READ_CHARS > ProcessTextCore.MAX_CHARS)
    check("link", ProcessTextCore.link("note", "abc", "a b+c", false) == "midnote://text/note?id=abc&t=a%20b%2Bc")
    check("link with cut", ProcessTextCore.link("note", "abc", "x", true).endsWith("&cut=1"))

    println("$passed passed, $failed failed")
    if (failed > 0) System.exit(1)
}
