import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { getCouponStatusSnapshot, CouponStatusSnapshot } from '../../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../../src/store/restaurantOwnerStore';
import { FavoriteHeart } from '../../../src/components/common/FavoriteHeart';
import { useFavoritePages } from '../../../src/hooks/useFavoritePages';

export default function CouponStatusOverviewReport() {
  const router = useRouter();
  const { restaurant } = useRestaurantOwnerStore();
  const { favorites, toggleFavorite } = useFavoritePages();
  const [snapshot, setSnapshot] = useState<CouponStatusSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [restaurant])
  );

  async function loadData() {
    if (!restaurant) {
      setLoading(false);
      return;
    }
    try {
      const data = await getCouponStatusSnapshot(restaurant.id);
      setSnapshot(data);
    } catch (error) {
      console.error('[coupon-status-overview-report] Failed to load:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  const hasIssues = (snapshot?.expired_count ?? 0) > 0 || (snapshot?.orphaned_count ?? 0) > 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>🎟️ Coupon Status Overview</Text>
        <FavoriteHeart
          active={favorites.has('report-coupon-status-overview')}
          onPress={() => toggleFavorite('report-coupon-status-overview')}
          size="large"
        />
      </View>
      <Text style={styles.subtitle}>Where all your coupons currently stand</Text>

      <View style={styles.snapshotRow}>
        <View style={[styles.snapshotBox, styles.snapshotBoxActive]}>
          <Text style={styles.snapshotNumber}>{snapshot?.active_count ?? 0}</Text>
          <Text style={styles.snapshotLabel}>Active</Text>
        </View>
        <View style={styles.snapshotBox}>
          <Text style={styles.snapshotNumber}>{snapshot?.inactive_count ?? 0}</Text>
          <Text style={styles.snapshotLabel}>Inactive</Text>
        </View>
        <View style={styles.snapshotBox}>
          <Text style={styles.snapshotNumber}>{snapshot?.expired_count ?? 0}</Text>
          <Text style={styles.snapshotLabel}>Expired</Text>
        </View>
        <View style={[styles.snapshotBox, styles.snapshotBoxOrphaned]}>
          <Text style={styles.snapshotNumber}>{snapshot?.orphaned_count ?? 0}</Text>
          <Text style={styles.snapshotLabel}>Orphaned</Text>
        </View>
      </View>
      <Text style={styles.hint}>A coupon can be in more than one of these at once (e.g. active and orphaned).</Text>

      {hasIssues && (
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => router.push('/restaurant/coupon-status')}
        >
          <Text style={styles.actionCardText}>
            {(snapshot?.orphaned_count ?? 0) > 0
              ? 'Some coupons point to items that no longer exist — reassign them'
              : 'Some coupons have expired — renew or replace them'}
          </Text>
          <Text style={styles.actionCardArrow}>→</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f6f6f6' },
  content: { padding: 16, width: '100%', maxWidth: 900, alignSelf: 'center' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: '#1565C0', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 16 },

  snapshotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  snapshotBox: {
    flex: 1, minWidth: 90, backgroundColor: '#fff', borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', elevation: 1,
  },
  snapshotBoxActive: { backgroundColor: '#E8F5E9' },
  snapshotBoxOrphaned: { backgroundColor: '#FFF3E0' },
  snapshotNumber: { fontSize: 24, fontWeight: '800', color: '#222' },
  snapshotLabel: { fontSize: 11, fontWeight: '700', color: '#666', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 4 },

  hint: { fontSize: 11, color: '#999', marginTop: 8 },

  actionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFF3E0',
    borderRadius: 12, padding: 14, marginTop: 20, borderLeftWidth: 4, borderLeftColor: '#E65100',
  },
  actionCardText: { flex: 1, fontSize: 13, fontWeight: '700', color: '#E65100' },
  actionCardArrow: { fontSize: 18, fontWeight: '800', color: '#E65100' },
});
