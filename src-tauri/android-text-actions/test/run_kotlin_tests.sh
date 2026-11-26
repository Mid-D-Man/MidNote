#!/bin/sh
# Compiles the Android-free parts of kotlin/ProcessTextActivities.kt with the tests and runs them. Needs kotlinc and a JVM.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
python3 - "$HERE/../kotlin/ProcessTextActivities.kt" "$TMP/pure.kt" <<'PY'
import sys, re
src = open(sys.argv[1], encoding="utf-8").read()
cut = src.index('/** "MidNote: Read aloud"')          # everything after this needs Android
body = src[:cut]
body = "\n".join(l for l in body.split("\n") if not l.startswith("import android."))
open(sys.argv[2], "w", encoding="utf-8").write(body)
PY
kotlinc "$TMP/pure.kt" "$HERE/SelectionReaderTest.kt" -include-runtime -d "$TMP/test.jar" 2>&1 | grep -v "^warning" || true
java -jar "$TMP/test.jar"
