import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getTopCoupons, TopCouponRow } from '../../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../../src/store/restaurantOwnerStore';
import { FavoriteHeart } from '../../../src/components/common/FavoriteHeart';
import { useFavoritePages } from '../../../src/hooks/useFavoritePages';

export default function TopCouponsReport() {
  const { restaurant } = useRestaurantOwnerStore();
  const { favorites, toggleFavorite } = useFavoritePages();
  const [rows, setRows] = useState<TopCouponRow[]>([]);
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
      const data = await getTopCoupons(restaurant.id, 10);
      setRows(data);
    } catch (error) {
      console.error('[top-coupons-report] Failed to load:', error);
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>🏆 Top Performing Coupons</Text>
        <FavoriteHeart
          active={favorites.has('report-top-coupons')}
          onPress={() => toggleFavorite('report-top-coupons')}
          size="large"
        />
      </View>
      <Text style={styles.subtitle}>Your coupons ranked by how often customers redeem them</Text>

      <View style={styles.card}>
        {rows.length === 0 ? (
          <View style={styles.emptyList}>
            <Text style={styles.emptyListText}>No coupons yet</Text>
            <Text style={styles.emptyListSubtext}>Create one from Add Coupons</Text>
          </View>
        ) : (
          rows.map((c, index) => (
            <View key={c.coupon_id} style={styles.row}>
              <Text style={styles.rank}>{index + 1}</Text>
              <View style={styles.info}>
                <View style={styles.codeBadge}>
                  <Text style={styles.codeBadgeText} numberOfLines={1}>{c.coupon_code}</Text>
                </View>
                <Text style={styles.usage}>
                  {c.coupon_type.includes('percent') ? `${c.discount_value}%` : `$${c.discount_value}`} off
                  {'  ·  '}Used {c.times_used}{c.usage_limit ? `/${c.usage_limit}` : ' (no limit)'}
                </Text>
              </View>
              <View style={styles.stats}>
                <Text style={styles.redemptions}>{c.redemption_count}</Text>
                <Text style={styles.redemptionsLabel}>redemptions</Text>
              </View>
            </View>
          ))
        )}
      </View>
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

  card: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', elevation: 1 },
  emptyList: { alignItems: 'center', paddingVertical: 40 },
  emptyListText: { fontSize: 16, fontWeight: '600', color: '#222' },
  emptyListSubtext: { fontSize: 12, color: '#999', marginTop: 4 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f5f5f5',
  },
  rank: { width: 20, fontSize: 14, fontWeight: '800', color: '#999' },
  info: { flex: 1, minWidth: 0 },
  codeBadge: { backgroundColor: '#E8F5E9', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' },
  codeBadgeText: { fontSize: 12, fontWeight: '800', color: '#2e7d32' },
  usage: { fontSize: 11, color: '#888', marginTop: 4 },
  stats: { alignItems: 'flex-end' },
  redemptions: { fontSize: 16, fontWeight: '800', color: '#1565C0' },
  redemptionsLabel: { fontSize: 10, color: '#999' },
});
