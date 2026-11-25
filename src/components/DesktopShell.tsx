import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';
import { Bell, ChevronDown, Compass, MapPin, MapPinned, Settings2 } from './icons';
import { CitySelectSheet } from './CitySelectSheet';
import { SpringPressable } from './SpringPressable';
import { getCity, type CityId } from '../cities';
import { useStrings } from '../i18n';
import { getActiveCityIdSync, useActiveCity } from '../services/cityStore';
import { ensureActiveCityTimetable } from '../services/dataManager';
import {
  fetchCityNews,
  getCachedNews,
  markNewsSeen,
  shouldShowNewsAlert,
  subscribeNewsCache,
} from '../services/mpkNews';
import { useWebLayout, type WebLayoutInfo } from '../theme/layout';
import { elev, scheme, shape, type } from '../theme/tokens';

type NavKey = 'planner' | 'live-map' | 'news' | 'settings';

function KilometrMark({ size = 34 }: { size?: number }) {
  return (
    <View style={[styles.logoBox, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox="0 0 1024 1024" fill="none">
        <Rect width="1024" height="1024" rx="232" fill="#00a884" />
        <G transform="translate(512, 512) scale(0.82) translate(-512, -512)">
          <G
            fill="none"
            stroke="#04362c"
            strokeWidth="80"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <Line x1="352" y1="180" x2="352" y2="794" />
            <Path d="M 352 512 C 390 380, 480 300, 600 220" />
            <Path d="M 352 512 C 400 664, 510 754, 672 754" />
          </G>
          <G transform="translate(605, 215) rotate(-35)">
            <Path
              d="M -18 -68 L 96 0 L -18 68 L 8 0 Z"
              fill="#04362c"
              stroke="#04362c"
              strokeWidth="40"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </G>
          <Circle cx="352" cy="512" r="102" fill="#04362c" />
          <Circle cx="352" cy="512" r="50" fill="#00a884" />
          <Circle cx="672" cy="754" r="32" fill="#04362c" />
        </G>
      </Svg>
    </View>
  );
}

/** Stały panel nawigacji bocznej (rail lub sidebar) dla widoków tabletowych i desktopowych Web PWA. */
export function DesktopShell({ children }: { children: ReactNode }) {
  const layout = useWebLayout();
  // Na telefonach i wąskim oknie pomijamy subskrypcję usePathname(), żeby
  // zwykłe przejścia ekranów nie przerysowywały całego drzewa nad Stack.
  if (!layout.isMedium) {
    return <>{children}</>;
  }
  return <DesktopShellActive layout={layout}>{children}</DesktopShellActive>;
}

function DesktopShellActive({ layout, children }: { layout: WebLayoutInfo; children: ReactNode }) {
  const pathname = usePathname();
  const s = useStrings();
  const { cityId, setCity } = useActiveCity();
  const [citySheetOpen, setCitySheetOpen] = useState(false);
  const [switchingCity, setSwitchingCity] = useState(false);
  const [switchingCityId, setSwitchingCityId] = useState<CityId | null>(null);
  const [newsAlert, setNewsAlert] = useState(false);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const cityHasNews = getCity(cityId).features.news;

  useEffect(() => {
    if (!layout.isMedium || !cityHasNews) {
      setNewsAlert(false);
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();

    const syncCachedAlert = async () => {
      try {
        const cached = getCachedNews();
        if (cached) {
          const alert = await shouldShowNewsAlert(cached);
          if (!cancelled && getActiveCityIdSync() === cityId) setNewsAlert(alert);
          return true;
        }
      } catch {
        // brak odczytu stanu powiadomień
      }
      return false;
    };

    const initCheck = async () => {
      const hadCache = await syncCachedAlert();
      if (hadCache || cancelled) return;
      try {
        const news = await fetchCityNews(ctrl.signal);
        if (cancelled || ctrl.signal.aborted || getActiveCityIdSync() !== cityId) return;
        const alert = await shouldShowNewsAlert(news);
        if (!cancelled && getActiveCityIdSync() === cityId) setNewsAlert(alert);
      } catch {
        // sieć niedostępna: brak kropki pilnych utrudnień
      }
    };

    void initCheck();
    const unsub = subscribeNewsCache(() => {
      void syncCachedAlert();
    });

    return () => {
      cancelled = true;
      ctrl.abort();
      unsub();
    };
  }, [cityHasNews, cityId, layout.isMedium]);

  const handleCitySelect = useCallback(
    async (id: CityId) => {
      if (id === cityId) {
        setCitySheetOpen(false);
        return;
      }
      setSwitchingCity(true);
      setSwitchingCityId(id);
      try {
        await setCity(id, { source: 'manual' });
        await ensureActiveCityTimetable().catch(() => {});
        setCitySheetOpen(false);
      } finally {
        setSwitchingCity(false);
        setSwitchingCityId(null);
      }
    },
    [cityId, setCity],
  );

  const hiddenShell = pathname === '/onboarding' || pathname.startsWith('/dev');
  if (hiddenShell) {
    return <>{children}</>;
  }

  const isPlannerActive =
    pathname === '/' ||
    pathname.startsWith('/routes') ||
    pathname === '/map' ||
    pathname.startsWith('/line') ||
    pathname === '/shared';
  const isLiveMapActive = pathname === '/live-map';
  const isNewsActive = pathname === '/news' || pathname === '/article';
  const isSettingsActive =
    pathname === '/settings' || pathname === '/data-sources' || pathname === '/privacy';

  const navItems: {
    key: NavKey;
    label: string;
    a11yLabel: string;
    path: '/' | '/live-map' | '/news' | '/settings';
    active: boolean;
    Icon: typeof Compass;
    badge?: boolean;
  }[] = [
    {
      key: 'planner',
      label: s.home.navPlanner,
      a11yLabel: s.home.navPlanner,
      path: '/',
      active: isPlannerActive,
      Icon: Compass,
    },
    {
      key: 'live-map',
      label: s.liveMap.title,
      a11yLabel: s.liveMap.title,
      path: '/live-map',
      active: isLiveMapActive,
      Icon: MapPinned,
    },
    ...(cityHasNews
      ? [
          {
            key: 'news' as const,
            label: s.news.title,
            a11yLabel: newsAlert ? s.home.newsAlertA11y : s.news.title,
            path: '/news' as const,
            active: isNewsActive,
            Icon: Bell,
            badge: newsAlert,
          },
        ]
      : []),
    {
      key: 'settings',
      label: s.settings.title,
      a11yLabel: s.settings.title,
      path: '/settings',
      active: isSettingsActive,
      Icon: Settings2,
    },
  ];

  const handleNavPress = (item: (typeof navItems)[number]) => {
    if (item.key === 'news' && newsAlert) {
      setNewsAlert(false);
      void markNewsSeen();
    }
    if (pathname === item.path) return;
    router.navigate(item.path);
  };

  return (
    <View style={styles.shell}>
      <View
        style={[
          styles.sidebar,
          { width: layout.sidebarWidth },
          !layout.isDesktop && styles.sidebarRail,
        ]}
        accessibilityRole="menu"
        accessibilityLabel={s.home.navMenuA11y}
      >
        <SpringPressable
          onPress={() => {
            if (pathname !== '/') router.navigate('/');
          }}
          scaleDelta={0.03}
          style={[styles.brandRow, !layout.isDesktop && styles.brandRowRail]}
          accessibilityRole="button"
          accessibilityLabel={`Kilometr, ${s.home.navPlanner}`}
        >
          <KilometrMark size={34} />
          {layout.isDesktop && (
            <Text style={styles.brandText} numberOfLines={1}>
              Kilometr
            </Text>
          )}
        </SpringPressable>

        <View style={styles.navList}>
          {navItems.map(({ key, label, a11yLabel, active, Icon, badge, path }) => {
            const hovered = hoveredKey === key && !active;
            if (!layout.isDesktop) {
              return (
                <Pressable
                  key={key}
                  onPress={() =>
                    handleNavPress({ key, label, a11yLabel, active, Icon, badge, path })
                  }
                  onHoverIn={() => setHoveredKey(key)}
                  onHoverOut={() => setHoveredKey((cur) => (cur === key ? null : cur))}
                  accessibilityRole="button"
                  accessibilityLabel={a11yLabel}
                  accessibilityState={{ selected: active }}
                  style={styles.railItem}
                >
                  <View
                    style={[
                      styles.railPill,
                      active && styles.railPillActive,
                      hovered && styles.navHover,
                    ]}
                  >
                    <Icon
                      size={20}
                      color={active ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
                    />
                    {badge && <View style={styles.railBadgeDot} />}
                  </View>
                  <Text
                    style={[styles.railLabel, active && styles.railLabelActive]}
                    numberOfLines={1}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            }

            return (
              <Pressable
                key={key}
                onPress={() =>
                  handleNavPress({ key, label, a11yLabel, active, Icon, badge, path })
                }
                onHoverIn={() => setHoveredKey(key)}
                onHoverOut={() => setHoveredKey((cur) => (cur === key ? null : cur))}
                accessibilityRole="button"
                accessibilityLabel={a11yLabel}
                accessibilityState={{ selected: active }}
                style={[
                  styles.navItem,
                  active && styles.navItemActive,
                  hovered && styles.navHover,
                ]}
              >
                <View style={styles.navIconWrap}>
                  <Icon
                    size={20}
                    color={active ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
                  />
                  {badge && <View style={styles.railBadgeDot} />}
                </View>
                <Text
                  style={[styles.navLabel, active && styles.navLabelActive]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={[styles.footer, !layout.isDesktop && styles.footerRail]}>
          {layout.isDesktop ? (
            <SpringPressable
              onPress={() => setCitySheetOpen(true)}
              scaleDelta={0.02}
              style={styles.cityCard}
              accessibilityRole="button"
              accessibilityLabel={`${s.city.name(cityId)}, ${s.city.changeAction}`}
              accessibilityState={{ busy: switchingCity }}
            >
              <View style={styles.cityIconBox}>
                {switchingCity ? (
                  <ActivityIndicator size="small" color={scheme.onPrimaryContainer} />
                ) : (
                  <MapPin size={16} color={scheme.onPrimaryContainer} />
                )}
              </View>
              <View style={styles.cityTextCol}>
                <Text style={styles.cityLabel} numberOfLines={1}>
                  {s.city.section}
                </Text>
                <Text style={styles.cityName} numberOfLines={1}>
                  {s.city.name(cityId)}
                </Text>
              </View>
              <ChevronDown size={16} color={scheme.onSurfaceVariant} />
            </SpringPressable>
          ) : (
            <SpringPressable
              onPress={() => setCitySheetOpen(true)}
              scaleDelta={0.04}
              style={styles.cityRailBtn}
              accessibilityRole="button"
              accessibilityLabel={`${s.city.name(cityId)}, ${s.city.changeAction}`}
              accessibilityState={{ busy: switchingCity }}
            >
              {switchingCity ? (
                <ActivityIndicator size="small" color={scheme.onPrimaryContainer} />
              ) : (
                <MapPin size={20} color={scheme.onPrimaryContainer} />
              )}
            </SpringPressable>
          )}
        </View>
      </View>

      <View style={styles.workspace}>{children}</View>

      {citySheetOpen && (
        <CitySelectSheet
          selectedCityId={cityId}
          onSelectCity={(id) => void handleCitySelect(id)}
          onClose={() => setCitySheetOpen(false)}
          switchingCity={switchingCity}
          switchingCityId={switchingCityId}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: scheme.surface,
  },
  sidebar: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRightWidth: 2,
    borderRightColor: scheme.outlineVariant,
    paddingHorizontal: 14,
    paddingVertical: 18,
    gap: 20,
  },
  sidebarRail: {
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 8,
    minHeight: 44,
  },
  brandRowRail: {
    paddingHorizontal: 0,
    justifyContent: 'center',
  },
  logoBox: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  brandText: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: scheme.onSurface,
  },
  navList: {
    gap: 6,
    width: '100%',
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: shape.full,
  },
  navItemActive: {
    backgroundColor: scheme.primaryContainer,
  },
  navHover: {
    backgroundColor: scheme.surfaceContainerHigh,
  },
  navIconWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navLabel: {
    ...type.labelLarge,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    flex: 1,
  },
  navLabelActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '800',
  },
  railItem: {
    alignItems: 'center',
    gap: 4,
    minHeight: 56,
    justifyContent: 'center',
    width: '100%',
  },
  railPill: {
    width: 56,
    height: 34,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  railPillActive: {
    backgroundColor: scheme.primaryContainer,
  },
  railBadgeDot: {
    position: 'absolute',
    top: -3,
    right: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: scheme.error,
  },
  railLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    maxWidth: 68,
  },
  railLabelActive: {
    color: scheme.onSurface,
    fontWeight: '700',
  },
  footer: {
    marginTop: 'auto',
    width: '100%',
  },
  footerRail: {
    alignItems: 'center',
  },
  cityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 54,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
    ...elev.level1,
  },
  cityIconBox: {
    width: 34,
    height: 34,
    borderRadius: shape.medium,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cityTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  cityLabel: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },
  cityName: {
    ...type.labelLarge,
    fontWeight: '800',
    color: scheme.onSurface,
  },
  cityRailBtn: {
    width: 48,
    height: 48,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    ...elev.level1,
  },
  workspace: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    backgroundColor: scheme.surface,
  },
});
