package com.localify.crimson;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

public class PlaybackService extends Service {
    static final String ACTION_PLAYING = "com.localify.crimson.PLAYING";
    static final String ACTION_PAUSED = "com.localify.crimson.PAUSED";
    static final String ACTION_METADATA = "com.localify.crimson.METADATA";
    static final String ACTION_PLAY = "com.localify.crimson.PLAY";
    static final String ACTION_PAUSE = "com.localify.crimson.PAUSE";
    static final String ACTION_NEXT = "com.localify.crimson.NEXT";
    static final String ACTION_PREVIOUS = "com.localify.crimson.PREVIOUS";
    static final String ACTION_MEDIA_EVENT = "com.localify.crimson.MEDIA_EVENT";
    private static final String CHANNEL = "localify_playback";
    private static final int NOTIFICATION_ID = 2301;
    private MediaSession session;
    private String title = "Localify Crimson";
    private String artist = "";
    private String album = "";
    private boolean playing = false;
    private PowerManager.WakeLock wakeLock;

    @Override public void onCreate() {
        super.onCreate(); createChannel();
        session = new MediaSession(this, "LocalifyCrimsonSession");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { postAction("play-pause"); }
            @Override public void onPause() { postAction("play-pause"); }
            @Override public void onSkipToNext() { postAction("next"); }
            @Override public void onSkipToPrevious() { postAction("previous"); }
        });
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        PowerManager pm = (PowerManager)getSystemService(POWER_SERVICE);
        if (pm != null) wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LocalifyCrimson:Playback");
        Intent launch = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 1, launch, PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
        session.setSessionActivity(pi);
        setSessionState(false);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        String action = intent.getAction();
        if (ACTION_PLAYING.equals(action)) {
            playing = true; updateMetadata(intent); setSessionState(true);
            if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire();
            startForeground(NOTIFICATION_ID, notification());
        } else if (ACTION_PAUSED.equals(action)) {
            playing = false; updateMetadata(intent); setSessionState(false);
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
            stopForeground(STOP_FOREGROUND_DETACH);
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification());
        } else if (ACTION_METADATA.equals(action)) {
            updateMetadata(intent); setSessionState(playing);
            if (playing) { if (Build.VERSION.SDK_INT >= 24) getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification()); }
        } else if (ACTION_PLAY.equals(action)) postAction("play-pause");
        else if (ACTION_PAUSE.equals(action)) postAction("play-pause");
        else if (ACTION_NEXT.equals(action)) postAction("next");
        else if (ACTION_PREVIOUS.equals(action)) postAction("previous");
        return START_NOT_STICKY;
    }

    private void updateMetadata(Intent intent) {
        if (intent.hasExtra("title")) title = intent.getStringExtra("title");
        if (intent.hasExtra("artist")) artist = intent.getStringExtra("artist");
        if (intent.hasExtra("album")) album = intent.getStringExtra("album");
        if (title == null || title.isEmpty()) title = "Localify Crimson";
        if (artist == null) artist = ""; if (album == null) album = "";
        session.setMetadata(new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
            .build());
    }

    private void setSessionState(boolean isPlaying) {
        session.setActive(true);
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP;
        session.setPlaybackState(new PlaybackState.Builder().setActions(actions).setState(isPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, isPlaying ? 1f : 0f).build());
    }

    private Notification notification() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag();
        PendingIntent previous = PendingIntent.getService(this, 2, new Intent(this, PlaybackService.class).setAction(ACTION_PREVIOUS), flags);
        PendingIntent toggle = PendingIntent.getService(this, 3, new Intent(this, PlaybackService.class).setAction(playing ? ACTION_PAUSE : ACTION_PLAY), flags);
        PendingIntent next = PendingIntent.getService(this, 4, new Intent(this, PlaybackService.class).setAction(ACTION_NEXT), flags);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title).setContentText(artist.isEmpty() ? "Localify Crimson" : artist)
            .setSubText("Localify Crimson")
            .setContentIntent(sessionActivityPendingIntent())
            .setOngoing(playing).setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "Предыдущий", previous).build())
            .addAction(new Notification.Action.Builder(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, playing ? "Пауза" : "Продолжить", toggle).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "Следующий", next).build());
        if (Build.VERSION.SDK_INT >= 21) b.setCategory(Notification.CATEGORY_TRANSPORT);
        if (Build.VERSION.SDK_INT >= 21) b.addExtras(new android.os.Bundle());
        return b.build();
    }
    private PendingIntent sessionActivityPendingIntent() {
        Intent launch = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 1, launch, PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
    }
    private int immutableFlag() { return Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0; }
    private void postAction(String action) {
        Intent event = new Intent(ACTION_MEDIA_EVENT); event.setPackage(getPackageName()); event.putExtra("action", action); sendBroadcast(event);
    }
    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Воспроизведение Localify", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Управление воспроизведением музыки"); channel.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }
    @Override public void onDestroy() { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); if (session != null) { session.setActive(false); session.release(); session = null; } super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
