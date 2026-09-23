import { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  getSupportSnapshot, getSupportResolutionTime,
  SupportSnapshotRow, SupportResolutionTime,
} from '../../../src/api/reports';

const TICKET_STATUS_ORDER = ['open', 'in_progress', 'resolved', 'closed'];
const TICKET_TYPE_LABELS: Record<string, string> = { owner: 'Owner', consumer: 'Consumer' };

export default function AdminSupportTicketsReport() {
  const [loading, setLoading] = useState(true);
  const [supportSnapshot, setSupportSnapshot] = useState<SupportSnapshotRow[]>([]);
  const [supportResolution, setSupportResolution] = useState<SupportResolutionTime | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  async function loadData() {
    setLoading(true);
    try {
      const [supportStat, supportRes] = await Promise.all([
        getSupportSnapshot(),
        getSupportResolutionTime(),
      ]);
      setSupportSnapshot(supportStat);
      setSupportResolution(supportRes);
    } catch (error: any) {
      console.error('[admin-support-tickets-report] Load error:', error);
      Alert.alert('Error', error.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }

  const supportByType = useMemo(() => {
    const types = new Map<string, Record<string, number>>();
    for (const row of supportSnapshot) {
      if (!types.has(row.ticket_type)) types.set(row.ticket_type, {});
      types.get(row.ticket_type)![row.status] = row.ticket_count;
    }
    return Array.from(types.entries());
  }, [supportSnapshot]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>🎧 Support Tickets</Text>
      <Text style={styles.subtitle}>By status and submitter type, plus resolution time</Text>

      <View style={styles.card}>
        {supportByType.length === 0 ? (
          <Text style={styles.emptyText}>No tickets yet</Text>
        ) : (
          <>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.tableHeaderCell, styles.typeCol]}>Submitted by</Text>
              {TICKET_STATUS_ORDER.map((s) => (
                <Text key={s} style={styles.tableHeaderCell}>{s.replace('_', ' ')}</Text>
              ))}
            </View>
            {supportByType.map(([type, counts]) => (
              <View key={type} style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.typeCol]}>{TICKET_TYPE_LABELS[type] ?? type}</Text>
                {TICKET_STATUS_ORDER.map((s) => (
                  <Text key={s} style={styles.tableCell}>{counts[s] ?? 0}</Text>
                ))}
              </View>
            ))}
          </>
        )}
        {supportResolution && supportResolution.resolved_count > 0 && (
          <Text style={styles.cardSubtext}>
            Avg resolution {supportResolution.avg_hours}h · Median {supportResolution.median_hours}h
            {'  '}(based on {supportResolution.resolved_count} resolved ticket(s))
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f6f6f6' },
  content: { padding: 16, width: '100%', maxWidth: 900, alignSelf: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: '#1565C0', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 16 },

  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, elevation: 1 },
  cardSubtext: { fontSize: 12, color: '#888', marginTop: 10 },
  emptyText: { fontSize: 13, color: '#999', fontStyle: 'italic' },

  tableHeaderRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 8, marginBottom: 4 },
  tableHeaderCell: { flex: 1, fontSize: 11, fontWeight: '700', color: '#999', textTransform: 'uppercase' },
  tableRow: { flexDirection: 'row', paddingVertical: 6 },
  tableCell: { flex: 1, fontSize: 13, color: '#333', fontWeight: '600' },
  typeCol: { flex: 1.4, color: '#222', fontWeight: '700' },
});
