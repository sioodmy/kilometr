// Config plugin: nadpisuje animacje przejść `fade_from_bottom` w `react-native-screens`
// na Androidzie krzywymi M3 Expressive bez 100 ms opóźnienia wyjścia z Nougata.
//
// Używane przez app.config.js.

const { withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const ANIM_FILES = {
  // Krzywe M3 Expressive spójne z src/theme/motion.ts (enter / exit).
  'rns_m3_emphasized_decelerate.xml': `<?xml version="1.0" encoding="utf-8"?>
<pathInterpolator xmlns:android="http://schemas.android.com/apk/res/android"
    android:controlX1="0.05"
    android:controlY1="0.7"
    android:controlX2="0.1"
    android:controlY2="1.0" />
`,
  'rns_m3_emphasized_accelerate.xml': `<?xml version="1.0" encoding="utf-8"?>
<pathInterpolator xmlns:android="http://schemas.android.com/apk/res/android"
    android:controlX1="0.3"
    android:controlY1="0.0"
    android:controlX2="0.8"
    android:controlY2="0.15" />
`,
  'rns_fade_from_bottom.xml': `<?xml version="1.0" encoding="utf-8"?>
<set xmlns:android="http://schemas.android.com/apk/res/android"
    android:shareInterpolator="false">
    <alpha
        android:fromAlpha="0.0"
        android:toAlpha="1.0"
        android:interpolator="@anim/rns_m3_emphasized_decelerate"
        android:duration="160" />
    <translate
        android:fromYDelta="4%"
        android:toYDelta="0%"
        android:interpolator="@anim/rns_m3_emphasized_decelerate"
        android:duration="220" />
</set>
`,
  'rns_no_animation_350.xml': `<?xml version="1.0" encoding="utf-8"?>
<alpha xmlns:android="http://schemas.android.com/apk/res/android"
    android:fromAlpha="1.0"
    android:toAlpha="1.0"
    android:duration="220" />
`,
  'rns_fade_to_bottom.xml': `<?xml version="1.0" encoding="utf-8"?>
<set xmlns:android="http://schemas.android.com/apk/res/android"
    android:shareInterpolator="false">
    <alpha
        android:fromAlpha="1.0"
        android:toAlpha="0.0"
        android:interpolator="@anim/rns_m3_emphasized_accelerate"
        android:duration="120" />
    <translate
        android:fromYDelta="0%"
        android:toYDelta="4%"
        android:interpolator="@anim/rns_m3_emphasized_accelerate"
        android:duration="140" />
</set>
`,
  'rns_no_animation_250.xml': `<?xml version="1.0" encoding="utf-8"?>
<alpha xmlns:android="http://schemas.android.com/apk/res/android"
    android:fromAlpha="1.0"
    android:toAlpha="1.0"
    android:duration="140" />
`,
};

module.exports = function withM3Transitions(config) {
  return withDangerousMod(config, [
    'android',
    (mod) => {
      const animDir = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'anim');
      fs.mkdirSync(animDir, { recursive: true });
      for (const [name, content] of Object.entries(ANIM_FILES)) {
        fs.writeFileSync(path.join(animDir, name), content);
      }
      return mod;
    },
  ]);
};
