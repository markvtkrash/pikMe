import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { getRestaurantCoupons } from '../../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../../src/store/restaurantOwnerStore';
import { FavoriteHeart } from '../../../src/components/common/FavoriteHeart';
import { useFavoritePages } from '../../../src/hooks/useFavoritePages';

interface Coupon {
  id: string;
  coupon_type: string;
  discount_value: number;
  coupon_code: string;
  menu_item_id: string | null;
  expiry_date: string;
  usage_limit: number | null;
  times_used: number;
  is_active: boolean;
}

export default function CouponPerformanceReport() {
  const router = useRouter();
  const { restaurant } = useRestaurantOwnerStore();
  const { favorites, toggleFavorite } = useFavoritePages();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      loadCoupons();
    }, [restaurant])
  );

  async function loadCoupons() {
    if (!restaurant) {
      setLoading(false);
      return;
    }
    try {
      const data = await getRestaurantCoupons(restaurant.id);
      const now = new Date();
      const activeCoupons = data.filter((c: Coupon) => c.is_active && new Date(c.expiry_date) > now);
      setCoupons(activeCoupons);
    } catch (error) {
      console.error('[coupon-performance-report] Failed to load coupons:', error);
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
        <Text style={styles.title}>📊 Coupon Performance</Text>
        <FavoriteHeart
          active={favorites.has('report-coupon-performance')}
          onPress={() => toggleFavorite('report-coupon-performance')}
          size="large"
        />
      </View>
      <Text style={styles.subtitle}>Usage and expiry for your active coupons</Text>

      {coupons.length === 0 ? (
        <View style={styles.emptyList}>
          <Text style={styles.emptyListText}>No active coupons yet</Text>
          <Text style={styles.emptyListSubtext}>Add one from Menu Items</Text>
        </View>
      ) : (
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.tableHeaderCell, styles.tableCodeCol]}>Code</Text>
            <Text style={[styles.tableHeaderCell, styles.tableDiscountCol]}>Discount</Text>
            <Text style={[styles.tableHeaderCell, styles.tableUsedCol]}>Used</Text>
            <Text style={[styles.tableHeaderCell, styles.tableExpiresCol]}>Expires</Text>
            <View style={styles.tableChevronCol} />
          </View>
          {coupons.map((coupon, index) => {
            const usageRatio = coupon.usage_limit
              ? Math.min(coupon.times_used / coupon.usage_limit, 1)
              : 0;
            const daysUntilExpiry = Math.ceil(
              (new Date(coupon.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            );
            const expiringSoon = daysUntilExpiry <= 7;

            return (
              <TouchableOpacity
                key={coupon.id}
                style={[styles.tableRow, index % 2 === 1 && styles.tableRowAlt]}
                onPress={() => router.push(`/restaurant/coupon/${coupon.id}/edit`)}
              >
                <View style={styles.tableCodeCol}>
                  <View style={styles.codeBadge}>
                    <Text style={styles.codeBadgeText} numberOfLines={1}>{coupon.coupon_code}</Text>
                  </View>
                </View>

                <View style={styles.tableDiscountCol}>
                  <View style={styles.discountBadge}>
                    <Text style={styles.discountBadgeText}>
                      {coupon.coupon_type.includes('percent')
                        ? `${coupon.discount_value}%`
                        : `$${coupon.discount_value}`} off
                    </Text>
                  </View>
                </View>

                <View style={styles.tableUsedCol}>
                  <Text style={styles.usedText}>
                    {coupon.times_used}/{coupon.usage_limit ?? '∞'}
                  </Text>
                  {coupon.usage_limit ? (
                    <View style={styles.usageBarTrack}>
                      <View style={[styles.usageBarFill, { width: `${usageRatio * 100}%` }]} />
                    </View>
                  ) : null}
                </View>

                <View style={styles.tableExpiresCol}>
                  <Text style={[styles.expiresText, expiringSoon && styles.expiresTextSoon]}>
                    {new Date(coupon.expiry_date).toLocaleDateString()}
                  </Text>
                </View>

                <View style={styles.tableChevronCol}>
                  <Text style={styles.rowChevron}>›</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
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

  emptyList: { alignItems: 'center', paddingVertical: 40 },
  emptyListText: { fontSize: 16, fontWeight: '600', color: '#222' },
  emptyListSubtext: { fontSize: 12, color: '#999', marginTop: 4 },

  table: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', elevation: 1 },
  tableHeaderRow: {
    flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#eee', backgroundColor: '#FAFAFA',
  },
  tableHeaderCell: { fontSize: 10, fontWeight: '800', color: '#999', textTransform: 'uppercase', letterSpacing: 0.5 },
  tableRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#f5f5f5',
  },
  tableRowAlt: { backgroundColor: '#FAFCFB' },
  tableCodeCol: { flex: 1.3 },
  tableDiscountCol: { flex: 1 },
  tableUsedCol: { flex: 1 },
  tableExpiresCol: { flex: 1.1, textAlign: 'right', alignItems: 'flex-end' },
  tableChevronCol: { width: 16, alignItems: 'flex-end' },

  codeBadge: { backgroundColor: '#E8F5E9', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' },
  codeBadgeText: { fontSize: 12, fontWeight: '800', color: '#2e7d32' },
  discountBadge: { backgroundColor: '#FFF3E0', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' },
  discountBadgeText: { fontSize: 11, fontWeight: '700', color: '#E65100' },
  usedText: { fontSize: 12, color: '#444', fontWeight: '600', marginBottom: 4 },
  usageBarTrack: { height: 4, width: '80%', backgroundColor: '#eee', borderRadius: 2, overflow: 'hidden' },
  usageBarFill: { height: 4, backgroundColor: '#4CAF50', borderRadius: 2 },
  expiresText: { fontSize: 12, color: '#666' },
  expiresTextSoon: { color: '#e53e3e', fontWeight: '700' },
  rowChevron: { fontSize: 20, color: '#ccc', fontWeight: '700' },
});
