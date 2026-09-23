import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getRedemptionsOverTime, RedemptionsOverTimeRow } from '../../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../../src/store/restaurantOwnerStore';
import { FavoriteHeart } from '../../../src/components/common/FavoriteHeart';
import { useFavoritePages } from '../../../src/hooks/useFavoritePages';

function formatWeek(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function RedemptionsOverTimeReport() {
  const { restaurant } = useRestaurantOwnerStore();
  const { favorites, toggleFavorite } = useFavoritePages();
  const [rows, setRows] = useState<RedemptionsOverTimeRow[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [restaurant])
  );

  async function loadData() {
    if (!restaurant) {
      setLoading(false);
      return;
    }
    try {
      const data = await getRedemptionsOverTime(restaurant.id);
      setRows(data);
    } catch (error) {
      console.error('[redemptions-over-time-report] Failed to load:', error);
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

  const maxCount = Math.max(1, ...rows.map((r) => r.redemption_count));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>📈 Redemptions Over Time</Text>
        <FavoriteHeart
          active={favorites.has('report-redemptions-over-time')}
          onPress={() => toggleFavorite('report-redemptions-over-time')}
          size="large"
        />
      </View>
      <Text style={styles.subtitle}>How often your coupons actually get used, by week</Text>

      <View style={styles.card}>
        {rows.length === 0 ? (
          <View style={styles.emptyList}>
            <Text style={styles.emptyListText}>No redemptions yet</Text>
            <Text style={styles.emptyListSubtext}>They'll show up here once customers activate a coupon</Text>
          </View>
        ) : (
          rows.slice(0, 12).map((row) => (
            <View key={row.week_start} style={styles.row}>
              <Text style={styles.weekLabel}>{formatWeek(row.week_start)}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${(row.redemption_count / maxCount) * 100}%` }]} />
              </View>
              <Text style={styles.countLabel}>{row.redemption_count}</Text>
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
  content: { padding: 16, width: '100%', maxWidth: 900, alignSelf: 'center' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: '#1565C0', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 16 },

  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, elevation: 1 },
  emptyList: { alignItems: 'center', paddingVertical: 40 },
  emptyListText: { fontSize: 16, fontWeight: '600', color: '#222' },
  emptyListSubtext: { fontSize: 12, color: '#999', marginTop: 4, textAlign: 'center' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  weekLabel: { width: 60, fontSize: 12, fontWeight: '700', color: '#666' },
  barTrack: { flex: 1, height: 10, backgroundColor: '#eee', borderRadius: 5, overflow: 'hidden' },
  barFill: { height: 10, backgroundColor: '#1565C0', borderRadius: 5 },
  countLabel: { width: 28, fontSize: 13, fontWeight: '800', color: '#222', textAlign: 'right' },
});
