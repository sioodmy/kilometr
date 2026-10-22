import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, Wallpaper } from 'lucide-react-native';
import { useStrings } from '../i18n';
import {
  getWallpaperScheme,
  hasWallpaperColors,
  setThemeSetting,
  THEME_PRESETS,
  THEME_SEEDS,
  useThemeSetting,
  type ThemeSetting,
} from '../theme/personalization';
import { scheme, shape, type } from '../theme/tokens';

export function PersonalizationCard() {
  const s = useStrings();
  const selected = useThemeSetting();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [focused, setFocused] = useState<ThemeSetting | null>(null);
  const wallpaper = getWallpaperScheme();

  async function select(next: ThemeSetting) {
    if (saving || next === selected) return;
    setSaving(true);
    setError(false);
    try {
      await setThemeSetting(next);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">
        {s.personalization.colors}
      </Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={s.personalization.colors}
        style={styles.options}
      >
        <Pressable
          onPress={() => void select('system')}
          onFocus={() => setFocused('system')}
          onBlur={() => setFocused(null)}
          disabled={saving}
          accessibilityRole="radio"
          accessibilityState={{ checked: selected === 'system', disabled: saving }}
          accessibilityLabel={s.personalization.system}
          accessibilityHint={
            hasWallpaperColors()
              ? s.personalization.systemDescription
              : s.personalization.wallpaperUnavailable
          }
          style={({ pressed }) => [
            styles.systemOption,
            selected === 'system' && styles.selected,
            focused === 'system' && styles.focused,
            pressed && styles.pressed,
          ]}
        >
          <View style={[styles.swatch, { backgroundColor: wallpaper.primaryContainer }]}>
            <Wallpaper size={24} color={wallpaper.onPrimaryContainer} />
          </View>
          <View style={styles.systemText}>
            <Text style={styles.label}>{s.personalization.system}</Text>
            <Text style={styles.hint}>
              {hasWallpaperColors()
                ? s.personalization.systemDescription
                : s.personalization.wallpaperUnavailable}
            </Text>
          </View>
          {selected === 'system' && <Check size={20} color={scheme.primary} />}
        </Pressable>
        <View style={styles.grid}>
          {(Object.keys(THEME_SEEDS) as (keyof typeof THEME_SEEDS)[]).map((key) => {
            const palette = THEME_PRESETS[key];
            const active = selected === key;
            return (
              <Pressable
                key={key}
                onPress={() => void select(key)}
                onFocus={() => setFocused(key)}
                onBlur={() => setFocused(null)}
                disabled={saving}
                accessibilityRole="radio"
                accessibilityState={{ checked: active, disabled: saving }}
                accessibilityLabel={s.personalization[key]}
                style={({ pressed }) => [
                  styles.colorOption,
                  active && styles.selected,
                  focused === key && styles.focused,
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.swatch, { backgroundColor: palette.primary }]}>
                  {active && <Check size={22} color={palette.onPrimary} />}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
      {saving && (
        <View style={styles.saving} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={scheme.primary} />
          <Text style={styles.hint}>{s.personalization.saving}</Text>
        </View>
      )}
      {error && (
        <Text style={styles.error} accessibilityRole="alert">
          {s.personalization.saveError}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
    padding: 20,
    gap: 16,
  },
  title: { ...type.titleMedium, color: scheme.onSurface },
  hint: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 18 },
  options: { gap: 12 },
  systemOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    minHeight: 64,
    borderRadius: shape.medium,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: scheme.surfaceContainer,
  },
  systemText: { flex: 1, minWidth: 0, gap: 4 },
  selected: { borderColor: scheme.primary, backgroundColor: scheme.primaryContainer },
  focused: { borderColor: scheme.onSurface, borderStyle: 'dashed' },
  pressed: { opacity: 0.75 },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { flexShrink: 1, ...type.bodyLarge, color: scheme.onSurface },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  colorOption: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saving: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  error: { ...type.bodyMedium, color: scheme.error, lineHeight: 21 },
});
