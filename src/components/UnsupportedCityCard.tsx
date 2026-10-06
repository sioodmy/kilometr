// Karta „Nieobsługiwane miasto": pokazywana, gdy GPS jest dalej niż
// 15 km od centrum Wrocławia. Ma wyglądać jak pełnoprawny empty-state,
// nie jak błąd — stąd spokojna kompozycja M3: ikona w kole, pigułka
// z wykrytą miejscowością, tytuł, opis i jedno wyraźne CTA.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MapPinOff, MapPin, Navigation } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';

export function UnsupportedCityCard({
  city,
  onPickStart,
}: {
  /** Miejscowość z reverse-geocode; null = nie udało się ustalić. */
  city: string | null;
  onPickStart: () => void;
}) {
  const s = useStrings();
  const body = city ? s.home.unsupportedBody(city) : s.home.unsupportedBodyUnknown;

  return (
    <View
      style={styles.card}
      accessibilityRole="alert"
      accessibilityLabel={`${s.home.unsupportedTitle}. ${body}`}
    >
      {/* Górny rząd: ikona + pigułka z miejscowością */}
      <View style={styles.topRow}>
        <View style={styles.iconWrap}>
          <MapPinOff size={22} color={scheme.onWarningContainer} />
        </View>
        {city ? (
          <View style={styles.cityPill}>
            <MapPin size={13} color={scheme.onTertiaryContainer} />
            <Text style={styles.cityPillText} numberOfLines={1}>
              {city}
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.title}>{s.home.unsupportedTitle}</Text>
      <Text style={styles.body}>{body}</Text>

      <View style={styles.hintRow}>
        <View style={styles.hintDot} />
        <Text style={styles.hint}>{s.home.unsupportedHint}</Text>
      </View>

      <Pressable
        onPress={onPickStart}
        style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel={s.home.unsupportedAction}
      >
        <Navigation size={16} color={scheme.onPrimary} />
        <Text style={styles.ctaText}>{s.home.unsupportedAction}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    padding: 18,
    gap: 8,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.extraLarge,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    ...elev.level1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: shape.full,
    backgroundColor: scheme.warningContainer,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
  },
  cityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: '55%',
    backgroundColor: scheme.tertiaryContainer,
    borderRadius: shape.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  cityPillText: {
    ...type.labelMedium,
    fontWeight: '700',
    color: scheme.onTertiaryContainer,
    flexShrink: 1,
  },
  title: {
    ...type.titleLarge,
    fontWeight: '700',
    color: scheme.onSurface,
    letterSpacing: -0.2,
  },
  body: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    lineHeight: 20,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.medium,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  hintDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: scheme.primary,
  },
  hint: {
    ...type.labelMedium,
    color: scheme.onSurface,
    fontWeight: '500',
    flex: 1,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    paddingVertical: 13,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
  },
  ctaText: {
    ...type.labelLarge,
    color: scheme.onPrimary,
    fontWeight: '700',
  },
});
