#!/usr/bin/env python3
# Brought to u by MidManStudio
"""
Adds MidNote's background read-aloud to the GENERATED Android project (src-tauri/gen/android, which is not committed:
`tauri android init` writes it fresh on every CI build).

What it does, in order:
  1. finds MainActivity.kt and reads its package (all the new classes must live in the same package);
  2. copies kotlin/*.kt next to it, with the package line rewritten to match;
  3. copies res/ (the notification's small icon; every name starts with midnote_reader) into the project's res/;
  4. checks that every R.drawable the Kotlin uses exists;
  5. adds `onWebViewCreate` to MainActivity.kt, which hands the WebView to ReaderBridge (the page's door to the service);
  6. adds to AndroidManifest.xml: the permissions FOREGROUND_SERVICE, FOREGROUND_SERVICE_MEDIA_PLAYBACK and WAKE_LOCK, and
     the <service> for ReaderService (foregroundServiceType mediaPlayback, which Android 14+ requires);
  7. checks its own work. Any problem stops it with a message that says what is wrong, and every file it had changed is put
     back, so the app still builds, without background reading.
Running it twice changes nothing the second time.

Run from the repository root:  python3 src-tauri/android-reader/install.py [path/to/gen/android]
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
KOTLIN_FILES = ["ReaderCore.kt", "ReaderWire.kt", "ReaderService.kt", "ReaderBridge.kt"]
PERMISSIONS = [
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
    "android.permission.WAKE_LOCK",
]
SERVICE_NAME = ".ReaderService"
HOOK_CALL = "ReaderBridge.install(this, webView)"
HOOK_CODE = (
    "\n  override fun onWebViewCreate(webView: android.webkit.WebView) {\n"
    "    super.onWebViewCreate(webView)\n"
    "    " + HOOK_CALL + "\n"
    "  }\n"
)


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
    target_dir = os.path.dirname(main_activity)
    written = []
    for name in KOTLIN_FILES:
        src = read(os.path.join(HERE, "kotlin", name))
        out, n = re.subn(r"^package\s+[A-Za-z0-9_.]+\s*$", "package " + package, src, count=1, flags=re.MULTILINE)
        if n != 1:
            fail("kotlin/%s has no package line to rewrite" % name)
        target = os.path.join(target_dir, name)
        if not os.path.exists(target):
            CREATED.append(target)
        write(target, out)
        written.append(target)
    return package, written


def install_resources(main_dir):
    res_src = os.path.join(HERE, "res")
    copied = []
    for root, _dirs, files in os.walk(res_src):
        for name in sorted(files):
            if not name.startswith("midnote_reader"):
                fail("res/%s does not start with midnote_reader: it could clash with the app's own resources" % name)
            rel = os.path.relpath(os.path.join(root, name), res_src)
            dest = os.path.join(main_dir, "res", rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)  # the template has no res/drawable
            if not os.path.exists(dest):
                CREATED.append(dest)
            shutil.copyfile(os.path.join(root, name), dest)
            copied.append(rel)
    if not copied:
        fail("no resource files found in " + res_src)
    return sorted(copied)


def verify_resources(kotlin_paths, main_dir):
    """Every R.drawable the Kotlin uses is one of ours (android.R.drawable.* is the system's and is not matched)."""
    have = set()
    drawable_dir = os.path.join(main_dir, "res", "drawable")
    if os.path.isdir(drawable_dir):
        for name in os.listdir(drawable_dir):
            have.add(os.path.splitext(name)[0])
    for path in kotlin_paths:
        for m in re.finditer(r"(?<![\w.])R\.drawable\.([A-Za-z0-9_]+)", read(path)):
            if m.group(1) not in have:
                fail("%s uses R.drawable.%s which no resource file defines" % (os.path.basename(path), m.group(1)))
        for m in re.finditer(r"(?<![\w.])R\.(layout|string|id|xml)\.([A-Za-z0-9_]+)", read(path)):
            fail("%s uses R.%s.%s but this installer ships no such resource" % (os.path.basename(path), m.group(1), m.group(2)))


def patch_main_activity(path):
    text = read(path)
    if HOOK_CALL in text:
        return  # patched before
    if re.search(r"\bonWebViewCreate\b", text):
        fail("MainActivity.kt already overrides onWebViewCreate; add `%s` to it by hand" % HOOK_CALL)
    m = re.search(r"class\s+MainActivity\b[^{]*\{", text)
    if not m:
        fail("no 'class MainActivity ... {' in " + path)
    remember(path)
    write(path, text[: m.end()] + HOOK_CODE + text[m.end():])


def patch_manifest(manifest_path):
    remember(manifest_path)
    tree = ET.parse(manifest_path)
    root = tree.getroot()
    app = root.find("application")
    if app is None:
        fail("AndroidManifest.xml has no <application>")
    have = {p.get(A + "name") for p in root.findall("uses-permission")}
    position = list(root).index(app)
    for permission in PERMISSIONS:
        if permission in have:
            continue
        el = ET.Element("uses-permission")
        el.set(A + "name", permission)
        root.insert(position, el)  # permissions sit before <application>, like the others
        position += 1
    for old in app.findall("service"):
        if old.get(A + "name") == SERVICE_NAME:
            app.remove(old)  # replaced below, so running twice gives the same file
    service = ET.SubElement(app, "service")
    service.set(A + "name", SERVICE_NAME)
    service.set(A + "exported", "false")
    # Android 14+ throws MissingForegroundServiceTypeException from startForeground() without this
    service.set(A + "foregroundServiceType", "mediaPlayback")
    ET.indent(tree, space="    ")
    tree.write(manifest_path, encoding="utf-8", xml_declaration=True)


def verify_manifest(manifest_path):
    root = ET.parse(manifest_path).getroot()
    have = [p.get(A + "name") for p in root.findall("uses-permission")]
    for permission in PERMISSIONS:
        if have.count(permission) != 1:
            fail("expected the permission %s once in the manifest, found %d" % (permission, have.count(permission)))
    app = root.find("application")
    services = [s for s in app.findall("service") if s.get(A + "name") == SERVICE_NAME]
    if len(services) != 1:
        fail("expected one %s service in the manifest, found %d" % (SERVICE_NAME, len(services)))
    s = services[0]
    if s.get(A + "foregroundServiceType") != "mediaPlayback":
        fail("the service is not foregroundServiceType mediaPlayback")
    if s.get(A + "exported") != "false":
        fail("the service must not be exported")


def verify_main_activity(path):
    text = read(path)
    if HOOK_CALL not in text or "override fun onWebViewCreate" not in text:
        fail("MainActivity.kt does not hand the WebView to ReaderBridge")
    if text.count("onWebViewCreate") != 2:  # the override and the super call, nothing else
        fail("MainActivity.kt has an unexpected number of onWebViewCreate mentions")


def run():
    gen = sys.argv[1] if len(sys.argv) > 1 else os.path.join("src-tauri", "gen", "android")
    main_dir = os.path.join(gen, "app", "src", "main")
    manifest = os.path.join(main_dir, "AndroidManifest.xml")
    if not os.path.isfile(manifest):
        fail("no AndroidManifest.xml at %s (did 'tauri android init' run?)" % manifest)
    main_activity = find_main_activity(main_dir)
    package, kotlin_paths = install_kotlin(main_activity)
    copied = install_resources(main_dir)
    verify_resources(kotlin_paths, main_dir)
    patch_main_activity(main_activity)
    patch_manifest(manifest)
    verify_main_activity(main_activity)
    verify_manifest(manifest)
    CREATED.clear()
    ORIGINALS.clear()
    print("MidNote background read-aloud installed")
    print("  package        : " + package)
    print("  kotlin         : " + ", ".join(os.path.basename(p) for p in kotlin_paths))
    print("  resources      : %d files (%s)" % (len(copied), ", ".join(copied)))
    print("  MainActivity   : onWebViewCreate hands the WebView to ReaderBridge")
    print("  manifest       : %d permissions and the %s service" % (len(PERMISSIONS), SERVICE_NAME))


def main():
    try:
        run()
    except InstallError as e:
        for path, text in ORIGINALS.items():  # put every file it changed back
            try:
                write(path, text)
            except OSError:
                pass
        for path in CREATED:  # and take out every file it added (Kotlin without its pieces would break the build)
            try:
                os.remove(path)
            except OSError:
                pass
        print("READ-ALOUD INSTALL FAILED: %s" % e, file=sys.stderr)
        if ORIGINALS or CREATED:
            print("(what it had already changed was put back, so the app builds without background reading)", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
