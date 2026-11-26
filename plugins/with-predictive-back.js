// Config plugin: uzupełnia MainActivity.kt o mostek OnBackPressedCallback dla API 33-35.
//
// W React Native 0.86 klasa ReactActivity rejestruje mBackPressedCallback dopiero
// na API 36 (Android 16). Po włączeniu android:enableOnBackInvokedCallback="true"
// bez tego mostka na Androidzie 13-15 gest wstecz omija BackHandler na pozostałych
// ekranach (lista, mapa, ustawienia, arkusze). Na API 36 działa wbudowany callback
// ReactActivity, a na ekranie szczegółów nasz PredictiveBackModule nadpisuje gest
// przez OnBackAnimationCallback z PRIORITY_OVERLAY.

const { CodeGenerator, withMainActivity } = require('expo/config-plugins');

const BRIDGE_TAG = 'kilometr-predictive-back-bridge';
const REGISTER_TAG = 'kilometr-predictive-back-register';

function ensureImport(src, fqcn) {
  const line = `import ${fqcn}`;
  if (src.includes(line)) return src;
  return src.replace(/^package\s+[^\n]+\n/m, (match) => `${match}\n${line}\n`);
}

function wrapDefaultBackCall(src) {
  if (src.includes('predictiveBackBridge.isEnabled = false')) return src;
  if (src.includes('super.invokeDefaultOnBackPressed()')) {
    return src.replace(
      /super\.invokeDefaultOnBackPressed\(\)/g,
      [
        'run {',
        '      predictiveBackBridge.isEnabled = false',
        '      try {',
        '        super.invokeDefaultOnBackPressed()',
        '      } finally {',
        '        predictiveBackBridge.isEnabled = true',
        '      }',
        '    }',
      ].join('\n'),
    );
  }
  const lastBrace = src.lastIndexOf('}');
  if (lastBrace < 0) {
    throw new Error('withPredictiveBack: nieprawidłowa struktura MainActivity.kt.');
  }
  const overrideMethod = [
    '',
    '  override fun invokeDefaultOnBackPressed() {',
    '    predictiveBackBridge.isEnabled = false',
    '    try {',
    '      super.invokeDefaultOnBackPressed()',
    '    } finally {',
    '      predictiveBackBridge.isEnabled = true',
    '    }',
    '  }',
    '',
  ].join('\n');
  return src.slice(0, lastBrace) + overrideMethod + src.slice(lastBrace);
}

function patchMainActivityForPredictiveBack(rawSrc) {
  let src = ensureImport(rawSrc, 'android.os.Build');
  src = ensureImport(src, 'androidx.activity.OnBackPressedCallback');

  const classAnchor = /class\s+MainActivity\s*:\s*ReactActivity\(\)\s*\{/;
  if (!classAnchor.test(src)) {
    throw new Error(
      'withPredictiveBack: wygenerowany MainActivity.kt nie ma oczekiwanego nagłówka class MainActivity : ReactActivity().',
    );
  }

  const onCreateAnchor = /super\.onCreate\((null|savedInstanceState)\)/;
  if (!onCreateAnchor.test(src)) {
    throw new Error(
      'withPredictiveBack: wygenerowany MainActivity.kt nie ma wywołania super.onCreate(...).',
    );
  }

  src = CodeGenerator.mergeContents({
    src,
    comment: '  //',
    tag: BRIDGE_TAG,
    offset: 1,
    anchor: classAnchor,
    newSrc: [
      '  // Mostek dla API 33-35 przy enableOnBackInvokedCallback="true" (API 36 obsługuje ReactActivity).',
      '  private val predictiveBackBridge = object : OnBackPressedCallback(true) {',
      '    override fun handleOnBackPressed() {',
      '      isEnabled = false',
      '      try {',
      '        @Suppress("DEPRECATION")',
      '        onBackPressed()',
      '      } finally {',
      '        isEnabled = true',
      '      }',
      '    }',
      '  }',
    ].join('\n'),
  }).contents;

  src = CodeGenerator.mergeContents({
    src,
    comment: '    //',
    tag: REGISTER_TAG,
    offset: 1,
    anchor: onCreateAnchor,
    newSrc: [
      '    if (Build.VERSION.SDK_INT in 33..35) {',
      '      onBackPressedDispatcher.addCallback(this, predictiveBackBridge)',
      '    }',
    ].join('\n'),
  }).contents;

  return wrapDefaultBackCall(src);
}

function withPredictiveBack(config) {
  return withMainActivity(config, (mod) => {
    mod.modResults.contents = patchMainActivityForPredictiveBack(mod.modResults.contents);
    return mod;
  });
}

withPredictiveBack.patchMainActivityForPredictiveBack = patchMainActivityForPredictiveBack;

module.exports = withPredictiveBack;
