import { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  getClaimsOverTime, getClaimApprovalTime, getRestaurantStatusSnapshot,
  ClaimsOverTimeRow, ClaimApprovalTime, RestaurantStatusRow,
} from '../../../src/api/reports';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', approved: 'Approved', rejected: 'Rejected', closed: 'Closed',
};
const STATUS_ORDER = ['pending', 'approved', 'rejected', 'closed'];

function formatWeek(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function RestaurantGrowthReport() {
  const [loading, setLoading] = useState(true);
  const [claimsOverTime, setClaimsOverTime] = useState<ClaimsOverTimeRow[]>([]);
  const [approvalTime, setApprovalTime] = useState<ClaimApprovalTime | null>(null);
  const [statusSnapshot, setStatusSnapshot] = useState<RestaurantStatusRow[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  async function loadData() {
    setLoading(true);
    try {
      const [claims, approval, statuses] = await Promise.all([
        getClaimsOverTime(),
        getClaimApprovalTime(),
        getRestaurantStatusSnapshot(),
      ]);
      setClaimsOverTime(claims);
      setApprovalTime(approval);
      setStatusSnapshot(statuses);
    } catch (error: any) {
      console.error('[restaurant-growth-report] Load error:', error);
      Alert.alert('Error', error.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }

  const claimsByWeek = useMemo(() => {
    const weeks = new Map<string, Record<string, number>>();
    for (const row of claimsOverTime) {
      if (!weeks.has(row.week_start)) weeks.set(row.week_start, {});
      weeks.get(row.week_start)![row.status] = row.claim_count;
    }
    return Array.from(weeks.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 12);
  }, [claimsOverTime]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>📈 Restaurant Growth</Text>
      <Text style={styles.subtitle}>Claims over time, approval speed, and current status mix</Text>

      <Text style={styles.sectionTitle}>Restaurant Status</Text>
      <View style={styles.snapshotRow}>
        {statusSnapshot.map((row) => (
          <View key={row.status} style={styles.snapshotBox}>
            <Text style={styles.snapshotNumber}>{row.restaurant_count}</Text>
            <Text style={styles.snapshotLabel}>{STATUS_LABELS[row.status] ?? row.status}</Text>
          </View>
        ))}
        {statusSnapshot.length === 0 && <Text style={styles.emptyText}>No restaurants yet</Text>}
      </View>

      <Text style={styles.sectionTitle}>Claim → Approval Time</Text>
      <View style={styles.card}>
        {approvalTime && approvalTime.approved_count > 0 ? (
          <>
            <Text style={styles.approvalStat}>
              Avg <Text style={styles.approvalStatNumber}>{approvalTime.avg_hours}h</Text>
              {'   '}Median <Text style={styles.approvalStatNumber}>{approvalTime.median_hours}h</Text>
            </Text>
            <Text style={styles.cardSubtext}>Based on {approvalTime.approved_count} approved restaurant(s)</Text>
          </>
        ) : (
          <Text style={styles.emptyText}>No approved restaurants yet</Text>
        )}
      </View>

      <Text style={styles.sectionTitle}>Claims Over Time (by week)</Text>
      <View style={styles.card}>
        {claimsByWeek.length === 0 ? (
          <Text style={styles.emptyText}>No claims yet</Text>
        ) : (
          <>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.tableHeaderCell, styles.weekCol]}>Week of</Text>
              {STATUS_ORDER.map((s) => (
                <Text key={s} style={styles.tableHeaderCell}>{STATUS_LABELS[s]}</Text>
              ))}
            </View>
            {claimsByWeek.map(([week, counts]) => (
              <View key={week} style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.weekCol]}>{formatWeek(week)}</Text>
                {STATUS_ORDER.map((s) => (
                  <Text key={s} style={styles.tableCell}>{counts[s] ?? 0}</Text>
                ))}
              </View>
            ))}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f6f6f6' },
  content: { padding: 16, width: '100%', maxWidth: 900, alignSelf: 'center', paddingBottom: 32 },
  title: { fontSize: 20, fontWeight: '800', color: '#1565C0', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 16 },

  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#222', paddingTop: 20, paddingBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, elevation: 1 },
  cardSubtext: { fontSize: 12, color: '#888', marginTop: 4 },
  emptyText: { fontSize: 13, color: '#999', fontStyle: 'italic' },

  snapshotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  snapshotBox: {
    flex: 1, minWidth: 90, backgroundColor: '#fff', borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', elevation: 1,
  },
  snapshotNumber: { fontSize: 22, fontWeight: '800', color: '#222' },
  snapshotLabel: { fontSize: 11, fontWeight: '700', color: '#666', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2 },

  approvalStat: { fontSize: 15, color: '#444' },
  approvalStatNumber: { fontWeight: '800', color: '#1565C0' },

  tableHeaderRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 8, marginBottom: 4 },
  tableHeaderCell: { flex: 1, fontSize: 11, fontWeight: '700', color: '#999', textTransform: 'uppercase' },
  tableRow: { flexDirection: 'row', paddingVertical: 6 },
  tableCell: { flex: 1, fontSize: 13, color: '#333', fontWeight: '600' },
  weekCol: { flex: 1.4, color: '#222', fontWeight: '700' },
});
