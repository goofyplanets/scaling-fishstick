package com.localify.crimson;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.content.Intent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.net.Uri;
import android.database.Cursor;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.media.MediaMetadataRetriever;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.content.ContentResolver;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.Manifest;
import android.content.pm.PackageManager;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONException;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final String TAG = "LocalifyCrimson";
    private static final int REQ_PICKER = 4101;
    private static final int REQ_HTML_CHOOSER = 4102;
    private WebView webView;
    private LocalifyAndroidBridge bridge;
    private android.webkit.ValueCallback<Uri[]> webFileChooser;
    private BroadcastReceiver mediaReceiver;
    private boolean receiverRegistered = false;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(android.graphics.Color.rgb(16, 11, 13));
        getWindow().setNavigationBarColor(android.graphics.Color.rgb(16, 11, 13));
        webView = new WebView(this);
        webView.setBackgroundColor(android.graphics.Color.rgb(16, 11, 13));
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setJavaScriptCanOpenWindowsAutomatically(false);
        ws.setSupportMultipleWindows(false);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        ws.setLoadWithOverviewMode(true);
        ws.setUseWideViewPort(true);
        if (Build.VERSION.SDK_INT >= 29) ws.setForceDark(WebSettings.FORCE_DARK_OFF);
        bridge = new LocalifyAndroidBridge(this);
        registerMediaReceiver();
        webView.addJavascriptInterface(bridge, "LocalifyAndroid");
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse local = bridge.interceptMediaRequest(request.getUrl(), request.getRequestHeaders());
                return local != null ? local : super.shouldInterceptRequest(view, request);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
                if (scheme.equals("file") || scheme.equals("https") && "appassets.androidplatform.net".equals(uri.getHost())) return false;
                if (scheme.equals("https") || scheme.equals("http") || scheme.equals("mailto")) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                    return true;
                }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage cm) {
                Log.d(TAG, cm.message() + " (" + cm.sourceId() + ":" + cm.lineNumber() + ")");
                return true;
            }
            @Override public boolean onShowFileChooser(WebView view, android.webkit.ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (webFileChooser != null) webFileChooser.onReceiveValue(null);
                webFileChooser = callback;
                try {
                    Intent intent = params.createIntent();
                    startActivityForResult(intent, REQ_HTML_CHOOSER);
                    return true;
                } catch (Exception ex) {
                    webFileChooser = null;
                    callback.onReceiveValue(null);
                    return false;
                }
            }
        });
        setContentView(webView);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 4103);
        }
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    private void registerMediaReceiver() {
        if (mediaReceiver == null) {
            mediaReceiver = new BroadcastReceiver() {
                @Override public void onReceive(Context context, Intent intent) {
                    if (intent != null && bridge != null) bridge.onMediaAction(intent.getStringExtra("action"));
                }
            };
        }
        if (!receiverRegistered) {
            IntentFilter filter = new IntentFilter(PlaybackService.ACTION_MEDIA_EVENT);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(mediaReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            else registerReceiver(mediaReceiver, filter);
            receiverRegistered = true;
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_PICKER) {
            bridge.onPickerResult(resultCode, data);
        } else if (requestCode == REQ_HTML_CHOOSER && webFileChooser != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount(); result = new Uri[count];
                    for (int i = 0; i < count; i++) result[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) result = new Uri[]{data.getData()};
            }
            webFileChooser.onReceiveValue(result); webFileChooser = null;
        }
    }

    void launchPicker(Intent intent) { startActivityForResult(intent, REQ_PICKER); }
    void runOnUi(Runnable task) { runOnUiThread(task); }
    void eval(String javascript) { runOnUiThread(() -> { if (webView != null) webView.evaluateJavascript(javascript, null); }); }

    void dispatchMediaKey(String action) {
        String q = JSONObject.quote(action);
        eval("(function(){var n=0;function run(){if(window.__localifyMediaKey){window.__localifyMediaKey(" + q + ");}else if(n++<20){setTimeout(run,100);}}run();})()");
    }

    @Override public void onBackPressed() {
        if (webView != null) {
            webView.evaluateJavascript("(function(){var d=[...document.querySelectorAll('dialog[open]')];if(d.length){d[d.length-1].close();return true;}return false;})()", value -> {
                if (!"true".equals(value)) finish();
            });
        } else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (receiverRegistered && mediaReceiver != null) { try { unregisterReceiver(mediaReceiver); } catch (Exception ignored) {} receiverRegistered = false; }
        if (webView != null) { webView.removeJavascriptInterface("LocalifyAndroid"); webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
