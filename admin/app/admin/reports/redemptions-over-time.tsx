import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getRedemptionsOverTime, RedemptionsOverTimeRow } from '../../../src/api/reports';

function formatWeek(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function AdminRedemptionsOverTimeReport() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<RedemptionsOverTimeRow[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  async function loadData() {
    setLoading(true);
    try {
      const data = await getRedemptionsOverTime();
      setRows(data);
    } catch (error: any) {
      console.error('[admin-redemptions-over-time-report] Load error:', error);
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

  const maxCount = Math.max(1, ...rows.map((r) => r.redemption_count));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>📊 Redemptions Over Time</Text>
      <Text style={styles.subtitle}>Coupon activations across all restaurants, by week</Text>

      <View style={styles.card}>
        {rows.length === 0 ? (
          <Text style={styles.emptyText}>No redemptions yet</Text>
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
  title: { fontSize: 20, fontWeight: '800', color: '#2e7d32', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 16 },

  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, elevation: 1 },
  emptyText: { fontSize: 13, color: '#999', fontStyle: 'italic' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  weekLabel: { width: 60, fontSize: 12, fontWeight: '700', color: '#666' },
  barTrack: { flex: 1, height: 10, backgroundColor: '#eee', borderRadius: 5, overflow: 'hidden' },
  barFill: { height: 10, backgroundColor: '#2e7d32', borderRadius: 5 },
  countLabel: { width: 28, fontSize: 13, fontWeight: '800', color: '#222', textAlign: 'right' },
});
