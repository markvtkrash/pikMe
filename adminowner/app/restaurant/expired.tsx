import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, Alert, useFocusEffect,
} from 'react-native';
import { useRouter } from 'expo-router';
import { getRestaurantCoupons, deleteCoupon } from '../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';

interface Coupon {
  id: string;
  coupon_code: string;
  coupon_type: string;
  discount_value: number;
  expiry_date: string;
  is_active: boolean;
  menu_item_id?: string;
  usage_limit?: number;
  times_used?: number;
}

export default function ExpiredCouponsScreen() {
  const router = useRouter();
  const { restaurant } = useRestaurantOwnerStore();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    loadExpiredCoupons();
  }, [restaurant]);

  async function loadExpiredCoupons() {
    if (!restaurant) {
      router.replace('/restaurant/dashboard');
      return;
    }

    try {
      const allCoupons = await getRestaurantCoupons(restaurant.id);
      const now = new Date();

      // Filter for expired coupons (regardless of is_active status)
      const expiredCoupons = allCoupons.filter(c => new Date(c.expiry_date) <= now);

      setCoupons(expiredCoupons);
    } catch (error: any) {
      console.error('[expired] Load error:', error);
      Alert.alert('Error', 'Failed to load expired coupons');
    } finally {
      setLoading(false);
    }
  }

  function handleDelete(couponId: string, couponCode: string) {
    console.log('[expired] handleDelete called for:', couponId, couponCode);

    // Use confirm for web compatibility
    const confirmed = confirm(`Delete ${couponCode}? This cannot be undone.`);
    console.log('[expired] Confirm result:', confirmed);

    if (confirmed) {
      performDelete(couponId, couponCode);
    }
  }

  async function performDelete(couponId: string, couponCode: string) {
    console.log('[expired] performDelete called');
    setDeleting(couponId);
    try {
      console.log('[expired] Calling deleteCoupon for:', couponId);
      const result = await deleteCoupon(couponId);
      console.log('[expired] deleteCoupon response:', JSON.stringify(result, null, 2));
      console.log('[expired] Coupon deleted successfully');

      console.log('[expired] Reloading expired coupons');
      setDeleting(null);
      await loadExpiredCoupons();
      console.log('[expired] Coupons reloaded');

      Alert.alert('Success', `${couponCode} has been deleted`);
    } catch (error: any) {
      console.error('[expired] Delete error:', error);
      console.error('[expired] Full error object:', JSON.stringify(error, null, 2));
      setDeleting(null);
      Alert.alert('Error', error.message || JSON.stringify(error) || 'Failed to delete');
    }
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Expired Coupons</Text>
          <Text style={styles.count}>{coupons.length} expired</Text>
        </View>
      </View>

      {coupons.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyText}>No expired coupons</Text>
          <Text style={styles.emptySubtext}>All your coupons are still active!</Text>
        </View>
      ) : (
        <FlatList
          data={coupons}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.couponCard}>
              <View style={styles.expiredBadgeContainer}>
                <Text style={styles.expiredBadge}>❌ EXPIRED • {new Date(item.expiry_date).toLocaleDateString()}</Text>
              </View>

              <View style={styles.couponInfo}>
                {/* Header: Code + Type */}
                <View style={styles.couponHeader}>
                  <Text style={styles.couponCode}>{item.coupon_code}</Text>
                  {item.menu_item_id && <Text style={styles.itemBadge}>Item-Specific</Text>}
                </View>

                {/* Discount */}
                <View style={styles.couponRow}>
                  <Text style={styles.discountValue}>
                    {item.coupon_type.includes('percent') ? '%' : '$'}{item.discount_value} off
                  </Text>
                </View>

                {/* Usage + Limit */}
                {(item.times_used !== undefined || item.usage_limit) && (
                  <View style={styles.couponRow}>
                    <Text style={styles.usageText}>
                      Used: {item.times_used || 0}{item.usage_limit ? `/${item.usage_limit}` : '/∞'} times
                    </Text>
                  </View>
                )}
              </View>

              <View style={styles.couponFooter}>
              <TouchableOpacity
                style={[styles.deleteBtn, deleting === item.id && styles.buttonDisabled]}
                onPress={() => handleDelete(item.id, item.coupon_code)}
                disabled={deleting === item.id}
              >
                {deleting === item.id ? (
                  <ActivityIndicator color="#e53e3e" size="small" />
                ) : (
                  <Text style={styles.deleteBtnText}>🗑️ Delete</Text>
                )}
              </TouchableOpacity>
              </View>
            </View>
          )}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, elevation: 2, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  backBtn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#f0f0f0' },
  backBtnText: { fontSize: 13, fontWeight: '600', color: '#e53e3e' },
  title: { fontSize: 24, fontWeight: '800', color: '#222', marginBottom: 2 },
  count: { fontSize: 12, color: '#999' },

  list: { paddingHorizontal: 16, paddingVertical: 12 },
  couponCard: { backgroundColor: '#FFEBEE', borderRadius: 12, padding: 14, marginBottom: 12, elevation: 2, flexDirection: 'column', borderLeftWidth: 4, borderLeftColor: '#c62828', gap: 12 },
  expiredBadgeContainer: { backgroundColor: '#c62828', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, alignSelf: 'flex-start' },
  expiredBadge: { fontSize: 13, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  couponInfo: { flex: 1 },
  couponHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  couponCode: { fontSize: 16, fontWeight: '800', color: '#222' },
  itemBadge: { fontSize: 10, fontWeight: '700', color: '#fff', backgroundColor: '#c62828', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  couponType: { fontSize: 12, color: '#666', marginBottom: 8, textTransform: 'capitalize' },
  couponRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  discountValue: { fontSize: 18, fontWeight: '800', color: '#c62828' },
  expiredDate: { fontSize: 11, color: '#999', fontStyle: 'italic' },
  usageText: { fontSize: 11, color: '#666', fontWeight: '600' },

  couponFooter: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  deleteBtn: { backgroundColor: '#c62828', borderWidth: 0, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  buttonDisabled: { opacity: 0.6 },
  deleteBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '700', color: '#222' },
  emptySubtext: { fontSize: 13, color: '#999', marginTop: 4 },
});
