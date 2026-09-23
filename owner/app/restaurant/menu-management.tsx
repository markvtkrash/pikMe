import { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { getRestaurantMenuItems } from '../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { FavoriteHeart } from '../../src/components/common/FavoriteHeart';
import { useFavoritePages } from '../../src/hooks/useFavoritePages';

// Dashboard for the menu data itself: how it's sourced (link, manual, AI) and
// a status summary. The actual item-by-item list (view + verify) — and the
// AI Refresh actions, since seeing what you're about to replace matters —
// lives on the separate Menu Items screen. This page is entry points + stats,
// not browsing rows or destructive actions.
export default function MenuManagementScreen() {
  const router = useRouter();
  const { owner, restaurant } = useRestaurantOwnerStore();
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
      const items = await getRestaurantMenuItems(restaurant.name);
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
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  const unverifiedCount = itemCount - verifiedCount;

  return (
    <View style={styles.container}>
    <View style={styles.pageWrapper}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Menu Management</Text>
          <Text style={styles.subtitle}>{restaurant.name}</Text>
        </View>
      </View>

      <View style={styles.content}>
        {/* Edit Menu + Summary, side by side up top */}
        <View style={styles.topRow}>
          <TouchableOpacity
            style={styles.manualCurationCard}
            onPress={() => router.push('/restaurant/manual-menu')}
          >
            <View style={styles.favoriteCorner}>
              <FavoriteHeart active={favorites.has('menu-manual-entry')} onPress={() => toggleFavorite('menu-manual-entry')} />
            </View>
            <Text style={styles.manualCurationIcon}>✍️</Text>
            <Text style={styles.manualCurationText}>Edit Menu</Text>
          </TouchableOpacity>

          <View style={styles.summaryCard}>
            {itemCount === 0 ? (
              <Text style={styles.summaryEmptyText}>No menu items yet — add one below</Text>
            ) : (
              <>
                <Text style={styles.summaryCount}>{itemCount} menu item{itemCount === 1 ? '' : 's'}</Text>
                {unverifiedCount > 0 ? (
                  <Text style={styles.summaryUnverified}>
                    {verifiedCount} verified · {unverifiedCount} unconfirmed
                  </Text>
                ) : (
                  <Text style={styles.summaryVerified}>✓ All items verified</Text>
                )}
              </>
            )}
          </View>
        </View>

        {/* View items / add a source */}
        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.compactBtn, styles.compactBtnGreen]}
            onPress={() => router.push('/restaurant/menu-items')}
          >
            <View style={styles.favoriteCorner}>
              <FavoriteHeart active={favorites.has('menu-ai-pull')} onPress={() => toggleFavorite('menu-ai-pull')} />
            </View>
            <Text style={styles.compactBtnIcon}>🤖</Text>
            <Text style={[styles.compactBtnText, { color: '#2e7d32' }]}>AI Assisted Menu Pull</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.compactBtn, styles.compactBtnPurple]}
            onPress={() => router.push('/restaurant/menu-photo')}
          >
            <View style={styles.favoriteCorner}>
              <FavoriteHeart active={favorites.has('menu-photo')} onPress={() => toggleFavorite('menu-photo')} />
            </View>
            <Text style={styles.compactBtnIcon}>📷</Text>
            <Text style={[styles.compactBtnText, { color: '#8E24AA' }]}>Update Menu Items Using a Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.compactBtn, styles.compactBtnTeal]}
            onPress={() => router.push('/restaurant/menu-text')}
          >
            <View style={styles.favoriteCorner}>
              <FavoriteHeart active={favorites.has('menu-text')} onPress={() => toggleFavorite('menu-text')} />
            </View>
            <Text style={styles.compactBtnIcon}>📋</Text>
            <Text style={[styles.compactBtnText, { color: '#00695C' }]}>Update Menu Items From Text</Text>
          </TouchableOpacity>
          {/* Upload Menu (menu-link.tsx) temporarily hidden from the UI —
              needs more fixes before exposing it again. Route and backend
              are untouched, just not linked to from anywhere right now. */}
        </View>
      </View>
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f6f6f6' },
  header: { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, elevation: 2, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  backBtn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#f0f0f0' },
  backBtnText: { fontSize: 13, fontWeight: '600', color: '#e53e3e' },
  title: { fontSize: 24, fontWeight: '800', color: '#222', marginBottom: 2 },
  subtitle: { fontSize: 14, color: '#666' },

  content: { padding: 16 },

  topRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  summaryCard: { flex: 1.4, backgroundColor: '#fff', borderRadius: 12, padding: 16, justifyContent: 'center', elevation: 1 },
  summaryEmptyText: { fontSize: 13, color: '#999', fontStyle: 'italic' },
  summaryCount: { fontSize: 18, fontWeight: '800', color: '#222', marginBottom: 4 },
  summaryVerified: { fontSize: 13, color: '#2e7d32', fontWeight: '600' },
  summaryUnverified: { fontSize: 13, color: '#E65100', fontWeight: '600' },

  manualCurationCard: {
    flex: 1, position: 'relative', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#1565C0', borderRadius: 12, paddingVertical: 16, paddingHorizontal: 10, elevation: 2,
  },
  manualCurationIcon: { fontSize: 24 },
  manualCurationText: { fontSize: 13, fontWeight: '800', color: '#fff', textAlign: 'center' },

  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  compactBtn: {
    flexBasis: '48%', flexGrow: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff', borderRadius: 10, borderWidth: 1.5, paddingVertical: 12, gap: 4,
    position: 'relative',
  },
  favoriteCorner: { position: 'absolute', top: 4, right: 4 },
  compactBtnGreen: { borderColor: '#4CAF50', backgroundColor: '#E8F5E9' },
  compactBtnPurple: { borderColor: '#8E24AA', backgroundColor: '#F3E5F5' },
  compactBtnTeal: { borderColor: '#00695C', backgroundColor: '#E0F2F1' },
  compactBtnIcon: { fontSize: 18 },
  compactBtnText: { fontSize: 12, fontWeight: '800', textAlign: 'center' },
});
