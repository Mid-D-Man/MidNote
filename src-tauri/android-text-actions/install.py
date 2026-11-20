#!/usr/bin/env python3
# Brought to u by MidManStudio
"""
Adds MidNote's two entries to Android's text-selection menu ("MidNote: Read aloud" and "MidNote: Make a note") to the GENERATED
Android project (src-tauri/gen/android, which is not committed: `tauri android init` writes it fresh on every CI build).

What it does, in order:
  1. finds MainActivity.kt and reads its package (the new classes must live in the same package);
  2. copies kotlin/ProcessTextActivities.kt next to it, with the package line rewritten to match;
  3. adds two <activity> entries to AndroidManifest.xml, each with an intent-filter for android.intent.action.PROCESS_TEXT
     (mime type text/plain), which is what makes Android list them in the selection menu;
  4. checks its own work. Any problem stops it with a message that says what is wrong, and every file it had changed is put
     back, so the app still builds, without the menu entries.
MainActivity.kt is NOT changed: the selection reaches the app as a midnote:// link, through the deep-link plugin that is already
there. Running it twice changes nothing the second time.

Run from the repository root:  python3 src-tauri/android-text-actions/install.py [path/to/gen/android]
Only the Python standard library is used.
"""
import os
import re
import sys
import xml.etree.ElementTree as ET

ANDROID_NS = "http://schemas.android.com/apk/res/android"
ET.register_namespace("android", ANDROID_NS)
A = "{%s}" % ANDROID_NS

HERE = os.path.dirname(os.path.abspath(__file__))
KOTLIN_FILE = "ProcessTextActivities.kt"
# (class name in the manifest, label shown in the menu)
ACTIVITIES = [
    (".ProcessTextReadActivity", "MidNote: Read aloud"),
    (".ProcessTextNoteActivity", "MidNote: Make a note"),
]
ACTION = "android.intent.action.PROCESS_TEXT"
CATEGORY = "android.intent.category.DEFAULT"
MIME = "text/plain"
# draws nothing: the activity finishes in onCreate
THEME = "@android:style/Theme.Translucent.NoTitleBar"


class InstallError(Exception):
    pass


def fail(message):
    raise InstallError(message)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


CREATED = []  # files this run wrote that did not exist before
ORIGINALS = {}  # files this run changed -> their text before, so a failure can put them back


def remember(path):
    if path not in ORIGINALS:
        ORIGINALS[path] = read(path)


def find_main_activity(main_dir):
    hits = []
    for root, _dirs, files in os.walk(main_dir):
        if "MainActivity.kt" in files:
            hits.append(os.path.join(root, "MainActivity.kt"))
    if len(hits) != 1:
        fail("expected exactly one MainActivity.kt under %s, found %d: %s" % (main_dir, len(hits), hits))
    return hits[0]


def package_of(kotlin_path):
    m = re.search(r"^package\s+([A-Za-z0-9_.]+)\s*$", read(kotlin_path), re.MULTILINE)
    if not m:
        fail("no 'package' line in " + kotlin_path)
    return m.group(1)


def install_kotlin(main_activity):
    package = package_of(main_activity)
    src = read(os.path.join(HERE, "kotlin", KOTLIN_FILE))
    out, n = re.subn(r"^package\s+[A-Za-z0-9_.]+\s*$", "package " + package, src, count=1, flags=re.MULTILINE)
    if n != 1:
        fail("kotlin/%s has no package line to rewrite" % KOTLIN_FILE)
    target = os.path.join(os.path.dirname(main_activity), KOTLIN_FILE)
    if not os.path.exists(target):
        CREATED.append(target)
    write(target, out)
    return package, target


def verify_kotlin(path, package):
    text = read(path)
    if package_of(path) != package:
        fail("%s does not have the package %s" % (KOTLIN_FILE, package))
    for name, _label in ACTIVITIES:
        if not re.search(r"\bclass\s+%s\b" % re.escape(name.lstrip(".")), text):
            fail("%s does not define the class %s the manifest points to" % (KOTLIN_FILE, name.lstrip(".")))
    if re.search(r"(?<![\w.])R\.[a-z]+\.", text):
        fail("%s uses an R.* resource but this installer ships none" % KOTLIN_FILE)
    if text.count("{") != text.count("}"):
        fail("%s has unbalanced braces" % KOTLIN_FILE)


def patch_manifest(manifest_path):
    remember(manifest_path)
    tree = ET.parse(manifest_path)
    root = tree.getroot()
    app = root.find("application")
    if app is None:
        fail("AndroidManifest.xml has no <application>")
    for name, label in ACTIVITIES:
        for old in app.findall("activity"):
            if old.get(A + "name") == name:
                app.remove(old)  # replaced below, so running twice gives the same file
        activity = ET.SubElement(app, "activity")
        activity.set(A + "name", name)
        activity.set(A + "label", label)
        activity.set(A + "exported", "true")  # the system's selection menu starts it, so it must be reachable from outside
        activity.set(A + "theme", THEME)
        activity.set(A + "excludeFromRecents", "true")
        activity.set(A + "taskAffinity", "")  # opens over the app the text was selected in, not inside MidNote's own task
        intent_filter = ET.SubElement(activity, "intent-filter")
        ET.SubElement(intent_filter, "action").set(A + "name", ACTION)
        ET.SubElement(intent_filter, "category").set(A + "name", CATEGORY)
        ET.SubElement(intent_filter, "data").set(A + "mimeType", MIME)
    ET.indent(tree, space="    ")
    tree.write(manifest_path, encoding="utf-8", xml_declaration=True)


def verify_manifest(manifest_path):
    root = ET.parse(manifest_path).getroot()
    app = root.find("application")
    main = [a for a in app.findall("activity") if a.get(A + "name") == ".MainActivity"]
    if len(main) != 1:
        fail("the manifest lost its .MainActivity (found %d)" % len(main))
    for name, label in ACTIVITIES:
        found = [a for a in app.findall("activity") if a.get(A + "name") == name]
        if len(found) != 1:
            fail("expected one %s activity in the manifest, found %d" % (name, len(found)))
        a = found[0]
        if a.get(A + "exported") != "true":
            fail("%s must be exported (the system's selection menu starts it)" % name)
        if a.get(A + "label") != label:
            fail("%s has the wrong label" % name)
        filters = a.findall("intent-filter")
        if len(filters) != 1:
            fail("%s must have exactly one intent-filter" % name)
        f = filters[0]
        if [x.get(A + "name") for x in f.findall("action")] != [ACTION]:
            fail("%s's intent-filter must have the single action %s" % (name, ACTION))
        if [x.get(A + "name") for x in f.findall("category")] != [CATEGORY]:
            fail("%s's intent-filter must have the single category %s" % (name, CATEGORY))
        if [x.get(A + "mimeType") for x in f.findall("data")] != [MIME]:
            fail("%s's intent-filter must accept only %s" % (name, MIME))


def run():
    gen = sys.argv[1] if len(sys.argv) > 1 else os.path.join("src-tauri", "gen", "android")
    main_dir = os.path.join(gen, "app", "src", "main")
    manifest = os.path.join(main_dir, "AndroidManifest.xml")
    if not os.path.isfile(manifest):
        fail("no AndroidManifest.xml at %s (did 'tauri android init' run?)" % manifest)
    main_activity = find_main_activity(main_dir)
    package, kotlin_path = install_kotlin(main_activity)
    verify_kotlin(kotlin_path, package)
    patch_manifest(manifest)
    verify_manifest(manifest)
    CREATED.clear()
    ORIGINALS.clear()
    print("MidNote text-selection actions installed")
    print("  package  : " + package)
    print("  kotlin   : " + KOTLIN_FILE)
    print("  manifest : " + ", ".join("%s (%s)" % (n, l) for n, l in ACTIVITIES))


def main():
    try:
        run()
    except InstallError as e:
        for path, text in ORIGINALS.items():  # put every file it changed back
            try:
                write(path, text)
            except OSError:
                pass
        for path in CREATED:  # and take out every file it added (Kotlin without its manifest entries is harmless, but keep the tree as it was)
            try:
                os.remove(path)
            except OSError:
                pass
        print("TEXT-ACTIONS INSTALL FAILED: %s" % e, file=sys.stderr)
        if ORIGINALS or CREATED:
            print("(what it had already changed was put back, so the app builds without the menu entries)", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
