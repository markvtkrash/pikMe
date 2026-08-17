import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { getRestaurantCoupons } from '../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';

interface Coupon {
  id: string;
  coupon_type: string;
  discount_value: number;
  coupon_code: string;
  expiry_date: string;
  usage_limit: number | null;
  times_used: number;
  is_active: boolean;
}

export default function RestaurantDashboardScreen() {
  const router = useRouter();
  const { owner, restaurant, logout } = useRestaurantOwnerStore();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [expiredCount, setExpiredCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!owner) {
      router.replace('/restaurant/auth/login');
      return;
    }
  }, [owner]);

  // Refetch coupons whenever page comes into focus
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
      console.log('[dashboard] Loading coupons for restaurant:', restaurant.id, 'owner:', restaurant.owner_id);
      const data = await getRestaurantCoupons(restaurant.id);

      // Separate active and expired coupons
      const now = new Date();
      const activeCoupons = data.filter(c =>
        c.is_active && new Date(c.expiry_date) > now
      );
      const expired = data.filter(c =>
        new Date(c.expiry_date) <= now
      );

      setCoupons(activeCoupons);
      setExpiredCount(expired.length);
    } catch (error: any) {
      console.error('[dashboard] Failed to load coupons:', JSON.stringify(error, null, 2));
      console.error('[dashboard] Restaurant object:', JSON.stringify(restaurant, null, 2));
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    logout();
    router.replace('/restaurant/auth/login');
  }

  if (!owner) return null;

  if (!restaurant) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>📍</Text>
          <Text style={styles.emptyTitle}>No Restaurant Claimed</Text>
          <Text style={styles.emptyBody}>Claim your restaurant to start managing coupons</Text>
          <TouchableOpacity
            style={styles.claimBtn}
            onPress={() => router.push('/restaurant/claim')}
          >
            <Text style={styles.claimBtnText}>Claim Restaurant</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Show status badge if pending approval
  const statusColor = restaurant.status === 'pending' ? '#FFF3E0' :
                      restaurant.status === 'approved' ? '#E8F5E9' : '#FFEBEE';
  const statusTextColor = restaurant.status === 'pending' ? '#E65100' :
                          restaurant.status === 'approved' ? '#2e7d32' : '#c62828';
  const statusIcon = restaurant.status === 'pending' ? '⏳' :
                     restaurant.status === 'approved' ? '✓' : '✕';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>Welcome back!</Text>
          <Text style={styles.businessName}>{owner.businessName}</Text>
          <Text style={styles.restaurantName}>{restaurant.name}</Text>
          <Text style={styles.restaurantAddress}>{restaurant.address}</Text>
          {restaurant.status && (
            <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
              <Text style={[styles.statusText, { color: statusTextColor }]}>
                {statusIcon} {restaurant.status === 'pending' ? 'Pending Approval' :
                            restaurant.status === 'approved' ? 'Approved Business' : 'Rejected'}
              </Text>
            </View>
          )}
        </View>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <TouchableOpacity
          style={[styles.statBox, styles.statBoxGreen]}
          onPress={() => router.push('/restaurant/menu')}
        >
          <Text style={styles.statNumber}>{coupons.length}</Text>
          <Text style={styles.statLabel}>Active</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.statBox, styles.statBoxRed]}
          onPress={() => router.push('/restaurant/expired')}
        >
          <Text style={[styles.statNumber, { color: '#e53e3e' }]}>{expiredCount}</Text>
          <Text style={styles.statLabel}>Expired</Text>
        </TouchableOpacity>
      </View>

      {/* Menu Items Button */}
      <TouchableOpacity
        style={styles.menuItemsBtn}
        onPress={() => router.push('/restaurant/menu')}
      >
        <Text style={styles.menuItemsIcon}>📋</Text>
        <View style={styles.menuItemsContent}>
          <Text style={styles.menuItemsTitle}>Menu Items</Text>
          <Text style={styles.menuItemsSubtitle}>View and manage all menu items</Text>
        </View>
        <Text style={styles.menuItemsArrow}>→</Text>
      </TouchableOpacity>

      {/* Show warning if not approved */}
      {restaurant.status !== 'approved' && (
        <View style={styles.warningBox}>
          <Text style={styles.warningIcon}>⏳</Text>
          <Text style={styles.warningText}>Waiting for admin approval to manage coupons</Text>
        </View>
      )}

      {/* Coupon performance table */}
      <View style={styles.couponTableSection}>
        <Text style={styles.sectionTitle}>Coupon Performance</Text>
        {coupons.length === 0 ? (
          <View style={styles.emptyList}>
            <Text style={styles.emptyListText}>No active coupons yet</Text>
            <Text style={styles.emptyListSubtext}>Add one from Menu Items</Text>
          </View>
        ) : (
          <View style={styles.table}>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.tableHeaderCell, styles.tableCodeCol]}>Code</Text>
              <Text style={[styles.tableHeaderCell, styles.tableUsedCol]}>Used</Text>
              <Text style={[styles.tableHeaderCell, styles.tableExpiresCol]}>Expires</Text>
            </View>
            {coupons.map((coupon) => (
              <TouchableOpacity
                key={coupon.id}
                style={styles.tableRow}
                onPress={() => router.push(`/restaurant/coupon/${coupon.id}/edit`)}
              >
                <Text style={[styles.tableCell, styles.tableCodeCol, styles.tableCodeText]} numberOfLines={1}>
                  {coupon.coupon_code}
                </Text>
                <Text style={[styles.tableCell, styles.tableUsedCol]}>
                  {coupon.times_used}/{coupon.usage_limit ?? '∞'}
                </Text>
                <Text style={[styles.tableCell, styles.tableExpiresCol]}>
                  {new Date(coupon.expiry_date).toLocaleDateString()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  scrollContent: { paddingBottom: 24 },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    elevation: 2,
  },
  greeting: { fontSize: 12, color: '#999' },
  businessName: { fontSize: 18, fontWeight: '800', color: '#222', marginBottom: 2 },
  restaurantName: { fontSize: 14, color: '#666', marginBottom: 2 },
  restaurantAddress: { fontSize: 12, color: '#999', fontStyle: 'italic', marginBottom: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, alignSelf: 'flex-start' },
  statusText: { fontSize: 12, fontWeight: '700' },
  logoutBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#f0f0f0' },
  logoutText: { fontSize: 12, color: '#e53e3e', fontWeight: '600' },

  statsRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  statBox: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    elevation: 2,
  },
  statBoxGreen: { backgroundColor: '#E8F5E9', borderWidth: 2, borderColor: '#4CAF50' },
  statBoxRed: { backgroundColor: '#FFEBEE', borderWidth: 2, borderColor: '#e53e3e' },
  statNumber: { fontSize: 24, fontWeight: '800', color: '#4CAF50' },
  statLabel: { fontSize: 11, color: '#999', marginTop: 4 },

  menuItemsBtn: { backgroundColor: '#fff', marginHorizontal: 16, marginVertical: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 12, elevation: 2 },
  menuItemsIcon: { fontSize: 24 },
  menuItemsContent: { flex: 1 },
  menuItemsTitle: { fontSize: 14, fontWeight: '700', color: '#222' },
  menuItemsSubtitle: { fontSize: 12, color: '#999', marginTop: 2 },
  menuItemsArrow: { fontSize: 18, color: '#4CAF50', fontWeight: '600' },

  warningBox: { backgroundColor: '#FFF3E0', marginHorizontal: 16, marginTop: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderLeftWidth: 4, borderLeftColor: '#E65100', flexDirection: 'row', alignItems: 'center', gap: 10 },
  warningIcon: { fontSize: 20 },
  warningText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#E65100' },

  section: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#222' },
  buttonGroup: { flexDirection: 'row', gap: 8 },
  addBtn: { backgroundColor: '#4CAF50', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  addBtnDisabled: { opacity: 0.5 },
  addBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  emptyList: { alignItems: 'center', paddingVertical: 40 },
  emptyListText: { fontSize: 16, fontWeight: '600', color: '#222' },
  emptyListSubtext: { fontSize: 12, color: '#999', marginTop: 4 },

  emptyBox: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#222' },
  emptyBody: { fontSize: 14, color: '#666', textAlign: 'center' },
  claimBtn: { backgroundColor: '#4CAF50', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, marginTop: 12 },
  claimBtnText: { color: '#fff', fontWeight: '600' },

  couponTableSection: { paddingHorizontal: 16, paddingTop: 8 },
  table: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 2,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#FAFAFA',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  tableHeaderCell: { fontSize: 11, fontWeight: '700', color: '#999', textTransform: 'uppercase' },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  tableCell: { fontSize: 13, color: '#444' },
  tableCodeText: { fontWeight: '700', color: '#222' },
  tableCodeCol: { flex: 1.4 },
  tableUsedCol: { flex: 1, textAlign: 'center' },
  tableExpiresCol: { flex: 1.2, textAlign: 'right' },
});
