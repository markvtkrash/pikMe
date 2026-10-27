import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, ScrollView } from 'react-native';
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
  const [open, setOpen] = useState(false);

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

  // Opening a restaurant's page leaves this screen mounted underneath, so the window is closed as the admin goes there.
  function goTo(href: { pathname: string; params: Record<string, string> }) {
    router.push(href as any);
    setOpen(false);
  }

  const rowList = (
    <>
      {rows.map((r) => {
        const state = describeCrawlState(r.crawl_state);
        const place = [r.address, r.city].filter(Boolean).join(', ');
        return (
          <View key={r.place_id} style={styles.row}>
            <View style={styles.rowText}>
              {/* the name opens this restaurant's menu edit page (its own place, by its place ID) */}
              <TouchableOpacity
                onPress={() => goTo({ pathname: '/admin/menu-edit', params: editParams(r) })}
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
              onPress={() => goTo({
                pathname: '/admin/menu-management/by-place',
                params: r.address ? { placeId: r.place_id, address: r.address } : { placeId: r.place_id },
              })}
              accessibilityRole="button"
            >
              <Text style={styles.manageText}>Manage</Text>
            </TouchableOpacity>
          </View>
        );
      })}

      {loading && rows.length > 0 && <ActivityIndicator size="small" style={styles.spinner} />}
      <PagerBar page={page} pageCount={pageCount} from={range.from} to={range.to} total={total} onPage={(p) => !loading && setPage(p)} />
    </>
  );

  return (
    <View>
      {failed ? (
        <Text style={styles.warning}>The list could not be loaded. Check that migration 119 is applied.</Text>
      ) : (
        <TouchableOpacity
          style={[styles.countBtn, loading && rows.length === 0 && styles.countBtnDisabled]}
          onPress={() => setOpen(true)}
          disabled={loading && rows.length === 0}
          accessibilityRole="button"
          accessibilityLabel="See which restaurants were opened without a confirmed menu item"
        >
          <Text style={styles.countBtnText}>
            {loading && rows.length === 0 ? 'Loading…' : describeTotal(total)}
          </Text>
        </TouchableOpacity>
      )}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{describeTotal(total)}</Text>
              <TouchableOpacity onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close">
                <Text style={styles.closeText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.list}>{rowList}</ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { fontSize: 12, color: '#555', marginBottom: 6 },
  countBtn: { alignSelf: 'flex-start', backgroundColor: '#ECEFF1', borderWidth: 1.5, borderColor: '#1565C0', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, marginBottom: 10 },
  countBtnDisabled: { opacity: 0.5 },
  countBtnText: { fontSize: 13, fontWeight: '800', color: '#1565C0' },
  warning: { fontSize: 12, color: '#E65100', marginBottom: 6 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, width: '100%', maxWidth: 480, maxHeight: '80%', borderWidth: 1, borderColor: '#CFD8DC' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  modalTitle: { fontSize: 15, fontWeight: '800', color: '#222', flex: 1, marginRight: 10 },
  closeText: { fontSize: 18, color: '#666', fontWeight: '700', paddingHorizontal: 6 },
  list: { flexGrow: 0 },
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
