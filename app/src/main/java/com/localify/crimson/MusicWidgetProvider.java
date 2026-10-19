package com.localify.crimson;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.widget.RemoteViews;

public class MusicWidgetProvider extends AppWidgetProvider {
    private static final String PREFS = "localify_music_widget";
    private static final String KEY_TITLE = "title";
    private static final String KEY_ARTIST = "artist";
    private static final String KEY_PLAYING = "playing";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        android.content.SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        updateAll(context,
            prefs.getString(KEY_TITLE, "Localify Crimson"),
            prefs.getString(KEY_ARTIST, "Откройте приложение для начала"),
            null,
            prefs.getBoolean(KEY_PLAYING, false));
    }

    static void updateAll(Context context, String title, String artist, Bitmap artwork, boolean playing) {
        if (title == null || title.trim().isEmpty()) title = "Localify Crimson";
        if (artist == null || artist.trim().isEmpty()) artist = " ";
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_TITLE, title)
            .putString(KEY_ARTIST, artist)
            .putBoolean(KEY_PLAYING, playing)
            .apply();

        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, MusicWidgetProvider.class));
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.music_widget);
            views.setTextViewText(R.id.widget_title, title);
            views.setTextViewText(R.id.widget_artist, artist);
            views.setTextViewText(R.id.widget_play_pause, playing ? "Ⅱ" : "▶");
            if (artwork != null) {
                views.setImageViewBitmap(R.id.widget_artwork, artwork);
            } else {
                views.setImageViewResource(R.id.widget_artwork, R.drawable.localify_icon);
            }

            views.setOnClickPendingIntent(R.id.widget_previous,
                servicePendingIntent(context, PlaybackService.ACTION_PREVIOUS, 201));
            views.setOnClickPendingIntent(R.id.widget_play_pause,
                servicePendingIntent(context, playing ? PlaybackService.ACTION_PAUSE : PlaybackService.ACTION_PLAY, 202));
            views.setOnClickPendingIntent(R.id.widget_next,
                servicePendingIntent(context, PlaybackService.ACTION_NEXT, 203));

            Intent launch = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent openApp = PendingIntent.getActivity(context, 204, launch,
                PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
            views.setOnClickPendingIntent(R.id.widget_artwork, openApp);
            views.setOnClickPendingIntent(R.id.widget_title, openApp);
            manager.updateAppWidget(id, views);
        }
    }

    private static PendingIntent servicePendingIntent(Context context, String action, int requestCode) {
        Intent intent = new Intent(context, PlaybackService.class).setAction(action);
        return PendingIntent.getService(context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
    }

    private static int immutableFlag() {
        return android.os.Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
    }
}