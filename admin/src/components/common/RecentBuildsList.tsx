import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { getChainBuildLog } from '../../api/chainMenus';
import { usePaging } from '../../hooks/usePaging';
import { PagerBar } from './PagerBar';
import {
  BUILD_LOG_HOURS, ChainBuildLogRow, canManageFromBuild, describeBuildOutcome, formatLastRun, manageChainParams,
  summarizeBuildLog,
} from '../../utils/chainMenuSources';

const TONES = {
  good: { bg: '#E8F5E9', fg: '#2E7D32' },
  warn: { bg: '#FFF3E0', fg: '#E65100' },
  bad: { bg: '#FFEBEE', fg: '#c62828' },
  neutral: { bg: '#E3F2FD', fg: '#1565C0' },
} as const;

const hoursLabel = (h: number) => (h < 24 ? `${h} h` : `${h / 24} d`);

// "Recent builds" inside the Scheduled builds panel (migration 097): the chains the hourly job, or
// "Run a batch now", started in the last N hours, with each chain's outcome. Loads when shown.
// Shows nothing but a short note if the list cannot be read (for example migration 097 is not applied yet).
// kind: show only franchise builds ('chain') or only independent-restaurant builds ('place'); leave out to show both. Paged, 20 to a page.
const BUILDS_PAGE_SIZE = 20;

export default function RecentBuildsList({ kind }: { kind?: 'chain' | 'place' }) {
  const router = useRouter();
  const [hours, setHours] = useState(24);
  const [rows, setRows] = useState<ChainBuildLogRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (h: number) => {
    setLoading(true);
    setFailed(false);
    try {
      setRows(await getChainBuildLog(h));
    } catch (error: any) {
      console.warn('[admin-chain-menus] Build log unavailable:', error?.message);
      setRows(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(hours);
  }, [load, hours]);

  // a build log from before migration 105 has no kind: those are franchise builds
  const shown = rows ? rows.filter((r) => !kind || (r.kind ?? 'chain') === kind) : null;
  const summary = shown ? summarizeBuildLog(shown) : null;
  const paging = usePaging(shown ?? [], `${hours}|${kind ?? 'all'}`, undefined, BUILDS_PAGE_SIZE);

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Text style={styles.title}>{kind === 'place' ? 'Recent restaurant builds' : kind === 'chain' ? 'Recent franchise builds' : 'Recent builds'}</Text>
        <TouchableOpacity onPress={() => load(hours)} disabled={loading} accessibilityRole="button">
          <Text style={[styles.refresh, loading && styles.disabled]}>↻ Refresh</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.optionRow}>
        {BUILD_LOG_HOURS.map((h) => (
          <TouchableOpacity
            key={h}
            style={[styles.option, hours === h && styles.optionActive]}
            onPress={() => setHours(h)}
            accessibilityRole="button"
          >
            <Text style={[styles.optionText, hours === h && styles.optionTextActive]}>Last {hoursLabel(h)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && !rows && <ActivityIndicator size="small" color="#1565C0" style={styles.spinner} />}
      {failed && <Text style={styles.note}>The list is not available yet (migration 097 may not be applied).</Text>}

      {summary && (
        <Text style={styles.summary}>
          {summary.total === 0
            ? `No builds started in the last ${hoursLabel(hours)}.`
            : `${summary.total} started · ${summary.built} built · ${summary.failed} failed${summary.running ? ` · ${summary.running} running` : ''}`}
        </Text>
      )}

      {(shown ? paging.pageItems : []).map((r) => {
        const outcome = describeBuildOutcome(r.outcome);
        const tone = TONES[outcome.tone];
        return (
          <View key={`${r.chain_id ?? r.place_id ?? r.chain_name}|${r.started_at}`} style={styles.row}>
            <View style={styles.rowTop}>
              {r.kind === 'place' && !r.place_id ? (
                <Text style={styles.chain} numberOfLines={1}>{r.chain_name}</Text>
              ) : (
                <TouchableOpacity
                  style={styles.chainWrap}
                  onPress={() =>
                    router.push({
                      pathname: '/admin/menu-edit',
                      params: r.kind === 'place' ? { name: r.chain_name, placeId: r.place_id } : { name: r.chain_name },
                    } as any)}
                  accessibilityRole="link"
                  accessibilityLabel={`Edit the menu of ${r.chain_name}`}
                >
                  <Text style={[styles.chain, styles.chainLink]} numberOfLines={1}>{r.chain_name}</Text>
                </TouchableOpacity>
              )}
              <Text style={[styles.badge, { backgroundColor: tone.bg, color: tone.fg }]}>
                {outcome.label}{r.outcome === 'ok' ? ` · ${r.item_count} items` : ''}
              </Text>
            </View>
            <Text style={styles.meta}>
              {formatLastRun(r.started_at, null)} · {r.kind === 'place' ? `restaurant · link from ${r.source === 'google' ? 'Google' : r.source}` : `franchise · ${r.source}`}
            </Text>
            {!!r.detail && r.outcome !== 'ok' && <Text style={styles.detail} numberOfLines={2}>{r.detail}</Text>}
            {canManageFromBuild(r) && (
              <TouchableOpacity
                style={styles.manageBtn}
                onPress={() =>
                  r.kind === 'place'
                    ? router.push({ pathname: '/admin/menu-management/by-place', params: { placeId: r.place_id } } as any)
                    : router.push({ pathname: '/admin/chain-menus', params: manageChainParams(r.chain_id) } as any)}
                accessibilityRole="button"
              >
                <Text style={styles.manageBtnText}>{r.kind === 'place' ? '⚙ Upload menu for' : '⚙ Manage'} {r.chain_name}</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}

      <PagerBar page={paging.page} pageCount={paging.pageCount} from={paging.from} to={paging.to} total={paging.total} onPage={paging.goTo} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#eee' },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 12, fontWeight: '800', color: '#333' },
  refresh: { fontSize: 12, fontWeight: '700', color: '#1565C0' },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6, marginBottom: 6 },
  option: { backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#ccc' },
  optionActive: { backgroundColor: '#1565C0', borderColor: '#1565C0' },
  optionText: { fontSize: 11, fontWeight: '600', color: '#444' },
  optionTextActive: { color: '#fff' },
  spinner: { alignSelf: 'flex-start', marginVertical: 6 },
  note: { fontSize: 12, color: '#E65100', marginVertical: 4 },
  summary: { fontSize: 12, color: '#555', marginBottom: 4 },
  row: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#f2f2f2' },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chain: { fontSize: 13, fontWeight: '700', color: '#222', flex: 1 },
  chainWrap: { flex: 1 },
  chainLink: { color: '#1565C0', textDecorationLine: 'underline' },
  badge: { fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  meta: { fontSize: 11, color: '#888' },
  detail: { fontSize: 11, color: '#c62828' },
  manageBtn: { alignSelf: 'flex-start', marginTop: 4, backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  manageBtnText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  disabled: { opacity: 0.5 },
});
