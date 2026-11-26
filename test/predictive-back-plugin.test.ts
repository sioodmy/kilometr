import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { patchMainActivityForPredictiveBack } = require('../plugins/with-predictive-back.js');

const EXPO_MAIN_ACTIVITY = `package app.kilometr

import android.os.Build
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme)
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"

  override fun invokeDefaultOnBackPressed() {
    if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
      if (!moveTaskToBack(false)) {
        super.invokeDefaultOnBackPressed()
      }
      return
    }
    super.invokeDefaultOnBackPressed()
  }
}
`;

const MINIMAL_MAIN_ACTIVITY = `package app.kilometr

import android.os.Bundle
import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
  }
}
`;

describe('plugins/with-predictive-back', () => {
  it('wstrzykuje mostek dla API 33+ bez callbacku ReactActivity i bezpiecznie wyłącza go w invokeDefaultOnBackPressed', () => {
    const patched = patchMainActivityForPredictiveBack(EXPO_MAIN_ACTIVITY);
    assert.ok(patched.includes('import androidx.activity.OnBackPressedCallback'));
    assert.ok(
      patched.includes('private val predictiveBackBridge = object : OnBackPressedCallback(true)'),
    );
    assert.ok(
      patched.includes(
        'val usesReactActivityCallback = Build.VERSION.SDK_INT >= 36 && applicationInfo.targetSdkVersion >= 36',
      ),
    );
    assert.ok(patched.includes('if (Build.VERSION.SDK_INT >= 33 && !usesReactActivityCallback)'));
    assert.ok(patched.includes('onBackPressedDispatcher.addCallback(this, predictiveBackBridge)'));
    assert.equal(
      patched.match(/predictiveBackBridge\.isEnabled = false/g)?.length,
      2,
      'każde wywołanie super.invokeDefaultOnBackPressed() musi wyłączać mostek, by uniknąć pętli',
    );
  });

  it('dodaje override invokeDefaultOnBackPressed gdy szablon go nie zawiera', () => {
    const patched = patchMainActivityForPredictiveBack(MINIMAL_MAIN_ACTIVITY);
    assert.ok(patched.includes('import android.os.Build'));
    assert.ok(patched.includes('import androidx.activity.OnBackPressedCallback'));
    assert.ok(patched.includes('override fun invokeDefaultOnBackPressed()'));
    assert.ok(patched.includes('predictiveBackBridge.isEnabled = false'));
  });

  it('jest idempotentny przy wielokrotnym uruchomieniu prebuildu', () => {
    const once = patchMainActivityForPredictiveBack(EXPO_MAIN_ACTIVITY);
    const twice = patchMainActivityForPredictiveBack(once);
    assert.equal(twice, once);
  });
});
