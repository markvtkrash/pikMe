import { useCallback, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, Modal, Platform, ScrollView,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Alert, confirmDialog } from '../../src/utils/alert';
import { TypeToConfirmModal } from '../../src/components/common/TypeToConfirmModal';
import { PagerBar } from '../../src/components/common/PagerBar';
import { usePaging } from '../../src/hooks/usePaging';
import {
  getRegionGateValue, getRegionWaitlist, listRegions, setRegion, setRegionGateValue, turnOffAllRegions,
} from '../../src/api/regions';
import {
  describeGoLive, filterRegions, goLiveInputValue, parseGoLive, readinessWarning, Region, regionCounts, RegionFilter, regionSwitchText,
  REGION_SWITCH_KEY, statusLabel, TURN_OFF_ALL_PHRASE,
} from '../../src/utils/regions';

// Region launch control: the app is open to customers state by state. A customer can use it only in a state that is Live (the master switch below
// decides whether this is enforced at all). A Scheduled state opens by itself at its time. Staff accounts are never blocked.

const FILTERS: { key: RegionFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'off', label: 'Off' },
];

const TONES = {
  Live: { bg: '#E8F5E9', fg: '#1B5E20' },
  Scheduled: { bg: '#FFF3E0', fg: '#BF360C' },
  Off: { bg: '#ECEFF1', fg: '#546E7A' },
} as const;

async function copyText(text: string) {
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      Alert.alert('Copied', 'Copied to the clipboard.');
    }
  } catch {
    // the text is still selectable on screen
  }
}

export default function AdminRegionsScreen() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [gateValue, setGateValue] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<RegionFilter>('all');
  const [search, setSearch] = useState('');

  const [switchOpen, setSwitchOpen] = useState(false);
  const [offAllOpen, setOffAllOpen] = useState(false);
  const [editing, setEditing] = useState<Region | null>(null);
  const [editWhen, setEditWhen] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [waitlistFor, setWaitlistFor] = useState<Region | null>(null);
  const [waitlist, setWaitlist] = useState<{ email: string; createdAt: string }[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const [list, gate] = await Promise.all([listRegions(), getRegionGateValue()]);
      setRegions(list);
      setGateValue(gate);
    } catch (e: any) {
      console.error('[admin-regions] Load error:', e);
      Alert.alert('Error', e?.message || 'Could not load the regions (has migration 142 been run?)');
    } finally {
      setLoading(false);
    }
  }

  // one place for every change to a region
  async function change(region: Region, status: 'off' | 'scheduled' | 'live', goLiveAt: string | null, note: string, done?: string) {
    setBusyKey(region.stateCode);
    try {
      await setRegion(region.stateCode, status, goLiveAt, note);
      await load(true);
      if (done) Alert.alert('Saved', done);
      return true;
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not change the state');
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  async function goLiveNow(region: Region) {
    const warning = readinessWarning(region);
    const message = `${region.name} opens to customers right away${gateValue === 'true' ? '' : ' (region gating is OFF at the moment, so nobody is blocked yet)'}.${warning ? `\n\nHeads up: ${warning}` : ''}`;
    if (!(await confirmDialog(`Open ${region.name}?`, message, { confirmText: 'Go live' }))) return;
    await change(region, 'live', null, region.note ?? '');
  }

  async function turnOff(region: Region) {
    if (!(await confirmDialog(`Turn ${region.name} off?`, `Customers in ${region.name} will see "Coming soon" if region gating is ON.`, { confirmText: 'Turn off', destructive: true }))) return;
    await change(region, 'off', null, region.note ?? '');
  }

  function openEdit(region: Region) {
    setEditing(region);
    setEditWhen(region.status === 'scheduled' ? goLiveInputValue(region.goLiveAt) : '');
    setEditNote(region.note ?? '');
    setEditError(null);
  }

  async function saveEdit() {
    if (!editing) return;
    const when = editWhen.trim();
    if (when) {
      const iso = parseGoLive(when);
      if (!iso) {
        setEditError('Enter the time as year-month-day hour:minute, for example 2026-11-01 09:00 (24-hour, your own time zone).');
        return;
      }
      const ok = await change(editing, 'scheduled', iso, editNote, `${editing.name} is scheduled to open ${describeGoLive(iso)}.`);
      if (ok) setEditing(null);
      return;
    }
    // no time typed: keep the state as it is and save the note only
    const keepScheduled = editing.status === 'scheduled' && !editing.isOpen && !!editing.goLiveAt;
    const ok = await change(editing, keepScheduled ? 'scheduled' : editing.isOpen ? 'live' : editing.status, keepScheduled ? editing.goLiveAt : null, editNote, 'The note is saved.');
    if (ok) setEditing(null);
  }

  async function openWaitlist(region: Region) {
    setWaitlistFor(region);
    setWaitlist(null);
    try {
      setWaitlist(await getRegionWaitlist(region.stateCode));
    } catch (e: any) {
      setWaitlistFor(null);
      Alert.alert('Error', e?.message || 'Could not load the waitlist');
    }
  }

  async function confirmSwitch() {
    if (gateValue == null) return;
    setBusyKey(REGION_SWITCH_KEY);
    try {
      const next = gateValue === 'true' ? 'false' : 'true';
      await setRegionGateValue(next);
      setGateValue(next);
      setSwitchOpen(false);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not change the switch');
    } finally {
      setBusyKey(null);
    }
  }

  async function confirmTurnOffAll() {
    setBusyKey('all');
    try {
      const n = await turnOffAllRegions();
      await load(true);
      setOffAllOpen(false);
      Alert.alert('Done', n === 0 ? 'Every state was already off.' : `${n} state${n === 1 ? '' : 's'} turned off.`);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not turn the states off');
    } finally {
      setBusyKey(null);
    }
  }

  const filtered = filterRegions(regions, filter, search);
  const listRef = useRef<FlatList<Region>>(null);
  const paging = usePaging(filtered, `${filter}|${search}`, () => listRef.current?.scrollToOffset({ offset: 0, animated: false }));
  const counts = regionCounts(regions);
  const text = regionSwitchText(gateValue ?? undefined);

  if (loading) {
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
          ref={listRef}
          data={paging.pageItems}
          keyExtractor={(r) => r.stateCode}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View>
              <Text style={styles.hint}>
                Open the app to customers one state at a time. A customer can use it only in a state that is Live, decided by where they are standing.
                A Scheduled state opens by itself at its time. Admin and owner accounts are never blocked.
              </Text>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Region gating</Text>
                <Text style={styles.state}>{gateValue == null ? 'Not set up yet (run migration 142).' : text.state}</Text>
                <View style={styles.cardButtons}>
                  <TouchableOpacity
                    style={[styles.switchBtn, text.on ? styles.switchBtnOff : styles.switchBtnOn, (gateValue == null || busyKey === REGION_SWITCH_KEY) && styles.disabled]}
                    disabled={gateValue == null || busyKey === REGION_SWITCH_KEY}
                    onPress={() => setSwitchOpen(true)}
                    accessibilityRole="button"
                  >
                    {busyKey === REGION_SWITCH_KEY ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnText}>{text.button}</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.emergencyBtn, (counts.live + counts.scheduled === 0 || busyKey === 'all') && styles.disabled]}
                    disabled={counts.live + counts.scheduled === 0 || busyKey === 'all'}
                    onPress={() => setOffAllOpen(true)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.emergencyText}>🛑 Turn all regions off</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.chips}>
                {FILTERS.map((f) => {
                  const n = f.key === 'all' ? counts.all : counts[f.key];
                  const on = filter === f.key;
                  return (
                    <TouchableOpacity key={f.key} style={[styles.chip, on && styles.chipOn]} onPress={() => setFilter(f.key)} accessibilityRole="button" accessibilityState={{ selected: on }}>
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label} ({n})</Text>
                    </TouchableOpacity>
                  );
                })}
                <Text style={styles.waitTotal}>{counts.waitlist} on waitlists</Text>
              </View>

              <TextInput
                style={styles.search}
                placeholder="Search a state…"
                placeholderTextColor="#999"
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
              />
            </View>
          }
          renderItem={({ item }) => {
            const label = statusLabel(item);
            const tone = TONES[label as keyof typeof TONES];
            const warning = item.isOpen ? null : readinessWarning(item);
            const busy = busyKey === item.stateCode;
            return (
              <View style={styles.row}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowName}>{item.name} <Text style={styles.rowCode}>{item.stateCode}</Text></Text>
                  <Text style={[styles.badge, { backgroundColor: tone.bg, color: tone.fg }]}>{label}</Text>
                </View>
                {item.status === 'scheduled' && !item.isOpen && !!item.goLiveAt && <Text style={styles.when}>Opens {describeGoLive(item.goLiveAt)}</Text>}
                <Text style={styles.counts}>
                  {item.restaurantCount} restaurants · {item.withMenuCount} with menus · {item.waitlistCount} waiting
                </Text>
                {!!warning && <Text style={styles.warning}>⚠️ {warning}</Text>}
                {!!item.note && <Text style={styles.note}>“{item.note}”</Text>}
                <View style={styles.actions}>
                  {!item.isOpen && (
                    <TouchableOpacity style={[styles.act, styles.actGo, busy && styles.disabled]} disabled={busy} onPress={() => goLiveNow(item)} accessibilityRole="button">
                      <Text style={styles.actGoText}>Go live now</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={[styles.act, busy && styles.disabled]} disabled={busy} onPress={() => openEdit(item)} accessibilityRole="button">
                    <Text style={styles.actText}>Schedule / note…</Text>
                  </TouchableOpacity>
                  {(item.isOpen || item.status === 'scheduled') && (
                    <TouchableOpacity style={[styles.act, styles.actWarn, busy && styles.disabled]} disabled={busy} onPress={() => turnOff(item)} accessibilityRole="button">
                      <Text style={styles.actWarnText}>Turn off</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.act} onPress={() => openWaitlist(item)} accessibilityRole="button">
                    <Text style={styles.actText}>Waitlist ({item.waitlistCount})</Text>
                  </TouchableOpacity>
                  {busy && <ActivityIndicator size="small" color="#1565C0" />}
                </View>
              </View>
            );
          }}
          ListEmptyComponent={<Text style={styles.empty}>{search || filter !== 'all' ? 'No matching states' : 'No states yet (run migration 142)'}</Text>}
          ListFooterComponent={<PagerBar page={paging.page} pageCount={paging.pageCount} from={paging.from} to={paging.to} total={paging.total} onPage={paging.goTo} />}
        />
      </View>

      <TypeToConfirmModal
        visible={switchOpen}
        title={text.title}
        message={text.message}
        phrase={REGION_SWITCH_KEY}
        confirmLabel={text.button}
        destructive={!text.on}
        busy={busyKey === REGION_SWITCH_KEY}
        onConfirm={confirmSwitch}
        onCancel={() => setSwitchOpen(false)}
      />

      <TypeToConfirmModal
        visible={offAllOpen}
        title="Turn ALL regions off?"
        message={`Every state that is Live or Scheduled (${counts.live + counts.scheduled}) goes Off. If region gating is ON, customers everywhere will see "Coming soon". Use this in an emergency.`}
        phrase={TURN_OFF_ALL_PHRASE}
        confirmLabel="Turn all off"
        destructive
        busy={busyKey === 'all'}
        onConfirm={confirmTurnOffAll}
        onCancel={() => setOffAllOpen(false)}
      />

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={styles.overlay}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>{editing?.name}</Text>
            <Text style={styles.label}>Opens at (optional)</Text>
            <TextInput
              style={styles.input}
              value={editWhen}
              onChangeText={(v) => { setEditWhen(v); setEditError(null); }}
              placeholder="2026-11-01 09:00"
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.small}>Year-month-day hour:minute, 24-hour, in your own time zone. The state opens by itself at that time. Leave blank to keep the state as it is and save only the note.</Text>
            <Text style={styles.label}>Note (only admins see it)</Text>
            <TextInput style={styles.input} value={editNote} onChangeText={setEditNote} placeholder="e.g. first launch week" placeholderTextColor="#999" maxLength={300} />
            {!!editError && <Text style={styles.error}>{editError}</Text>}
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancel} onPress={() => setEditing(null)} accessibilityRole="button"><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.save} onPress={saveEdit} accessibilityRole="button"><Text style={styles.saveText}>{editWhen.trim() ? 'Schedule' : 'Save note'}</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!waitlistFor} transparent animationType="fade" onRequestClose={() => setWaitlistFor(null)}>
        <View style={styles.overlay}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>Waitlist: {waitlistFor?.name}</Text>
            {waitlist == null ? (
              <ActivityIndicator size="small" color="#1565C0" style={{ marginVertical: 20 }} />
            ) : waitlist.length === 0 ? (
              <Text style={styles.small}>Nobody is waiting for this state yet.</Text>
            ) : (
              <ScrollView style={styles.waitScroll}>
                <Text style={styles.emails} selectable>{waitlist.map((w) => w.email).join('\n')}</Text>
              </ScrollView>
            )}
            <View style={styles.modalButtons}>
              {!!waitlist && waitlist.length > 0 && (
                <TouchableOpacity style={styles.cancel} onPress={() => copyText(waitlist.map((w) => w.email).join('\n'))} accessibilityRole="button"><Text style={styles.cancelText}>Copy emails</Text></TouchableOpacity>
              )}
              <TouchableOpacity style={styles.save} onPress={() => setWaitlistFor(null)} accessibilityRole="button"><Text style={styles.saveText}>Close</Text></TouchableOpacity>
            </View>
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
  hint: { fontSize: 12, color: '#666', lineHeight: 17, paddingTop: 4, paddingBottom: 12 },
  list: { paddingHorizontal: 16, paddingVertical: 12 },

  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, gap: 8, borderWidth: 1, borderColor: '#CFD8DC', marginBottom: 14 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#222' },
  state: { fontSize: 13, fontWeight: '700', color: '#222', lineHeight: 18 },
  cardButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 2 },
  switchBtn: { borderRadius: 10, paddingVertical: 11, paddingHorizontal: 22, minWidth: 130, alignItems: 'center' },
  switchBtnOn: { backgroundColor: '#C62828' },
  switchBtnOff: { backgroundColor: '#78909C' },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  emergencyBtn: { borderRadius: 10, paddingVertical: 11, paddingHorizontal: 18, borderWidth: 2, borderColor: '#C62828', backgroundColor: '#FFEBEE' },
  emergencyText: { color: '#C62828', fontSize: 13, fontWeight: '800' },
  disabled: { opacity: 0.4 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: '#CFD8DC' },
  chipOn: { backgroundColor: '#E3F2FD', borderColor: '#1565C0' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#546E7A' },
  chipTextOn: { color: '#1565C0' },
  waitTotal: { fontSize: 12, color: '#888', marginLeft: 'auto' },
  search: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#222', marginBottom: 12, borderWidth: 1.5, borderColor: '#B0BEC5' },

  row: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#CFD8DC', gap: 4 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  rowName: { fontSize: 15, fontWeight: '800', color: '#222', flexShrink: 1 },
  rowCode: { fontSize: 12, color: '#90A4AE', fontWeight: '700' },
  badge: { fontSize: 11, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, overflow: 'hidden', textTransform: 'uppercase' },
  when: { fontSize: 12, fontWeight: '700', color: '#BF360C' },
  counts: { fontSize: 12, color: '#607D8B' },
  warning: { fontSize: 12, color: '#BF360C', fontWeight: '600' },
  note: { fontSize: 12, color: '#78909C', fontStyle: 'italic' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 6 },
  act: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#F5F5F5' },
  actText: { fontSize: 12, fontWeight: '700', color: '#333' },
  actGo: { backgroundColor: '#2E7D32' },
  actGoText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  actWarn: { backgroundColor: '#FFEBEE' },
  actWarnText: { fontSize: 12, fontWeight: '700', color: '#C62828' },
  empty: { textAlign: 'center', color: '#888', paddingVertical: 30 },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 460, maxHeight: '90%', backgroundColor: '#fff', borderRadius: 16, padding: 20, gap: 8, borderWidth: 1, borderColor: '#CFD8DC' },
  label: { fontSize: 13, fontWeight: '700', color: '#222', marginTop: 6 },
  small: { fontSize: 12, color: '#777', lineHeight: 17 },
  input: { paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: '#222', backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#B0BEC5', borderRadius: 8 },
  error: { fontSize: 13, color: '#C62828' },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  cancel: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: '#f0f0f0' },
  cancelText: { color: '#555', fontWeight: '700' },
  save: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, backgroundColor: '#1565C0', minWidth: 90, alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '800' },
  waitScroll: { maxHeight: 300 },
  emails: { fontSize: 13, color: '#222', lineHeight: 20 },
});
