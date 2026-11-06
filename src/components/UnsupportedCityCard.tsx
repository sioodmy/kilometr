import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { MapPin, MapPinOff, Navigation, Train } from './icons';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import { resolveSupportedCityId, suggestCityForCoords, type CityId } from '../cities';

export function UnsupportedCityCard({
  city,
  activeCity,
  activeCityId,
  onPickStart,
  onSwitchCity,
  onNearestStation,
  nearestStationBusy,
  switchingCityId,
  coords,
}: {
  /** Miejscowość z reverse-geocode; null = nie udało się ustalić. */
  city: string | null;
  /** Nazwa aktywnego miasta (tego, dla którego mamy rozkład). */
  activeCity: string;
  /** Id aktywnego miasta (zapobiega fałszywym ostrzeżeniom, gdy użytkownik jest w aktywnym mieście). */
  activeCityId?: CityId;
  onPickStart: () => void;
  /** Szybka zmiana miasta na proponowane przez GPS. */
  onSwitchCity?: (cityId: CityId) => void;
  /** Pociągi z najbliższej stacji kolejowej (planer między miastami). */
  onNearestStation?: () => void;
  /** Trwa szukanie najbliższej stacji (spinner na przycisku). */
  nearestStationBusy?: boolean;
  /** Id miasta, na które aktualnie trwa przełączanie (do pokazania spinnera). */
  switchingCityId?: CityId | null;
  /** Współrzędne GPS (opcjonalne, do precyzyjnego dopasowania strefy). */
  coords?: { lat: number; lon: number } | null;
}) {
  const s = useStrings();
  const supported = s.city.supportedList;

  // Najpierw sprawdzamy precyzyjne współrzędne GPS (bounding box + promień).
  // Dopiero przy ich braku wspomagamy się nazwą miejscowości z reverse geocodingu.
  const matchedCityId =
    (coords && suggestCityForCoords(coords.lat, coords.lon)?.id) ?? resolveSupportedCityId(city);

  // Bezpieczeństwo: jeśli wykryte miasto to dokładnie to, które użytkownik ma wybrane,
  // nie wyświetlamy ostrzeżenia (użytkownik znajduje się w obszarze obsługiwanym).
  if (activeCityId && matchedCityId === activeCityId) {
    return null;
  }

  const insideSupported = matchedCityId != null;

  const body =
    !city && !insideSupported
      ? s.home.unsupportedBodyUnknown(supported)
      : insideSupported
        ? s.home.unsupportedBodyOther(s.city.loc(matchedCityId), activeCity)
        : s.home.unsupportedBody(city!, supported);
  // Miasto obsługiwane, ale w apce ustawione inne: tytuł „Nieobsługiwane miasto”
  // kłóciłby się z treścią, która mówi „jesteś w obsługiwanym mieście”.
  const title = insideSupported ? s.home.unsupportedTitleOther : s.home.unsupportedTitle;

  const canSwitchCity = insideSupported && onSwitchCity != null;

  return (
    <View style={styles.card} accessibilityRole="alert" accessibilityLabel={`${title}. ${body}`}>
      <View style={styles.topRow}>
        <MapPinOff size={20} color={scheme.warning} />
        <Text style={styles.title}>{title}</Text>
      </View>

      <Text style={styles.body}>{body}</Text>

      {canSwitchCity ? (
        <View style={styles.actions}>
          <Pressable
            onPress={() => onSwitchCity(matchedCityId)}
            disabled={switchingCityId != null}
            style={({ pressed }) => [
              styles.actionBtn,
              styles.primaryBtn,
              pressed && { opacity: 0.85 },
              switchingCityId != null && { opacity: 0.6 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={s.home.unsupportedSwitchCityA11y(s.city.name(matchedCityId))}
          >
            {switchingCityId === matchedCityId ? (
              <ActivityIndicator size="small" color={scheme.onPrimary} />
            ) : (
              <MapPin size={16} color={scheme.onPrimary} />
            )}
            <Text style={styles.primaryBtnText} numberOfLines={1} ellipsizeMode="tail">
              {s.home.unsupportedSwitchCity(s.city.acc(matchedCityId))}
            </Text>
          </Pressable>

          <Pressable
            onPress={onPickStart}
            style={({ pressed }) => [
              styles.actionBtn,
              styles.secondaryBtn,
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={s.home.unsupportedAction}
          >
            <Navigation size={16} color={scheme.onSecondaryContainer} />
            <Text style={styles.secondaryBtnText} numberOfLines={1} ellipsizeMode="tail">
              {s.home.unsupportedActionShort}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={onPickStart}
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={s.home.unsupportedAction}
        >
          <Navigation size={16} color={scheme.onPrimary} />
          <Text style={styles.ctaText}>{s.home.unsupportedAction}</Text>
        </Pressable>
      )}

      {/* Poza obsługiwanymi miastami planer między miastami i tak działa:
       * pociągi z najbliższej stacji kolejowej (baza ogólnopolska). */}
      {onNearestStation && (
        <Pressable
          onPress={onNearestStation}
          disabled={nearestStationBusy}
          style={({ pressed }) => [styles.cta, styles.stationCta, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={s.home.unsupportedNearestStationA11y}
        >
          {nearestStationBusy ? (
            <ActivityIndicator size="small" color={scheme.onTertiaryContainer} />
          ) : (
            <Train size={16} color={scheme.onTertiaryContainer} />
          )}
          <Text style={styles.stationCtaText} numberOfLines={1} ellipsizeMode="tail">
            {s.home.unsupportedNearestStation}
          </Text>
        </Pressable>
      )}
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
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
  },
  actionBtn: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: shape.full,
  },
  primaryBtn: {
    backgroundColor: scheme.primary,
  },
  primaryBtnText: {
    ...type.labelLarge,
    color: scheme.onPrimary,
    fontWeight: '600',
  },
  secondaryBtn: {
    backgroundColor: scheme.secondaryContainer,
  },
  secondaryBtnText: {
    ...type.labelLarge,
    color: scheme.onSecondaryContainer,
    fontWeight: '600',
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
  stationCta: {
    backgroundColor: scheme.tertiaryContainer,
  },
  stationCtaText: {
    ...type.labelLarge,
    color: scheme.onTertiaryContainer,
    fontWeight: '600',
  },
  ctaText: {
    ...type.labelLarge,
    color: scheme.onPrimary,
    fontWeight: '600',
  },
});
