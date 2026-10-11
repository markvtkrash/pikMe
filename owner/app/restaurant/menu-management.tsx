import { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { getMenuItemsForOwnerView } from '../../src/api/chainMenu';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { useIsChainRestaurant } from '../../src/hooks/useIsChainRestaurant';
import { ChainMenuBanner } from '../../src/components/common/ChainMenuNotice';
import { FavoriteHeart } from '../../src/components/common/FavoriteHeart';
import { useFavoritePages } from '../../src/hooks/useFavoritePages';
import { MenuUrlSection } from '../../src/components/common/MenuUrlSection';
import { CARD } from '../../src/constants/cardStyle';
import { confirmedPercent, menuSummaryText } from '../../src/utils/menuSummary';
import { IconText } from '../../src/components/common/AppIcon';

// The ways to add or update a menu (independent restaurants). Each is a card with a coloured icon, a title and a line
// saying what it does. The "online link" way is the form below them, since it needs a field.
const IMPORT_CARDS = [
  {
    key: 'menu-photo',
    href: '/restaurant/menu-photo',
    icon: '📷',
    title: 'Import Menu from Photo',
    blurb: 'Snap or upload a picture. We read the dishes.',
    tint: '#F3E5F5',
    accent: '#7B1FA2',
  },
  {
    key: 'menu-text',
    href: '/restaurant/menu-text',
    icon: '📋',
    title: 'Import Menu from Text',
    blurb: 'Paste text from a PDF, an email or a document.',
    tint: '#E0F2F1',
    accent: '#00796B',
  },
  {
    key: 'menu-online-link',
    href: '/restaurant/menu-online-link',
    icon: '🔗',
    title: 'Import Menu from Online Link',
    blurb: 'Enter the web address of your menu page.',
    tint: '#E3F2FD',
    accent: '#1565C0',
  },
] as const;

// Dashboard for the menu data itself: a status summary and the ways to add to the menu. The actual item-by-item
// list (view + verify) lives on the separate Menu Items screen. This page is entry points + stats, not browsing rows
// or destructive actions.
export default function MenuManagementScreen() {
  const router = useRouter();
  const { owner, restaurant } = useRestaurantOwnerStore();
  const { data: isChain } = useIsChainRestaurant(restaurant?.name);
  const { favorites, toggleFavorite } = useFavoritePages();
  const [loading, setLoading] = useState(true);
  const [itemCount, setItemCount] = useState(0);
  const [verifiedCount, setVerifiedCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      loadSummary();
    }, [restaurant])
  );

  async function loadSummary() {
    if (!restaurant) {
      setLoading(false);
      return;
    }
    try {
      const items = await getMenuItemsForOwnerView(restaurant);
      setItemCount(items.length);
      setVerifiedCount(items.filter((i: any) => i.is_verified).length);
    } catch (error) {
      console.error('[menu-management] Failed to load summary:', error);
    } finally {
      setLoading(false);
    }
  }

  if (!owner || !restaurant) return null;

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  const summary = menuSummaryText(itemCount, verifiedCount, isChain === true);
  const percent = confirmedPercent(itemCount, verifiedCount);
  const toneColor = summary.tone === 'good' ? '#2E7D32' : summary.tone === 'warn' ? '#E65100' : '#78909C';

  return (
    <View style={styles.container}>
    <View style={styles.pageWrapper}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.backBtnText}>‹ Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Menu Management</Text>
          <Text style={styles.subtitle}>{restaurant.name}</Text>
        </View>
        <FavoriteHeart active={favorites.has('main-menu')} onPress={() => toggleFavorite('main-menu')} size="large" />
      </View>

      {isChain && <ChainMenuBanner />}

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Summary: how big the menu is, how much of it is confirmed, and the main action */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.summaryLabel}>YOUR MENU</Text>
              <Text style={styles.summaryCount}>{summary.count}</Text>
            </View>
            {isChain ? (
              <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push('/restaurant/menu-items')} accessibilityRole="button">
                <IconText style={styles.primaryBtnText} emoji="📖">View Menu Items</IconText>
              </TouchableOpacity>
            ) : (
              <View style={styles.primaryWrap}>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push('/restaurant/manual-menu')} accessibilityRole="button">
                  <IconText style={styles.primaryBtnText} emoji="✍️">Edit Menu</IconText>
                </TouchableOpacity>
                <FavoriteHeart active={favorites.has('menu-manual-entry')} onPress={() => toggleFavorite('menu-manual-entry')} />
              </View>
            )}
          </View>

          {itemCount > 0 && (
            <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
              <View style={[styles.fill, { width: `${percent}%` }]} />
            </View>
          )}
          <Text style={[styles.summaryLine, { color: toneColor }]}>{summary.line}</Text>
        </View>

        {/* The ways to add or update the menu (not for chains: their menu is managed centrally) */}
        {!isChain && (
          <>
            <Text style={styles.sectionTitle}>Add or update your menu</Text>

            {/* AI Assisted Menu Pull (menu-items.tsx), Add Nutrition Info (menu-nutrition.tsx) and Upload Menu
                (menu-link.tsx) are temporarily hidden from the UI — to be revisited. Routes and backend are
                untouched, just not linked to from here. */}
            <View style={styles.grid}>
              {IMPORT_CARDS.map((c) => (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.importCard, { backgroundColor: c.tint, borderColor: c.accent }]}
                  onPress={() => router.push(c.href as any)}
                  accessibilityRole="button"
                >
                  <View style={styles.heartCorner}>
                    <FavoriteHeart active={favorites.has(c.key)} onPress={() => toggleFavorite(c.key)} />
                  </View>
                  <View style={styles.cardTop}>
                    <View style={[styles.badge, { backgroundColor: c.accent }]}>
                      <IconText style={styles.badgeIcon} emoji={c.icon} iconColor="#fff" />
                    </View>
                    <Text style={[styles.importTitle, { color: c.accent }]} numberOfLines={2}>{c.title}</Text>
                  </View>
                  <Text style={styles.importBlurb}>{c.blurb}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* For a franchise restaurant the menu link is a suggestion to our team. An independent restaurant has the same form as the
            "Import Menu from Online Link" card above, so it is not repeated here. */}
        {isChain === true && <MenuUrlSection isChain />}
      </ScrollView>
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F6FA' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F4F6FA' },

  header: {
    backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#EEF1F5', flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  backBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#F1F3F7' },
  backBtnText: { fontSize: 13, fontWeight: '700', color: '#455A64' },
  title: { fontSize: 22, fontWeight: '800', color: '#1F2A44' },
  subtitle: { fontSize: 13.5, color: '#78909C', marginTop: 1 },

  content: { padding: 16, paddingBottom: 32, gap: 14 },

  summaryCard: { ...CARD, padding: 18 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  summaryLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: '#90A4AE', marginBottom: 2 },
  summaryCount: { fontSize: 24, fontWeight: '800', color: '#1F2A44' },
  primaryWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  primaryBtn: { backgroundColor: '#1565C0', borderRadius: 12, paddingVertical: 11, paddingHorizontal: 16 },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  track: { height: 8, borderRadius: 4, backgroundColor: '#E6ECF3', overflow: 'hidden', marginBottom: 8 },
  fill: { height: 8, borderRadius: 4, backgroundColor: '#43A047' },
  summaryLine: { fontSize: 13.5, fontWeight: '700' },

  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#1F2A44', marginTop: 4 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  importCard: { ...CARD, width: '32%', minWidth: 200, minHeight: 92, padding: 12, paddingRight: 30, position: 'relative', borderWidth: 2, borderRadius: 12 },
  heartCorner: { position: 'absolute', top: 6, right: 6, zIndex: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  badge: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  badgeIcon: { fontSize: 16, color: '#fff' },
  importTitle: { flex: 1, fontSize: 14, fontWeight: '800' },
  importBlurb: { fontSize: 12, color: '#37474F', lineHeight: 16 },
});
