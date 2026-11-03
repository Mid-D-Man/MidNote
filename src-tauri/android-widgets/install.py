#!/usr/bin/env python3
# Brought to u by MidManStudio
"""
Adds the MidNote home-screen widget to the GENERATED Android project (src-tauri/gen/android, which is not committed:
`tauri android init` writes it fresh on every CI build).

What it does, in order:
  1. finds MainActivity.kt and reads its package (the widget class must live in the same package as MainActivity);
  2. copies kotlin/MidNoteWidget.kt next to it, with the package line rewritten to match;
  3. copies res/ (layout, xml, drawables, strings: every name starts with midnote_widget) into the project's res/;
  4. adds the <receiver> for the widget to AndroidManifest.xml (once: running it twice changes nothing);
  5. checks its own work: the receiver is in the manifest, every resource it names exists, and every R.id / R.layout the
     Kotlin code uses is defined in the layout. Any problem stops the build with a message that says what is wrong.

Run from the repository root:  python3 src-tauri/android-widgets/install.py [path/to/gen/android]
Only the Python standard library is used.
"""
import os
import re
import shutil
import sys
import xml.etree.ElementTree as ET

ANDROID_NS = "http://schemas.android.com/apk/res/android"
ET.register_namespace("android", ANDROID_NS)
A = "{%s}" % ANDROID_NS

HERE = os.path.dirname(os.path.abspath(__file__))
PROVIDER_CLASS = "MidNoteWidget"
RECEIVER_NAME = "." + PROVIDER_CLASS


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


CREATED = []  # files this run wrote, so a failure BEFORE the manifest is touched can take them out again


def install_kotlin(main_activity):
    package = package_of(main_activity)
    src = read(os.path.join(HERE, "kotlin", PROVIDER_CLASS + ".kt"))
    out, n = re.subn(r"^package\s+[A-Za-z0-9_.]+\s*$", "package " + package, src, count=1, flags=re.MULTILINE)
    if n != 1:
        fail("kotlin/%s.kt has no package line to rewrite" % PROVIDER_CLASS)
    target = os.path.join(os.path.dirname(main_activity), PROVIDER_CLASS + ".kt")
    write(target, out)
    CREATED.append(target)
    return package, target


def install_resources(main_dir):
    res_src = os.path.join(HERE, "res")
    copied = []
    for root, _dirs, files in os.walk(res_src):
        for name in sorted(files):
            if not name.startswith("midnote_widget"):
                fail("res/%s does not start with midnote_widget: it could clash with the app's own resources" % name)
            rel = os.path.relpath(os.path.join(root, name), res_src)
            dest = os.path.join(main_dir, "res", rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)  # the template has no res/xml, res/layout or res/drawable
            shutil.copyfile(os.path.join(root, name), dest)
            CREATED.append(dest)
            copied.append(rel)
    if not copied:
        fail("no resource files found in " + res_src)
    return sorted(copied)


def patch_manifest(manifest_path):
    tree = ET.parse(manifest_path)
    root = tree.getroot()
    app = root.find("application")
    if app is None:
        fail("AndroidManifest.xml has no <application>")
    for old in app.findall("receiver"):
        if old.get(A + "name") == RECEIVER_NAME:
            app.remove(old)  # replaced below, so running twice gives the same file
    receiver = ET.SubElement(app, "receiver")
    receiver.set(A + "name", RECEIVER_NAME)
    # Only Android itself (the launcher's widget service) sends this broadcast, so nothing outside needs to reach us.
    receiver.set(A + "exported", "false")
    receiver.set(A + "label", "@string/midnote_widget_label")
    intent_filter = ET.SubElement(receiver, "intent-filter")
    action = ET.SubElement(intent_filter, "action")
    action.set(A + "name", "android.appwidget.action.APPWIDGET_UPDATE")
    meta = ET.SubElement(receiver, "meta-data")
    meta.set(A + "name", "android.appwidget.provider")
    meta.set(A + "resource", "@xml/midnote_widget_info")
    ET.indent(tree, space="    ")  # one element per line, like the other manifest steps
    tree.write(manifest_path, encoding="utf-8", xml_declaration=True)


def collect_defined(res_dir):
    """The names our own resource files define, and the files they are in."""
    defined = {"layout": set(), "xml": set(), "drawable": set(), "string": set(), "id": set()}
    ours = []
    for root_dir, _dirs, files in os.walk(res_dir):
        for name in files:
            if not name.startswith("midnote_widget"):
                continue
            path = os.path.join(root_dir, name)
            ours.append(path)
            kind = os.path.basename(root_dir)
            text = read(path)
            if kind in ("layout", "xml", "drawable"):
                defined[kind].add(os.path.splitext(name)[0])
            for m in re.finditer(r'<string\s+name="([^"]+)"', text):
                defined["string"].add(m.group(1))
            for m in re.finditer(r'@\+id/([A-Za-z0-9_]+)', text):
                defined["id"].add(m.group(1))
    return defined, ours


def verify_resources(main_dir, main_activity):
    """Before the manifest is touched: every resource our files name exists, and the Kotlin only uses real ids."""
    res_dir = os.path.join(main_dir, "res")
    defined, ours = collect_defined(res_dir)
    for path in ours:
        text = read(path)
        for m in re.finditer(r'@(layout|xml|drawable|string)/([A-Za-z0-9_]+)', text):
            if m.group(2) not in defined[m.group(1)]:
                fail("%s uses @%s/%s but nothing defines it" % (os.path.relpath(path, res_dir), m.group(1), m.group(2)))
    kotlin = read(os.path.join(os.path.dirname(main_activity), PROVIDER_CLASS + ".kt"))
    for m in re.finditer(r"\bR\.layout\.([A-Za-z0-9_]+)", kotlin):
        if m.group(1) not in defined["layout"]:
            fail("%s.kt uses R.layout.%s which does not exist" % (PROVIDER_CLASS, m.group(1)))
    for m in re.finditer(r"\bR\.id\.([A-Za-z0-9_]+)", kotlin):
        if m.group(1) not in defined["id"]:
            fail("%s.kt uses R.id.%s which no layout defines" % (PROVIDER_CLASS, m.group(1)))
    return defined


def verify_manifest(manifest_path, defined):
    root = ET.parse(manifest_path).getroot()
    app = root.find("application")
    receivers = [r for r in app.findall("receiver") if r.get(A + "name") == RECEIVER_NAME]
    if len(receivers) != 1:
        fail("expected one %s receiver in the manifest, found %d" % (RECEIVER_NAME, len(receivers)))
    r = receivers[0]
    actions = [a.get(A + "name") for a in r.iter("action")]
    if "android.appwidget.action.APPWIDGET_UPDATE" not in actions:
        fail("the receiver has no APPWIDGET_UPDATE action")
    metas = [m for m in r.findall("meta-data") if m.get(A + "name") == "android.appwidget.provider"]
    if len(metas) != 1 or metas[0].get(A + "resource") != "@xml/midnote_widget_info":
        fail("the receiver has no android.appwidget.provider meta-data pointing at @xml/midnote_widget_info")
    for m in re.finditer(r'@(layout|xml|drawable|string)/(midnote_widget[A-Za-z0-9_]*)', read(manifest_path)):
        if m.group(2) not in defined[m.group(1)]:
            fail("AndroidManifest.xml uses @%s/%s but nothing defines it" % (m.group(1), m.group(2)))


def check_main_activity(manifest_path):
    """The widget's links start MainActivity; it must stay the singleTask activity, or a tap would open a second app."""
    app = ET.parse(manifest_path).getroot().find("application")
    if app is None:
        fail("AndroidManifest.xml has no <application>")
    activities = [a for a in app.findall("activity") if a.get(A + "name", "").endswith("MainActivity")]
    if len(activities) != 1 or activities[0].get(A + "launchMode") != "singleTask":
        fail("MainActivity is not singleTask in the manifest: a widget tap would start a second copy of the app")


def run():
    gen = sys.argv[1] if len(sys.argv) > 1 else os.path.join("src-tauri", "gen", "android")
    main_dir = os.path.join(gen, "app", "src", "main")
    manifest = os.path.join(main_dir, "AndroidManifest.xml")
    if not os.path.isfile(manifest):
        fail("no AndroidManifest.xml at %s (did 'tauri android init' run?)" % manifest)
    check_main_activity(manifest)
    main_activity = find_main_activity(main_dir)
    package, kotlin_path = install_kotlin(main_activity)
    copied = install_resources(main_dir)
    defined = verify_resources(main_dir, main_activity)
    patch_manifest(manifest)  # the one change to an existing file: written last, and only if everything above held
    CREATED.clear()  # from here on the project is consistent, so there is nothing to take back
    verify_manifest(manifest, defined)
    print("MidNote widget installed")
    print("  package        : " + package)
    print("  kotlin         : " + os.path.relpath(kotlin_path, gen))
    print("  resources      : %d files (%s)" % (len(copied), ", ".join(copied)))
    print("  manifest       : receiver %s added" % RECEIVER_NAME)


def main():
    try:
        run()
    except InstallError as e:
        for path in CREATED:  # a half-installed widget (Kotlin without its layout) would break the whole build
            try:
                os.remove(path)
            except OSError:
                pass
        print("WIDGET INSTALL FAILED: %s" % e, file=sys.stderr)
        if CREATED:
            print("(the files it had already copied were removed again, so the app builds without the widget)", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
