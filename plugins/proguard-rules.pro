# Reguły R8 doklejane do android/app/proguard-rules.pro w prebuildzie.
# Reszta reguł przychodzi z AAR-ów (React Native, Expo, SVG) jako consumer rules,
# a klasy z manifestu chroni AGP.

# RAPTOR: C++ woła te metody przez JNI po nazwie, więc klasa i metody native
# muszą zostać bez zmian.
-keep class app.kilometr.raptor.KilometrRaptorBridge { *; }

# Metody wystawione do WebView przez addJavascriptInterface.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
