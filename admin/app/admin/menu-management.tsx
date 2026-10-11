import { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Alert } from '../../src/utils/alert';
import { getRestaurantsWithMenuCounts, RestaurantMenuSummary } from '../../src/api/menuAdmin';
import { IconText } from '../../src/components/common/AppIcon';

const PAGE_SIZE = 50;

type SourceFilter = 'all' | 'claimed' | 'cached';

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: '#FFF3E0', text: '#E65100', label: 'Pending' },
  approved: { bg: '#E3F2FD', text: '#1565C0', label: 'Approved' },
  rejected: { bg: '#FFEBEE', text: '#c62828', label: 'Rejected' },
  closed: { bg: '#e53e3e', text: '#fff', label: 'Closed' },
};

// Admin's Menu Management: every owner-claimed AND cached restaurant, with how
// many menu items each has. "View Menu" opens a read-only list of the current
// items for any of them; "Update Menu" (photo / pasted text) is only offered
// for claimed restaurants, since those tools need an owner. Items are keyed by
// restaurant NAME for franchises (listed once, one shared menu) and by place for
// independents (one row per location, each with its own menu — migration 108).
export default function AdminMenuManagementScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<RestaurantMenuSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<SourceFilter>('all');
  const [page, setPage] = useState(0);

  useFocusEffect(
    useCallback(() => {
      loadRestaurants();
    }, [])
  );

  async function loadRestaurants() {
    try {
      setRows(await getRestaurantsWithMenuCounts());
    } catch (error: any) {
      console.error('[admin-menu-management] Load error:', error);
      Alert.alert('Error', error.message || 'Failed to load restaurants');
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== 'all' && r.source !== filter) return false;
      if (!query) return true;
      return (
        r.restaurant_name.toLowerCase().includes(query) ||
        (r.address ?? '').toLowerCase().includes(query) ||
        (r.owner_business_name ?? '').toLowerCase().includes(query) ||
        (r.owner_email ?? '').toLowerCase().includes(query)
      );
    });
  }, [rows, searchQuery, filter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const firstShown = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const lastShown = Math.min((safePage + 1) * PAGE_SIZE, filtered.length);

  // Independents work on one location (its place ID); franchises on the one menu shared by name.
  function menuParams(item: RestaurantMenuSummary) {
    const params: Record<string, string> = { name: item.restaurant_name };
    if (!item.is_franchise && item.place_id) {
      params.placeId = item.place_id;
      if (item.address) params.address = item.address;
    }
    return params;
  }

  function viewMenu(item: RestaurantMenuSummary) {
    router.push({ pathname: '/admin/menu-view', params: menuParams(item) } as any);
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
    <View style={styles.pageWrapper}>
      <View style={styles.header}>
        <Text style={styles.title}>Menu Management</Text>
        <Text style={styles.count}>{rows.length}</Text>
      </View>
      <Text style={styles.headerSubtitle}>
        View the current menu of any restaurant. Claimed restaurants can also be updated from a photo or pasted text.
      </Text>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, address, owner, or login email..."
          placeholderTextColor="#999"
          value={searchQuery}
          onChangeText={(text) => { setSearchQuery(text); setPage(0); }}
        />
        <View style={styles.filterRow}>
          {(['all', 'claimed', 'cached'] as SourceFilter[]).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterChip, filter === f && styles.filterChipActive]}
              onPress={() => { setFilter(f); setPage(0); }}
            >
              <Text style={[styles.filterChipText, filter === f && styles.filterChipTextActive]}>
                {f === 'all' ? 'All' : f === 'claimed' ? 'Claimed' : 'Cached'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <Text style={styles.rangeText}>
        {filtered.length === 0 ? '0 results' : `Showing ${firstShown}–${lastShown} of ${filtered.length}`}
      </Text>

      {filtered.length === 0 ? (
        <View style={styles.emptyContainer}>
          <IconText style={styles.emptyIcon} emoji="🍽️" />
          <Text style={styles.emptyText}>No restaurants found</Text>
        </View>
      ) : (
        <FlatList
          data={pageRows}
          keyExtractor={(item) => `${item.source}-${item.restaurant_id ?? item.place_id ?? item.restaurant_name}`}
          renderItem={({ item }) => {
            const claimed = item.source === 'claimed';
            const statusInfo = item.status ? STATUS_COLORS[item.status] : undefined;
            return (
              <TouchableOpacity style={styles.restaurantRow} onPress={() => viewMenu(item)}>
                <View style={styles.restaurantInfo}>
                  <View style={styles.nameRow}>
                    <Text style={styles.restaurantName}>{item.restaurant_name}</Text>
                    <View style={[styles.sourceBadge, claimed ? styles.sourceClaimed : styles.sourceCached]}>
                      <Text style={[styles.sourceBadgeText, claimed ? styles.sourceClaimedText : styles.sourceCachedText]}>
                        {claimed ? 'Claimed' : 'Cached'}
                      </Text>
                    </View>
                    {claimed && statusInfo && (
                      <View style={[styles.sourceBadge, { backgroundColor: statusInfo.bg }]}>
                        <Text style={[styles.sourceBadgeText, { color: statusInfo.text }]}>{statusInfo.label}</Text>
                      </View>
                    )}
                  </View>
                  {!!item.address && <Text style={styles.restaurantAddress}>{item.address}</Text>}
                  {claimed ? (
                    <>
                      <Text style={styles.restaurantOwner}>Owner: {item.owner_business_name || 'Unknown'}</Text>
                      {!!item.owner_email && <Text style={styles.ownerEmail}>Login: {item.owner_email}</Text>}
                    </>
                  ) : (
                    <>
                      {item.location_count > 1 && (
                        <Text style={styles.restaurantOwner}>{item.location_count} cached locations</Text>
                      )}
                      {item.shares_menu_with_claimed && (
                        <Text style={styles.sharedNote}>Menu shared with a claimed location of the same name</Text>
                      )}
                    </>
                  )}
                  <Text style={styles.itemCounts}>
                    {item.total_items === 0
                      ? 'No menu items'
                      : `${item.total_items} items · ${item.verified_items} verified · ${item.unverified_items} unverified`}
                  </Text>
                </View>
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.viewBtn} onPress={() => viewMenu(item)}>
                    <IconText style={styles.viewBtnText} numberOfLines={1} emoji="👁">View Menu</IconText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.manualBtn}
                    onPress={() => router.push({ pathname: '/admin/menu-edit', params: menuParams(item) } as any)}
                  >
                    <IconText style={styles.manualBtnText} numberOfLines={1} emoji="📝">Manual Edit</IconText>
                  </TouchableOpacity>
                  {claimed && item.restaurant_id && (
                    <TouchableOpacity
                      style={styles.updateBtn}
                      onPress={() => router.push(`/admin/menu-management/${item.restaurant_id}` as any)}
                    >
                      <IconText style={styles.updateBtnText} numberOfLines={1} emoji="🔄">Update Menu</IconText>
                    </TouchableOpacity>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
          contentContainerStyle={styles.list}
          ListFooterComponent={
            pageCount > 1 ? (
              <View style={styles.pager}>
                <TouchableOpacity
                  style={[styles.pagerBtn, safePage === 0 && styles.btnDisabled]}
                  onPress={() => setPage(safePage - 1)}
                  disabled={safePage === 0}
                >
                  <Text style={styles.pagerBtnText}>‹ Prev</Text>
                </TouchableOpacity>
                <Text style={styles.pagerLabel}>Page {safePage + 1} of {pageCount}</Text>
                <TouchableOpacity
                  style={[styles.pagerBtn, safePage >= pageCount - 1 && styles.btnDisabled]}
                  onPress={() => setPage(safePage + 1)}
                  disabled={safePage >= pageCount - 1}
                >
                  <Text style={styles.pagerBtnText}>Next ›</Text>
                </TouchableOpacity>
              </View>
            ) : null
          }
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
  header: { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: '#222' },
  count: { fontSize: 18, fontWeight: '800', color: '#1565C0', backgroundColor: '#E3F2FD', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  headerSubtitle: { fontSize: 13, color: '#666', backgroundColor: '#fff', paddingHorizontal: 16, paddingBottom: 12, elevation: 2 },

  searchContainer: { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 10 },
  searchInput: { paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#222', backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#B0BEC5', borderRadius: 8 },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#f0f0f0' },
  filterChipActive: { backgroundColor: '#1565C0' },
  filterChipText: { fontSize: 12, fontWeight: '700', color: '#555' },
  filterChipTextActive: { color: '#fff' },
  rangeText: { fontSize: 12, color: '#888', paddingHorizontal: 16, paddingTop: 10 },

  list: { paddingHorizontal: 16, paddingVertical: 12 },
  restaurantRow: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, elevation: 1, borderWidth: 1, borderColor: '#CFD8DC' },
  restaurantInfo: {},
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 2 },
  restaurantName: { fontSize: 15, fontWeight: '700', color: '#222' },
  sourceBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  sourceBadgeText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  sourceClaimed: { backgroundColor: '#E8F5E9' },
  sourceClaimedText: { color: '#2e7d32' },
  sourceCached: { backgroundColor: '#ECEFF1' },
  sourceCachedText: { color: '#546E7A' },
  restaurantAddress: { fontSize: 12, color: '#666', marginBottom: 4 },
  restaurantOwner: { fontSize: 12, color: '#1565C0', fontWeight: '600' },
  ownerEmail: { fontSize: 12, color: '#555', fontWeight: '600', marginTop: 2 },
  sharedNote: { fontSize: 11, color: '#E65100', fontWeight: '600', marginTop: 2 },
  itemCounts: { fontSize: 12, color: '#888', marginTop: 4, fontWeight: '600' },
  // View Menu, Manual Edit and Update Menu share one line, equal width.
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  viewBtn: { flex: 1, backgroundColor: '#E3F2FD', borderWidth: 1.5, borderColor: '#1565C0', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 8, alignItems: 'center' },
  viewBtnText: { color: '#1565C0', fontWeight: '700', fontSize: 12 },
  manualBtn: { flex: 1, backgroundColor: '#FFF3E0', borderWidth: 1.5, borderColor: '#E65100', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 8, alignItems: 'center' },
  manualBtnText: { color: '#E65100', fontWeight: '700', fontSize: 12 },
  updateBtn: { flex: 1, backgroundColor: '#ECEFF1', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 8, alignItems: 'center' },
  updateBtnText: { color: '#222', fontWeight: '700', fontSize: 12 },

  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, paddingTop: 8 },
  pagerBtn: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9, elevation: 1 },
  pagerBtnText: { fontSize: 13, fontWeight: '700', color: '#222' },
  pagerLabel: { fontSize: 13, color: '#666', fontWeight: '600' },
  btnDisabled: { opacity: 0.4 },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '700', color: '#222' },
});
