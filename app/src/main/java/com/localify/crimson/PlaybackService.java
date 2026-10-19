package com.localify.crimson;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.MediaMetadata;
import android.media.MediaMetadataRetriever;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

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
    private long durationMs = 0L;
    private long positionMs = 0L;
    private String sourcePath = "";
    private String coverUrl = "";
    private String artworkKey = "";
    private volatile Bitmap artwork;
    private volatile int artworkRequestId = 0;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService artworkWorker = Executors.newSingleThreadExecutor();
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
            MusicWidgetProvider.updateAll(this, title, artist, artwork, playing);
        } else if (ACTION_PAUSED.equals(action)) {
            playing = false; updateMetadata(intent); setSessionState(false);
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
            stopForeground(STOP_FOREGROUND_DETACH);
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification());
            MusicWidgetProvider.updateAll(this, title, artist, artwork, playing);
        } else if (ACTION_METADATA.equals(action)) {
            updateMetadata(intent); setSessionState(playing);
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification());
            MusicWidgetProvider.updateAll(this, title, artist, artwork, playing);
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
        if (intent.hasExtra("sourcePath")) sourcePath = intent.getStringExtra("sourcePath");
        if (intent.hasExtra("cover")) coverUrl = intent.getStringExtra("cover");
        if (intent.hasExtra("duration")) durationMs = Math.max(0L, (long)(intent.getDoubleExtra("duration", 0) * 1000d));
        if (intent.hasExtra("position")) positionMs = Math.max(0L, (long)(intent.getDoubleExtra("position", 0) * 1000d));
        if (title == null || title.isEmpty()) title = "Localify Crimson";
        if (artist == null) artist = ""; if (album == null) album = "";
        refreshSessionMetadata();
        MusicWidgetProvider.updateAll(this, title, artist, artwork, playing);
        String key = (sourcePath == null ? "" : sourcePath) + "\u0000" + (coverUrl == null ? "" : coverUrl);
        if (key.equals(artworkKey)) return;
        artworkKey = key;
        final int requestId = ++artworkRequestId;
        artwork = null;
        if (sourcePath.isEmpty() && coverUrl.isEmpty()) return;
        final String requestedSource = sourcePath;
        final String requestedCover = coverUrl;
        artworkWorker.execute(() -> {
            Bitmap bitmap = loadArtwork(requestedSource, requestedCover);
            mainHandler.post(() -> {
                if (requestId != artworkRequestId) return;
                artwork = bitmap;
                refreshSessionMetadata();
                MusicWidgetProvider.updateAll(PlaybackService.this, title, artist, artwork, playing);
                try {
                    NotificationManager manager = getSystemService(NotificationManager.class);
                    if (manager != null) manager.notify(NOTIFICATION_ID, notification());
                } catch (Exception ignored) {}
            });
        });
    }

    private void refreshSessionMetadata() {
        MediaMetadata.Builder metadata = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs);
        if (artwork != null) {
            metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork);
            metadata.putBitmap(MediaMetadata.METADATA_KEY_ART, artwork);
            metadata.putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, artwork);
        }
        if (session != null) session.setMetadata(metadata.build());
    }

    private Bitmap loadArtwork(String path, String cover) {
        byte[] bytes = null;
        if (path != null && !path.isEmpty()) {
            MediaMetadataRetriever retriever = new MediaMetadataRetriever();
            try {
                Uri uri = Uri.parse(path);
                String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(java.util.Locale.ROOT);
                if ("content".equals(scheme) || "file".equals(scheme)) {
                    retriever.setDataSource(this, uri);
                    bytes = retriever.getEmbeddedPicture();
                }
            } catch (Exception ignored) {
            } finally { try { retriever.release(); } catch (Exception ignored) {} }
        }
        if ((bytes == null || bytes.length == 0) && cover != null && cover.startsWith("data:image/") && cover.length() <= 6 * 1024 * 1024) {
            try {
                int comma = cover.indexOf(',');
                if (comma >= 0) bytes = Base64.decode(cover.substring(comma + 1), Base64.DEFAULT);
            } catch (Exception ignored) {}
        }
        if ((bytes == null || bytes.length == 0) && cover != null && (cover.startsWith("https://") || cover.startsWith("http://")) && cover.length() < 4096) {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection)new URL(cover).openConnection();
                connection.setConnectTimeout(2500);
                connection.setReadTimeout(2500);
                connection.setInstanceFollowRedirects(true);
                connection.setRequestProperty("Accept", "image/*");
                int status = connection.getResponseCode();
                int length = connection.getContentLength();
                if (status >= 200 && status < 300 && (length <= 0 || length <= 4 * 1024 * 1024)) {
                    try (InputStream in = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                        byte[] buffer = new byte[8192]; int count, total = 0;
                        while ((count = in.read(buffer)) >= 0) {
                            total += count; if (total > 4 * 1024 * 1024) break;
                            out.write(buffer, 0, count);
                        }
                        if (total <= 4 * 1024 * 1024) bytes = out.toByteArray();
                    }
                }
            } catch (Exception ignored) {
            } finally { if (connection != null) connection.disconnect(); }
        }
        if (bytes == null || bytes.length == 0) return null;
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = 1;
            while (bounds.outWidth / options.inSampleSize > 512 || bounds.outHeight / options.inSampleSize > 512) options.inSampleSize *= 2;
            options.inPreferredConfig = Bitmap.Config.ARGB_8888;
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        } catch (Exception ignored) { return null; }
    }

    private void setSessionState(boolean isPlaying) {
        session.setActive(true);
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP;
        session.setPlaybackState(new PlaybackState.Builder().setActions(actions)
            .setState(isPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, Math.max(0L, positionMs), isPlaying ? 1f : 0f, SystemClock.elapsedRealtime()).build());
    }

    private Notification notification() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag();
        PendingIntent previous = PendingIntent.getService(this, 2, new Intent(this, PlaybackService.class).setAction(ACTION_PREVIOUS), flags);
        PendingIntent toggle = PendingIntent.getService(this, 3, new Intent(this, PlaybackService.class).setAction(playing ? ACTION_PAUSE : ACTION_PLAY), flags);
        PendingIntent next = PendingIntent.getService(this, 4, new Intent(this, PlaybackService.class).setAction(ACTION_NEXT), flags);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.localify_icon)
            .setContentTitle(title).setContentText(artist.isEmpty() ? "Localify Crimson" : artist)
            .setSubText(album.isEmpty() ? "Localify Crimson" : album)
            .setContentIntent(sessionActivityPendingIntent())
            .setOngoing(playing).setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "Предыдущий", previous).build())
            .addAction(new Notification.Action.Builder(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, playing ? "Пауза" : "Продолжить", toggle).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "Следующий", next).build());
        if (artwork != null) b.setLargeIcon(artwork);
        if (Build.VERSION.SDK_INT >= 21) {
            b.setCategory(Notification.CATEGORY_TRANSPORT);
            b.setStyle(new Notification.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2));
        }
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
    @Override public void onDestroy() { artworkWorker.shutdownNow(); if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); if (session != null) { session.setActive(false); session.release(); session = null; } super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
