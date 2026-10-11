import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Alert } from '../../../src/utils/alert';
import { useFocusEffect } from 'expo-router';
import { getNonFranchiseRestaurants, NonFranchiseRestaurantRow } from '../../../src/api/reports';
import { SelectableRestaurantList } from '../../../src/components/common/SelectableRestaurantList';
import { IconText } from '../../../src/components/common/AppIcon';

export default function AdminNonFranchiseReport() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<NonFranchiseRestaurantRow[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  async function loadData() {
    setLoading(true);
    try {
      setRows(await getNonFranchiseRestaurants());
    } catch (error: any) {
      console.error('[admin-non-franchise-report] Load error:', error);
      Alert.alert('Error', error.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#E65100" />
      </View>
    );
  }

  return (
    <SelectableRestaurantList
      rows={rows}
      accent="#E65100"
      searchPlaceholder="Search name, city or address…"
      emptyText="Every cached restaurant is a franchise"
      onDeleted={loadData}
      header={
        <View>
          <IconText style={styles.title} emoji="🏠">Non-Franchise Restaurants</IconText>
          <Text style={styles.subtitle}>
            Cached restaurants that did not match the Franchise Lookup, so the consumer app only shows
            menu items the restaurant confirmed.
          </Text>
          <View style={styles.countBox}>
            <Text style={styles.countNumber}>{rows.length}</Text>
            <Text style={styles.countLabel}>Non-franchise restaurants in cache</Text>
          </View>
        </View>
      }
      renderExtra={(item) =>
        item.cuisine_types?.length ? (
          <Text style={styles.rowTypes} numberOfLines={1}>
            {item.cuisine_types.slice(0, 4).map((t) => t.replace(/_/g, ' ')).join(' · ')}
          </Text>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f6f6f6' },
  title: { fontSize: 20, fontWeight: '800', color: '#E65100', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 16 },

  countBox: { backgroundColor: '#FFF3E0', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  countNumber: { fontSize: 24, fontWeight: '800', color: '#222' },
  countLabel: { fontSize: 11, fontWeight: '700', color: '#666', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2 },

  rowTypes: { fontSize: 11, color: '#E65100', fontWeight: '600', textTransform: 'capitalize' },
});
