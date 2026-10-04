import { useState, useCallback, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Alert } from '../../src/utils/alert';
import { getRestaurantMenu, AdminMenuItem } from '../../src/api/menuAdmin';

type ItemFilter = 'all' | 'verified' | 'unverified' | 'out_of_stock';

function fmt(value: number | null, unit = '') {
  return value === null || value === undefined ? '—' : `${Math.round(Number(value) * 10) / 10}${unit}`;
}

// Read-only view of one restaurant's current menu (menu_items, matched by
// restaurant name — migration 065). Reached from Menu Management.
export default function AdminMenuViewScreen() {
  const router = useRouter();
  const { name } = useLocalSearchParams<{ name: string }>();
  const [items, setItems] = useState<AdminMenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ItemFilter>('all');

  useFocusEffect(
    useCallback(() => {
      loadMenu();
    }, [name])
  );

  async function loadMenu() {
    if (!name) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setItems(await getRestaurantMenu(name));
    } catch (error: any) {
      console.error('[admin-menu-view] Load error:', error);
      Alert.alert('Error', error.message || 'Failed to load menu');
    } finally {
      setLoading(false);
    }
  }

  const verifiedCount = items.filter((i) => i.is_verified).length;
  const outOfStockCount = items.filter((i) => i.is_out_of_stock).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (filter === 'verified' && !i.is_verified) return false;
      if (filter === 'unverified' && i.is_verified) return false;
      if (filter === 'out_of_stock' && !i.is_out_of_stock) return false;
      return !q || i.name.toLowerCase().includes(q);
    });
  }, [items, search, filter]);

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
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.item_id}
          contentContainerStyle={styles.content}
          initialNumToRender={20}
          ListHeaderComponent={
            <View>
              <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                <Text style={styles.backBtnText}>← Back to Menu Management</Text>
              </TouchableOpacity>
              <Text style={styles.title}>{name}</Text>
              <Text style={styles.subtitle}>Current menu items (read-only)</Text>

              <View style={styles.statsRow}>
                <View style={styles.statBox}>
                  <Text style={styles.statNumber}>{items.length}</Text>
                  <Text style={styles.statLabel}>Total</Text>
                </View>
                <View style={[styles.statBox, { backgroundColor: '#E3F2FD' }]}>
                  <Text style={styles.statNumber}>{verifiedCount}</Text>
                  <Text style={styles.statLabel}>Verified</Text>
                </View>
                <View style={[styles.statBox, { backgroundColor: '#FFF3E0' }]}>
                  <Text style={styles.statNumber}>{items.length - verifiedCount}</Text>
                  <Text style={styles.statLabel}>Unverified</Text>
                </View>
                <View style={[styles.statBox, { backgroundColor: '#FFEBEE' }]}>
                  <Text style={styles.statNumber}>{outOfStockCount}</Text>
                  <Text style={styles.statLabel}>Out of stock</Text>
                </View>
              </View>

              <TextInput
                style={styles.search}
                placeholder="Search items…"
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
              />
              <View style={styles.filterRow}>
                {([
                  ['all', 'All'],
                  ['verified', 'Verified'],
                  ['unverified', 'Unverified'],
                  ['out_of_stock', 'Out of stock'],
                ] as [ItemFilter, string][]).map(([key, label]) => (
                  <TouchableOpacity
                    key={key}
                    style={[styles.filterChip, filter === key && styles.filterChipActive]}
                    onPress={() => setFilter(key)}
                  >
                    <Text style={[styles.filterChipText, filter === key && styles.filterChipTextActive]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.rangeText}>{filtered.length} of {items.length} items</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowTop}>
                <Text style={styles.itemName}>{item.name}</Text>
                <View style={[styles.badge, item.is_verified ? styles.badgeVerified : styles.badgeUnverified]}>
                  <Text style={[styles.badgeText, item.is_verified ? styles.badgeVerifiedText : styles.badgeUnverifiedText]}>
                    {item.is_verified ? '✓ Verified' : '⚠ Unverified'}
                  </Text>
                </View>
                {item.is_out_of_stock && (
                  <View style={[styles.badge, styles.badgeOut]}>
                    <Text style={[styles.badgeText, styles.badgeOutText]}>Out of stock</Text>
                  </View>
                )}
              </View>
              <Text style={styles.nutrition}>
                {fmt(item.calories)} cal · P {fmt(item.protein_g, 'g')} · C {fmt(item.total_carbs_g, 'g')} · F {fmt(item.total_fat_g, 'g')} · Sat {fmt(item.saturated_fat_g, 'g')} · Na {fmt(item.sodium_mg, 'mg')}
              </Text>
              {item.nutrition_source === 'owner_provided' && (
                <Text style={styles.source}>Nutrition provided by owner</Text>
              )}
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {items.length === 0 ? 'No menu items for this restaurant yet' : 'No items match'}
              </Text>
            </View>
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f6f6f6' },
  content: { padding: 16, paddingBottom: 32 },

  backBtn: { alignSelf: 'flex-start', paddingVertical: 6, marginBottom: 8 },
  backBtnText: { color: '#1565C0', fontWeight: '700', fontSize: 13 },
  title: { fontSize: 22, fontWeight: '800', color: '#222' },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 14 },

  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  statBox: { flex: 1, minWidth: 80, backgroundColor: '#fff', borderRadius: 12, paddingVertical: 12, alignItems: 'center', elevation: 1 },
  statNumber: { fontSize: 20, fontWeight: '800', color: '#222' },
  statLabel: { fontSize: 10, fontWeight: '700', color: '#666', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2 },

  search: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#222', marginBottom: 10 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#fff' },
  filterChipActive: { backgroundColor: '#1565C0' },
  filterChipText: { fontSize: 12, fontWeight: '700', color: '#555' },
  filterChipTextActive: { color: '#fff' },
  rangeText: { fontSize: 12, color: '#888', marginBottom: 8 },

  row: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, elevation: 1, gap: 4 },
  rowTop: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  itemName: { fontSize: 14, fontWeight: '700', color: '#222' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 10, fontWeight: '800' },
  badgeVerified: { backgroundColor: '#E3F2FD' },
  badgeVerifiedText: { color: '#1565C0' },
  badgeUnverified: { backgroundColor: '#FFF3E0' },
  badgeUnverifiedText: { color: '#E65100' },
  badgeOut: { backgroundColor: '#FFEBEE' },
  badgeOutText: { color: '#c62828' },
  nutrition: { fontSize: 12, color: '#666' },
  source: { fontSize: 11, color: '#1565C0', fontWeight: '600' },

  emptyContainer: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#999' },
});
