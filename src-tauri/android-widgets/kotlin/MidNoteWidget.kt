// Brought to u by MidManStudio
//
// The MidNote home-screen widget: ONE widget with three buttons (new note, new todo, new board). It shows no data,
// so there is nothing to refresh: onUpdate only draws the three buttons and gives each one a tap action.
//
// A tap opens MidNote with an ordinary link, midnote://new/note | todo | board. The app (utils/widgetLinks.ts)
// turns it into /note/new, /todo/new or /board/new, which are blank editors: nothing is saved until you type.
// tauri-plugin-deep-link hands the link to the running app (onNewIntent) or to a cold start (get_current); it only
// accepts hosts listed in tauri.conf.json (plugins.deep-link.mobile), where "new" is one of them.
//
// This file is NOT part of the Tauri template: android-widgets/install.py copies it next to MainActivity.kt in the
// generated Android project on every build (gen/android is not committed) and rewrites the package line to match.
package com.midmanstudio.midnote

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

class MidNoteWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (appWidgetId in appWidgetIds) {
            appWidgetManager.updateAppWidget(appWidgetId, buildViews(context))
        }
    }

    private fun buildViews(context: Context): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.midnote_widget)
        views.setOnClickPendingIntent(R.id.midnote_widget_note, open(context, 1, "midnote://new/note"))
        views.setOnClickPendingIntent(R.id.midnote_widget_todo, open(context, 2, "midnote://new/todo"))
        views.setOnClickPendingIntent(R.id.midnote_widget_board, open(context, 3, "midnote://new/board"))
        return views
    }

    // One PendingIntent per button. Each has its own request code, and the link differs anyway, so Android never
    // mixes them up. FLAG_IMMUTABLE is required on Android 12+ (we only start an activity, nobody changes the intent).
    private fun open(context: Context, requestCode: Int, link: String): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse(link)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}
