import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Alert } from '../../utils/alert';
import { getChainBuildStatus, runChainBuildsNow, setChainBuildsPerRun } from '../../api/chainMenus';
import RecentBuildsList from './RecentBuildsList';
import UnconfirmedClickedList from './UnconfirmedClickedList';
import {
  BUILDS_PER_RUN_OPTIONS, ChainBuildStatus, describeBuildStatus, describeSchedule, formatLastRun,
} from '../../utils/chainMenuSources';
import { IconText } from './AppIcon';

const TONES = {
  good: { bg: '#E8F5E9', fg: '#2E7D32' },
  warn: { bg: '#FFF3E0', fg: '#E65100' },
  bad: { bg: '#FFEBEE', fg: '#c62828' },
  neutral: { bg: '#ECEFF1', fg: '#546E7A' },
} as const;

// A row of choices (one is the current value). 0 reads "Paused".
function Choices({
  options, value, disabled, onPick,
}: { options: number[]; value: number | undefined; disabled: boolean; onPick: (n: number) => void }) {
  return (
    <View style={styles.optionRow}>
      {options.map((n) => (
        <TouchableOpacity
          key={n}
          style={[styles.option, value === n && styles.optionActive, disabled && styles.disabled]}
          disabled={disabled}
          onPress={() => onPick(n)}
          accessibilityRole="button"
        >
          <Text style={[styles.optionText, value === n && styles.optionTextActive]}>{n === 0 ? 'Paused' : n}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// The scheduled menu builds (migrations 087-106), in one collapsible panel with the two kinds of work kept apart:
//   Franchises             one shared menu per franchise: how many each run builds, and "Run Menu Build Now"
//   Independent restaurants the ones customers opened that have no confirmed menu item (migration 119), each with
//                          Manage so the admin can upload a menu; their menus are read by the browser crawler
// followed by the list of recent builds. The schedule and last run are for the franchise builds.
// Shows nothing when the status cannot be read (for example migration 089 is not applied yet), so the Franchise Menu
// Management page itself is never affected.
// standalone: shown on its own page (Tools -> Scheduled Builds), so it is always open and the header does not fold.
export default function ScheduledBuildsPanel({ standalone = false }: { standalone?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<ChainBuildStatus | null>(null);
  const [open, setOpen] = useState(standalone);
  const [busy, setBusy] = useState(false);
  // Bumped after a run so the recent builds list below reloads and shows what was started.
  const [logKey, setLogKey] = useState(0);

  const load = useCallback(async () => {
    try {
      setStatus(await getChainBuildStatus());
    } catch (error: any) {
      console.warn('[admin-chain-menus] Scheduled builds status unavailable:', error?.message);
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!status) {
    // On its own page an empty screen would be confusing; in the old embedded spot it simply stayed hidden.
    return standalone ? (
      <Text style={styles.warning}>
        The status could not be loaded. Check that the latest database migrations are applied and that you are signed in as an admin.
      </Text>
    ) : null;
  }

  const info = describeBuildStatus(status);
  const tone = TONES[info.tone];

  // Change one setting, then reload the status.
  async function change(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await load();
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Could not change the setting');
    } finally {
      setBusy(false);
    }
  }

  async function runFranchises() {
    if (busy) return;
    setBusy(true);
    try {
      const started = await runChainBuildsNow();
      setLogKey((k) => k + 1);
      Alert.alert(
        started > 0 ? 'Batch started' : 'Nothing started',
        started > 0
          ? `${started} franchise${started === 1 ? '' : 's'} are being built. Each takes up to a minute; refresh this page to see the results.`
          : 'No franchise is waiting, builds are paused, or the key and server address are not stored yet.',
      );
      await load();
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Could not start the batch');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.header}
        disabled={standalone}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole={standalone ? undefined : 'button'}
      >
        <Text style={styles.title}>{standalone ? 'Status' : `${open ? '▾' : '▸'} Scheduled builds`}</Text>
        <Text style={[styles.badge, { backgroundColor: tone.bg, color: tone.fg }]}>{info.label}</Text>
      </TouchableOpacity>

      {open && (
        <View style={styles.body}>
          {/* Shared by both kinds */}
          <Text style={styles.line}>Schedule: {describeSchedule(status.job_schedule)}</Text>
          <Text style={styles.line}>Last run: {formatLastRun(status.last_run_at, status.last_run_status)}</Text>
          {!!status.last_run_detail && status.last_run_status === 'failed' && (
            <Text style={styles.warning}>{status.last_run_detail}</Text>
          )}
          {!status.configured && (
            <Text style={styles.warning}>
              The server key and address are not stored yet, so no builds start. See migration 087 for the one-time setup.
            </Text>
          )}

          {/* Franchises */}
          <View style={[styles.section, styles.sectionFranchise]}>
            <View style={[styles.band, styles.bandFranchise]}>
              <IconText style={styles.bandTitle} emoji="🍔">Franchises</IconText>
            </View>
            <Text style={styles.sectionHint}>One shared menu for each franchise, built from its official menu page.</Text>
            <Text style={styles.line}>
              Waiting: {status.queued_count}
              {status.queued_names.length > 0
                ? ` (next: ${status.queued_names.join(', ')}${status.queued_count > status.queued_names.length ? ', …' : ''})`
                : ''}
            </Text>
            <TouchableOpacity onPress={() => router.push('/admin/chain-menus?filter=attention')} accessibilityRole="button">
              <Text style={styles.reportLink}>View franchises whose menu could not be built →</Text>
            </TouchableOpacity>
            <Text style={styles.label}>Franchises per run (0 pauses)</Text>
            <Choices
              options={BUILDS_PER_RUN_OPTIONS}
              value={status.per_run}
              disabled={busy}
              onPick={(n) => n !== status.per_run && change(() => setChainBuildsPerRun(n))}
            />
            <TouchableOpacity style={[styles.runBtn, busy && styles.disabled]} disabled={busy} onPress={runFranchises} accessibilityRole="button">
              {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.runBtnText}>▶ Run Menu Build Now</Text>}
            </TouchableOpacity>
          </View>

          {/* Independent restaurants */}
          <View style={[styles.section, styles.sectionRestaurant]}>
            <View style={[styles.band, styles.bandRestaurant]}>
              <IconText style={styles.bandTitle} emoji="🍽️">Independent restaurants</IconText>
            </View>
            <Text style={styles.sectionHint}>
              Restaurants customers opened that have no confirmed menu item. Use Manage to upload a menu.
            </Text>
            <UnconfirmedClickedList />
          </View>

          <RecentBuildsList key={logKey} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e0e0e0', marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 12, paddingVertical: 9 },
  title: { fontSize: 13, fontWeight: '700', color: '#333' },
  badge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
  body: { paddingHorizontal: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 8 },
  line: { fontSize: 12, color: '#555', marginBottom: 3 },
  warning: { fontSize: 12, color: '#E65100', marginBottom: 4 },
  note: { fontSize: 11, color: '#999', marginTop: 4 },
  reportLink: { fontSize: 12, fontWeight: '700', color: '#1565C0', marginTop: 2 },
  section: { marginTop: 12, borderWidth: 1, borderColor: '#e6e6e6', borderLeftWidth: 4, borderRadius: 8, padding: 10, backgroundColor: '#fafafa', overflow: 'hidden' },
  sectionFranchise: { borderLeftColor: '#1565C0' },
  sectionRestaurant: { borderLeftColor: '#2E7D32' },
  band: { marginHorizontal: -10, marginTop: -10, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 9, borderTopRightRadius: 6 },
  bandFranchise: { backgroundColor: '#1565C0' },
  bandRestaurant: { backgroundColor: '#2E7D32' },
  bandTitle: { fontSize: 14, fontWeight: '800', color: '#fff', letterSpacing: 0.2 },
  sectionHint: { fontSize: 11, color: '#888', marginTop: 2, marginBottom: 6, lineHeight: 15 },
  label: { fontSize: 11, fontWeight: '700', color: '#666', marginTop: 8, marginBottom: 4 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  option: { backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#ccc' },
  optionActive: { backgroundColor: '#1565C0', borderColor: '#1565C0' },
  optionText: { fontSize: 12, fontWeight: '600', color: '#444' },
  optionTextActive: { color: '#fff' },
  runBtn: { marginTop: 10, alignSelf: 'flex-start', backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9, elevation: 2 },
  runBtnText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  queueBtn: { marginTop: 10, alignSelf: 'flex-start', backgroundColor: '#2E7D32', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9, elevation: 2 },
  queueBtnText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  disabled: { opacity: 0.5 },
});
