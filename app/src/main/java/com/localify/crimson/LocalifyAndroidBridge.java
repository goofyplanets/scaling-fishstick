package com.localify.crimson;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URLEncoder;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLRequest;
import com.yausername.youtubedl_android.YoutubeDLResponse;
import com.yausername.youtubedl_android.mapper.VideoInfo;
import com.yausername.ffmpeg.FFmpeg;

public class LocalifyAndroidBridge {
    private static final String TAG = "LocalifyAndroidBridge";
    private static final int REQUEST_PICKER = 4101;
    private static final String AUDIO_HOST = "localify.media";
    private final MainActivity activity;
    private final File dataDir;
    private final SharedPreferences prefs;
    private int pendingCallbackId = -1;
    private String pendingAction = "";
    private volatile boolean scanCancelled = false;
    private final ExecutorService ytDlpExecutor = Executors.newFixedThreadPool(2);
    private static volatile boolean ytDlpInitialized = false;
    private static final Object YT_DLP_INIT_LOCK = new Object();

    LocalifyAndroidBridge(MainActivity activity) {
        this.activity = activity;
        this.dataDir = new File(activity.getFilesDir(), "localify");
        if (!dataDir.exists()) dataDir.mkdirs();
        this.prefs = activity.getSharedPreferences("localify_android", Activity.MODE_PRIVATE);
    }

    @JavascriptInterface public String loadState() {
        JSONObject empty = new JSONObject();
        try { empty.put("schemaVersion", 2); empty.put("library", new JSONArray()); empty.put("playlists", new JSONArray()); } catch (Exception ignored) {}
        return readJsonFile("library.json", empty).toString();
    }

    @JavascriptInterface public boolean saveState(String raw) { return writeJsonFile("library.json", parseObject(raw)); }

    @JavascriptInterface public String getSettings() {
        JSONObject defaults = defaultSettings();
        JSONObject saved = readJsonFile("settings.json", defaults);
        Iterator<String> keys = defaults.keys();
        while (keys.hasNext()) { String key = keys.next(); if (!saved.has(key)) try { saved.put(key, defaults.get(key)); } catch (Exception ignored) {} }
        // Windows-only file-moving/tray behavior is deliberately disabled on Android.
        put(saved, "closeToTray", false); put(saved, "startMinimized", false); put(saved, "trayEnabled", false);
        put(saved, "minimizeToTray", false); put(saved, "moveFilesIntoPlaylists", false);
        put(saved, "autoWatch", false);
        return saved.toString();
    }

    @JavascriptInterface public boolean saveSettings(String raw) {
        JSONObject settings = parseObject(raw);
        put(settings, "closeToTray", false); put(settings, "startMinimized", false); put(settings, "trayEnabled", false);
        put(settings, "minimizeToTray", false); put(settings, "moveFilesIntoPlaylists", false); put(settings, "autoWatch", false);
        return writeJsonFile("settings.json", settings);
    }

    @JavascriptInterface public String getPlaybackSession() { return readJsonFile("playback.json", new JSONObject()).toString(); }
    @JavascriptInterface public boolean savePlaybackSession(String raw) { return writeJsonFile("playback.json", parseObject(raw)); }

    @JavascriptInterface public void flushPlayback() {}
    @JavascriptInterface public String providerConfig() {
        JSONObject out = readJsonFile("provider-config.json", new JSONObject());
        put(out, "ytDlpPath", "Not available in Android build"); put(out, "cookiesFile", ""); put(out, "proxy", ""); put(out, "downloadMode", "m4a");
        return out.toString();
    }
    @JavascriptInterface public boolean saveProviderConfig(String raw) { return writeJsonFile("provider-config.json", parseObject(raw)); }

    @JavascriptInterface public boolean openLibraryFolder() {
        String folder = readJsonFile("settings.json", defaultSettings()).optString("musicFolder", "");
        if (folder.isEmpty()) return false;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(Uri.parse(folder), DocumentsContract.Document.MIME_TYPE_DIR);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.runOnUi(() -> { try { activity.startActivity(intent); } catch (Exception e) { android.widget.Toast.makeText(activity, "Провайдер хранилища не поддерживает открытие папки отдельно", android.widget.Toast.LENGTH_SHORT).show(); } });
            return true;
        } catch (Exception e) { return false; }
    }

    @JavascriptInterface public String providerDiagnostics() {
        JSONObject out = new JSONObject();
        JSONObject ytdlp = new JSONObject(); JSONObject ffmpeg = new JSONObject(); JSONObject cookies = new JSONObject();
        try {
            String version = "встроен; проверка обновления при первом онлайн-поиске";
            if (ytDlpInitialized) {
                String installedVersion = YoutubeDL.getInstance().version(activity.getApplicationContext());
                if (installedVersion != null && !installedVersion.trim().isEmpty()) version = installedVersion;
            }
            ytdlp.put("available", true); ytdlp.put("version", version); ytdlp.put("updateAvailable", false);
            ytdlp.put("path", "внутреннее хранилище приложения"); ytdlp.put("autoUpdate", true); ytdlp.put("channel", "nightly");
            ffmpeg.put("available", true); cookies.put("sources", new JSONObject()); cookies.put("file", "");
            out.put("ytDlp", ytdlp); out.put("ffmpeg", ffmpeg); out.put("cookies", cookies);
            out.put("jsRuntime", "Android WebView"); out.put("readyForMp3", true); out.put("platform", "android");
        } catch (Exception ignored) {}
        return out.toString();
    }
    @JavascriptInterface public String diagnosticsReport() { return "Localify Crimson Android\\nVersion 1.2.0-android-preview\\nRuntime: Android WebView\\nLocal file playback: MediaStore/Storage Access Framework\\nYouTube yt-dlp/FFmpeg: bundled; yt-dlp auto-update from official NIGHTLY channel\\n"; }
    @JavascriptInterface public String getLogs(int lines) { return "Логи Android доступны через системный журнал приложения."; }
    @JavascriptInterface public boolean clearLogs() { return true; }
    @JavascriptInterface public String logsDirectory() { return dataDir.getAbsolutePath(); }

    @JavascriptInterface public void request(String action, int callbackId) {
        activity.runOnUi(() -> startRequest(action, callbackId));
    }

    private void startRequest(String action, int callbackId) {
        if (pendingCallbackId != -1) {
            finishCallback(callbackId, new JSONObject(), "Другой системный выбор уже открыт");
            return;
        }
        pendingCallbackId = callbackId; pendingAction = action;
        try {
            Intent intent;
            switch (action) {
                case "pickFiles":
                    intent = new Intent(Intent.ACTION_OPEN_DOCUMENT); intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("audio/*"); intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true); break;
                case "pickFolder":
                    intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE); break;
                case "chooseLibraryFolder":
                    intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE); break;
                case "pickImage":
                    intent = new Intent(Intent.ACTION_OPEN_DOCUMENT); intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("image/*"); break;
                default:
                    pendingCallbackId = -1; pendingAction = ""; finishCallback(callbackId, new JSONObject(), "Неизвестное действие"); return;
            }
            if (Build.VERSION.SDK_INT >= 26 && (action.equals("chooseLibraryFolder") || action.equals("pickFolder"))) {
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            } else {
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            }
            activity.launchPicker(intent);
        } catch (Exception ex) {
            int id = pendingCallbackId; pendingCallbackId = -1; pendingAction = "";
            finishCallback(id, new JSONObject(), "Не удалось открыть системный выбор: " + ex.getMessage());
        }
    }

    void onPickerResult(int resultCode, Intent data) {
        final int callback = pendingCallbackId;
        final String action = pendingAction;
        pendingCallbackId = -1; pendingAction = "";
        if (callback < 0) return;
        if (resultCode != Activity.RESULT_OK || data == null) { finishCallback(callback, JSONObject.NULL, null); return; }
        new Thread(() -> {
            try {
                if ("pickImage".equals(action)) {
                    Uri uri = data.getData();
                    String result = uri == null ? null : imageAsDataUrl(uri);
                    finishCallback(callback, result == null ? JSONObject.NULL : new org.json.JSONStringer().value(result).toString(), null);
                } else if ("pickFiles".equals(action)) {
                    List<Uri> uris = getSelectedUris(data);
                    JSONArray tracks = new JSONArray();
                    for (Uri uri : uris) { takePersistable(uri, data); JSONObject t = makeTrack(uri, queryDisplayName(uri), 0); if (t != null) tracks.put(t); }
                    finishCallback(callback, tracks.toString(), null);
                } else {
                    Uri tree = data.getData();
                    if (tree == null) { finishCallback(callback, JSONObject.NULL, null); return; }
                    takePersistable(tree, data);
                    if ("chooseLibraryFolder".equals(action)) saveMusicFolder(tree.toString());
                    JSONArray tracks = "chooseLibraryFolder".equals(action) ? scanTree(tree, 0, loadTrackCache()) : scanTree(tree, 0);
                    if ("chooseLibraryFolder".equals(action)) {
                        JSONObject result = new JSONObject(); put(result, "folder", tree.toString()); put(result, "folderAvailable", true);
                        try { result.put("tracks", tracks); result.put("discoveredPlaylists", new JSONArray()); } catch (Exception ignored) {}
                        finishCallback(callback, result.toString(), null);
                    } else finishCallback(callback, tracks.toString(), null);
                }
            } catch (Exception ex) {
                Log.e(TAG, "Picker failed", ex); finishCallback(callback, JSONObject.NULL, ex.getMessage());
            }
        }, "LocalifyPickerWorker").start();
    }

    private List<Uri> getSelectedUris(Intent data) {
        ArrayList<Uri> out = new ArrayList<>();
        if (data.getClipData() != null) {
            for (int i = 0; i < data.getClipData().getItemCount(); i++) out.add(data.getClipData().getItemAt(i).getUri());
        } else if (data.getData() != null) out.add(data.getData());
        return out;
    }

    private void takePersistable(Uri uri, Intent data) {
        try {
            int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            activity.getContentResolver().takePersistableUriPermission(uri, flags & Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {}
    }

    private void finishCallback(int id, Object rawResult, String error) {
        if (id < 0) return;
        String jsonValue;
        if (rawResult == null || rawResult == JSONObject.NULL) jsonValue = "null";
        else if (rawResult instanceof String) jsonValue = (String) rawResult;
        else jsonValue = String.valueOf(rawResult);
        String payload = JSONObject.quote(jsonValue);
        String err = error == null ? "null" : JSONObject.quote(error);
        activity.eval("if(window.__localifyAndroidResolve){window.__localifyAndroidResolve(" + id + "," + payload + "," + err + ");}");
    }

    @JavascriptInterface public void scanLibraryFolder(int callbackId) {
        String folder = readJsonFile("settings.json", defaultSettings()).optString("musicFolder", "");
        if (folder.isEmpty()) { finishCallback(callbackId, "null", null); return; }
        new Thread(() -> {
            try {
                JSONArray tracks = scanTree(Uri.parse(folder), 0, loadTrackCache());
                JSONObject result = new JSONObject(); put(result, "folder", folder); put(result, "folderAvailable", true);
                try { result.put("tracks", tracks); result.put("discoveredPlaylists", new JSONArray()); } catch (Exception ignored) {}
                finishCallback(callbackId, result.toString(), null);
            } catch (Exception e) {
                JSONObject result = new JSONObject(); put(result, "folder", folder); put(result, "folderAvailable", false); put(result, "tracks", new JSONArray());
                finishCallback(callbackId, result.toString(), e.getMessage());
            }
        }, "LocalifyScanWorker").start();
    }

    private Map<String, JSONObject> loadTrackCache() {
        Map<String, JSONObject> cache = new HashMap<>();
        JSONObject saved = readJsonFile("library.json", new JSONObject());
        JSONArray tracks = saved.optJSONArray("library");
        if (tracks == null) return cache;
        for (int i = 0; i < tracks.length(); i++) {
            JSONObject track = tracks.optJSONObject(i);
            if (track == null) continue;
            String path = track.optString("sourcePath", track.optString("path", ""));
            if (!path.isEmpty()) cache.put(path, track);
        }
        return cache;
    }

    private JSONArray scanTree(Uri treeUri, int depth) throws Exception {
        return scanTree(treeUri, depth, null);
    }

    private JSONArray scanTree(Uri treeUri, int depth, Map<String, JSONObject> cachedTracks) throws Exception {
        JSONArray tracks = new JSONArray();
        if (depth > 10 || tracks.length() > 15000) return tracks;
        String treeId = DocumentsContract.getTreeDocumentId(treeUri);
        Uri rootDoc = DocumentsContract.buildDocumentUriUsingTree(treeUri, treeId);
        scanDocument(treeUri, rootDoc, depth, tracks, new HashSet<String>(), cachedTracks);
        return tracks;
    }

    private void scanDocument(Uri treeUri, Uri docUri, int depth, JSONArray out, Set<String> visited, Map<String, JSONObject> cachedTracks) {
        if (depth > 10 || out.length() >= 15000) return;
        String docId;
        try { docId = DocumentsContract.getDocumentId(docUri); } catch (Exception e) { return; }
        if (!visited.add(docId)) return;
        ContentResolver resolver = activity.getContentResolver();
        try (Cursor cursor = resolver.query(docUri, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_LAST_MODIFIED}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String display = cursor.getString(cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME));
                String mime = cursor.getString(cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE));
                if (!DocumentsContract.Document.MIME_TYPE_DIR.equals(mime) && isAudio(display, mime)) {
                    int modifiedIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
                    long modified = modifiedIndex >= 0 ? cursor.getLong(modifiedIndex) : 0;
                    JSONObject track = cachedTrack(docUri, display, modified, cachedTracks);
                    if (track != null) out.put(track);
                }
            }
        } catch (Exception ignored) {}
        try {
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId);
            try (Cursor cursor = resolver.query(children, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_LAST_MODIFIED}, null, null, null)) {
                if (cursor == null) return;
                while (cursor.moveToNext() && out.length() < 15000) {
                    String childId = cursor.getString(cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID));
                    String display = cursor.getString(cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME));
                    String mime = cursor.getString(cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE));
                    Uri child = DocumentsContract.buildDocumentUriUsingTree(treeUri, childId);
                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) scanDocument(treeUri, child, depth + 1, out, visited, cachedTracks);
                    else if (isAudio(display, mime)) {
                        int modifiedIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
                        long modified = modifiedIndex >= 0 ? cursor.getLong(modifiedIndex) : 0;
                        JSONObject track = cachedTrack(child, display, modified, cachedTracks);
                        if (track != null) out.put(track);
                    }
                }
            }
        } catch (Exception ignored) {}
    }

    private JSONObject cachedTrack(Uri uri, String display, long modified, Map<String, JSONObject> cachedTracks) {
        JSONObject cached = cachedTracks == null ? null : cachedTracks.get(uri.toString());
        if (cached != null && modified > 0 && Long.toString(modified).equals(cached.optString("_statKey", ""))) {
            try { return new JSONObject(cached.toString()); } catch (Exception ignored) {}
        }
        return makeTrack(uri, display, modified);
    }

    private boolean isAudio(String name, String mime) {
        if (mime != null && mime.toLowerCase(Locale.ROOT).startsWith("audio/")) return true;
        String n = name == null ? "" : name.toLowerCase(Locale.ROOT);
        return n.matches(".*\\.(mp3|flac|wav|m4a|aac|ogg|opus|wma|aiff|alac|ape)$");
    }

    private JSONObject makeTrack(Uri uri, String displayName, long modified) {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(activity, uri);
            String title = meta(retriever, MediaMetadataRetriever.METADATA_KEY_TITLE);
            String artist = meta(retriever, MediaMetadataRetriever.METADATA_KEY_ARTIST);
            String album = meta(retriever, MediaMetadataRetriever.METADATA_KEY_ALBUM);
            String albumArtist = meta(retriever, MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST);
            String year = meta(retriever, MediaMetadataRetriever.METADATA_KEY_YEAR);
            String genre = meta(retriever, MediaMetadataRetriever.METADATA_KEY_GENRE);
            String duration = meta(retriever, MediaMetadataRetriever.METADATA_KEY_DURATION);
            if (title.isEmpty()) title = stripExtension(displayName == null ? queryDisplayName(uri) : displayName);
            if (artist.isEmpty()) artist = "Неизвестный исполнитель";
            JSONObject track = new JSONObject();
            String path = uri.toString();
            String stable = "android:" + sha256(path).substring(0, 24);
            put(track, "id", stable); put(track, "title", title); put(track, "artist", artist);
            put(track, "album", album); put(track, "albumArtist", albumArtist); put(track, "year", year);
            put(track, "genre", genre); put(track, "duration", parseLong(duration) / 1000.0);
            put(track, "path", path); put(track, "sourcePath", path); put(track, "url", mediaUrl("audio", uri));
            put(track, "addedAt", System.currentTimeMillis()); put(track, "_statKey", String.valueOf(modified));
            byte[] picture = retriever.getEmbeddedPicture();
            put(track, "cover", picture != null && picture.length > 0 ? mediaUrl("cover", uri) : "");
            put(track, "remoteCover", "");
            return track;
        } catch (Exception e) {
            Log.w(TAG, "Cannot read embedded metadata from " + uri + "; importing with filename metadata", e);
            return makeBasicTrack(uri, displayName, modified);
        } finally { try { retriever.release(); } catch (Exception ignored) {} }
    }

    private JSONObject makeBasicTrack(Uri uri, String displayName, long modified) {
        try {
            JSONObject track = new JSONObject();
            String path = uri.toString();
            String title = stripExtension(displayName == null ? queryDisplayName(uri) : displayName);
            put(track, "id", "android:" + sha256(path).substring(0, 24)); put(track, "title", title);
            put(track, "artist", "Неизвестный исполнитель"); put(track, "album", ""); put(track, "albumArtist", "");
            put(track, "year", ""); put(track, "genre", ""); put(track, "duration", 0);
            put(track, "path", path); put(track, "sourcePath", path); put(track, "url", mediaUrl("audio", uri));
            put(track, "addedAt", System.currentTimeMillis()); put(track, "_statKey", String.valueOf(modified));
            put(track, "cover", ""); put(track, "remoteCover", "");
            return track;
        } catch (Exception ignored) { return null; }
    }

    private String mediaUrl(String kind, Uri uri) {
        String encoded = Base64.encodeToString(uri.toString().getBytes(StandardCharsets.UTF_8), Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        return "https://" + AUDIO_HOST + "/" + kind + "/" + encoded;
    }

    WebResourceResponse interceptMediaRequest(Uri requestUri, Map<String, String> headers) {
        if (requestUri == null || !AUDIO_HOST.equals(requestUri.getHost())) return null;
        String[] path = requestUri.getPath() == null ? new String[0] : requestUri.getPath().split("/");
        if (path.length < 3) return response(404, "Not Found", "text/plain", new byte[0]);
        String kind = path[1];
        Uri source;
        try { source = Uri.parse(new String(Base64.decode(path[2], Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING), StandardCharsets.UTF_8)); }
        catch (Exception e) { return response(400, "Bad Request", "text/plain", new byte[0]); }
        try {
            if ("cover".equals(kind)) {
                MediaMetadataRetriever r = new MediaMetadataRetriever();
                try { r.setDataSource(activity, source); byte[] art = r.getEmbeddedPicture(); if (art == null) return response(404, "Not Found", "image/jpeg", new byte[0]); return response(200, "OK", sniffImage(art), art); }
                finally { try { r.release(); } catch (Exception ignored) {} }
            }
            if (!"audio".equals(kind)) return response(404, "Not Found", "text/plain", new byte[0]);
            InputStream in = activity.getContentResolver().openInputStream(source);
            if (in == null) return response(404, "Not Found", "text/plain", new byte[0]);
            String mime = activity.getContentResolver().getType(source);
            if (mime == null || !mime.toLowerCase(Locale.ROOT).startsWith("audio/") || "application/octet-stream".equalsIgnoreCase(mime)) {
                String inferred = guessMime(queryDisplayName(source));
                if (inferred.startsWith("audio/")) mime = inferred;
                else if (mime == null || !mime.toLowerCase(Locale.ROOT).startsWith("audio/")) mime = "audio/mpeg";
            }
            String range = findHeader(headers, "Range");
            long totalLength = querySize(source);
            if (range != null && range.startsWith("bytes=") && totalLength > 0) {
                long start = 0, requestedEnd = -1;
                try { String[] parts = range.substring(6).split("-", 2); start = Long.parseLong(parts[0]); if (parts.length > 1 && !parts[1].isEmpty()) requestedEnd = Long.parseLong(parts[1]); } catch (Exception ignored) {}
                if (start >= totalLength) { try { in.close(); } catch (Exception ignored) {} Map<String, String> h = commonHeaders(); h.put("Content-Range", "bytes */" + totalLength); return new WebResourceResponse(mime, null, 416, "Range Not Satisfiable", h, new ByteArrayInputStream(new byte[0])); }
                long end = requestedEnd >= start ? Math.min(requestedEnd, totalLength - 1) : totalLength - 1;
                long skipped = 0; while (skipped < start) { long n = in.skip(start - skipped); if (n <= 0) break; skipped += n; }
                long contentLength = end - start + 1;
                Map<String, String> h = commonHeaders(); h.put("Accept-Ranges", "bytes"); h.put("Content-Range", "bytes " + start + "-" + end + "/" + totalLength); h.put("Content-Length", String.valueOf(contentLength));
                return new WebResourceResponse(mime, null, 206, "Partial Content", h, new LimitedInputStream(in, contentLength));
            }
            Map<String, String> h = commonHeaders(); h.put("Accept-Ranges", "bytes"); if (totalLength > 0) h.put("Content-Length", String.valueOf(totalLength));
            return new WebResourceResponse(mime, null, 200, "OK", h, in);
        } catch (Exception e) {
            Log.w(TAG, "Media request failed: " + requestUri, e);
            return response(404, "Not Found", "text/plain", new byte[0]);
        }
    }

    private long querySize(Uri uri) {
        try (Cursor c = activity.getContentResolver().query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
            if (c != null && c.moveToFirst()) { int index = c.getColumnIndex(OpenableColumns.SIZE); if (index >= 0 && !c.isNull(index)) return c.getLong(index); }
        } catch (Exception ignored) {}
        return -1;
    }

    private String findHeader(Map<String, String> headers, String name) {
        if (headers == null) return null;
        for (Map.Entry<String, String> e : headers.entrySet()) if (e.getKey().equalsIgnoreCase(name)) return e.getValue();
        return null;
    }
    private Map<String, String> commonHeaders() {
        Map<String, String> out = new HashMap<>(); out.put("Access-Control-Allow-Origin", "*"); out.put("Cache-Control", "no-store");
        out.put("X-Content-Type-Options", "nosniff"); return out;
    }
    private WebResourceResponse response(int code, String reason, String mime, byte[] bytes) {
        return new WebResourceResponse(mime, "UTF-8", code, reason, commonHeaders(), new ByteArrayInputStream(bytes));
    }
    private String guessMime(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".mp3")) return "audio/mpeg"; if (p.endsWith(".m4a")) return "audio/mp4"; if (p.endsWith(".aac")) return "audio/aac";
        if (p.endsWith(".ogg") || p.endsWith(".opus")) return "audio/ogg"; if (p.endsWith(".wav")) return "audio/wav";
        if (p.endsWith(".flac")) return "audio/flac"; if (p.endsWith(".wma")) return "audio/x-ms-wma"; return "application/octet-stream";
    }
    private String sniffImage(byte[] b) { if (b.length > 4 && b[0] == (byte)0x89 && b[1] == 'P') return "image/png"; if (b.length > 2 && b[0] == (byte)0xff && b[1] == (byte)0xd8) return "image/jpeg"; return "image/jpeg"; }

    @JavascriptInterface public String onlineSearch(String payload) {
        JSONObject data = parseObject(payload); String query = data.optString("query", "").trim();
        int limit = Math.max(1, Math.min(50, data.optInt("limit", 18)));
        try { return itunesSearch(query, limit).toString(); }
        catch (Exception e) { Log.w(TAG, "Online search failed", e); return "[]"; }
    }

    @JavascriptInterface public String metadataSearch(String rawTrack) {
        JSONObject track = parseObject(rawTrack);
        String query = (track.optString("artist", "") + " " + track.optString("title", "")).trim();
        if (query.isEmpty()) return "null";
        try {
            JSONArray results = itunesSearch(query, 8);
            if (results.length() == 0) return "null";
            JSONObject best = results.getJSONObject(0);
            JSONObject out = new JSONObject();
            put(out, "title", best.optString("title", track.optString("title", "")));
            put(out, "artist", best.optString("artist", track.optString("artist", "")));
            put(out, "album", best.optString("album", track.optString("album", "")));
            put(out, "year", best.optString("year", track.optString("year", "")));
            put(out, "genre", best.optString("genre", track.optString("genre", "")));
            put(out, "remoteCover", best.optString("cover", "")); put(out, "cover", best.optString("cover", ""));
            put(out, "sourceUrl", best.optString("sourceUrl", "")); put(out, "metadataCheckedAt", System.currentTimeMillis());
            return out.toString();
        } catch (Exception e) { return "null"; }
    }

    private JSONArray itunesSearch(String query, int limit) throws Exception {
        JSONArray out = new JSONArray(); if (query == null || query.trim().isEmpty()) return out;
        String endpoint = "https://itunes.apple.com/search?media=music&entity=song&limit=" + limit + "&term=" + URLEncoder.encode(query, "UTF-8");
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setConnectTimeout(4500); connection.setReadTimeout(5500); connection.setRequestProperty("User-Agent", "LocalifyCrimson-Android/1.2.0");
        try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int n; while ((n = input.read(buffer)) >= 0) output.write(buffer, 0, n);
            JSONObject root = new JSONObject(output.toString("UTF-8")); JSONArray rows = root.optJSONArray("results"); if (rows == null) return out;
            for (int i = 0; i < rows.length(); i++) {
                JSONObject r = rows.getJSONObject(i); String preview = r.optString("previewUrl", ""); if (preview.isEmpty()) continue;
                JSONObject track = new JSONObject(); String trackId = r.optString("trackId", "remote-" + i);
                put(track, "id", "remote:itunes:" + trackId); put(track, "provider", "itunes"); put(track, "providerId", trackId);
                put(track, "title", r.optString("trackName", "Без названия")); put(track, "artist", r.optString("artistName", ""));
                put(track, "album", r.optString("collectionName", "")); put(track, "duration", r.optLong("trackTimeMillis", 0) / 1000.0);
                put(track, "year", r.optString("releaseDate", "").length() >= 4 ? r.optString("releaseDate").substring(0, 4) : "");
                put(track, "genre", r.optString("primaryGenreName", ""));
                String artwork = r.optString("artworkUrl100", "").replace("100x100bb", "600x600bb");
                put(track, "cover", artwork); put(track, "remoteCover", artwork); put(track, "sourceUrl", r.optString("trackViewUrl", ""));
                put(track, "streamUrl", preview); put(track, "url", preview); put(track, "downloadAllowed", false); out.put(track);
            }
        } finally { connection.disconnect(); }
        return out;
    }

    @JavascriptInterface public boolean openExternal(String rawUrl) {
        try {
            Uri uri = Uri.parse(rawUrl);
            String scheme = uri.getScheme();
            if (scheme == null || !(scheme.equals("https") || scheme.equals("http") || scheme.equals("mailto"))) return false;
            Intent intent = new Intent(Intent.ACTION_VIEW, uri); intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); activity.startActivity(intent); return true;
        } catch (Exception e) { return false; }
    }

    @JavascriptInterface public String radioSearch(String payload) { return "[]"; }
    @JavascriptInterface public String radioClick(String stationUuid) { return "null"; }
    @JavascriptInterface public String metadataStats() { return "{\"items\":0,\"coverBytes\":0,\"status\":\"Android\"}"; }
    @JavascriptInterface public boolean clearMetadataCache() { return true; }
    @JavascriptInterface public boolean deleteFiles(String rawPaths) { return false; }
    @JavascriptInterface public String hashLibraryFiles(String rawPaths) { return "{}"; }
    @JavascriptInterface public String findMissingLibraryTracks() { return "[]"; }
    @JavascriptInterface public String recoveryInfo() { return "[]"; }
    @JavascriptInterface public boolean restoreBackup() { return false; }
    @JavascriptInterface public String getLibraryWatchStatus() { return "{\"enabled\":false,\"active\":false,\"folder\":\"\"}"; }
    @JavascriptInterface public void ignoreEvent(String ignored) {}

    private void ensureYtDlpInitialized() throws Exception {
        if (ytDlpInitialized) return;
        synchronized (YT_DLP_INIT_LOCK) {
            if (ytDlpInitialized) return;
            android.content.Context appContext = activity.getApplicationContext();
            YoutubeDL.getInstance().init(appContext);
            FFmpeg.getInstance().init(appContext);

            // The APK contains a fixed yt-dlp snapshot. YouTube frequently changes its
            // player APIs, so refresh the embedded script from the official NIGHTLY
            // channel at most once per week. If offline, keep the bundled copy and
            // retry tomorrow rather than preventing local/iTunes playback.
            final String updateKey = "ytDlpLastUpdateAttemptAt";
            final long now = System.currentTimeMillis();
            final long dayMs = 24L * 60L * 60L * 1000L;
            long lastAttempt = prefs.getLong(updateKey, 0L);
            if (now - lastAttempt >= 7L * dayMs) {
                prefs.edit().putLong(updateKey, now).apply();
                try {
                    YoutubeDL.getInstance().updateYoutubeDL(
                        appContext, YoutubeDL.UpdateChannel._NIGHTLY
                    );
                    String version = YoutubeDL.getInstance().version(appContext);
                    Log.i(TAG, "yt-dlp update check finished; version=" + version);
                } catch (Exception updateError) {
                    Log.w(TAG, "yt-dlp update failed; using bundled version and retrying tomorrow", updateError);
                    prefs.edit().putLong(updateKey, now - 6L * dayMs).apply();
                }
            }
            ytDlpInitialized = true;
        }
    }

    private boolean isHttpUrl(String rawUrl) {
        try {
            Uri uri = Uri.parse(rawUrl);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            return (scheme.equals("https") || scheme.equals("http"))
                && uri.getHost() != null && rawUrl.length() <= 4096;
        } catch (Exception ignored) { return false; }
    }

    @JavascriptInterface public void updateYtDlp(String raw, int callbackId) {
        ytDlpExecutor.execute(() -> {
            try {
                ensureYtDlpInitialized();
                android.content.Context appContext = activity.getApplicationContext();
                YoutubeDL.getInstance().updateYoutubeDL(appContext, YoutubeDL.UpdateChannel._NIGHTLY);
                prefs.edit().putLong("ytDlpLastUpdateAttemptAt", System.currentTimeMillis()).apply();
                String version = YoutubeDL.getInstance().version(appContext);
                JSONObject result = new JSONObject();
                put(result, "updated", true);
                put(result, "version", version == null ? "unknown" : version);
                finishCallback(callbackId, result, null);
            } catch (Exception ex) {
                Log.w(TAG, "Manual yt-dlp update failed", ex);
                finishCallback(callbackId, JSONObject.NULL, ex.getMessage() == null ? "Не удалось обновить yt-dlp" : ex.getMessage());
            }
        });
    }

    @JavascriptInterface public void searchItunes(String raw, int callbackId) {
        JSONObject payload = parseObject(raw);
        String query = payload.optString("query", "").trim();
        int limit = Math.max(1, Math.min(20, payload.optInt("limit", 12)));
        ytDlpExecutor.execute(() -> {
            try { finishCallback(callbackId, itunesSearch(query, limit), null); }
            catch (Exception ex) {
                Log.w(TAG, "iTunes preview search failed", ex);
                finishCallback(callbackId, new JSONArray(), null);
            }
        });
    }

    @JavascriptInterface public void searchYtDlp(String raw, int callbackId) {
        JSONObject payload = parseObject(raw);
        String query = payload.optString("query", "").trim();
        final int limit = Math.max(1, Math.min(6, payload.optInt("limit", 6)));
        if (query.isEmpty() || query.length() > 180) {
            finishCallback(callbackId, new JSONArray(), null);
            return;
        }
        ytDlpExecutor.execute(() -> {
            JSONArray results = new JSONArray();
            String failure = null;
            try {
                ensureYtDlpInitialized();
                String searchUrl = "ytsearch" + limit + ":" + query.replace("\n", " ").replace("\r", " ");
                YoutubeDLRequest request = new YoutubeDLRequest(searchUrl);
                request.addOption("--flat-playlist");
                request.addOption("--dump-json");
                request.addOption("--no-warnings");
                request.addOption("--no-update");
                request.addOption("--ignore-errors");
                request.addOption("--skip-download");
                request.addOption("--socket-timeout", "10");
                request.addOption("--extractor-retries", "1");
                YoutubeDLResponse response = YoutubeDL.getInstance().execute(request, null, null);
                String output = response == null ? "" : response.getOut();
                if (output != null) {
                    for (String line : output.split("\\r?\\n")) {
                        String row = line == null ? "" : line.trim();
                        if (!row.startsWith("{") || !row.endsWith("}")) continue;
                        try {
                            JSONObject source = new JSONObject(row);
                            String id = source.optString("id", "").trim();
                            String sourceUrl = source.optString("webpage_url", "").trim();
                            if (!isHttpUrl(sourceUrl)) {
                                String rawUrl = source.optString("url", "").trim();
                                if (isHttpUrl(rawUrl)) sourceUrl = rawUrl;
                                else if (!id.isEmpty()) sourceUrl = "https://www.youtube.com/watch?v=" + id;
                            }
                            if (id.isEmpty() || !isHttpUrl(sourceUrl)) continue;
                            JSONObject track = new JSONObject();
                            String title = source.optString("title", source.optString("fulltitle", "Без названия"));
                            String artist = source.optString("artist", source.optString("channel", source.optString("uploader", "YouTube")));
                            String thumbnail = source.optString("thumbnail", "").trim();
                            if (thumbnail.isEmpty()) thumbnail = "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
                            put(track, "id", "remote:youtube:" + id);
                            put(track, "provider", "youtube");
                            put(track, "providerId", id);
                            put(track, "title", title);
                            put(track, "artist", artist);
                            put(track, "album", source.optString("album", ""));
                            put(track, "duration", source.optDouble("duration", 0));
                            put(track, "cover", thumbnail);
                            put(track, "remoteCover", thumbnail);
                            put(track, "sourceUrl", sourceUrl);
                            put(track, "downloadAllowed", true);
                            results.put(track);
                            if (results.length() >= limit) break;
                        } catch (Exception parseError) {
                            Log.d(TAG, "Skipping unparsed yt-dlp search row", parseError);
                        }
                    }
                }
            } catch (Exception ex) {
                Log.w(TAG, "Built-in yt-dlp search failed", ex);
                failure = ex.getMessage() == null ? "yt-dlp search failed" : ex.getMessage();
            }
            finishCallback(callbackId, results, failure);
        });
    }

    @JavascriptInterface public void resolveYtDlp(String raw, int callbackId) {
        JSONObject payload = parseObject(raw);
        String url = payload.optString("sourceUrl", payload.optString("url", "")).trim();
        if (!isHttpUrl(url)) {
            finishCallback(callbackId, JSONObject.NULL, "У результата нет допустимой веб-ссылки");
            return;
        }
        ytDlpExecutor.execute(() -> {
            try {
                ensureYtDlpInitialized();
                YoutubeDLRequest request = new YoutubeDLRequest(url);
                request.addOption("-f", "bestaudio/best");
                request.addOption("--no-playlist");
                request.addOption("--no-warnings");
                request.addOption("--no-update");
                request.addOption("--socket-timeout", "10");
                request.addOption("--extractor-retries", "1");
                VideoInfo info = YoutubeDL.getInstance().getInfo(request);
                String stream = info == null || info.getUrl() == null ? "" : info.getUrl();
                if (!isHttpUrl(stream) && info != null && info.getFormats() != null) {
                    for (com.yausername.youtubedl_android.mapper.VideoFormat format : info.getFormats()) {
                        String audioCodec = format.getAcodec() == null ? "" : format.getAcodec();
                        String candidate = format.getUrl() == null ? "" : format.getUrl();
                        if (isHttpUrl(candidate) && !audioCodec.isEmpty() && !"none".equalsIgnoreCase(audioCodec)) {
                            stream = candidate;
                            break;
                        }
                    }
                }
                if (!isHttpUrl(stream)) throw new IOException("Не удалось получить прямой аудиопоток");
                JSONObject resolved = new JSONObject();
                put(resolved, "url", stream);
                put(resolved, "title", info == null ? payload.optString("title", "") : info.getTitle());
                put(resolved, "artist", info == null ? payload.optString("artist", "") : info.getUploader());
                put(resolved, "duration", info == null ? 0 : info.getDuration());
                put(resolved, "cover", info == null ? payload.optString("cover", "") : info.getThumbnail());
                finishCallback(callbackId, resolved, null);
            } catch (Exception ex) {
                Log.w(TAG, "Could not resolve an audio stream", ex);
                finishCallback(callbackId, JSONObject.NULL, "Не удалось получить аудиопоток: " + (ex.getMessage() == null ? "ошибка yt-dlp" : ex.getMessage()));
            }
        });
    }

    private String safeDownloadName(String title) {
        String value = title == null ? "" : title;
        StringBuilder safe = new StringBuilder();
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '/' || c == '\\' || c == ':' || c == '*' || c == '?' || c == '"' || c == '<' || c == '>' || c == '|') safe.append('_');
            else if (!Character.isISOControl(c)) safe.append(c);
        }
        String name = safe.toString().trim().replaceAll("\\s+", " ");
        if (name.isEmpty()) name = "Localify track";
        if (name.length() > 100) name = name.substring(0, 100).trim();
        return name;
    }

    private void reportYtDlpProgress(int callbackId, String key, float percent, long eta, String line) {
        try {
            JSONObject progress = new JSONObject();
            put(progress, "key", key);
            put(progress, "percent", Math.max(0, Math.min(99.5, percent)));
            put(progress, "eta", Math.max(0, eta));
            put(progress, "line", line == null ? "" : line);
            activity.eval("if(window.__localifyAndroidDownloadProgress){window.__localifyAndroidDownloadProgress(" + progress.toString() + ");}");
        } catch (Exception ignored) {}
    }

    private JSONObject publishDownloadedAudio(File downloaded, JSONObject source) throws Exception {
        if (downloaded == null || !downloaded.isFile() || downloaded.length() <= 0) {
            throw new IOException("yt-dlp не создал MP3-файл");
        }
        String name = safeDownloadName(source.optString("title", stripExtension(downloaded.getName()))) + ".mp3";
        Uri resultUri;
        ContentResolver resolver = activity.getContentResolver();
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Audio.Media.DISPLAY_NAME, name);
            values.put(MediaStore.Audio.Media.MIME_TYPE, "audio/mpeg");
            values.put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_MUSIC + "/Localify Downloads");
            values.put(MediaStore.Audio.Media.IS_PENDING, 1);
            resultUri = resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values);
            if (resultUri == null) throw new IOException("Не удалось создать файл в Music/Localify Downloads");
            try {
                try (InputStream input = new FileInputStream(downloaded);
                     java.io.OutputStream output = resolver.openOutputStream(resultUri, "w")) {
                    if (output == null) throw new IOException("Не удалось записать скачанный файл");
                    byte[] buffer = new byte[32768]; int count;
                    while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
                    output.flush();
                }
                ContentValues ready = new ContentValues();
                ready.put(MediaStore.Audio.Media.IS_PENDING, 0);
                resolver.update(resultUri, ready, null, null);
            } catch (Exception ex) {
                try { resolver.delete(resultUri, null, null); } catch (Exception ignored) {}
                throw ex;
            }
        } else {
            File ext = activity.getExternalFilesDir(Environment.DIRECTORY_MUSIC);
            File music = new File(ext == null ? activity.getFilesDir() : ext, "Localify Downloads");
            if (!music.exists() && !music.mkdirs()) throw new IOException("Не удалось создать папку загрузок");
            File output = new File(music, name);
            if (output.exists()) output = new File(music, safeDownloadName(source.optString("title", "Localify track")) + "-" + System.currentTimeMillis() + ".mp3");
            try (InputStream input = new FileInputStream(downloaded); java.io.OutputStream outputStream = new FileOutputStream(output)) {
                byte[] buffer = new byte[32768]; int count;
                while ((count = input.read(buffer)) >= 0) outputStream.write(buffer, 0, count);
                outputStream.flush();
            }
            resultUri = Uri.fromFile(output);
        }
        JSONObject localTrack = makeTrack(resultUri, name, System.currentTimeMillis());
        if (localTrack == null) throw new IOException("Файл скачан, но не удалось прочитать его метаданные");
        put(localTrack, "provider", "local");
        put(localTrack, "downloadedPath", resultUri.toString());
        put(localTrack, "downloadSourceUrl", source.optString("sourceUrl", ""));
        put(localTrack, "downloadAllowed", false);
        JSONObject result = new JSONObject();
        put(result, "path", resultUri.toString());
        put(result, "format", "mp3");
        put(result, "duplicate", false);
        result.put("track", localTrack);
        return result;
    }

    @JavascriptInterface public void downloadYtDlp(String raw, int callbackId) {
        JSONObject payload = parseObject(raw);
        String url = payload.optString("sourceUrl", payload.optString("url", "")).trim();
        String provider = payload.optString("provider", "");
        if (!"youtube".equals(provider) || !isHttpUrl(url)) {
            finishCallback(callbackId, JSONObject.NULL, "Для встроенного скачивания выберите результат YouTube");
            return;
        }
        final String key = payload.optString("key", payload.optString("providerId", payload.optString("id", "")));
        ytDlpExecutor.execute(() -> {
            File workDir = null;
            try {
                ensureYtDlpInitialized();
                workDir = new File(activity.getCacheDir(), "yt-dlp-" + callbackId + "-" + System.currentTimeMillis());
                if (!workDir.mkdirs() && !workDir.isDirectory()) throw new IOException("Не удалось создать временную папку загрузки");
                File outputTemplate = new File(workDir, "%(title).150B.%(ext)s");
                YoutubeDLRequest request = new YoutubeDLRequest(url);
                request.addOption("-x");
                request.addOption("--audio-format", "mp3");
                request.addOption("--audio-quality", "192K");
                request.addOption("--embed-metadata");
                request.addOption("--embed-thumbnail");
                request.addOption("--convert-thumbnails", "jpg");
                request.addOption("--no-playlist");
                request.addOption("--newline");
                request.addOption("--no-update");
                request.addOption("--socket-timeout", "10");
                request.addOption("--extractor-retries", "1");
                request.addOption("-o", outputTemplate.getAbsolutePath());
                YoutubeDLResponse response = YoutubeDL.getInstance().execute(request, null, (progress, eta, line) -> {
                    float percentage = progress == null ? 0f : progress.floatValue();
                    long remaining = eta == null ? 0L : eta.longValue();
                    reportYtDlpProgress(callbackId, key, percentage, remaining, line);
                    return kotlin.Unit.INSTANCE;
                });
                if (response == null || response.getExitCode() != 0) {
                    throw new IOException("yt-dlp завершился с ошибкой");
                }
                File[] outputs = workDir.listFiles((dir, filename) -> filename.toLowerCase(Locale.ROOT).endsWith(".mp3") && !filename.endsWith(".part"));
                if (outputs == null || outputs.length == 0) throw new IOException("После обработки MP3-файл не найден");
                java.util.Arrays.sort(outputs, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
                JSONObject result = publishDownloadedAudio(outputs[0], payload);
                reportYtDlpProgress(callbackId, key, 100f, 0, "Готово");
                finishCallback(callbackId, result, null);
            } catch (Exception ex) {
                Log.e(TAG, "Built-in yt-dlp download failed", ex);
                finishCallback(callbackId, JSONObject.NULL, ex.getMessage() == null ? "Не удалось скачать трек через yt-dlp" : ex.getMessage());
            } finally {
                if (workDir != null && workDir.exists()) deleteRecursively(workDir);
            }
        });
    }

    private void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteRecursively(child);
        try { file.delete(); } catch (Exception ignored) {}
    }

    @JavascriptInterface public void updatePlayback(String raw) {
        JSONObject payload = parseObject(raw); boolean playing = payload.optBoolean("playing", false);
        Intent intent = new Intent(activity, PlaybackService.class);
        intent.setAction(playing ? PlaybackService.ACTION_PLAYING : PlaybackService.ACTION_PAUSED);
        putMediaExtras(intent, payload);
        if (playing) { if (Build.VERSION.SDK_INT >= 26) activity.startForegroundService(intent); else activity.startService(intent); }
        else activity.startService(intent);
    }
    @JavascriptInterface public void nowPlaying(String raw) {
        JSONObject payload = parseObject(raw);
        Intent intent = new Intent(activity, PlaybackService.class);
        intent.setAction(PlaybackService.ACTION_METADATA);
        putMediaExtras(intent, payload);
        try { activity.startService(intent); } catch (Exception ignored) {}
    }
    private void putMediaExtras(Intent intent, JSONObject payload) {
        putIntentExtra(intent, "title", payload.optString("title", "Localify Crimson"));
        putIntentExtra(intent, "artist", payload.optString("artist", ""));
        putIntentExtra(intent, "album", payload.optString("album", ""));
        putIntentExtra(intent, "sourcePath", payload.optString("sourcePath", ""));
        putIntentExtra(intent, "cover", payload.optString("cover", ""));
        intent.putExtra("duration", payload.optDouble("duration", 0));
        intent.putExtra("position", payload.optDouble("position", 0));
    }
    private void putIntentExtra(Intent intent, String key, String value) { intent.putExtra(key, value == null ? "" : value); }

    void onMediaAction(String action) { activity.dispatchMediaKey(action); }

    private JSONObject defaultSettings() {
        JSONObject x = new JSONObject();
        try {
            x.put("closeToTray", false); x.put("startMinimized", false); x.put("trayEnabled", false); x.put("minimizeToTray", false);
            x.put("mediaKeys", true); x.put("notifications", true); x.put("onlineMetadata", true); x.put("renameFiles", false); x.put("moveFilesIntoPlaylists", false);
            x.put("musicFolder", ""); x.put("ytDlpPath", "Not available in Android build"); x.put("cookiesFile", ""); x.put("proxy", ""); x.put("downloadMode", "m4a");
            x.put("gapless", true); x.put("uiDensity", "normal"); x.put("coverSize", "medium"); x.put("reduceMotion", false); x.put("compactPlayer", false); x.put("autoWatch", false);
        } catch (Exception ignored) {}
        return x;
    }
    private void saveMusicFolder(String uri) {
        JSONObject settings = readJsonFile("settings.json", defaultSettings()); put(settings, "musicFolder", uri); put(settings, "moveFilesIntoPlaylists", false); writeJsonFile("settings.json", settings);
    }
    private String queryDisplayName(Uri uri) {
        try (Cursor c = activity.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {}
        String segment = uri.getLastPathSegment(); return segment == null ? "Аудиофайл" : segment;
    }
    private String imageAsDataUrl(Uri uri) {
        try (InputStream in = activity.getContentResolver().openInputStream(uri); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) return null; byte[] buf = new byte[8192]; int n; int total = 0;
            while ((n = in.read(buf)) >= 0) { total += n; if (total > 8 * 1024 * 1024) return null; out.write(buf, 0, n); }
            String mime = activity.getContentResolver().getType(uri); if (mime == null) mime = "image/jpeg";
            return "data:" + mime + ";base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) { return null; }
    }
    private String meta(MediaMetadataRetriever r, int key) { try { String s = r.extractMetadata(key); return s == null ? "" : s.trim(); } catch (Exception e) { return ""; } }
    private long parseLong(String v) { try { return Long.parseLong(v); } catch (Exception e) { return 0; } }
    private String stripExtension(String v) { if (v == null) return "Без названия"; int dot = v.lastIndexOf('.'); return dot > 0 ? v.substring(0, dot) : v; }
    private String sha256(String raw) {
        try { byte[] b = java.security.MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8)); StringBuilder s = new StringBuilder(); for (byte x : b) s.append(String.format(Locale.ROOT, "%02x", x)); return s.toString(); }
        catch (Exception e) { return String.valueOf(raw.hashCode()); }
    }
    private JSONObject parseObject(String raw) { try { return new JSONObject(raw == null || raw.isEmpty() ? "{}" : raw); } catch (Exception e) { return new JSONObject(); } }
    private JSONObject readJsonFile(String name, JSONObject fallback) {
        File file = new File(dataDir, name); if (!file.exists()) return copy(fallback);
        try (FileInputStream in = new FileInputStream(file); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] b = new byte[8192]; int n; while ((n = in.read(b)) >= 0) out.write(b, 0, n); return new JSONObject(out.toString("UTF-8"));
        } catch (Exception e) { return copy(fallback); }
    }
    private boolean writeJsonFile(String name, JSONObject data) {
        synchronized (this) {
            try {
                File tmp = new File(dataDir, name + ".tmp"), dest = new File(dataDir, name);
                try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(data.toString().getBytes(StandardCharsets.UTF_8)); out.flush(); out.getFD().sync(); }
                if (dest.exists() && !dest.delete()) return false;
                return tmp.renameTo(dest);
            } catch (Exception e) { Log.e(TAG, "Failed saving " + name, e); return false; }
        }
    }
    private JSONObject copy(JSONObject object) { try { return new JSONObject(object.toString()); } catch (Exception e) { return new JSONObject(); } }
    private void put(JSONObject object, String key, Object value) { try { object.put(key, value); } catch (Exception ignored) {} }

    private static final class LimitedInputStream extends InputStream {
        private final InputStream delegate; private long remaining;
        LimitedInputStream(InputStream delegate, long remaining) { this.delegate = delegate; this.remaining = remaining; }
        @Override public int read() throws IOException { if (remaining <= 0) return -1; int value = delegate.read(); if (value >= 0) remaining--; return value; }
        @Override public int read(byte[] b, int off, int len) throws IOException { if (remaining <= 0) return -1; int n = delegate.read(b, off, (int)Math.min(len, remaining)); if (n > 0) remaining -= n; return n; }
        @Override public void close() throws IOException { delegate.close(); }
    }
}
