#!/usr/bin/env python3
# Brought to u by MidManStudio
"""
Tests for install.py. They build a stand-in for the generated Android project (a manifest with a singleTask MainActivity and the
template's MainActivity.kt) in a temporary folder and run the installer on it.

Run:  python3 src-tauri/android-text-actions/test_install.py
"""
import os
import re
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
    <application android:label="@string/app_name">
        <activity android:name=".MainActivity" android:exported="true" android:launchMode="singleTask">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
%s    </application>
</manifest>
"""

MAIN_ACTIVITY = """package %s

import android.os.Bundle

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
  }
}
"""


def slurp(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def make_project(root, package="com.midmanstudio.midnote", extra_manifest="", main_text=None, extra_main=False, with_reader=False):
    main = os.path.join(root, "app", "src", "main")
    pkg_dir = os.path.join(main, "java", *package.split("."))
    os.makedirs(pkg_dir)
    with open(os.path.join(main, "AndroidManifest.xml"), "w", encoding="utf-8") as f:
        f.write(MANIFEST % extra_manifest)
    with open(os.path.join(pkg_dir, "MainActivity.kt"), "w", encoding="utf-8") as f:
        f.write(main_text if main_text is not None else MAIN_ACTIVITY % package)
    if with_reader:
        # the read-aloud service's Kotlin is in the build (src-tauri/android-reader/install.py puts it next to MainActivity.kt)
        with open(os.path.join(pkg_dir, "ReaderBridge.kt"), "w", encoding="utf-8") as f:
            f.write("package %s\n" % package)
    if extra_main:
        other = os.path.join(main, "java", "other")
        os.makedirs(other)
        with open(os.path.join(other, "MainActivity.kt"), "w", encoding="utf-8") as f:
            f.write("package other\n")
    return main, pkg_dir


def run_installer(gen, script_dir=HERE):
    return subprocess.run([sys.executable, os.path.join(script_dir, "install.py"), gen], capture_output=True, text=True)


def tree_files(main):
    out = {}
    for r, _d, files in os.walk(main):
        for n in files:
            p = os.path.join(r, n)
            out[os.path.relpath(p, main)] = slurp(p)
    return out


class InstallerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.gen = os.path.join(self.tmp, "gen")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def activities(self, main):
        app = ET.parse(os.path.join(main, "AndroidManifest.xml")).getroot().find("application")
        return {a.get(A + "name"): a for a in app.findall("activity")}

    def test_happy_path(self):
        main, pkg_dir = make_project(self.gen)
        r = run_installer(self.gen)
        self.assertEqual(r.returncode, 0, r.stderr)
        kt = slurp(os.path.join(pkg_dir, "ProcessTextActivities.kt"))
        self.assertIn("package com.midmanstudio.midnote", kt)
        acts = self.activities(main)
        self.assertEqual(sorted(acts), [".MainActivity", ".ProcessTextNoteActivity", ".ProcessTextReadActivity"])
        for name, label in ((".ProcessTextReadActivity", "MidNote: Read aloud"), (".ProcessTextNoteActivity", "MidNote: Make a note")):
            a = acts[name]
            self.assertEqual(a.get(A + "label"), label)
            self.assertEqual(a.get(A + "exported"), "true")
            self.assertEqual(a.get(A + "theme"), "@android:style/Theme.Translucent.NoTitleBar")
            self.assertEqual(a.get(A + "excludeFromRecents"), "true")
            f = a.findall("intent-filter")
            self.assertEqual(len(f), 1)
            self.assertEqual([x.get(A + "name") for x in f[0].findall("action")], ["android.intent.action.PROCESS_TEXT"])
            self.assertEqual([x.get(A + "name") for x in f[0].findall("category")], ["android.intent.category.DEFAULT"])
            self.assertEqual([x.get(A + "mimeType") for x in f[0].findall("data")], ["text/plain"])

    def test_main_activity_and_the_launcher_entry_are_left_alone(self):
        main, pkg_dir = make_project(self.gen)
        before_main = slurp(os.path.join(pkg_dir, "MainActivity.kt"))
        self.assertEqual(run_installer(self.gen).returncode, 0)
        self.assertEqual(slurp(os.path.join(pkg_dir, "MainActivity.kt")), before_main)
        main_act = self.activities(main)[".MainActivity"]
        self.assertEqual(main_act.get(A + "launchMode"), "singleTask")
        self.assertEqual(len(main_act.findall("intent-filter")), 1)

    def test_runs_twice_with_the_same_result(self):
        main, _ = make_project(self.gen)
        self.assertEqual(run_installer(self.gen).returncode, 0)
        first = tree_files(main)
        r = run_installer(self.gen)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(tree_files(main), first)
        self.assertEqual(len(self.activities(main)), 3)

    def test_another_package_name(self):
        main, pkg_dir = make_project(self.gen, package="org.example.notes")
        self.assertEqual(run_installer(self.gen).returncode, 0)
        self.assertIn("package org.example.notes", slurp(os.path.join(pkg_dir, "ProcessTextActivities.kt")))

    def test_an_old_entry_with_the_same_name_is_replaced_not_doubled(self):
        old = '        <activity android:name=".ProcessTextReadActivity" android:exported="false" />\n'
        main, _ = make_project(self.gen, extra_manifest=old)
        self.assertEqual(run_installer(self.gen).returncode, 0)
        names = [a.get(A + "name") for a in ET.parse(os.path.join(main, "AndroidManifest.xml")).getroot().find("application").findall("activity")]
        self.assertEqual(names.count(".ProcessTextReadActivity"), 1)
        self.assertEqual(self.activities(main)[".ProcessTextReadActivity"].get(A + "exported"), "true")

    def test_two_main_activities_stops_and_changes_nothing(self):
        main, _ = make_project(self.gen, extra_main=True)
        before = tree_files(main)
        r = run_installer(self.gen)
        self.assertEqual(r.returncode, 1)
        self.assertIn("TEXT-ACTIONS INSTALL FAILED", r.stderr)
        self.assertEqual(tree_files(main), before)

    def test_no_manifest_stops(self):
        os.makedirs(self.gen)
        r = run_installer(self.gen)
        self.assertEqual(r.returncode, 1)
        self.assertIn("AndroidManifest.xml", r.stderr)

    def test_main_activity_without_a_package_line_stops_and_changes_nothing(self):
        main, _ = make_project(self.gen, main_text="class MainActivity : TauriActivity()\n")
        before = tree_files(main)
        r = run_installer(self.gen)
        self.assertEqual(r.returncode, 1)
        self.assertIn("package", r.stderr)
        self.assertEqual(tree_files(main), before)

    def test_a_manifest_without_application_stops_and_the_kotlin_is_taken_back_out(self):
        main, pkg_dir = make_project(self.gen)
        with open(os.path.join(main, "AndroidManifest.xml"), "w", encoding="utf-8") as f:
            f.write('<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android"/>\n')
        before = tree_files(main)
        r = run_installer(self.gen)
        self.assertEqual(r.returncode, 1)
        self.assertIn("<application>", r.stderr)
        self.assertEqual(tree_files(main), before)
        self.assertFalse(os.path.exists(os.path.join(pkg_dir, "ProcessTextActivities.kt")))

    def test_a_kotlin_file_missing_a_class_the_manifest_names_is_caught(self):
        folder = os.path.join(self.tmp, "tw")
        shutil.copytree(HERE, folder, ignore=shutil.ignore_patterns("__pycache__"))
        kt = os.path.join(folder, "kotlin", "ProcessTextActivities.kt")
        text = slurp(kt).replace("class ProcessTextNoteActivity", "class SomethingElse")
        with open(kt, "w", encoding="utf-8") as f:
            f.write(text)
        main, pkg_dir = make_project(self.gen, with_reader=True)
        before = tree_files(main)
        r = run_installer(self.gen, script_dir=folder)
        self.assertEqual(r.returncode, 1)
        self.assertIn("ProcessTextNoteActivity", r.stderr)
        self.assertEqual(tree_files(main), before)

    def test_a_kotlin_file_using_an_app_resource_is_caught(self):
        folder = os.path.join(self.tmp, "tw2")
        shutil.copytree(HERE, folder, ignore=shutil.ignore_patterns("__pycache__"))
        kt = os.path.join(folder, "kotlin", "ProcessTextActivities.kt")
        text = slurp(kt) + "\nval x = R.string.app_name\n"
        with open(kt, "w", encoding="utf-8") as f:
            f.write(text)
        make_project(self.gen, with_reader=True)
        r = run_installer(self.gen, script_dir=folder)
        self.assertEqual(r.returncode, 1)
        self.assertIn("R.*", r.stderr)

    def test_with_the_reader_in_the_build_read_aloud_runs_without_opening_the_app(self):
        main, pkg_dir = make_project(self.gen, with_reader=True)
        r = run_installer(self.gen)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("without opening MidNote", r.stdout)
        kt = slurp(os.path.join(pkg_dir, "ProcessTextActivities.kt"))
        self.assertIn("ReaderHub.start", kt)
        self.assertIn("ReaderPrefs.load", kt)
        self.assertIn("object SelectionReader", kt)
        # the Read aloud activity never launches the app; only Make a note does
        read = kt[kt.index("class ProcessTextReadActivity") : kt.index("class ProcessTextNoteActivity")]
        self.assertNotIn("startActivity", read)
        self.assertNotIn("getLaunchIntentForPackage", read)
        note = kt[kt.index("class ProcessTextNoteActivity") :]
        self.assertIn("startActivity(launch)", note)

    def test_without_the_reader_the_older_activities_are_installed(self):
        main, pkg_dir = make_project(self.gen)
        r = run_installer(self.gen)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Read aloud opens MidNote", r.stdout)
        kt = slurp(os.path.join(pkg_dir, "ProcessTextActivities.kt"))
        self.assertNotIn("ReaderHub", kt)
        self.assertNotIn("ReaderPrefs", kt)
        self.assertIn("class ProcessTextReadActivity", kt)
        self.assertIn("class ProcessTextNoteActivity", kt)
        self.assertIn("startActivity(launch)", kt)
        # whichever variant is chosen, the file is called ProcessTextActivities.kt and the .txt is not copied
        self.assertFalse(os.path.exists(os.path.join(pkg_dir, "ProcessTextActivities.forward.txt")))

    def test_both_shipped_variants_are_balanced_and_define_both_activities(self):
        for name in ("ProcessTextActivities.kt", "ProcessTextActivities.forward.txt"):
            kt = slurp(os.path.join(HERE, "kotlin", name))
            self.assertEqual(kt.count("{"), kt.count("}"), name)
            self.assertEqual(len(re.findall(r"^package ", kt, re.MULTILINE)), 1, name)
            self.assertIn("class ProcessTextReadActivity", kt, name)
            self.assertIn("class ProcessTextNoteActivity", kt, name)
            self.assertNotIn("setResult", kt, name)

    def test_the_shipped_kotlin_is_what_it_should_be(self):
        kt = slurp(os.path.join(HERE, "kotlin", "ProcessTextActivities.kt"))
        self.assertEqual(kt.count("{"), kt.count("}"))
        self.assertEqual(len(re.findall(r"^package ", kt, re.MULTILINE)), 1)
        self.assertIn("MAX_CHARS = 30000", kt)  # the page cuts at the same number (src/lib/utils/textLinks.ts)
        self.assertIn('"midnote://text/"', kt)
        self.assertIn("Intent.EXTRA_PROCESS_TEXT", kt)
        self.assertIn("finish()", kt)
        # no result is returned: the app the text came from must leave it unchanged
        self.assertNotIn("setResult", kt)
        self.assertNotIn("RESULT_OK", kt)


if __name__ == "__main__":
    unittest.main()
