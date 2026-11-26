import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, ChevronLeft, ExternalLink } from '../src/components/icons';
import { useStrings } from '../src/i18n';
import { CITIES, getCity, type CityId } from '../src/cities';
import { useActiveCity } from '../src/services/cityStore';
import { useWebLayout } from '../src/theme/layout';
import { scheme, shape, type } from '../src/theme/tokens';

/** Portale bez poprawnego HTTPS: otwieramy po HTTP, inaczej link nie działa. */
const HTTP_ONLY_HOSTS = new Set([
  'zkgkm-olkusz.pl',
  'zkm.ilawa.pl',
  'zakopane.pl',
  'mzk.nysa.pl',
  'mpk.zdunskawola.pl',
  'mzk.starogard.pl',
  'pkm.czechowice-dziedzice.pl',
]);

function portalUrl(host: string): string {
  return `${HTTP_ONLY_HOSTS.has(host) ? 'http' : 'https'}://${host}`;
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text style={st.sectionLabel} accessibilityRole="header">
      {children}
    </Text>
  );
}

function SourceRow({
  name,
  host,
  hint,
  a11y,
}: {
  name: string;
  host: string;
  hint?: string;
  a11y: string;
}) {
  const d = useStrings().dataSources;
  const url = portalUrl(host);
  const open = async () => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(d.openErrorTitle, d.openErrorBody);
    }
  };
  return (
    <Pressable
      onPress={() => void open()}
      accessibilityRole="link"
      accessibilityLabel={a11y}
      style={({ pressed }) => [st.row, pressed && st.pressed]}
    >
      <View style={st.rowText}>
        <Text style={st.rowName}>{name}</Text>
        <Text style={st.rowUrl}>{url}</Text>
        {hint ? <Text style={st.rowHint}>{hint}</Text> : null}
      </View>
      <ExternalLink size={18} color={scheme.onSurfaceVariant} />
    </Pressable>
  );
}

function CitySourceRow({ cityId, labeled = false }: { cityId: CityId; labeled?: boolean }) {
  const s = useStrings();
  const d = s.dataSources;
  const operator = s.city.operator(cityId);
  return (
    <SourceRow
      name={labeled ? d.citySourceTitle(operator) : s.city.name(cityId)}
      host={s.city.portal(cityId)}
      hint={labeled ? d.citySourceHint : operator}
      a11y={d.openA11y(labeled ? operator : s.city.name(cityId))}
    />
  );
}

export default function DataSourcesScreen() {
  const s = useStrings();
  const d = s.dataSources;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const webLayout = useWebLayout();
  const { cityId } = useActiveCity();
  const activeCity = getCity(cityId);
  const directLiveFeed = activeCity.features.directBusPosition;
  const kpLiveHost =
    activeCity.kpPrefix && activeCity.features.live
      ? `${activeCity.kpPrefix}.kiedyprzyjedzie.pl`
      : null;
  const [allCitiesOpen, setAllCitiesOpen] = useState(false);

  return (
    <View style={[st.safe, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={[st.header, webLayout.isMedium && st.mediumCentered]}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}
          style={({ pressed }) => [st.back, pressed && st.pressed]}
          accessibilityRole="button"
          accessibilityLabel={s.onboarding.backA11y}
        >
          <ChevronLeft size={24} color={scheme.onSurface} />
        </Pressable>
        <Text style={st.headerTitle}>{d.title}</Text>
      </View>
      <ScrollView contentContainerStyle={[st.body, webLayout.isMedium && st.mediumCentered]}>
        <Text style={st.intro}>{d.intro}</Text>

        <SectionLabel>{d.citySection}</SectionLabel>
        <View style={st.card}>
          <CitySourceRow cityId={cityId} labeled />
        </View>

        <SectionLabel>{d.railSection}</SectionLabel>
        <View style={st.card}>
          <SourceRow
            name={d.plkName}
            host="portalpasazera.pl"
            hint={d.plkHint}
            a11y={d.openA11y(d.plkName)}
          />
          <View style={st.divider} />
          <SourceRow
            name={d.icName}
            host="www.intercity.pl"
            hint={d.icHint}
            a11y={d.openA11y(d.icName)}
          />
        </View>

        <SectionLabel>{d.liveSection}</SectionLabel>
        <View style={st.card}>
          <SourceRow
            name={d.zbiorkomName}
            host="zbiorkom.live"
            hint={d.zbiorkomHint}
            a11y={d.openA11y(d.zbiorkomName)}
          />
          {kpLiveHost && (
            <>
              <View style={st.divider} />
              <SourceRow
                name={d.kpName}
                host={kpLiveHost}
                hint={d.kpHint}
                a11y={d.openA11y(d.kpName)}
              />
            </>
          )}
          {directLiveFeed && (
            <>
              <View style={st.divider} />
              <SourceRow
                name={d.mpkName}
                host="mpk.wroc.pl"
                hint={d.mpkHint}
                a11y={d.openA11y(d.mpkName)}
              />
            </>
          )}
        </View>

        <SectionLabel>{d.mapSection}</SectionLabel>
        <View style={st.card}>
          <SourceRow
            name={d.osmName}
            host="www.openstreetmap.org/copyright"
            hint={d.osmHint}
            a11y={d.openA11y(d.osmName)}
          />
          <View style={st.divider} />
          <SourceRow
            name={d.ofmName}
            host="openfreemap.org"
            hint={d.ofmHint}
            a11y={d.openA11y(d.ofmName)}
          />
        </View>

        <SectionLabel>{d.allCitiesSection}</SectionLabel>
        <View style={st.card}>
          <Pressable
            onPress={() => setAllCitiesOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: allCitiesOpen }}
            style={({ pressed }) => [st.row, pressed && st.pressed]}
          >
            <View style={st.rowText}>
              <Text style={st.rowName}>{allCitiesOpen ? d.allCitiesHide : d.allCitiesShow}</Text>
              <Text style={st.rowHint}>{d.allCitiesHint}</Text>
            </View>
            <ChevronDown
              size={18}
              color={scheme.onSurfaceVariant}
              style={allCitiesOpen ? st.chevronOpen : undefined}
            />
          </Pressable>
          {allCitiesOpen &&
            CITIES.map((city) => (
              <View key={city.id}>
                <View style={st.divider} />
                <CitySourceRow cityId={city.id} />
              </View>
            ))}
        </View>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: scheme.surface },
  mediumCentered: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  back: {
    width: 48,
    height: 48,
    borderRadius: shape.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pressed: { opacity: 0.7 },
  headerTitle: { flex: 1, ...type.titleLarge, fontWeight: '500', color: scheme.onSurface },
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 8 },
  intro: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    lineHeight: 21,
    marginBottom: 8,
  },
  sectionLabel: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
    marginTop: 10,
    paddingHorizontal: 2,
  },
  card: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    minHeight: 56,
  },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowName: { ...type.bodyLarge, color: scheme.onSurface, fontWeight: '500' },
  rowUrl: { ...type.bodySmall, color: scheme.primary, lineHeight: 19 },
  rowHint: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 19 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: scheme.outlineVariant },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
});
