import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { Alert } from '../../utils/alert';
import {
  approveChainLinkSuggestion, dismissChainLinkSuggestion, getChainLinkSuggestions, replaceChainLinkSuggestion,
} from '../../api/chainMenus';
import {
  buildReplaceMessage, ChainLinkSuggestion, describeSuggestionTrust, isReplacement, shortLink,
} from '../../utils/chainMenuSources';

const TONES = {
  good: { bg: '#E8F5E9', fg: '#2E7D32' },
  warn: { bg: '#FFF3E0', fg: '#E65100' },
  neutral: { bg: '#ECEFF1', fg: '#546E7A' },
} as const;

// Review list (migrations 093 + 094): menu page links that owners of a chain's locations saved on their
// Restaurant Profile. Approve fills a chain's EMPTY built-in menu page (a fallback used only when Google has
// no menu link). Replace swaps one that is already set, only after a confirm that shows both links, and the
// server refuses if the page changed since this list was loaded. Nothing changes until an admin chooses.
// Hidden when there is nothing to review or the list cannot be read (for example migration 093 is not applied
// yet), so the page itself is never affected.
export default function LinkSuggestionsPanel({ onApproved }: { onApproved: () => void }) {
  const [rows, setRows] = useState<ChainLinkSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await getChainLinkSuggestions());
    } catch (error: any) {
      console.warn('[admin-chain-menus] Link suggestions unavailable:', error?.message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (rows.length === 0) return null;

  async function run(row: ChainLinkSuggestion, kind: 'approve' | 'replace' | 'dismiss') {
    const key = `${row.chain_id}|${row.suggested_link}`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      if (kind === 'approve') {
        await approveChainLinkSuggestion(row.chain_id, row.suggested_link);
        Alert.alert(
          'Approved',
          `${row.chain_name} now has this built-in menu page. It is marked for a fresh lookup on its next visit (or the next scheduled build). The page is used only when Google has no menu link for it.`,
        );
        onApproved();
      } else if (kind === 'replace') {
        await replaceChainLinkSuggestion(row.chain_id, row.suggested_link, row.current_menu_url ?? null);
        Alert.alert(
          'Replaced',
          `${row.chain_name}'s built-in menu page was replaced. It is marked for a fresh lookup on its next visit (or the next scheduled build).`,
        );
        onApproved();
      } else {
        await dismissChainLinkSuggestion(row.chain_id, row.suggested_link);
      }
      await load();
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Something went wrong');
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  // Replacing needs a confirm that shows both links; filling an empty page does not.
  function choose(row: ChainLinkSuggestion, kind: 'approve' | 'dismiss') {
    if (kind === 'approve' && isReplacement(row)) {
      Alert.alert('Replace the built-in menu page?', buildReplaceMessage(row), [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', style: 'destructive', onPress: () => run(row, 'replace') },
      ]);
      return;
    }
    run(row, kind);
  }

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.header} onPress={() => setOpen((v) => !v)} accessibilityRole="button">
        <Text style={styles.title}>{open ? '▾' : '▸'} Menu page suggestions from owners</Text>
        <Text style={styles.count}>{rows.length}</Text>
      </TouchableOpacity>

      {open && (
        <View style={styles.body}>
          <Text style={styles.hint}>
            Owners of these chains' locations saved these on their profile. Check a link opens the real menu first.
            Approve fills an empty built-in menu page; Replace (orange) swaps one that is already set, after you confirm.
          </Text>
          {rows.map((row) => {
            const key = `${row.chain_id}|${row.suggested_link}`;
            const trust = describeSuggestionTrust(row);
            const tone = TONES[trust.tone];
            const busy = busyKey === key;
            const replacing = isReplacement(row);
            return (
              <View key={key} style={styles.row}>
                <Text style={styles.chain}>{row.chain_name}</Text>
                {replacing && (
                  <Text style={styles.current} numberOfLines={2}>Current: {shortLink(row.current_menu_url ?? '', 80)}</Text>
                )}
                <Text style={styles.link} selectable numberOfLines={2}>
                  {replacing ? 'Suggested: ' : ''}{shortLink(row.suggested_link, 80)}
                </Text>
                <Text style={[styles.badge, { backgroundColor: tone.bg, color: tone.fg }]}>{trust.label}</Text>
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.openBtn} onPress={() => Linking.openURL(row.suggested_link)} accessibilityRole="button">
                    <Text style={styles.openText}>↗ Open</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.approveBtn, replacing && styles.replaceBtn, !!busyKey && styles.disabled]}
                    disabled={!!busyKey}
                    onPress={() => choose(row, 'approve')}
                    accessibilityRole="button"
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.approveText}>{replacing ? '⇄ Replace' : '✓ Approve'}</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.dismissBtn, !!busyKey && styles.disabled]}
                    disabled={!!busyKey}
                    onPress={() => choose(row, 'dismiss')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.dismissText}>Dismiss</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e0e0e0', marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 12, paddingVertical: 9 },
  title: { fontSize: 13, fontWeight: '700', color: '#333', flex: 1 },
  count: { fontSize: 11, fontWeight: '800', color: '#fff', backgroundColor: '#E65100', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  body: { paddingHorizontal: 12, paddingBottom: 10, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 8 },
  hint: { fontSize: 12, color: '#666', lineHeight: 17, marginBottom: 8 },
  row: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f0f0f0', gap: 3 },
  chain: { fontSize: 13, fontWeight: '800', color: '#222' },
  current: { fontSize: 12, color: '#888' },
  link: { fontSize: 12, color: '#1565C0' },
  badge: { alignSelf: 'flex-start', fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  openBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1.5, borderColor: '#9aa5ad', backgroundColor: '#fff' },
  openText: { fontSize: 12, fontWeight: '700', color: '#455a64' },
  approveBtn: { backgroundColor: '#2E7D32', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, minWidth: 90, alignItems: 'center', elevation: 2 },
  replaceBtn: { backgroundColor: '#E65100' },
  approveText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  dismissBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1.5, borderColor: '#c62828', backgroundColor: '#fff' },
  dismissText: { fontSize: 12, fontWeight: '700', color: '#c62828' },
  disabled: { opacity: 0.5 },
});
