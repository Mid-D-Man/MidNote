#!/usr/bin/env python3
# Brought to u by MidManStudio
"""
Tests for install.py. They build a stand-in for the generated Android project (the shape `tauri android init` writes: a
manifest with a singleTask MainActivity, and the template's MainActivity.kt) in a temporary folder and run the installer on it.

Run:  python3 src-tauri/android-reader/test_install.py
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
A = "{http://schemas.android.com/apk/res/android}"

MANIFEST = """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
%s    <application android:label="@string/app_name">
        <activity android:name=".MainActivity" android:exported="true" android:launchMode="singleTask">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
"""

MAIN_ACTIVITY = """package %s

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
"""

KOTLIN = ["ReaderCore.kt", "ReaderWire.kt", "ReaderService.kt", "ReaderBridge.kt"]


def slurp(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def make_project(root, package="com.midmanstudio.midnote", extra_permission="", main_text=None, extra_main=False, manifest_text=None):
    main = os.path.join(root, "app", "src", "main")
    pkg_dir = os.path.join(main, "java", *package.split("."))
    os.makedirs(pkg_dir)
    os.makedirs(os.path.join(main, "res", "values"))
    with open(os.path.join(main, "AndroidManifest.xml"), "w", encoding="utf-8") as f:
        f.write(manifest_text if manifest_text is not None else MANIFEST % extra_permission)
    with open(os.path.join(pkg_dir, "MainActivity.kt"), "w", encoding="utf-8") as f:
        f.write(main_text if main_text is not None else MAIN_ACTIVITY % package)
    if extra_main:
        other = os.path.join(main, "java", "other")
        os.makedirs(other)
        with open(os.path.join(other, "MainActivity.kt"), "w", encoding="utf-8") as f:
            f.write("package other\n")
    return main, pkg_dir


def run_installer(gen, script_dir=HERE):
    return subprocess.run([sys.executable, os.path.join(script_dir, "install.py"), gen], capture_output=True, text=True)


def tree_files(main):
    out = set()
    for r, _d, files in os.walk(main):
        for n in files:
            out.add(os.path.relpath(os.path.join(r, n), main))
    return out


class InstallerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.gen = os.path.join(self.tmp, "gen")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def copy_of_folder(self):
        dest = os.path.join(self.tmp, "reader")
        shutil.copytree(HERE, dest, ignore=shutil.ignore_patterns("__pycache__"))
        return dest

    def test_happy_path(self):
        main, pkg_dir = make_project(self.gen)
        r = run_installer(self.gen)
        self.assertEqual(r.returncode, 0, r.stderr)
        for name in KOTLIN:
            self.assertTrue(os.path.isfile(os.path.join(pkg_dir, name)), name)
        self.assertTrue(os.path.isfile(os.path.join(main, "res", "drawable", "midnote_reader_small.xml")))
        root = ET.parse(os.path.join(main, "AndroidManifest.xml")).getroot()
        perms = [p.get(A + "name") for p in root.findall("uses-permission")]
        for p in ("android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK", "android.permission.WAKE_LOCK"):
            self.assertEqual(perms.count(p), 1, p)
        app = root.find("application")
        services = app.findall("service")
        self.assertEqual(len(services), 1)
        self.assertEqual(services[0].get(A + "name"), ".ReaderService")
        self.assertEqual(services[0].get(A + "exported"), "false")
        self.assertEqual(services[0].get(A + "foregroundServiceType"), "mediaPlayback")
        children = [c.tag for c in root]
        self.assertLess(max(i for i, t in enumerate(children) if t == "uses-permission"), children.index("application"), "permissions come before <application>")

    def test_main_activity_hands_the_webview_over_and_keeps_its_own_code(self):
        _main, pkg_dir = make_project(self.gen)
        self.assertEqual(run_installer(self.gen).returncode, 0)
        text = slurp(os.path.join(pkg_dir, "MainActivity.kt"))
        self.assertIn("override fun onWebViewCreate(webView: android.webkit.WebView) {", text)
        self.assertIn("ReaderBridge.install(this, webView)", text)
        self.assertIn("super.onWebViewCreate(webView)", text)
        self.assertIn("enableEdgeToEdge()", text)
        self.assertIn("override fun onCreate(savedInstanceState: Bundle?)", text)
        self.assertIn("class MainActivity : TauriActivity() {", text)
        self.assertEqual(text.count("onWebViewCreate"), 2)

    def test_package_line_follows_main_activity(self):
        _main, pkg_dir = make_project(self.gen, package="com.example.other")
        self.assertEqual(run_installer(self.gen).returncode, 0)
        for name in KOTLIN:
            text = slurp(os.path.join(pkg_dir, name))
            self.assertIn("\npackage com.example.other\n", text, name)
            self.assertNotIn("package com.midmanstudio.midnote", text, name)

    def test_running_twice_changes_nothing(self):
        main, pkg_dir = make_project(self.gen)
        self.assertEqual(run_installer(self.gen).returncode, 0)
        manifest = slurp(os.path.join(main, "AndroidManifest.xml"))
        activity = slurp(os.path.join(pkg_dir, "MainActivity.kt"))
        before = tree_files(main)
        self.assertEqual(run_installer(self.gen).returncode, 0)
        self.assertEqual(slurp(os.path.join(main, "AndroidManifest.xml")), manifest)
        self.assertEqual(slurp(os.path.join(pkg_dir, "MainActivity.kt")), activity)
        self.assertEqual(tree_files(main), before)

    def test_the_rest_of_the_manifest_is_untouched(self):
        main, _ = make_project(self.gen)
        run_installer(self.gen)
        root = ET.parse(os.path.join(main, "AndroidManifest.xml")).getroot()
        self.assertIn("android.permission.INTERNET", [p.get(A + "name") for p in root.findall("uses-permission")])
        act = root.find("application").find("activity")
        self.assertEqual(act.get(A + "launchMode"), "singleTask")
        self.assertEqual(act.get(A + "exported"), "true")

    def test_a_permission_already_declared_is_not_added_twice(self):
        main, _ = make_project(self.gen, extra_permission='    <uses-permission android:name="android.permission.WAKE_LOCK" />\n')
        self.assertEqual(run_installer(self.gen).returncode, 0)
        root = ET.parse(os.path.join(main, "AndroidManifest.xml")).getroot()
        self.assertEqual([p.get(A + "name") for p in root.findall("uses-permission")].count("android.permission.WAKE_LOCK"), 1)

    def test_refuses_a_main_activity_that_already_overrides_onWebViewCreate(self):
        text = MAIN_ACTIVITY % "com.midmanstudio.midnote"
        text = text.replace("class MainActivity : TauriActivity() {", "class MainActivity : TauriActivity() {\n  override fun onWebViewCreate(webView: android.webkit.WebView) { }")
        main, pkg_dir = make_project(self.gen, main_text=text)
        before = tree_files(main)
        r = run_installer(self.gen)
        self.assertEqual(r.returncode, 1)
        self.assertIn("onWebViewCreate", r.stderr)
        self.assertEqual(tree_files(main), before, "the copied files must be removed again")
        self.assertEqual(slurp(os.path.join(pkg_dir, "MainActivity.kt")), text)

    def test_refuses_two_main_activities(self):
        main, _ = make_project(self.gen, extra_main=True)
        before = tree_files(main)
        r = run_installer(self.gen)
        self.assertEqual(r.returncode, 1)
        self.assertIn("exactly one MainActivity.kt", r.stderr)
        self.assertEqual(tree_files(main), before)

    def test_refuses_without_a_manifest(self):
        os.makedirs(self.gen)
        r = run_installer(self.gen)
        self.assertEqual(r.returncode, 1)
        self.assertIn("AndroidManifest.xml", r.stderr)

    def test_a_missing_icon_takes_everything_back_out(self):
        folder = self.copy_of_folder()
        os.rename(os.path.join(folder, "res", "drawable", "midnote_reader_small.xml"), os.path.join(folder, "res", "drawable", "midnote_reader_other.xml"))
        main, pkg_dir = make_project(self.gen)
        before = tree_files(main)
        manifest = slurp(os.path.join(main, "AndroidManifest.xml"))
        activity = slurp(os.path.join(pkg_dir, "MainActivity.kt"))
        r = run_installer(self.gen, folder)
        self.assertEqual(r.returncode, 1)
        self.assertIn("midnote_reader_small", r.stderr)
        self.assertEqual(tree_files(main), before)
        self.assertEqual(slurp(os.path.join(main, "AndroidManifest.xml")), manifest)
        self.assertEqual(slurp(os.path.join(pkg_dir, "MainActivity.kt")), activity)

    def test_kotlin_using_a_resource_the_installer_does_not_ship_is_refused(self):
        folder = self.copy_of_folder()
        kt = os.path.join(folder, "kotlin", "ReaderService.kt")
        text = slurp(kt).replace("R.drawable.midnote_reader_small", "R.string.nope")
        with open(kt, "w", encoding="utf-8") as f:
            f.write(text)
        main, _ = make_project(self.gen)
        before = tree_files(main)
        r = run_installer(self.gen, folder)
        self.assertEqual(r.returncode, 1)
        self.assertIn("R.string.nope", r.stderr)
        self.assertEqual(tree_files(main), before)

    def test_an_empty_resource_folder_is_refused(self):
        folder = self.copy_of_folder()
        os.remove(os.path.join(folder, "res", "drawable", "midnote_reader_small.xml"))
        main, _ = make_project(self.gen)
        before = tree_files(main)
        r = run_installer(self.gen, folder)
        self.assertEqual(r.returncode, 1)
        self.assertIn("no resource files", r.stderr)
        self.assertEqual(tree_files(main), before)

    def test_a_resource_without_the_prefix_is_refused(self):
        folder = self.copy_of_folder()
        shutil.copyfile(os.path.join(folder, "res", "drawable", "midnote_reader_small.xml"), os.path.join(folder, "res", "drawable", "icon.xml"))
        main, _ = make_project(self.gen)
        before = tree_files(main)
        r = run_installer(self.gen, folder)
        self.assertEqual(r.returncode, 1)
        self.assertIn("midnote_reader", r.stderr)
        self.assertEqual(tree_files(main), before)

    def test_a_failure_after_main_activity_was_patched_puts_it_back(self):
        # a manifest with no <application>: the failure happens AFTER MainActivity.kt has been changed
        broken = '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n</manifest>\n'
        main, pkg_dir = make_project(self.gen, manifest_text=broken)
        before = tree_files(main)
        activity = slurp(os.path.join(pkg_dir, "MainActivity.kt"))
        manifest = slurp(os.path.join(main, "AndroidManifest.xml"))
        r = run_installer(self.gen)
        self.assertEqual(r.returncode, 1)
        self.assertIn("<application>", r.stderr)
        self.assertEqual(slurp(os.path.join(pkg_dir, "MainActivity.kt")), activity, "MainActivity.kt must be restored")
        self.assertEqual(slurp(os.path.join(main, "AndroidManifest.xml")), manifest)
        self.assertEqual(tree_files(main), before)

    def test_refuses_a_main_activity_it_cannot_patch(self):
        main, pkg_dir = make_project(self.gen, main_text="package com.midmanstudio.midnote\n\nfun main() {}\n")
        before = tree_files(main)
        r = run_installer(self.gen)
        self.assertEqual(r.returncode, 1)
        self.assertIn("class MainActivity", r.stderr)
        self.assertEqual(tree_files(main), before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
