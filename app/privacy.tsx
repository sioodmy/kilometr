import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, ExternalLink } from '../src/components/icons';
import { useStrings } from '../src/i18n';
import { PRIVACY_CONTACT_URL, PRIVACY_SECTIONS } from '../src/privacy';
import { scheme, shape, type } from '../src/theme/tokens';

export default function PrivacyScreen() {
  const s = useStrings();
  const router = useRouter();
  const privacy = s.landing.privacy;

  const openContact = async () => {
    try {
      await Linking.openURL(PRIVACY_CONTACT_URL);
    } catch {
      Alert.alert(privacy.linkLabel, privacy.linkError);
    }
  };

  return (
    <SafeAreaView style={st.safe} edges={['top', 'bottom']}>
      <View style={st.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}
          style={({ pressed }) => [st.back, pressed && st.pressed]}
          accessibilityRole="button"
          accessibilityLabel={s.onboarding.backA11y}
        >
          <ChevronLeft size={24} color={scheme.onSurface} />
        </Pressable>
        <Text style={st.headerTitle}>{privacy.linkLabel}</Text>
      </View>
      <ScrollView contentContainerStyle={st.body}>
        <Text style={st.title} accessibilityRole="header">
          {privacy.title}
        </Text>
        <Text style={st.copy}>{privacy.intro}</Text>
        {PRIVACY_SECTIONS.map((section) => (
          <View key={section} style={st.section}>
            <Text style={st.sectionTitle} accessibilityRole="header">
              {privacy[`${section}Title`]}
            </Text>
            <Text style={st.copy} selectable>
              {privacy[`${section}Body`]}
            </Text>
          </View>
        ))}
        <Pressable
          onPress={() => void openContact()}
          accessibilityRole="link"
          style={({ pressed }) => [st.contact, pressed && st.pressed]}
        >
          <Text style={st.contactText}>{privacy.contact}</Text>
          <ExternalLink size={20} color={scheme.onSecondaryContainer} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: scheme.surface },
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
  headerTitle: { ...type.titleMedium, color: scheme.onSurface, flex: 1 },
  body: { padding: 24, paddingBottom: 32, gap: 28 },
  title: { fontSize: 32, lineHeight: 40, fontWeight: '600', color: scheme.onSurface },
  section: { gap: 12 },
  sectionTitle: { ...type.titleLarge, color: scheme.onSurface },
  copy: { ...type.bodyLarge, lineHeight: 26, color: scheme.onSurfaceVariant },
  contact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    minHeight: 56,
    padding: 16,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
  },
  contactText: {
    ...type.labelLarge,
    color: scheme.onSecondaryContainer,
    flexShrink: 1,
    textAlign: 'center',
  },
});
