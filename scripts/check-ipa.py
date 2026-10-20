import plistlib
import re
import sys
import zipfile


def verify(path):
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        app = "Payload/Kilometr.app/"
        extension = app + "PlugIns/KilometrLiveActivity.appex/"
        info = plistlib.loads(archive.read(app + "Info.plist"))
        widget = plistlib.loads(archive.read(extension + "Info.plist"))
        assert info["CFBundleIdentifier"] == "app.kilometr", "Unexpected bundle ID"
        assert widget["CFBundleIdentifier"] == "app.kilometr.liveactivity"
        assert info.get("NSSupportsLiveActivities") is True
        assert info.get("NSLocationWhenInUseUsageDescription")
        assert not info.get("UIBackgroundModes"), "No background tracking is requested"
        assert widget["NSExtension"]["NSExtensionPointIdentifier"] == "com.apple.widgetkit-extension"
        for key in ["CFBundleShortVersionString", "CFBundleVersion"]:
            assert re.fullmatch(r"\d+(\.\d+){0,2}", info[key]), key
            assert info[key] == widget[key], "App and extension versions differ"
        assert app + info["CFBundleExecutable"] in names
        assert extension + widget["CFBundleExecutable"] in names
        assert any(name.startswith(app) and name.endswith("main.jsbundle") for name in names), "Missing JS bundle"
        assert not any(name.endswith("embedded.mobileprovision") for name in names)
        for locale in ["pl", "en", "de", "uk"]:
            assert app + locale + ".lproj/InfoPlist.strings" in names, locale
    print("IPA structure, versions, translations and Live Activity: OK")


if __name__ == "__main__":
    verify(sys.argv[1])
