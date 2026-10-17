import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Alert } from '../../src/utils/alert';
import { getAnalyticsSummary } from '../../src/api/analytics';
import {
  AnalyticsSummary, buildFunnel, eventLabel, formatPercent, maxDaily, PERIOD_CHOICES, weekLaterReturn,
} from '../../src/utils/analytics';

// How customers use the app, from anonymous counts (migration 147). Each phone has a random install ID; there is no name, email, location or search
// text behind a number. "Installs" below means distinct phones.

export default function AdminAnalyticsScreen() {
  const [days, setDays] = useState<number>(30);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (period: number) => {
    setLoading(true);
    try {
      setSummary(await getAnalyticsSummary(period));
    } catch (e: any) {
      console.error('[admin-analytics] Load error:', e);
      Alert.alert('Error', e?.message || 'Could not load the usage numbers (has migration 147 been run?)');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(days);
    }, [days, load])
  );

  const funnel = summary ? buildFunnel(summary) : [];
  const back = summary ? weekLaterReturn(summary) : null;
  const busiest = summary ? maxDaily(summary) : 1;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.pageWrapper}>
          <Text style={styles.hint}>
            Anonymous counts from the customer app. "Installs" are distinct phones: each has a random ID, with no name, email, location or search text behind it.
          </Text>

          <View style={styles.chips}>
            {PERIOD_CHOICES.map((p) => (
              <TouchableOpacity key={p} style={[styles.chip, days === p && styles.chipOn]} onPress={() => setDays(p)} accessibilityRole="button">
                <Text style={[styles.chipText, days === p && styles.chipTextOn]}>Last {p} days</Text>
              </TouchableOpacity>
            ))}
          </View>

          {loading && !summary ? (
            <ActivityIndicator size="large" color="#4527A0" style={{ marginTop: 40 }} />
          ) : summary ? (
            <>
              <View style={styles.tiles}>
                <View style={styles.tile}>
                  <Text style={styles.tileNumber}>{summary.installs}</Text>
                  <Text style={styles.tileLabel}>Active installs</Text>
                </View>
                <View style={styles.tile}>
                  <Text style={styles.tileNumber}>{summary.newInstalls}</Text>
                  <Text style={styles.tileLabel}>New installs</Text>
                </View>
                <View style={styles.tile}>
                  <Text style={styles.tileNumber}>{formatPercent(back)}</Text>
                  <Text style={styles.tileLabel}>Came back a week or more later</Text>
                  <Text style={styles.tileSub}>
                    {summary.retention.cohort > 0 ? `${summary.retention.returned} of ${summary.retention.cohort}` : 'not enough history yet'}
                  </Text>
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Funnel</Text>
                <Text style={styles.cardNote}>Installs that did each thing in the period.</Text>
                {funnel.map((row, i) => (
                  <View key={row.event} style={styles.funnelRow}>
                    <View style={styles.funnelHead}>
                      <Text style={styles.funnelLabel}>{i + 1}. {row.label}</Text>
                      <Text style={styles.funnelValue}>
                        {row.installs}{i > 0 ? `  ·  ${formatPercent(row.ofPrevious)} of the step before` : ''}
                      </Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${row.ofFirst ?? 0}%` }]} />
                    </View>
                  </View>
                ))}
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Every event</Text>
                <View style={styles.tableHead}>
                  <Text style={[styles.th, { flex: 2 }]}>Event</Text>
                  <Text style={[styles.th, styles.right]}>Times</Text>
                  <Text style={[styles.th, styles.right]}>Installs</Text>
                </View>
                {summary.events.map((e) => (
                  <View key={e.event} style={styles.tr}>
                    <Text style={[styles.td, { flex: 2 }]}>{eventLabel(e.event)}</Text>
                    <Text style={[styles.td, styles.right]}>{e.events}</Text>
                    <Text style={[styles.td, styles.right]}>{e.installs}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Active installs per day</Text>
                <View style={styles.daily}>
                  {summary.daily.map((d) => (
                    <View key={d.day} style={styles.dayCol} accessibilityLabel={`${d.day}: ${d.installs}`}>
                      <View style={[styles.dayBar, { height: Math.max(2, Math.round((d.installs / busiest) * 80)) }]} />
                    </View>
                  ))}
                </View>
                <Text style={styles.cardNote}>Most in one day: {summary.daily.some((d) => d.installs > 0) ? busiest : 0}</Text>
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  content: { paddingVertical: 12 },
  pageWrapper: { width: '100%', maxWidth: 900, alignSelf: 'center', paddingHorizontal: 16 },
  hint: { fontSize: 12, color: '#666', lineHeight: 17, paddingTop: 4, paddingBottom: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: '#CFD8DC' },
  chipOn: { backgroundColor: '#EDE7F6', borderColor: '#4527A0' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#546E7A' },
  chipTextOn: { color: '#4527A0' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  tile: { flexGrow: 1, flexBasis: 160, backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#CFD8DC' },
  tileNumber: { fontSize: 28, fontWeight: '800', color: '#4527A0' },
  tileLabel: { fontSize: 12, fontWeight: '700', color: '#444', marginTop: 2 },
  tileSub: { fontSize: 11, color: '#888', marginTop: 2 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, gap: 8, borderWidth: 1, borderColor: '#CFD8DC', marginBottom: 14 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#222' },
  cardNote: { fontSize: 12, color: '#777' },
  funnelRow: { gap: 4 },
  funnelHead: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 },
  funnelLabel: { fontSize: 13, fontWeight: '700', color: '#222' },
  funnelValue: { fontSize: 12, color: '#555' },
  barTrack: { height: 10, borderRadius: 5, backgroundColor: '#ECEFF1', overflow: 'hidden' },
  barFill: { height: 10, borderRadius: 5, backgroundColor: '#4527A0' },
  tableHead: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#CFD8DC', paddingBottom: 4 },
  th: { flex: 1, fontSize: 11, fontWeight: '800', color: '#78909C' },
  tr: { flexDirection: 'row', paddingVertical: 4 },
  td: { flex: 1, fontSize: 13, color: '#222' },
  right: { textAlign: 'right' },
  daily: { flexDirection: 'row', alignItems: 'flex-end', height: 84, gap: 2 },
  dayCol: { flex: 1, justifyContent: 'flex-end' },
  dayBar: { backgroundColor: '#7E57C2', borderRadius: 2 },
});
