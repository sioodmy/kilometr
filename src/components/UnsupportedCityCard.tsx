import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MapPinOff, Navigation } from 'lucide-react-native';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import { CITIES } from '../cities';

export function UnsupportedCityCard({
  city,
  activeCity,
  onPickStart,
}: {
  /** Miejscowość z reverse-geocode; null = nie udało się ustalić. */
  city: string | null;
  /** Nazwa aktywnego miasta (tego, dla którego mamy rozkład). */
  activeCity: string;
  onPickStart: () => void;
}) {
  const s = useStrings();
  const supported = s.city.supportedList;
  // Karta pokazuje się też wtedy, gdy użytkownik stoi w mieście, które
  // obsługujemy, ale w apce ma ustawione inne. Bez tego wariantu tekst
  // głosiłby „obsługujemy tylko: Wrocław, Kraków” osobie stojącej w Krakowie.
  const insideSupported = city
    ? CITIES.some((c) => c.name.toLocaleLowerCase() === city.trim().toLocaleLowerCase())
    : false;
  const body = !city
    ? s.home.unsupportedBodyUnknown(supported)
    : insideSupported
      ? s.home.unsupportedBodyOther(city, activeCity)
      : s.home.unsupportedBody(city, supported);
  // Miasto obsługiwane, ale w apce ustawione inne: tytuł „Nieobsługiwane miasto”
  // kłóciłby się z treścią, która mówi „jesteś w obsługiwanym mieście”.
  const title = insideSupported ? s.home.unsupportedTitleOther : s.home.unsupportedTitle;

  return (
    <View style={styles.card} accessibilityRole="alert" accessibilityLabel={`${title}. ${body}`}>
      <View style={styles.topRow}>
        <MapPinOff size={20} color={scheme.warning} />
        <Text style={styles.title}>{title}</Text>
      </View>

      <Text style={styles.body}>{body}</Text>

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
    gap: 14,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    ...type.titleMedium,
    fontWeight: '500',
    color: scheme.onSurface,
    flex: 1,
  },
  body: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    lineHeight: 20,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    minHeight: 52,
    borderRadius: shape.medium,
    backgroundColor: scheme.primary,
  },
  ctaText: {
    ...type.labelLarge,
    color: scheme.onPrimary,
    fontWeight: '500',
    flexShrink: 1,
    textAlign: 'center',
  },
});
