import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  getMenuHealthSnapshot, getMenuHealthByRestaurant, getRestaurantsNoMenuItems,
  MenuHealthSnapshot, MenuHealthByRestaurantRow, RestaurantNoMenuItems,
} from '../../../src/api/reports';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', approved: 'Approved', rejected: 'Rejected', closed: 'Closed',
};

function healthColor(pct: number): string {
  if (pct >= 80) return '#2e7d32';
  if (pct >= 40) return '#E65100';
  return '#c62828';
}
function healthBg(pct: number): string {
  if (pct >= 80) return '#E8F5E9';
  if (pct >= 40) return '#FFF3E0';
  return '#FFEBEE';
}

export default function AdminMenuHealthReport() {
  const [loading, setLoading] = useState(true);
  const [menuHealth, setMenuHealth] = useState<MenuHealthSnapshot | null>(null);
  const [menuHealthByRestaurant, setMenuHealthByRestaurant] = useState<MenuHealthByRestaurantRow[]>([]);
  const [noMenuItems, setNoMenuItems] = useState<RestaurantNoMenuItems[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  async function loadData() {
    setLoading(true);
    try {
      const [menuStat, menuByRestaurant, noItems] = await Promise.all([
        getMenuHealthSnapshot(),
        getMenuHealthByRestaurant(),
        getRestaurantsNoMenuItems(),
      ]);
      setMenuHealth(menuStat);
      setMenuHealthByRestaurant(menuByRestaurant);
      setNoMenuItems(noItems);
    } catch (error: any) {
      console.error('[admin-menu-health-report] Load error:', error);
      Alert.alert('Error', error.message || 'Failed to load report');
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
      <Text style={styles.title}>🍽️ Menu Data Health</Text>
      <Text style={styles.subtitle}>Verified vs unverified items, and gaps by restaurant</Text>

      <View style={styles.snapshotRow}>
        <View style={[styles.snapshotBox, styles.snapshotBoxActive]}>
          <Text style={styles.snapshotNumber}>{menuHealth?.verified_count ?? 0}</Text>
          <Text style={styles.snapshotLabel}>Verified Items</Text>
        </View>
        <View style={styles.snapshotBox}>
          <Text style={styles.snapshotNumber}>{menuHealth?.unverified_count ?? 0}</Text>
          <Text style={styles.snapshotLabel}>Unverified Items</Text>
        </View>
        <View style={[styles.snapshotBox, styles.snapshotBoxOrphaned]}>
          <Text style={styles.snapshotNumber}>{menuHealth?.restaurants_with_no_items_count ?? 0}</Text>
          <Text style={styles.snapshotLabel}>No Menu Items</Text>
        </View>
      </View>

      <Text style={styles.subsectionTitle}>By restaurant</Text>
      <View style={styles.card}>
        {menuHealthByRestaurant.length === 0 ? (
          <Text style={styles.emptyText}>No menu items on any claimed restaurant yet</Text>
        ) : (
          <>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Restaurant</Text>
              <Text style={styles.tableHeaderCell}>Verified</Text>
              <Text style={styles.tableHeaderCell}>Unverified</Text>
              <Text style={styles.tableHeaderCell}>% Verified</Text>
            </View>
            {menuHealthByRestaurant.map((r) => {
              const total = r.verified_count + r.unverified_count;
              const pct = total > 0 ? Math.round((r.verified_count / total) * 100) : 0;
              return (
                <View
                  key={r.restaurant_id}
                  style={[styles.tableRow, styles.healthRow, { borderLeftColor: healthColor(pct) }]}
                >
                  <Text style={[styles.tableCell, { flex: 2 }]}>{r.restaurant_name}</Text>
                  <Text style={[styles.tableCell, styles.verifiedCell]}>{r.verified_count}</Text>
                  <Text style={[styles.tableCell, styles.unverifiedCell]}>{r.unverified_count}</Text>
                  <View style={styles.pctCol}>
                    <View style={[styles.pctBadge, { backgroundColor: healthBg(pct) }]}>
                      <Text style={[styles.pctBadgeText, { color: healthColor(pct) }]}>{pct}%</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </>
        )}
      </View>

      <Text style={styles.subsectionTitle}>No menu items at all</Text>
      <View style={styles.card}>
        {noMenuItems.length === 0 ? (
          <Text style={styles.emptyText}>Every restaurant has at least one menu item</Text>
        ) : (
          noMenuItems.map((r) => (
            <View key={r.restaurant_id} style={styles.tableRow}>
              <Text style={[styles.tableCell, { flex: 2 }]}>{r.restaurant_name}</Text>
              <Text style={styles.tableCell}>{STATUS_LABELS[r.status] ?? r.status}</Text>
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
  content: { padding: 16, width: '100%', maxWidth: 900, alignSelf: 'center', paddingBottom: 32 },
  title: { fontSize: 20, fontWeight: '800', color: '#8E24AA', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 16 },

  subsectionTitle: { fontSize: 12, fontWeight: '700', color: '#888', paddingTop: 16, paddingBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, elevation: 1 },
  emptyText: { fontSize: 13, color: '#999', fontStyle: 'italic' },

  snapshotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  snapshotBox: {
    flex: 1, minWidth: 90, backgroundColor: '#fff', borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', elevation: 1,
  },
  snapshotBoxActive: { backgroundColor: '#E8F5E9' },
  snapshotBoxOrphaned: { backgroundColor: '#FFF3E0' },
  snapshotNumber: { fontSize: 22, fontWeight: '800', color: '#222' },
  snapshotLabel: { fontSize: 11, fontWeight: '700', color: '#666', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2 },

  tableHeaderRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 8, marginBottom: 4 },
  tableHeaderCell: { flex: 1, fontSize: 11, fontWeight: '700', color: '#999', textTransform: 'uppercase' },
  tableRow: { flexDirection: 'row', paddingVertical: 6 },
  tableCell: { flex: 1, fontSize: 13, color: '#333', fontWeight: '600' },

  healthRow: { alignItems: 'center', borderLeftWidth: 3, paddingLeft: 8 },
  verifiedCell: { color: '#2e7d32' },
  unverifiedCell: { color: '#c62828' },
  pctCol: { flex: 1 },
  pctBadge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  pctBadgeText: { fontSize: 12, fontWeight: '800' },
});
