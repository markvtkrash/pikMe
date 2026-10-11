import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, Modal, ScrollView,
} from 'react-native';
import { Alert } from '../../src/utils/alert';
import { useFocusEffect, useRouter } from 'expo-router';
import { getPlaceMenuIssues, requeuePlaceBuild, setPlaceOverrideLink } from '../../src/api/menuIssues';
import {
  describeRequests, describeRetry, placeIssueInfo, PlaceMenuIssue, summarizePlaceIssues,
} from '../../src/utils/menuIssues';
import { formatLastRun, validateMenuLinkInput } from '../../src/utils/chainMenuSources';
import { IconText } from '../../src/components/common/AppIcon';

const TONES = {
  bad: { bg: '#FFEBEE', fg: '#c62828' },
  warn: { bg: '#FFF3E0', fg: '#E65100' },
} as const;

// Report: independent restaurants whose menu could not be built automatically (migration 107), most-wanted first.
// "Needs attention" = the build failed repeatedly and stopped retrying; the others are still being retried.
// Franchises have their own report (Franchise Menu Management, filter "Needs attention").
// An admin can give a restaurant a menu link, try again now, or add the menu by photo or text in Menu Management.
export default function RestaurantMenuIssuesScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<PlaceMenuIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PlaceMenuIssue | null>(null);
  const [link, setLink] = useState('');
  const [working, setWorking] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setRows(await getPlaceMenuIssues());
    } catch (error: any) {
      console.error('[admin-menu-issues] Load error:', error);
      setLoadError(error?.message || 'Could not load the report');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const summary = useMemo(() => summarizePlaceIssues(rows), [rows]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.restaurant_name.toLowerCase().includes(q) || (r.city ?? '').toLowerCase().includes(q) || (r.address ?? '').toLowerCase().includes(q));
  }, [rows, search]);

  function openLink(row: PlaceMenuIssue) {
    setEditing(row);
    setLink(row.override_link ?? '');
  }

  const problem = validateMenuLinkInput(link, '');

  async function saveLink() {
    if (!editing || problem) return;
    setWorking(true);
    try {
      await setPlaceOverrideLink(editing.job_id, link);
      setEditing(null);
      Alert.alert(
        link.trim() ? 'Link saved' : 'Link removed',
        'The restaurant is back in the queue and will be built again at the next run, or press the build button on the Scheduled Builds page.',
      );
      await load();
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Could not save the link');
    } finally {
      setWorking(false);
    }
  }

  async function retry(row: PlaceMenuIssue) {
    if (busyId !== null) return;
    setBusyId(row.job_id);
    try {
      await requeuePlaceBuild(row.job_id);
      Alert.alert('Queued again', `${row.restaurant_name} will be built again at the next run.`);
      await load();
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Could not queue it again');
    } finally {
      setBusyId(null);
    }
  }

  if (loading && rows.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.pageWrapper}>
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.job_id)}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View>
              <Text style={styles.title}>Independent restaurant menu issues</Text>
              <Text style={styles.hint}>
                Restaurants a customer opened that have no menu because the automatic build could not find one. The most-opened come
                first. Franchises are on the Franchise Menu Management page (filter: Needs attention).
              </Text>
              {!!loadError && <Text style={styles.error}>{loadError}</Text>}
              <Text style={styles.summary}>
                {summary.total === 0
                  ? 'Nothing needs attention.'
                  : `${summary.total} restaurant${summary.total === 1 ? '' : 's'}: ${summary.stopped} need attention · ${summary.retrying} being retried`}
              </Text>
              <TextInput
                style={styles.search}
                placeholder="Search restaurant, city or address…"
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
              />
            </View>
          }
          renderItem={({ item }) => {
            const info = placeIssueInfo(item.status);
            const tone = TONES[info.tone];
            const retryText = describeRetry(item);
            return (
              <View style={styles.row}>
                <View style={styles.rowTop}>
                  <Text style={styles.name} numberOfLines={2}>{item.restaurant_name}</Text>
                  <Text style={[styles.badge, { backgroundColor: tone.bg, color: tone.fg }]}>{info.label}</Text>
                </View>
                {!!(item.address || item.city) && (
                  <Text style={styles.meta} numberOfLines={1}>{[item.address, item.city].filter(Boolean).join(' · ')}</Text>
                )}
                <Text style={styles.meta}>
                  {describeRequests(item.requested_count)}
                  {item.claimed ? ' · claimed by an owner' : ' · not claimed'}
                  {item.finished_at ? ` · last tried ${formatLastRun(item.finished_at, null)}` : ''}
                  {retryText ? ` · ${retryText}` : ''}
                </Text>
                {!!item.last_detail && <Text style={styles.detail} numberOfLines={3}>{item.last_detail}</Text>}
                {!!item.override_link && <Text style={styles.override} numberOfLines={1}>Menu link set: {item.override_link}</Text>}

                <View style={styles.actions}>
                  <TouchableOpacity style={styles.linkBtn} onPress={() => openLink(item)} accessibilityRole="button">
                    <IconText style={styles.linkBtnText} emoji="🔗">{item.override_link ? 'Change menu link' : 'Set menu link'}</IconText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.retryBtn, busyId === item.job_id && styles.disabled]}
                    disabled={busyId !== null}
                    onPress={() => retry(item)}
                    accessibilityRole="button"
                  >
                    {busyId === item.job_id ? <ActivityIndicator size="small" color="#455a64" /> : <Text style={styles.retryBtnText}>↻ Try again</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.retryBtn} onPress={() => router.push({ pathname: '/admin/menu-management/by-place', params: { placeId: item.place_id } } as any)} accessibilityRole="button">
                    <IconText style={styles.retryBtnText} emoji="📷">Add the menu</IconText>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>{search ? 'No matches' : 'No restaurant has a failed menu build'}</Text>
            </View>
          }
        />
      </View>

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => !working && setEditing(null)}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.cardTitle}>{editing?.restaurant_name}</Text>
              <Text style={styles.cardNote}>
                The page that lists this restaurant's menu (not its home page, if the menu is elsewhere). It is read as is, and Google is
                not asked. Saving puts the restaurant back in the queue. Leave it blank to remove a link.
              </Text>
              <TextInput
                style={styles.input}
                value={link}
                onChangeText={setLink}
                placeholder="https://www.example.com/menu"
                placeholderTextColor="#999"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!working}
              />
              {!!problem && <Text style={styles.error}>{problem}</Text>}
              <View style={styles.cardActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(null)} disabled={working}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.saveBtn, (working || !!problem) && styles.disabled]} onPress={saveLink} disabled={working || !!problem}>
                  {working ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveText}>{link.trim() ? 'Save and rebuild' : 'Remove link'}</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 20, fontWeight: '800', color: '#222', marginBottom: 4 },
  hint: { fontSize: 12, color: '#666', lineHeight: 17, marginBottom: 8 },
  summary: { fontSize: 13, fontWeight: '700', color: '#333', marginBottom: 8 },
  error: { fontSize: 12, color: '#c62828', fontWeight: '600', marginVertical: 4 },
  search: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#222', marginBottom: 10, borderWidth: 1, borderColor: '#CFD8DC' },
  row: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, elevation: 1, gap: 3, borderWidth: 1, borderColor: '#CFD8DC' },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { fontSize: 15, fontWeight: '800', color: '#222', flex: 1 },
  badge: { fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  meta: { fontSize: 11, color: '#888' },
  detail: { fontSize: 12, color: '#c62828' },
  override: { fontSize: 11, color: '#1565C0' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  linkBtn: { backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  linkBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  retryBtn: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1.5, borderColor: '#9aa5ad', backgroundColor: '#fff' },
  retryBtnText: { fontSize: 12, fontWeight: '700', color: '#455a64' },
  emptyBox: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#999' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 520, maxHeight: '90%', borderWidth: 1, borderColor: '#CFD8DC' },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 6 },
  cardNote: { fontSize: 12, color: '#666', lineHeight: 17, marginBottom: 10 },
  input: { paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#222', marginBottom: 6, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#B0BEC5', borderRadius: 8 },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5, borderColor: '#9aa5ad', backgroundColor: '#fff' },
  cancelText: { fontSize: 13, fontWeight: '700', color: '#455a64' },
  saveBtn: { backgroundColor: '#2E7D32', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 10, minWidth: 110, alignItems: 'center' },
  saveText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  disabled: { opacity: 0.5 },
});
