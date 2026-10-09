import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { getUnconfirmedClickedRestaurants } from '../../api/unconfirmedClicks';
import {
  describeClickCount, describeCrawlState, describeTotal, formatClickDate, UNCONFIRMED_PAGE_SIZE, UnconfirmedClickedRestaurant,
} from '../../utils/unconfirmedClicks';

// Independent restaurants a customer opened that have no confirmed menu item: nobody has looked after their menu, so
// the admin can upload one (Manage). A restaurant leaves the list as soon as it has one verified item.
export default function UnconfirmedClickedList() {
  const router = useRouter();
  const [rows, setRows] = useState<UnconfirmedClickedRestaurant[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    try {
      const page = await getUnconfirmedClickedRestaurants(UNCONFIRMED_PAGE_SIZE, offset);
      setTotal(page.total);
      setRows((prev) => (offset === 0 ? page.rows : [...prev, ...page.rows]));
      setFailed(false);
    } catch (error: any) {
      console.warn('[admin-scheduled-builds] Unconfirmed restaurants unavailable:', error?.message);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(0);
  }, [load]);

  return (
    <View>
      {failed ? (
        <Text style={styles.warning}>The list could not be loaded. Check that migration 119 is applied.</Text>
      ) : (
        <Text style={styles.line}>{loading && rows.length === 0 ? 'Loading…' : describeTotal(total)}</Text>
      )}

      {rows.map((r) => {
        const state = describeCrawlState(r.crawl_state);
        const place = [r.address, r.city].filter(Boolean).join(', ');
        return (
          <View key={r.place_id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.name} numberOfLines={1}>{r.restaurant_name}</Text>
              {!!place && <Text style={styles.sub} numberOfLines={1}>{place}</Text>}
              <Text style={styles.sub}>
                {describeClickCount(r.click_count)} · last {formatClickDate(r.last_clicked_at)}
                {r.claimed ? ' · has an owner' : ''}
              </Text>
              <Text style={[styles.state, state.quiet && styles.stateQuiet]}>{state.label}</Text>
            </View>
            <TouchableOpacity
              style={styles.manageBtn}
              onPress={() => router.push({ pathname: '/admin/menu-management/by-place', params: { placeId: r.place_id } } as any)}
              accessibilityRole="button"
            >
              <Text style={styles.manageText}>Manage</Text>
            </TouchableOpacity>
          </View>
        );
      })}

      {loading && rows.length > 0 && <ActivityIndicator size="small" style={styles.spinner} />}
      {!loading && rows.length < total && (
        <TouchableOpacity onPress={() => load(rows.length)} accessibilityRole="button">
          <Text style={styles.more}>Show more ({total - rows.length} left)</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { fontSize: 12, color: '#555', marginBottom: 6 },
  warning: { fontSize: 12, color: '#E65100', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderTopWidth: 1, borderTopColor: '#eee' },
  rowText: { flex: 1 },
  name: { fontSize: 13, fontWeight: '700', color: '#222' },
  sub: { fontSize: 11, color: '#777', marginTop: 1 },
  state: { fontSize: 11, fontWeight: '700', color: '#E65100', marginTop: 2 },
  stateQuiet: { color: '#2E7D32' },
  manageBtn: { backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  manageText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  spinner: { marginVertical: 8 },
  more: { fontSize: 12, fontWeight: '700', color: '#1565C0', marginTop: 8 },
});
