import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MapPinOff, Navigation } from './icons';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import { resolveSupportedCityId, suggestCityForCoords, type CityId } from '../cities';

export function UnsupportedCityCard({
  city,
  activeCity,
  activeCityId,
  onPickStart,
  coords,
}: {
  /** Miejscowość z reverse-geocode; null = nie udało się ustalić. */
  city: string | null;
  /** Nazwa aktywnego miasta (tego, dla którego mamy rozkład). */
  activeCity: string;
  /** Id aktywnego miasta (zapobiega fałszywym ostrzeżeniom, gdy użytkownik jest w aktywnym mieście). */
  activeCityId?: CityId;
  onPickStart: () => void;
  /** Współrzędne GPS (opcjonalne, do precyzyjnego dopasowania strefy). */
  coords?: { lat: number; lon: number } | null;
}) {
  const s = useStrings();
  const supported = s.city.supportedList;

  // Najpierw sprawdzamy precyzyjne współrzędne GPS (bounding box + promień).
  // Dopiero przy ich braku wspomagamy się nazwą miejscowości z reverse geocodingu.
  const matchedCityId =
    (coords && suggestCityForCoords(coords.lat, coords.lon)?.id) ??
    resolveSupportedCityId(city);

  // Bezpieczeństwo: jeśli wykryte miasto to dokładnie to, które użytkownik ma wybrane,
  // nie wyświetlamy ostrzeżenia (użytkownik znajduje się w obszarze obsługiwanym).
  if (activeCityId && matchedCityId === activeCityId) {
    return null;
  }

  const insideSupported = matchedCityId != null;

  const body = !city && !insideSupported
    ? s.home.unsupportedBodyUnknown(supported)
    : insideSupported
      ? s.home.unsupportedBodyOther(s.city.loc(matchedCityId), activeCity)
      : s.home.unsupportedBody(city!, supported);
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
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: scheme.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: shape.full,
  },
  ctaText: {
    ...type.labelLarge,
    color: scheme.onPrimary,
    fontWeight: '600',
  },
});
