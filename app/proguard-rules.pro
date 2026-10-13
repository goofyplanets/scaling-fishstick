# Keep the JavaScript bridge methods exposed through @JavascriptInterface.
-keepclassmembers class com.localify.crimson.LocalifyAndroidBridge { @android.webkit.JavascriptInterface <methods>; }
