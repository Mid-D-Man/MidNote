#!/usr/bin/env python3
# Brought to u by MidManStudio
"""
Tests for install.py. They build a tiny stand-in for the generated Android project (the same shape `tauri android init`
writes: a manifest with a singleTask MainActivity, and MainActivity.kt) in a temporary folder and run the installer on it.

Run:  python3 src-tauri/android-widgets/test_install.py
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
    <application android:label="@string/app_name">
        <activity android:name=".MainActivity" android:exported="true" android:launchMode="%s">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
"""


def make_project(root, launch_mode="singleTask", package="com.midmanstudio.midnote", extra_main=False):
    main = os.path.join(root, "app", "src", "main")
    pkg_dir = os.path.join(main, "java", *package.split("."))
    os.makedirs(pkg_dir)
    os.makedirs(os.path.join(main, "res", "values"))
    with open(os.path.join(main, "AndroidManifest.xml"), "w", encoding="utf-8") as f:
        f.write(MANIFEST % launch_mode)
    with open(os.path.join(pkg_dir, "MainActivity.kt"), "w", encoding="utf-8") as f:
        f.write("package %s\n\nclass MainActivity\n" % package)
    if extra_main:
        other = os.path.join(main, "java", "other")
        os.makedirs(other)
        with open(os.path.join(other, "MainActivity.kt"), "w", encoding="utf-8") as f:
            f.write("package other\n")
    return main, pkg_dir


def run_installer(gen, script_dir=HERE):
    return subprocess.run([sys.executable, os.path.join(script_dir, "install.py"), gen], capture_output=True, text=True)


def slurp(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


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

    def copy_of_widget_folder(self):
        dest = os.path.join(self.tmp, "widgets")
        shutil.copytree(HERE, dest, ignore=shutil.ignore_patterns("__pycache__"))
        return dest

    def test_happy_path(self):
        main, pkg_dir = make_project(self.gen)
        r = run_installer(self.gen)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isfile(os.path.join(pkg_dir, "MidNoteWidget.kt")))
        for rel in ("layout/midnote_widget.xml", "xml/midnote_widget_info.xml", "values/midnote_widget_strings.xml",
                    "drawable/midnote_widget_bg.xml", "drawable/midnote_widget_button_bg.xml",
                    "drawable/midnote_widget_icon_note.xml", "drawable/midnote_widget_icon_todo.xml",
                    "drawable/midnote_widget_icon_board.xml"):
            self.assertTrue(os.path.isfile(os.path.join(main, "res", rel)), rel)
        app = ET.parse(os.path.join(main, "AndroidManifest.xml")).getroot().find("application")
        receivers = app.findall("receiver")
        self.assertEqual(len(receivers), 1)
        r0 = receivers[0]
        self.assertEqual(r0.get(A + "name"), ".MidNoteWidget")
        self.assertEqual(r0.get(A + "exported"), "false")
        self.assertEqual([a.get(A + "name") for a in r0.iter("action")], ["android.appwidget.action.APPWIDGET_UPDATE"])
        meta = r0.find("meta-data")
        self.assertEqual(meta.get(A + "name"), "android.appwidget.provider")
        self.assertEqual(meta.get(A + "resource"), "@xml/midnote_widget_info")

    def test_package_line_follows_main_activity(self):
        _main, pkg_dir = make_project(self.gen, package="com.example.other")
        self.assertEqual(run_installer(self.gen).returncode, 0)
        text = slurp(os.path.join(pkg_dir, "MidNoteWidget.kt"))
        self.assertIn("\npackage com.example.other\n", text)
        self.assertNotIn("package com.midmanstudio.midnote", text)

    def test_running_twice_changes_nothing(self):
        main, _ = make_project(self.gen)
        self.assertEqual(run_installer(self.gen).returncode, 0)
        manifest = slurp(os.path.join(main, "AndroidManifest.xml"))
        before = tree_files(main)
        self.assertEqual(run_installer(self.gen).returncode, 0)
        self.assertEqual(slurp(os.path.join(main, "AndroidManifest.xml")), manifest)
        self.assertEqual(tree_files(main), before)

    def test_the_rest_of_the_manifest_is_untouched(self):
        main, _ = make_project(self.gen)
        run_installer(self.gen)
        root = ET.parse(os.path.join(main, "AndroidManifest.xml")).getroot()
        self.assertEqual([p.get(A + "name") for p in root.findall("uses-permission")], ["android.permission.INTERNET"])
        act = root.find("application").find("activity")
        self.assertEqual(act.get(A + "launchMode"), "singleTask")
        self.assertEqual(act.get(A + "exported"), "true")
        self.assertEqual([c.get(A + "name") for c in act.iter("category")], ["android.intent.category.LAUNCHER"])

    def test_refuses_when_main_activity_is_not_single_task(self):
        main, _ = make_project(self.gen, launch_mode="standard")
        before = tree_files(main)
        r = run_installer(self.gen)
        self.assertEqual(r.returncode, 1)
        self.assertIn("singleTask", r.stderr)
        self.assertEqual(tree_files(main), before, "nothing may be copied when the check fails")

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

    def test_a_missing_resource_takes_everything_back_out(self):
        widgets = self.copy_of_widget_folder()
        os.remove(os.path.join(widgets, "res", "drawable", "midnote_widget_icon_todo.xml"))
        main, _ = make_project(self.gen)
        before = tree_files(main)
        manifest = slurp(os.path.join(main, "AndroidManifest.xml"))
        r = run_installer(self.gen, widgets)
        self.assertEqual(r.returncode, 1)
        self.assertIn("midnote_widget_icon_todo", r.stderr)
        self.assertEqual(tree_files(main), before, "the copied files must be removed again")
        self.assertEqual(slurp(os.path.join(main, "AndroidManifest.xml")), manifest)

    def test_kotlin_using_an_unknown_id_takes_everything_back_out(self):
        widgets = self.copy_of_widget_folder()
        kt = os.path.join(widgets, "kotlin", "MidNoteWidget.kt")
        text = slurp(kt).replace("R.id.midnote_widget_todo", "R.id.midnote_widget_nope")
        with open(kt, "w", encoding="utf-8") as f:
            f.write(text)
        main, _ = make_project(self.gen)
        before = tree_files(main)
        r = run_installer(self.gen, widgets)
        self.assertEqual(r.returncode, 1)
        self.assertIn("R.id.midnote_widget_nope", r.stderr)
        self.assertEqual(tree_files(main), before)

    def test_a_resource_without_the_prefix_is_refused(self):
        widgets = self.copy_of_widget_folder()
        shutil.copyfile(os.path.join(widgets, "res", "values", "midnote_widget_strings.xml"),
                        os.path.join(widgets, "res", "values", "strings.xml"))
        main, _ = make_project(self.gen)
        before = tree_files(main)
        r = run_installer(self.gen, widgets)
        self.assertEqual(r.returncode, 1)
        self.assertIn("midnote_widget", r.stderr)
        self.assertEqual(tree_files(main), before)

    def test_manifest_names_only_resources_that_exist(self):
        # the shipped files are consistent: every @type/midnote_widget* the receiver names is defined
        main, _ = make_project(self.gen)
        self.assertEqual(run_installer(self.gen).returncode, 0)
        text = slurp(os.path.join(main, "AndroidManifest.xml"))
        self.assertIn("@string/midnote_widget_label", text)
        self.assertIn("@xml/midnote_widget_info", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
