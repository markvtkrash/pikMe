import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Alert } from '../../../src/utils/alert';
import { useFocusEffect } from 'expo-router';
import { getFranchiseRestaurants, FranchiseRestaurantRow } from '../../../src/api/reports';
import { SelectableRestaurantList } from '../../../src/components/common/SelectableRestaurantList';
import { IconText } from '../../../src/components/common/AppIcon';

export default function AdminFranchiseMatchesReport() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FranchiseRestaurantRow[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  async function loadData() {
    setLoading(true);
    try {
      setRows(await getFranchiseRestaurants());
    } catch (error: any) {
      console.error('[admin-franchise-matches-report] Load error:', error);
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
    <SelectableRestaurantList
      rows={rows}
      accent="#1565C0"
      searchPlaceholder="Search name, franchise, city or address…"
      extraSearchText={(r) => r.matched_franchise}
      emptyText="No cached restaurants match a franchise yet"
      onDeleted={loadData}
      header={
        <View>
          <IconText style={styles.title} emoji="🍔">Franchise Matches</IconText>
          <Text style={styles.subtitle}>
            Cached restaurants that match an active entry on the Franchise Lookup, so the consumer app
            treats them as franchises.
          </Text>
          <View style={styles.countBox}>
            <Text style={styles.countNumber}>{rows.length}</Text>
            <Text style={styles.countLabel}>Franchise restaurants in cache</Text>
          </View>
        </View>
      }
      renderExtra={(item) => (
        <View style={styles.matchRow}>
          <View style={styles.matchBadge}>
            <Text style={styles.matchBadgeText}>Matched: {item.matched_franchise}</Text>
          </View>
          {!!item.franchise_category && <Text style={styles.rowCategory}>{item.franchise_category}</Text>}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f6f6f6' },
  title: { fontSize: 20, fontWeight: '800', color: '#1565C0', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 16 },

  countBox: { backgroundColor: '#E3F2FD', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  countNumber: { fontSize: 24, fontWeight: '800', color: '#222' },
  countLabel: { fontSize: 11, fontWeight: '700', color: '#666', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2 },

  matchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  matchBadge: { backgroundColor: '#E3F2FD', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  matchBadgeText: { fontSize: 11, fontWeight: '700', color: '#1565C0' },
  rowCategory: { fontSize: 11, color: '#999', fontWeight: '600' },
});
