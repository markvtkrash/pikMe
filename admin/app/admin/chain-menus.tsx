import { useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, TextInput, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, Modal, ScrollView,
  useWindowDimensions,
} from 'react-native';
import { Alert } from '../../src/utils/alert';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/api/supabase';
import {
  clearChainMenuLink, getChainMenuSources, markChainMenuStale, pullChainMenuNow, setChainBuiltInMenuUrl, setChainMenuLink,
} from '../../src/api/chainMenus';
import AddFranchiseModal from '../../src/components/common/AddFranchiseModal';
import LinkSuggestionsPanel from '../../src/components/common/LinkSuggestionsPanel';
import ChainStoreSection from '../../src/components/common/ChainStoreSection';
import {
  ChainMenuSource, SourceFilter, describeCheckState, describePullResult, filterSources, markedDueTimestamp, needsStore, parseSourceFilter,
  statusInfo, summarizeSources, validateMenuLinkInput,
} from '../../src/utils/chainMenuSources';
import { IconText } from '../../src/components/common/AppIcon';
import { useEnterChain } from '../../src/hooks/useEnterChain';

// Colour for the "last looked up" text in a row: orange when marked for a fresh lookup, blue when never
// looked up, the normal grey otherwise.
function checkStyle(fetchedAt: string | null) {
  const tone = describeCheckState(fetchedAt).tone;
  return tone === 'due' ? styles.checkDue : tone === 'never' ? styles.checkNever : undefined;
}

// Window width from which the list rows use the aligned, fixed-name-column layout.
const ROW_WIDE_MIN_WIDTH = 600;

const TONE_STYLES = {
  good: { bg: '#E8F5E9', fg: '#2E7D32' },
  warn: { bg: '#FFF3E0', fg: '#E65100' },
  bad: { bg: '#FFEBEE', fg: '#c62828' },
  neutral: { bg: '#ECEFF1', fg: '#546E7A' },
} as const;

// Where each franchise chain's menu comes from (migrations 072 + 078): the
// outcome of its last lookup, and a way to enter the official menu link by hand
// when the automatic lookup finds nothing. A hand-entered link is read as is and
// SerpApi is never called for that chain.
export default function AdminChainMenusScreen() {
  const router = useRouter();
  // Wide screens: a fixed name column so every button lines up. Narrow screens: the name gets
  // its own line and the button and badge sit underneath.
  const { width } = useWindowDimensions();
  const wideRows = width >= ROW_WIDE_MIN_WIDTH;
  const [rows, setRows] = useState<ChainMenuSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // The Franchise Menu Issues report opens this page with ?filter=attention.
  // The Scheduled Builds page opens a failed chain's Manage window with ?manage=<chain id>.
  const params = useLocalSearchParams<{ filter?: string; manage?: string }>();
  const [filter, setFilter] = useState<SourceFilter>(parseSourceFilter(params.filter));
  const [editing, setEditing] = useState<ChainMenuSource | null>(null);
  const openedFor = useRef<string | null>(null);
  const [dueBusyId, setDueBusyId] = useState<string | null>(null);
  // Chain name shown in the "marked for refresh" confirmation window (null = closed).
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadRows();
    }, [])
  );

  // silent = refresh the list behind an open Manage window without the full-page spinner (which would close it).
  async function loadRows(silent = false) {
    if (!silent) setLoading(true);
    try {
      const loaded = await getChainMenuSources();
      setRows(loaded);
      if (silent) {
        setEditing((current) => (current ? loaded.find((r) => r.chain_id === current.chain_id) ?? current : current));
        return;
      }
      // Only once per visit: later reloads (after a save) must not reopen the window.
      const target = typeof params.manage === 'string' && openedFor.current !== params.manage
        ? loaded.find((r) => r.chain_id === params.manage)
        : undefined;
      if (target) {
        openedFor.current = target.chain_id;
        setEditing(target);
      }
    } catch (error: any) {
      console.error('[admin-chain-menus] Load error:', error);
      Alert.alert('Error', error.message || 'Failed to load chain menus');
    } finally {
      setLoading(false);
    }
  }

  // "Refresh on next visit" straight from the list: mark the chain for a fresh lookup, update
  // just that row, and confirm in a small window. A chain that has never been looked up has
  // nothing to mark (it is already due), which is the same outcome for the admin.
  async function markDue(item: ChainMenuSource) {
    setDueBusyId(item.chain_id);
    try {
      const marked = await markChainMenuStale(item.chain_id);
      if (marked) {
        const when = markedDueTimestamp();
        setRows((current) => current.map((r) => (r.chain_id === item.chain_id ? { ...r, fetched_at: when } : r)));
      }
      setReadyFor(item.chain_name);
    } catch (error: any) {
      console.error('[admin-chain-menus] Mark-due error:', error);
      Alert.alert('Error', error?.message || 'Could not mark this chain for refresh');
    } finally {
      setDueBusyId(null);
    }
  }

  const summary = useMemo(() => summarizeSources(rows), [rows]);
  const filtered = useMemo(() => filterSources(rows, filter, search), [rows, filter, search]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  const chips: { key: SourceFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: summary.total },
    { key: 'attention', label: 'Needs attention', count: summary.attention },
    { key: 'ok', label: 'OK', count: summary.ok },
    { key: 'manual', label: 'Manual link', count: summary.manual },
    { key: 'none', label: 'Not looked up', count: summary.notStarted },
    { key: 'due', label: 'Due for refresh', count: summary.due },
    { key: 'store', label: 'Needs a store', count: summary.needsStore },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.pageWrapper}>
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.chain_id}
          contentContainerStyle={styles.list}
          initialNumToRender={20}
          ListHeaderComponent={
            <View>
              <Text style={styles.hint}>
                Each chain's menu is built once from its official menu page. Chains marked "Needs attention" could
                not be read automatically: tap one and enter its menu link by hand. That link is then used as is.
              </Text>
              <TouchableOpacity style={styles.addBtn} onPress={() => setAdding(true)} accessibilityRole="button">
                <IconText style={styles.addBtnText} emoji="➕">Add franchise</IconText>
              </TouchableOpacity>
              <TouchableOpacity style={styles.createOwnerLink} onPress={() => router.push('/admin/create-owner')}>
                <Text style={styles.createOwnerLinkText}>
                  ➕ Need a store's Google place ID for a chain? Create a restaurant owner for one of its locations
                </Text>
              </TouchableOpacity>
              <LinkSuggestionsPanel onApproved={loadRows} />
              <View style={styles.chipRow}>
                {chips.map((c) => (
                  <TouchableOpacity
                    key={c.key}
                    style={[styles.chip, filter === c.key && styles.chipActive]}
                    onPress={() => setFilter(c.key)}
                  >
                    <Text style={[styles.chipText, filter === c.key && styles.chipTextActive]}>
                      {c.label} {c.count}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={styles.search}
                placeholder="Search chain or category…"
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
              />
            </View>
          }
          renderItem={({ item }) => {
            const info = statusInfo(item);
            const tone = TONE_STYLES[info.tone];
            return (
              <TouchableOpacity style={styles.row} onPress={() => setEditing(item)}>
                <View style={styles.rowTop}>
                  <Text
                    style={[styles.rowName, wideRows ? styles.rowNameWide : styles.rowNameNarrow]}
                    numberOfLines={wideRows ? 2 : undefined}
                  >
                    {item.chain_name}
                  </Text>
                  <TouchableOpacity
                    style={[styles.rowAction, dueBusyId === item.chain_id && styles.btnDisabled]}
                    disabled={dueBusyId === item.chain_id}
                    onPress={() => markDue(item)}
                    accessibilityRole="button"
                  >
                    {dueBusyId === item.chain_id ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.rowActionText}>↻ Refresh on next visit</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.rowManage} onPress={() => setEditing(item)} accessibilityRole="button">
                    <IconText style={styles.rowManageText} emoji="⚙">Manage</IconText>
                  </TouchableOpacity>
                  <Text style={[styles.badge, { backgroundColor: tone.bg, color: tone.fg }]}>{info.label}</Text>
                </View>
                <Text style={styles.rowMeta}>
                  {item.current_items} items shown ·{' '}
                  <Text style={checkStyle(item.fetched_at)}>{describeCheckState(item.fetched_at).text}</Text>
                  {needsStore(item) && <Text style={styles.checkDue}> · no store seen yet</Text>}
                  {item.menu_link ? ` · ${item.menu_link.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}` : ''}
                </Text>
                {!!item.status_detail && (
                  <Text style={[styles.rowDetail, item.status === 'ok' && styles.rowDetailOk]} numberOfLines={2}>{item.status_detail}</Text>
                )}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>{search || filter !== 'all' ? 'No matches' : 'No chains yet'}</Text>
            </View>
          }
        />
      </View>

      <Modal visible={!!readyFor} transparent animationType="fade" onRequestClose={() => setReadyFor(null)}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.readyIcon}>✓</Text>
            <Text style={styles.title}>Marked for refresh</Text>
            <Text style={styles.message}>
              {readyFor} will be rebuilt the next time a customer opens it. To do it right now, open the chain
              and tap "Pull menu now".
            </Text>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setReadyFor(null)} accessibilityRole="button">
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <AddFranchiseModal
        visible={adding}
        onClose={() => setAdding(false)}
        onAdded={(added) => {
          setAdding(false);
          Alert.alert('Franchise added', `${added} is now on the franchise list. Its menu is built once a store of this chain is seen, or when you add a menu link.`);
          loadRows();
        }}
      />

      <EditModal
        source={editing}
        onClose={() => setEditing(null)}
        onChanged={(keepOpen) => {
          if (keepOpen) {
            loadRows(true);
            return;
          }
          setEditing(null);
          loadRows();
        }}
      />
    </View>
  );
}

function EditModal({
  source, onClose, onChanged,
}: { source: ChainMenuSource | null; onClose: () => void; onChanged: (keepOpen?: boolean) => void }) {
  const [link, setLink] = useState('');
  const [storeRef, setStoreRef] = useState('');
  const [builtIn, setBuiltIn] = useState('');
  const [working, setWorking] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [lastSource, setLastSource] = useState<string | null>(null);
  const chain = useEnterChain(2);

  // Reset the form each time a different chain is opened.
  if (source && source.chain_id !== lastSource) {
    setLastSource(source.chain_id);
    setLink(source.menu_link_manual ? source.menu_link ?? '' : '');
    setStoreRef(source.menu_link_manual ? source.store_ref ?? '' : '');
    setBuiltIn(source.built_in_menu_url ?? '');
  }
  if (!source && lastSource !== null) setLastSource(null);

  const problem = validateMenuLinkInput(link, storeRef);
  // An emptied box on a chain that has a manual link means "remove it" (back to the automatic lookup).
  const clearing = !!source?.menu_link_manual && link.trim() === '';
  const canSave = !working && !pulling && ((link.trim() !== '' && problem === null) || clearing);
  // The built-in page: a plain address (blank clears it). Saved only when it changed.
  const builtInProblem = validateMenuLinkInput(builtIn, '');
  const builtInChanged = builtIn.trim() !== (source?.built_in_menu_url ?? '');
  const canSaveBuiltIn = !working && !pulling && builtInChanged && builtInProblem === null;

  async function run(action: () => Promise<unknown>, success: string, keepOpen = false) {
    setWorking(true);
    try {
      await action();
      Alert.alert('Done', success);
      onChanged(keepOpen);
    } catch (error: any) {
      console.error('[admin-chain-menus] Action error:', error);
      Alert.alert('Error', error?.message || 'Something went wrong');
    } finally {
      setWorking(false);
    }
  }

  async function pullNow() {
    if (!source) return;
    setPulling(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Admin session expired. Please log in again.');
      const outcome = describePullResult(await pullChainMenuNow(source.chain_id, token));
      Alert.alert(outcome.title, outcome.message);
      onChanged();
    } catch (error: any) {
      console.error('[admin-chain-menus] Pull error:', error);
      Alert.alert('Error', error?.message || 'The pull failed');
    } finally {
      setPulling(false);
    }
  }

  const busy = working || pulling;

  return (
    <Modal visible={!!source} transparent animationType="fade" onRequestClose={() => !busy && onClose()}>
      <View style={styles.overlay}>
        <View style={[styles.card, styles.manageCard]}>
          <ScrollView
            style={styles.manageScroll}
            contentContainerStyle={styles.manageScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            <Text style={styles.title}>{source?.chain_name}</Text>
            {!!source && (
              <Text style={styles.message}>
                {statusInfo(source).label} · {source.current_items} items shown · {describeCheckState(source.fetched_at).text}
                {source.menu_link && !source.menu_link_manual ? `\nFound automatically: ${source.menu_link}` : ''}
                {source.website ? `\nWebsite: ${source.website}` : ''}
                {source.status_detail ? `\n${source.status_detail}` : ''}
              </Text>
            )}

            <Text style={styles.label}>Menu link (set by hand)</Text>
            <TextInput {...chain(0)}
              style={styles.input}
              value={link}
              onChangeText={setLink}
              placeholder="https://www.example.com/menu"
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!working}
            />
            <Text style={styles.label}>Store parameter (optional)</Text>
            <TextInput {...chain(1)}
              style={styles.input}
              value={storeRef}
              onChangeText={setStoreRef}
              placeholder="e.g. store=034416"
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!working}
            />
            {!!problem && <Text style={styles.warning}>{problem}</Text>}
            {clearing && (
              <Text style={styles.warning}>
                The box is empty: tap "Remove link" to delete the manual link and use the automatic lookup again.
              </Text>
            )}
            <Text style={styles.note}>
              Use the page that lists the menu items, not a store locator. Saving marks the chain for a fresh
              lookup the next time a customer opens it.
            </Text>

            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={working}>
                <Text style={styles.cancelText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryBtn, clearing && styles.dangerBtn, !canSave && styles.btnDisabled]}
                disabled={!canSave}
                onPress={() =>
                  source &&
                  (clearing
                    ? run(() => clearChainMenuLink(source.chain_id), 'Manual link removed. This chain will use the automatic lookup again.', true)
                    : run(() => setChainMenuLink(source.chain_id, link, storeRef), 'Menu link saved. It will be read the next time a customer opens this chain.', true))
                }
              >
                {working ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryText}>{clearing ? 'Remove link' : 'Save link'}</Text>}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.pullBtn, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={pullNow}
            >
              {pulling ? (
                <View style={styles.pullBusy}>
                  <ActivityIndicator size="small" color="#1565C0" />
                  <Text style={styles.pullBtnText}>Pulling… this can take up to a minute</Text>
                </View>
              ) : (
                <Text style={styles.pullBtnText}>⬇ Pull menu now</Text>
              )}
            </TouchableOpacity>

            <View style={styles.secondaryActions}>
              {!!source?.menu_link_manual && (
                <TouchableOpacity
                  style={styles.linkBtn}
                  disabled={working}
                  onPress={() => source && run(() => clearChainMenuLink(source.chain_id), 'Manual link removed. This chain will use the automatic lookup again.')}
                >
                  <Text style={styles.linkBtnText}>Remove manual link (use automatic lookup)</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.linkBtn}
                disabled={working}
                onPress={() => source && run(() => markChainMenuStale(source.chain_id), 'This chain will be looked up again the next time a customer opens it.')}
              >
                <Text style={styles.linkBtnText}>Refresh on next visit</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.builtInSection}>
              <Text style={styles.label}>Built-in menu page (fallback)</Text>
              <Text style={styles.note}>
                Used only when Google has no menu link for the store and no link is saved above. A link above always
                wins. Leave blank to remove.
              </Text>
              <TextInput
                style={styles.input}
                value={builtIn}
                onChangeText={setBuiltIn}
                placeholder="https://www.example.com/menu"
                placeholderTextColor="#999"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!working && !pulling}
              />
              {!!builtInProblem && <Text style={styles.warning}>{builtInProblem}</Text>}
              <TouchableOpacity
                style={[styles.builtInBtn, !canSaveBuiltIn && styles.btnDisabled]}
                disabled={!canSaveBuiltIn}
                onPress={() =>
                  source &&
                  run(
                    () => setChainBuiltInMenuUrl(source.chain_id, builtIn),
                    builtIn.trim() === '' ? 'Built-in menu page removed.' : 'Built-in menu page saved.',
                  )
                }
              >
                <Text style={styles.builtInBtnText}>{builtIn.trim() === '' && builtInChanged ? 'Remove built-in page' : 'Save built-in page'}</Text>
              </TouchableOpacity>
            </View>

            {!!source && (
              <ChainStoreSection
                key={source.chain_id}
                source={source}
                disabled={working || pulling}
                onChanged={onChanged}
              />
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  hint: { fontSize: 12, color: '#666', paddingBottom: 6 },
  addBtn: { alignSelf: 'flex-start', backgroundColor: '#2E7D32', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 8, elevation: 2 },
  addBtnText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  createOwnerLink: { paddingVertical: 6, marginBottom: 6 },
  createOwnerLinkText: { fontSize: 12, fontWeight: '700', color: '#1565C0' },
  list: { paddingHorizontal: 16, paddingVertical: 12 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  chip: { backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#ddd' },
  chipActive: { backgroundColor: '#1565C0', borderColor: '#1565C0' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#555' },
  chipTextActive: { color: '#fff' },

  search: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#222', marginBottom: 12, borderWidth: 1, borderColor: '#CFD8DC' },

  row: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, elevation: 1, gap: 3, borderWidth: 1, borderColor: '#CFD8DC' },
  rowTop: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  rowAction: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#1565C0', width: 170,
    alignItems: 'center', justifyContent: 'center', elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.25, shadowRadius: 2,
  },
  rowActionText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  rowManage: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#37474F', width: 104,
    alignItems: 'center', justifyContent: 'center', elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.25, shadowRadius: 2,
  },
  rowManageText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  rowName: { fontSize: 14, fontWeight: '700', color: '#222' },
  rowNameWide: { width: 240 },
  rowNameNarrow: { flexBasis: '100%' },
  badge: { fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  rowMeta: { fontSize: 11, color: '#888' },
  checkDue: { color: '#E65100', fontWeight: '800' },
  checkNever: { color: '#1565C0', fontWeight: '700' },
  rowDetail: { fontSize: 11, color: '#c62828' },
  rowDetailOk: { color: '#8a6d00' },

  emptyContainer: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#999' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 480, maxHeight: '90%', borderWidth: 1, borderColor: '#CFD8DC' },
  // The Manage window: a little wider than the small confirm windows, and the content scrolls (with a visible
  // scrollbar) when it is taller than the window.
  manageCard: { maxWidth: 640, maxHeight: '92%' },
  manageScroll: { flexShrink: 1 },
  manageScrollContent: { paddingRight: 6 },
  title: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 6 },
  message: { fontSize: 12, color: '#666', lineHeight: 18, marginBottom: 14 },
  label: { fontSize: 11, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4, marginTop: 4 },
  input: { paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#222', marginBottom: 6, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#B0BEC5', borderRadius: 8 },
  warning: { fontSize: 12, color: '#c62828', marginTop: 4, fontWeight: '600' },
  note: { fontSize: 11, color: '#999', marginTop: 8, lineHeight: 16 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5, borderColor: '#9aa5ad', backgroundColor: '#fff' },
  cancelText: { fontSize: 13, fontWeight: '700', color: '#455a64' },
  primaryBtn: { backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 10, minWidth: 90, alignItems: 'center' },
  primaryText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  btnDisabled: { opacity: 0.5 },
  dangerBtn: { backgroundColor: '#c62828' },
  pullBtn: { marginTop: 12, backgroundColor: '#2E7D32', borderRadius: 8, paddingVertical: 11, alignItems: 'center', elevation: 2 },
  pullBusy: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  readyIcon: { fontSize: 32, color: '#2E7D32', textAlign: 'center', fontWeight: '800' },
  closeBtn: { marginTop: 16, backgroundColor: '#1565C0', borderRadius: 8, paddingVertical: 11, alignItems: 'center', elevation: 2 },
  closeBtnText: { fontSize: 13, fontWeight: '800', color: '#fff' },
  pullBtnText: { fontSize: 13, fontWeight: '800', color: '#fff' },
  secondaryActions: { marginTop: 8, gap: 2 },
  builtInSection: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#e0e0e0' },
  builtInBtn: { marginTop: 8, alignSelf: 'flex-start', backgroundColor: '#37474F', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9, elevation: 2 },
  builtInBtnText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  linkBtn: { paddingVertical: 8 },
  linkBtnText: { fontSize: 12, fontWeight: '700', color: '#1565C0' },
});
