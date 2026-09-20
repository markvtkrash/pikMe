import { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { getRestaurantMenuItems } from '../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';

// Dashboard for the menu data itself: how it's sourced (link, manual, AI) and
// a status summary. The actual item-by-item list (view + verify) — and the
// AI Refresh actions, since seeing what you're about to replace matters —
// lives on the separate Menu Items screen. This page is entry points + stats,
// not browsing rows or destructive actions.
export default function MenuManagementScreen() {
  const router = useRouter();
  const { owner, restaurant } = useRestaurantOwnerStore();
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
        {/* Summary */}
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

        {/* View items / add a source */}
        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.compactBtn, styles.compactBtnGreen]}
            onPress={() => router.push('/restaurant/menu-items')}
          >
            <Text style={styles.compactBtnIcon}>🤖</Text>
            <Text style={[styles.compactBtnText, { color: '#2e7d32' }]}>AI Assisted Menu Pull</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.compactBtn, styles.compactBtnBlue]}
            onPress={() => router.push('/restaurant/manual-menu')}
          >
            <Text style={styles.compactBtnIcon}>✍️</Text>
            <Text style={[styles.compactBtnText, { color: '#1565C0' }]}>Manual Entry</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.compactBtn, styles.compactBtnPurple]}
            onPress={() => router.push('/restaurant/menu-photo')}
          >
            <Text style={styles.compactBtnIcon}>📷</Text>
            <Text style={[styles.compactBtnText, { color: '#8E24AA' }]}>Add Menu Items Using a Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.compactBtn, styles.compactBtnTeal]}
            onPress={() => router.push('/restaurant/menu-text')}
          >
            <Text style={styles.compactBtnIcon}>📋</Text>
            <Text style={[styles.compactBtnText, { color: '#00695C' }]}>Add Menu Items From Text</Text>
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

  summaryCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, elevation: 1 },
  summaryEmptyText: { fontSize: 13, color: '#999', fontStyle: 'italic' },
  summaryCount: { fontSize: 18, fontWeight: '800', color: '#222', marginBottom: 4 },
  summaryVerified: { fontSize: 13, color: '#2e7d32', fontWeight: '600' },
  summaryUnverified: { fontSize: 13, color: '#E65100', fontWeight: '600' },

  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  compactBtn: {
    flexBasis: '48%', flexGrow: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff', borderRadius: 10, borderWidth: 1.5, paddingVertical: 12, gap: 4,
  },
  compactBtnGreen: { borderColor: '#4CAF50', backgroundColor: '#E8F5E9' },
  compactBtnPurple: { borderColor: '#8E24AA', backgroundColor: '#F3E5F5' },
  compactBtnBlue: { borderColor: '#1565C0', backgroundColor: '#E3F2FD' },
  compactBtnTeal: { borderColor: '#00695C', backgroundColor: '#E0F2F1' },
  compactBtnIcon: { fontSize: 18 },
  compactBtnText: { fontSize: 12, fontWeight: '800', textAlign: 'center' },
});
