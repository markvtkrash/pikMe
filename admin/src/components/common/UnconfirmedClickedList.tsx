import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { getUnconfirmedClickedRestaurants } from '../../api/unconfirmedClicks';
import {
  describeClickCount, describeCrawlState, describeTotal, formatClickDate, UNCONFIRMED_PAGE_SIZE, UnconfirmedClickedRestaurant,
} from '../../utils/unconfirmedClicks';
import { pageCountFor, pageRange } from '../../utils/paging';
import { PagerBar } from './PagerBar';

// Independent restaurants a customer opened that have no confirmed menu item: nobody has looked after their menu, so
// the admin can upload one (Manage). A restaurant leaves the list as soon as it has one verified item.
// Paged by the server (Prev / Next): only one page is fetched at a time.
// The menu edit page of one restaurant: by name, with its place ID (and address) so it edits THIS location's menu.
function editParams(r: UnconfirmedClickedRestaurant): Record<string, string> {
  const params: Record<string, string> = { name: r.restaurant_name, placeId: r.place_id };
  const address = [r.address, r.city].filter(Boolean).join(', ');
  if (address) params.address = address;
  return params;
}

export default function UnconfirmedClickedList() {
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<UnconfirmedClickedRestaurant[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (pageIndex: number) => {
    setLoading(true);
    try {
      const result = await getUnconfirmedClickedRestaurants(UNCONFIRMED_PAGE_SIZE, pageIndex * UNCONFIRMED_PAGE_SIZE);
      setTotal(result.total);
      setRows(result.rows);
      setFailed(false);
    } catch (error: any) {
      console.warn('[admin-scheduled-builds] Unconfirmed restaurants unavailable:', error?.message);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page);
  }, [load, page]);

  const pageCount = pageCountFor(total, UNCONFIRMED_PAGE_SIZE);
  const range = pageRange(page, total, UNCONFIRMED_PAGE_SIZE);

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
              {/* the name opens this restaurant's menu edit page (its own place, by its place ID) */}
              <TouchableOpacity
                onPress={() => router.push({ pathname: '/admin/menu-edit', params: editParams(r) } as any)}
                accessibilityRole="link"
                accessibilityLabel={`Edit the menu of ${r.restaurant_name}`}
              >
                <Text style={[styles.name, styles.nameLink]} numberOfLines={1}>{r.restaurant_name}</Text>
              </TouchableOpacity>
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
      <PagerBar page={page} pageCount={pageCount} from={range.from} to={range.to} total={total} onPage={(p) => !loading && setPage(p)} />
    </View>
  );
}

const styles = StyleSheet.create({
  line: { fontSize: 12, color: '#555', marginBottom: 6 },
  warning: { fontSize: 12, color: '#E65100', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderTopWidth: 1, borderTopColor: '#eee' },
  rowText: { flex: 1 },
  name: { fontSize: 13, fontWeight: '700', color: '#222' },
  nameLink: { color: '#1565C0', textDecorationLine: 'underline' },
  sub: { fontSize: 11, color: '#777', marginTop: 1 },
  state: { fontSize: 11, fontWeight: '700', color: '#E65100', marginTop: 2 },
  stateQuiet: { color: '#2E7D32' },
  manageBtn: { backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  manageText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  spinner: { marginVertical: 8 },
});
