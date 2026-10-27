import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Modal } from 'react-native';
import { Alert } from '../../src/utils/alert';
import {
  decideAgentProposals, listAgentProposals, mergeApprovedProposals, type AgentProposal, type ProposalStatus,
} from '../../src/api/menuAgent';

const TABS: { key: ProposalStatus; label: string }[] = [
  { key: 'pending', label: 'To review' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

function priceText(p: number | null): string {
  return p === null || p === undefined ? '' : `$${Number(p).toFixed(2)}`;
}

type Group = { placeId: string; name: string; items: AgentProposal[] };

// Tools -> Menu Agent: dishes the menu agent read from restaurant websites. Nothing reaches a menu until an admin approves
// it here and then adds the approved dishes to the restaurant's menu (the AI estimates their nutrition at that point).
// To review and Approved list the restaurants; a restaurant opens a window with its dishes and the buttons for that tab.
export default function MenuAgentScreen() {
  const [tab, setTab] = useState<ProposalStatus>('pending');
  const [rows, setRows] = useState<AgentProposal[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [openPlace, setOpenPlace] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  // silent: a refresh in the background (no spinner, the selection is kept), used to correct the list after a change
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setRows(await listAgentProposals(tab, 200, 0));
      if (!silent) setSelected(new Set());
      setFailed(false);
    } catch (e: any) {
      console.warn('[admin-menu-agent] list failed:', e?.message);
      if (!silent) setFailed(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  // The list grouped by restaurant, in the order the dishes were found.
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const r of rows) {
      if (!map.has(r.place_id)) map.set(r.place_id, { placeId: r.place_id, name: r.restaurant_name, items: [] });
      map.get(r.place_id)!.items.push(r);
    }
    return [...map.values()];
  }, [rows]);

  const openGroup = groups.find((g) => g.placeId === openPlace) ?? null;

  // A restaurant's window opens with every pending dish ticked; untick the wrong ones before approving.
  function openRestaurant(g: Group) {
    setSelected(new Set(tab === 'pending' ? g.items.map((i) => i.id) : []));
    setOpenPlace(g.placeId);
  }

  function closeWindow() {
    if (busy) return;
    setOpenPlace(null);
    setSelected(new Set());
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setAll(items: AgentProposal[], on: boolean) {
    setSelected(on ? new Set(items.map((i) => i.id)) : new Set());
  }

  async function decide(approve: boolean) {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const ids = new Set(selected);
      const changed = await decideAgentProposals([...ids], approve);
      // the decided dishes leave this tab: drop them here instead of fetching the whole list again, so the popup is instant
      setRows((prev) => prev.filter((r) => !ids.has(r.id)));
      setSelected(new Set());
      setOpenPlace(null);
      Alert.alert('Done', `${changed} dish${changed === 1 ? '' : 'es'} ${approve ? 'approved' : 'rejected'}.`);
    } catch (e: any) {
      setOpenPlace(null); // close the window so the error popup is not hidden behind it
      Alert.alert('Error', e?.message || 'That did not work');
    } finally {
      setBusy(false);
    }
  }

  async function addToMenu(placeId: string) {
    setBusy(true);
    try {
      const r = await mergeApprovedProposals(placeId);
      // mark this restaurant's dishes as added right away, tell the admin, then correct the list quietly (a dish the
      // server skipped is not added, so the background refresh puts its real state back)
      const now = new Date().toISOString();
      setRows((prev) => prev.map((x) => (x.place_id === placeId && x.status === 'approved' && !x.merged_at ? { ...x, merged_at: now } : x)));
      setOpenPlace(null);
      Alert.alert('Done', `${r.added} added, ${r.confirmed} AI item${r.confirmed === 1 ? '' : 's'} confirmed.`);
      load(true);
    } catch (e: any) {
      setOpenPlace(null); // close the window so the error popup is not hidden behind it
      Alert.alert('Error', e?.message || 'The dishes could not be added');
    } finally {
      setBusy(false);
    }
  }

  const off = busy || selected.size === 0;
  const hasUnmerged = (g: Group) => g.items.some((i) => !i.merged_at);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Menu Agent</Text>
      <Text style={styles.subtitle}>
        Dishes the agent read from restaurant websites. Review a restaurant to approve the dishes that are right and reject the
        rest, then add the approved dishes to its menu. Nothing is added to a menu before you approve it.
      </Text>

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} style={[styles.tab, tab === t.key && styles.tabOn]} onPress={() => setTab(t.key)} accessibilityRole="button">
            <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && <ActivityIndicator size="small" color="#1565C0" style={{ alignSelf: 'flex-start' }} />}
      {failed && <Text style={styles.error}>The list could not be loaded. Check that migration 160 is applied.</Text>}
      {!loading && !failed && rows.length === 0 && <Text style={styles.hint}>Nothing here.</Text>}

      {/* To review and Approved: one row per restaurant */}
      {tab !== 'rejected' && groups.map((g) => (
        <TouchableOpacity key={g.placeId} style={styles.row} onPress={() => openRestaurant(g)} accessibilityRole="button">
          <View style={styles.flex1}>
            <Text style={styles.itemTitle} numberOfLines={1}>{g.name}</Text>
            <Text style={styles.dishMeta}>{g.items.length} dish{g.items.length === 1 ? '' : 'es'}</Text>
          </View>
          {tab === 'pending' && (
            <View style={styles.reviewBtn}><Text style={styles.btnText}>Review</Text></View>
          )}
          {tab === 'approved' && (hasUnmerged(g)
            ? <View style={styles.okBtn}><Text style={styles.btnText}>Add to menu</Text></View>
            : <Text style={styles.doneText}>Added to the menu</Text>)}
        </TouchableOpacity>
      ))}

      {/* Rejected: a read-only list of the dishes */}
      {tab === 'rejected' && groups.map((g) => (
        <View key={g.placeId} style={styles.item}>
          <Text style={styles.itemTitle} numberOfLines={1}>{g.name}</Text>
          {g.items.map((i) => (
            <View key={i.id} style={styles.dish}>
              <View style={styles.flex1}>
                <Text style={styles.dishName}>{i.item_name}{priceText(i.price) ? `  ${priceText(i.price)}` : ''}</Text>
                {!!i.description && <Text style={styles.dishMeta}>{i.description}</Text>}
                {!!i.source_url && <Text style={styles.dishMeta} numberOfLines={1}>{i.source_url}</Text>}
              </View>
            </View>
          ))}
        </View>
      ))}

      {/* The restaurant's window */}
      <Modal visible={!!openGroup && tab !== 'rejected'} transparent animationType="fade" onRequestClose={closeWindow}>
        <View style={styles.backdrop}>
          {openGroup && (
            <View style={styles.dialog}>
              <Text style={styles.dialogTitle} numberOfLines={2}>{openGroup.name}</Text>

              {tab === 'pending' && (
                <View style={styles.bar}>
                  <Text style={styles.barText}>{selected.size} of {openGroup.items.length} selected</Text>
                  <TouchableOpacity disabled={busy} onPress={() => setAll(openGroup.items, true)} accessibilityRole="button">
                    <Text style={[styles.action, busy && styles.disabled]}>Select all</Text>
                  </TouchableOpacity>
                  <TouchableOpacity disabled={busy} onPress={() => setAll(openGroup.items, false)} accessibilityRole="button">
                    <Text style={[styles.action, busy && styles.disabled]}>Deselect all</Text>
                  </TouchableOpacity>
                </View>
              )}

              <ScrollView style={styles.dialogList}>
                {openGroup.items.map((i) => (
                  <TouchableOpacity key={i.id} style={styles.dish} disabled={tab !== 'pending' || busy} onPress={() => toggle(i.id)} accessibilityRole="button">
                    {tab === 'pending' && <Text style={styles.check}>{selected.has(i.id) ? '[x]' : '[ ]'}</Text>}
                    <View style={styles.flex1}>
                      <Text style={styles.dishName}>{i.item_name}{priceText(i.price) ? `  ${priceText(i.price)}` : ''}</Text>
                      {!!i.description && <Text style={styles.dishMeta}>{i.description}</Text>}
                      {!!i.source_url && <Text style={styles.dishMeta} numberOfLines={1}>{i.source_url}</Text>}
                      {tab === 'approved' && !!i.merged_at && <Text style={styles.dishMeta}>Added to the menu</Text>}
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={styles.buttons}>
                {tab === 'pending' && (
                  <>
                    <TouchableOpacity style={[styles.okBtn, off && styles.disabled]} disabled={off} onPress={() => decide(true)} accessibilityRole="button">
                      <Text style={styles.btnText}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.noBtn, off && styles.disabled]} disabled={off} onPress={() => decide(false)} accessibilityRole="button">
                      <Text style={styles.btnText}>Reject</Text>
                    </TouchableOpacity>
                  </>
                )}
                {tab === 'approved' && hasUnmerged(openGroup) && (
                  <TouchableOpacity style={[styles.okBtn, busy && styles.disabled]} disabled={busy} onPress={() => addToMenu(openGroup.placeId)} accessibilityRole="button">
                    <Text style={styles.btnText}>Add to menu</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={[styles.cancelBtn, busy && styles.disabled]} disabled={busy} onPress={closeWindow} accessibilityRole="button">
                  <Text style={styles.cancelText}>{tab === 'approved' && !hasUnmerged(openGroup) ? 'Close' : 'Cancel'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  content: { padding: 16, width: '100%', maxWidth: 760, alignSelf: 'center', paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '800', color: '#222', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888', lineHeight: 18, marginBottom: 12 },
  flex1: { flex: 1 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#ECEFF1', borderWidth: 1.5, borderColor: '#B0BEC5' },
  tabOn: { backgroundColor: '#1565C0', borderColor: '#1565C0' },
  tabText: { fontSize: 13, fontWeight: '800', color: '#546E7A' },
  tabTextOn: { color: '#fff' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 8, flexWrap: 'wrap' },
  barText: { fontSize: 12, color: '#666', fontWeight: '700', flex: 1 },
  okBtn: { backgroundColor: '#2E7D32', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9 },
  reviewBtn: { backgroundColor: '#1565C0', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9 },
  noBtn: { backgroundColor: '#c62828', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9 },
  cancelBtn: { backgroundColor: '#ECEFF1', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9, borderWidth: 1, borderColor: '#B0BEC5' },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  cancelText: { color: '#546E7A', fontWeight: '800', fontSize: 13 },
  hint: { fontSize: 12, color: '#888', marginTop: 4 },
  error: { fontSize: 12, color: '#c62828', marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e6e6e6', paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  doneText: { fontSize: 12, fontWeight: '700', color: '#777' },
  item: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e6e6e6', padding: 12, marginBottom: 10 },
  itemTitle: { fontSize: 15, fontWeight: '800', color: '#222' },
  action: { fontSize: 12, fontWeight: '800', color: '#1565C0', paddingVertical: 4 },
  dish: { flexDirection: 'row', gap: 8, borderTopWidth: 1, borderTopColor: '#eee', paddingVertical: 8 },
  check: { fontSize: 13, fontWeight: '800', color: '#1565C0' },
  dishName: { fontSize: 13, fontWeight: '700', color: '#222' },
  dishMeta: { fontSize: 11, color: '#777', marginTop: 2, lineHeight: 15 },
  disabled: { opacity: 0.5 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  dialog: { backgroundColor: '#fff', borderRadius: 14, padding: 16, width: '100%', maxWidth: 520, maxHeight: '85%' },
  dialogTitle: { fontSize: 17, fontWeight: '800', color: '#222', marginBottom: 8 },
  dialogList: { flexGrow: 0, marginBottom: 12 },
  buttons: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' },
});
