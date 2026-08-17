import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, Alert, TextInput, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/api/supabase';

type CouponStatus = 'active' | 'expired' | 'deleted' | 'all';

interface Coupon {
  id: string;
  coupon_code: string;
  restaurant_id: string;
  restaurant_name?: string;
  coupon_type: string;
  discount_value: number;
  is_active: boolean;
  is_deleted: boolean;
  expiry_date: string;
  times_used: number;
  usage_limit?: number;
  created_at: string;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<CouponStatus>('active');

  useEffect(() => {
    loadAllCoupons();
  }, []);

  async function loadAllCoupons() {
    setLoading(true);
    try {
      console.log('[admin-dashboard] Loading all coupons');
      const { data, error } = await supabase
        .from('coupons')
        .select(`
          id, coupon_code, restaurant_id, coupon_type, discount_value,
          is_active, is_deleted, expiry_date, times_used, usage_limit, created_at,
          restaurants:restaurant_id(name)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formattedCoupons = (data || []).map((c: any) => ({
        ...c,
        restaurant_name: c.restaurants?.name || 'Unknown',
      }));

      setCoupons(formattedCoupons);
      console.log('[admin-dashboard] Loaded', formattedCoupons.length, 'coupons');
    } catch (error: any) {
      console.error('[admin-dashboard] Load error:', error);
      Alert.alert('Error', 'Failed to load coupons');
    } finally {
      setLoading(false);
    }
  }

  function getStatus(coupon: Coupon): string {
    if (coupon.is_deleted) return 'deleted';
    if (new Date(coupon.expiry_date) < new Date()) return 'expired';
    return coupon.is_active ? 'active' : 'inactive';
  }

  const filteredCoupons = coupons.filter(coupon => {
    const status = getStatus(coupon);
    const matchesTab = activeTab === 'all' || status === activeTab;
    const matchesSearch =
      coupon.coupon_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      coupon.restaurant_name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesTab && matchesSearch;
  });

  const stats = {
    active: coupons.filter(c => !c.is_deleted && c.is_active && new Date(c.expiry_date) > new Date()).length,
    expired: coupons.filter(c => !c.is_deleted && new Date(c.expiry_date) <= new Date()).length,
    deleted: coupons.filter(c => c.is_deleted).length,
    total: coupons.length,
  };

  async function handleRestore(couponId: string) {
    try {
      const { error } = await supabase
        .from('coupons')
        .update({ is_deleted: false, deleted_at: null })
        .eq('id', couponId);

      if (error) throw error;
      console.log('[admin-dashboard] Coupon restored');
      loadAllCoupons();
      Alert.alert('Success', 'Coupon restored');
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  }

  async function handlePurge(couponId: string) {
    confirm('Permanently delete this coupon? This cannot be undone.') && (async () => {
      try {
        const { error } = await supabase
          .from('coupons')
          .delete()
          .eq('id', couponId);

        if (error) throw error;
        console.log('[admin-dashboard] Coupon purged');
        loadAllCoupons();
        Alert.alert('Success', 'Coupon permanently deleted');
      } catch (error: any) {
        Alert.alert('Error', error.message);
      }
    })();
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Stat Cards */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statsRow}>
        <View style={[styles.statCard, styles.statActive]}>
          <Text style={styles.statNumber}>{stats.active}</Text>
          <Text style={styles.statLabel}>Active</Text>
        </View>
        <View style={[styles.statCard, styles.statExpired]}>
          <Text style={styles.statNumber}>{stats.expired}</Text>
          <Text style={styles.statLabel}>Expired</Text>
        </View>
        <View style={[styles.statCard, styles.statDeleted]}>
          <Text style={styles.statNumber}>{stats.deleted}</Text>
          <Text style={styles.statLabel}>Deleted</Text>
        </View>
        <View style={[styles.statCard, styles.statTotal]}>
          <Text style={styles.statNumber}>{stats.total}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
      </ScrollView>

      {/* Tabs */}
      <View style={styles.tabsContainer}>
        {(['active', 'expired', 'deleted', 'all'] as CouponStatus[]).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by code or restaurant..."
          placeholderTextColor="#999"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Coupons List */}
      {filteredCoupons.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyText}>No coupons found</Text>
        </View>
      ) : (
        <FlatList
          data={filteredCoupons}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const status = getStatus(item);
            const statusColor = {
              active: '#4CAF50',
              expired: '#FF9800',
              deleted: '#999',
              inactive: '#9C27B0',
            }[status] || '#999';

            return (
              <View style={[styles.couponRow, { borderLeftColor: statusColor }]}>
                <View style={styles.couponInfo}>
                  <Text style={styles.couponCode}>{item.coupon_code}</Text>
                  <Text style={styles.couponRestaurant}>{item.restaurant_name}</Text>
                  <View style={styles.couponDetails}>
                    <Text style={styles.detailText}>
                      {item.coupon_type.includes('item') ? 'Item-specific' : 'Any item'} • {item.discount_value}
                      {item.coupon_type.includes('percent') ? '%' : '$'} off
                    </Text>
                    <Text style={styles.detailText}>
                      Used: {item.times_used}{item.usage_limit ? `/${item.usage_limit}` : ''}
                    </Text>
                    <Text style={styles.detailText}>
                      Expires: {new Date(item.expiry_date).toLocaleDateString()}
                    </Text>
                  </View>
                </View>

                <View style={styles.statusBadge}>
                  <Text style={[styles.statusText, { color: statusColor }]}>
                    {status.toUpperCase()}
                  </Text>
                </View>

                <View style={styles.actions}>
                  {item.is_deleted ? (
                    <TouchableOpacity
                      style={styles.actionBtn}
                      onPress={() => handleRestore(item.id)}
                    >
                      <Text style={styles.actionBtnText}>↩️ Restore</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.purgeBtn]}
                    onPress={() => handlePurge(item.id)}
                  >
                    <Text style={styles.purgeBtnText}>🗑️ Purge</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  statsRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  statCard: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, minWidth: 100, alignItems: 'center' },
  statActive: { backgroundColor: '#E8F5E9' },
  statExpired: { backgroundColor: '#FFF3E0' },
  statDeleted: { backgroundColor: '#F5F5F5', borderWidth: 1, borderColor: '#ddd' },
  statTotal: { backgroundColor: '#E3F2FD' },
  statNumber: { fontSize: 24, fontWeight: '800', marginBottom: 4 },
  statLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },

  tabsContainer: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#e0e0e0', backgroundColor: '#fff' },
  tab: { paddingHorizontal: 16, paddingVertical: 10, marginRight: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#1565C0' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#999' },
  tabTextActive: { color: '#1565C0' },

  searchContainer: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff' },
  searchInput: { backgroundColor: '#f5f5f5', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#222' },

  list: { paddingHorizontal: 16, paddingVertical: 12 },
  couponRow: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  couponInfo: { flex: 1 },
  couponCode: { fontSize: 14, fontWeight: '800', color: '#222', marginBottom: 2 },
  couponRestaurant: { fontSize: 12, color: '#666', marginBottom: 6 },
  couponDetails: { gap: 4 },
  detailText: { fontSize: 11, color: '#999' },

  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: '#f5f5f5' },
  statusText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  actions: { marginLeft: 10, gap: 6 },
  actionBtn: { backgroundColor: '#E3F2FD', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6 },
  actionBtnText: { fontSize: 11, fontWeight: '700', color: '#1565C0' },
  purgeBtn: { backgroundColor: '#FFEBEE' },
  purgeBtnText: { fontSize: 11, fontWeight: '700', color: '#e53e3e' },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#222' },
});
