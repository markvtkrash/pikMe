import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Linking, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { BRAND_COLORS } from '../../../src/constants/brandTheme';

const LEGAL_LINKS = {
  privacy: 'https://www.markvtkrash.com/legal/privacy',
  terms: 'https://www.markvtkrash.com/legal/terms',
  disclaimer: 'https://www.markvtkrash.com/legal/disclaimer',
  support: 'mailto:support@pikme.app',
};

const HELP_ITEMS = [
  {
    category: 'Legal',
    items: [
      {
        icon: '🔒',
        title: 'Privacy Policy',
        subtitle: 'How we handle your data',
        url: LEGAL_LINKS.privacy,
      },
      {
        icon: '⚖️',
        title: 'Terms of Service',
        subtitle: 'Rules and conditions',
        url: LEGAL_LINKS.terms,
      },
      {
        icon: '⚠️',
        title: 'Food Disclaimer',
        subtitle: 'Important health notices',
        url: LEGAL_LINKS.disclaimer,
      },
    ],
  },
  {
    category: 'Support',
    items: [
      {
        icon: '📧',
        title: 'Contact Support',
        subtitle: 'Email us with questions',
        url: LEGAL_LINKS.support,
      },
      {
        icon: '❓',
        title: 'FAQ',
        subtitle: 'Common questions answered',
        action: 'faq',
      },
      {
        icon: '🐛',
        title: 'Report a Bug',
        subtitle: 'Found an issue? Let us know',
        url: LEGAL_LINKS.support,
      },
    ],
  },
  {
    category: 'About',
    items: [
      {
        icon: '📱',
        title: 'App Version',
        subtitle: 'v1.0.0',
        action: 'version',
      },
      {
        icon: '❤️',
        title: 'Made with care',
        subtitle: 'Your personal menu guide',
        action: 'about',
      },
    ],
  },
];

function LegalLink({
  icon,
  title,
  subtitle,
  url,
  action,
}: {
  icon: string;
  title: string;
  subtitle: string;
  url?: string;
  action?: string;
}) {
  const handlePress = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (url) {
      try {
        await Linking.openURL(url);
      } catch (error) {
        Alert.alert('Error', 'Could not open link. Please try again.');
      }
    } else if (action === 'faq') {
      Alert.alert(
        'Frequently Asked Questions',
        `Q: Are recommendations accurate?\nA: Recommendations are AI-generated suggestions. Always verify with the restaurant.\n\nQ: Is my location data safe?\nA: Yes, location data is never stored. It's only used to find nearby restaurants.\n\nQ: Can I delete my account?\nA: Yes, go to Settings to delete your account and all data.`
      );
    } else if (action === 'version') {
      Alert.alert('App Version', 'PikMe v1.0.0\n\nBuild: 1\nReleased: June 2026');
    } else if (action === 'about') {
      Alert.alert('About PikMe', 'PikMe is your personal AI food recommendation assistant.\n\nFind restaurants and menu items that match your dietary preferences, health goals, and allergies.');
    }
  };

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.7}>
      <View style={styles.linkItem}>
        <View style={styles.linkIcon}>
          <Text style={styles.linkIconText}>{icon}</Text>
        </View>
        <View style={styles.linkContent}>
          <Text style={styles.linkTitle}>{title}</Text>
          <Text style={styles.linkSubtitle}>{subtitle}</Text>
        </View>
        <Text style={styles.linkArrow}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function HelpScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Help & Legal</Text>
        <Text style={styles.headerSubtitle}>Get answers and important information</Text>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Important Notice */}
        <View style={styles.noticeBox}>
          <Text style={styles.noticeIcon}>⚠️</Text>
          <View style={styles.noticeContent}>
            <Text style={styles.noticeTitle}>Important Notice</Text>
            <Text style={styles.noticeText}>
              PikMe is an AI recommendation tool. Always verify nutritional info and allergens with the restaurant before ordering.
            </Text>
          </View>
        </View>

        {/* Help Categories */}
        {HELP_ITEMS.map((category, idx) => (
          <View key={idx} style={styles.categorySection}>
            <Text style={styles.categoryTitle}>{category.category}</Text>
            <View style={styles.categoryItems}>
              {category.items.map((item, itemIdx) => (
                <LegalLink
                  key={itemIdx}
                  icon={item.icon}
                  title={item.title}
                  subtitle={item.subtitle}
                  url={item.url}
                  action={item.action}
                />
              ))}
            </View>
          </View>
        ))}

        {/* Quick Tips */}
        <View style={styles.tipsSection}>
          <Text style={styles.tipsTitle}>Quick Tips</Text>
          <View style={styles.tipItem}>
            <Text style={styles.tipIcon}>✓</Text>
            <Text style={styles.tipText}>Always verify nutritional data with restaurants</Text>
          </View>
          <View style={styles.tipItem}>
            <Text style={styles.tipIcon}>✓</Text>
            <Text style={styles.tipText}>For allergies, call the restaurant directly</Text>
          </View>
          <View style={styles.tipItem}>
            <Text style={styles.tipIcon}>✓</Text>
            <Text style={styles.tipText}>Recommendations are AI-generated suggestions only</Text>
          </View>
          <View style={styles.tipItem}>
            <Text style={styles.tipIcon}>✓</Text>
            <Text style={styles.tipText}>Consult a doctor for medical dietary advice</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>PikMe v1.0.0</Text>
          <Text style={styles.footerSubtext}>Your Personal Menu Guide</Text>
          <Text style={styles.footerCopyright}>© 2026 PikMe. All rights reserved.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },

  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#888',
  },

  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 20,
  },

  noticeBox: {
    backgroundColor: '#FFF9E6',
    borderWidth: 1.5,
    borderColor: '#FF6B35',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  noticeIcon: {
    fontSize: 24,
    marginTop: 2,
  },
  noticeContent: {
    flex: 1,
  },
  noticeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#D84315',
    marginBottom: 4,
  },
  noticeText: {
    fontSize: 13,
    color: '#D84315',
    lineHeight: 18,
  },

  categorySection: {
    marginBottom: 24,
  },
  categoryTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: BRAND_COLORS.primary,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  categoryItems: {
    backgroundColor: '#F9F9F9',
    borderRadius: 12,
    overflow: 'hidden',
  },

  linkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  linkIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  linkIconText: {
    fontSize: 20,
  },
  linkContent: {
    flex: 1,
  },
  linkTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  linkSubtitle: {
    fontSize: 12,
    color: '#888',
  },
  linkArrow: {
    fontSize: 18,
    color: BRAND_COLORS.primary,
    marginLeft: 8,
  },

  tipsSection: {
    backgroundColor: '#E8F5E9',
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
  },
  tipsTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: BRAND_COLORS.primary,
    marginBottom: 12,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  tipIcon: {
    fontSize: 16,
    color: BRAND_COLORS.success,
    marginTop: 1,
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    color: '#2e7d32',
    lineHeight: 18,
  },

  footer: {
    alignItems: 'center',
    paddingVertical: 30,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  footerText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  footerSubtext: {
    fontSize: 12,
    color: '#888',
    marginBottom: 10,
  },
  footerCopyright: {
    fontSize: 11,
    color: '#bbb',
  },
});
