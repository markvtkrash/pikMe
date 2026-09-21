import { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { getRestaurantCoupons, updateCoupon } from '../../src/api/restaurantAuth';
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

// Genuinely usable right now — is_active AND not yet expired. A coupon can
// be is_active:true but past its expiry_date (that's what Expired Coupons
// shows), so this list is the narrower, actually-live subset of that.
export default function ActiveCouponsScreen() {
  const router = useRouter();
  const { restaurant } = useRestaurantOwnerStore();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadActiveCoupons();
    }, [restaurant])
  );

  async function loadActiveCoupons() {
    if (!restaurant) {
      router.replace('/restaurant/dashboard');
      return;
    }
    try {
      const allCoupons = await getRestaurantCoupons(restaurant.id);
      const now = new Date();
      const active = (allCoupons as Coupon[]).filter((c) => c.is_active && new Date(c.expiry_date) > now);
      setCoupons(active);
    } catch (error: any) {
      console.error('[active-coupons] Load error:', error);
      Alert.alert('Error', 'Failed to load active coupons');
    } finally {
      setLoading(false);
    }
  }

  async function handleDeactivate(couponId: string, couponCode: string) {
    if (!confirm(`Deactivate ${couponCode}? Customers won't be able to use it until you reactivate it.`)) return;
    setDeactivatingId(couponId);
    try {
      await updateCoupon(couponId, { isActive: false });
      setCoupons((prev) => prev.filter((c) => c.id !== couponId));
    } catch (error: any) {
      console.error('[active-coupons] Deactivate error:', error);
      Alert.alert('Error', error.message || 'Failed to deactivate coupon');
    } finally {
      setDeactivatingId(null);
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
    <View style={styles.pageWrapper}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Active Coupons</Text>
          <Text style={styles.count}>{coupons.length} active</Text>
        </View>
      </View>

      {coupons.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🎟️</Text>
          <Text style={styles.emptyText}>No active coupons</Text>
          <Text style={styles.emptySubtext}>Add one from Add Coupons</Text>
        </View>
      ) : (
        <FlatList
          data={coupons}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const daysUntilExpiry = Math.ceil(
              (new Date(item.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            );
            const expiringSoon = daysUntilExpiry <= 7;
            return (
              <View style={styles.couponCard}>
                <View style={styles.activeBadgeContainer}>
                  <Text style={styles.activeBadge}>✓ ACTIVE</Text>
                </View>

                <View style={styles.couponInfo}>
                  <View style={styles.couponHeader}>
                    <Text style={styles.couponCode}>{item.coupon_code}</Text>
                    {item.menu_item_id && <Text style={styles.itemBadge}>Item-Specific</Text>}
                  </View>

                  <View style={styles.couponRow}>
                    <Text style={styles.discountValue}>
                      {item.coupon_type.includes('percent') ? '%' : '$'}{item.discount_value} off
                    </Text>
                    <Text style={[styles.expiryText, expiringSoon && styles.expiryTextSoon]}>
                      Expires {new Date(item.expiry_date).toLocaleDateString()}
                    </Text>
                  </View>

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
                    style={[styles.deactivateBtn, deactivatingId === item.id && styles.buttonDisabled]}
                    onPress={() => handleDeactivate(item.id, item.coupon_code)}
                    disabled={deactivatingId === item.id}
                  >
                    {deactivatingId === item.id ? (
                      <ActivityIndicator color="#E65100" size="small" />
                    ) : (
                      <Text style={styles.deactivateBtnText}>⏸ Deactivate</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.editBtn}
                    onPress={() => router.push(`/restaurant/coupon/${item.id}/edit`)}
                  >
                    <Text style={styles.editBtnText}>✎ Edit</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, elevation: 2, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  backBtn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#f0f0f0' },
  backBtnText: { fontSize: 13, fontWeight: '600', color: '#e53e3e' },
  title: { fontSize: 24, fontWeight: '800', color: '#222', marginBottom: 2 },
  count: { fontSize: 12, color: '#999' },

  list: { paddingHorizontal: 16, paddingVertical: 12 },
  couponCard: { backgroundColor: '#E8F5E9', borderRadius: 12, padding: 14, marginBottom: 12, elevation: 2, borderLeftWidth: 4, borderLeftColor: '#4CAF50', gap: 12 },
  activeBadgeContainer: { backgroundColor: '#4CAF50', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, alignSelf: 'flex-start' },
  activeBadge: { fontSize: 13, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  couponInfo: { flex: 1, minWidth: 0 },
  couponHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' },
  couponCode: { fontSize: 16, fontWeight: '800', color: '#222' },
  itemBadge: { fontSize: 10, fontWeight: '700', color: '#fff', backgroundColor: '#4CAF50', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  couponRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 6 },
  discountValue: { fontSize: 18, fontWeight: '800', color: '#2e7d32' },
  expiryText: { fontSize: 11, color: '#666' },
  expiryTextSoon: { color: '#E65100', fontWeight: '700' },
  usageText: { fontSize: 11, color: '#666', fontWeight: '600' },

  couponFooter: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8 },
  editBtn: { backgroundColor: '#4CAF50', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  editBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  deactivateBtn: {
    backgroundColor: '#FFF3E0', borderWidth: 1.5, borderColor: '#E65100',
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
  },
  deactivateBtnText: { fontSize: 12, fontWeight: '700', color: '#E65100' },
  buttonDisabled: { opacity: 0.6 },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '700', color: '#222' },
  emptySubtext: { fontSize: 13, color: '#999', marginTop: 4 },
});
