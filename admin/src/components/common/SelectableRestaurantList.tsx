import { useState, useMemo, ReactNode } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, Modal,
} from 'react-native';
import { Alert } from '../../utils/alert';
import { deleteCachedRestaurants } from '../../api/reports';

export const REPORT_PAGE_SIZE = 50;

interface BaseRow {
  place_id: string;
  restaurant_name: string;
  address: string | null;
  city: string | null;
}

interface Props<T extends BaseRow> {
  rows: T[];
  // Title, subtitle and count box, rendered above the controls.
  header: ReactNode;
  accent: string;
  searchPlaceholder: string;
  // Extra text the search box should match beyond name/city/address.
  extraSearchText?: (row: T) => string;
  // Extra content under the name/address (badges, cuisine types, ...).
  renderExtra?: (row: T) => ReactNode;
  // Optional per-row action (e.g. "Add as franchise").
  renderAction?: (row: T) => ReactNode;
  emptyText: string;
  // Called after a delete so the page can reload its data.
  onDeleted: () => void | Promise<void>;
}

// Shared by the Franchise Matches and Non-Franchise reports: 50 rows per
// page, a checkbox per row, "Select all on this page", and a bulk delete that
// removes the cached restaurants plus their dependent data (migration 064).
export function SelectableRestaurantList<T extends BaseRow>({
  rows, header, accent, searchPlaceholder, extraSearchText, renderExtra, renderAction, emptyText, onDeleted,
}: Props<T>) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.restaurant_name.toLowerCase().includes(q) ||
        (r.city ?? '').toLowerCase().includes(q) ||
        (r.address ?? '').toLowerCase().includes(q) ||
        (extraSearchText?.(r) ?? '').toLowerCase().includes(q)
    );
  }, [rows, search, extraSearchText]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / REPORT_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => filtered.slice(safePage * REPORT_PAGE_SIZE, (safePage + 1) * REPORT_PAGE_SIZE),
    [filtered, safePage]
  );

  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.place_id));

  function toggleOne(placeId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(placeId)) next.delete(placeId);
      else next.add(placeId);
      return next;
    });
  }

  // Selects every restaurant on the current page only; if they're all
  // already selected, it clears just this page's selection.
  function toggleSelectPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageRows.forEach((r) => next.delete(r.place_id));
      else pageRows.forEach((r) => next.add(r.place_id));
      return next;
    });
  }

  async function handleDelete() {
    const ids = Array.from(selected);
    setDeleting(true);
    try {
      const result = await deleteCachedRestaurants(ids);
      setConfirmOpen(false);
      setSelected(new Set());
      const parts = [
        `${result.deletedRestaurants} restaurant${result.deletedRestaurants === 1 ? '' : 's'} deleted`,
        `${result.deletedSavedRestaurants} saved-restaurant link${result.deletedSavedRestaurants === 1 ? '' : 's'} removed`,
        `${result.deletedMenuItems} menu item${result.deletedMenuItems === 1 ? '' : 's'} removed` +
          (result.deletedVerifiedMenuItems > 0 ? ` (${result.deletedVerifiedMenuItems} verified)` : ''),
      ];
      if (result.skippedClaimed > 0) {
        parts.push(`${result.skippedClaimed} skipped (claimed by an owner)`);
      }
      Alert.alert('Deleted', parts.join('\n'));
      await onDeleted();
    } catch (error: any) {
      console.error('[admin-cached-restaurants] Delete error:', error);
      setConfirmOpen(false);
      Alert.alert('Error', error.message || 'Failed to delete restaurants');
    } finally {
      setDeleting(false);
    }
  }

  const firstShown = filtered.length === 0 ? 0 : safePage * REPORT_PAGE_SIZE + 1;
  const lastShown = Math.min((safePage + 1) * REPORT_PAGE_SIZE, filtered.length);

  return (
    <View style={styles.container}>
      <View style={styles.pageWrapper}>
        <FlatList
          data={pageRows}
          keyExtractor={(item) => item.place_id}
          contentContainerStyle={styles.content}
          extraData={selected}
          ListHeaderComponent={
            <View>
              {header}
              <TextInput
                style={styles.search}
                placeholder={searchPlaceholder}
                value={search}
                onChangeText={(text) => { setSearch(text); setPage(0); }}
                autoCapitalize="none"
              />

              <View style={styles.toolbar}>
                <TouchableOpacity
                  style={[styles.selectAllBtn, { borderColor: accent }]}
                  onPress={toggleSelectPage}
                  disabled={pageRows.length === 0}
                >
                  <Text style={[styles.selectAllText, { color: accent }]}>
                    {allOnPageSelected ? 'Deselect page' : 'Select all on this page'}
                  </Text>
                </TouchableOpacity>
                {selected.size > 0 && (
                  <>
                    <TouchableOpacity onPress={() => setSelected(new Set())}>
                      <Text style={styles.clearText}>Clear ({selected.size})</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.deleteBtn} onPress={() => setConfirmOpen(true)}>
                      <Text style={styles.deleteBtnText}>🗑 Delete {selected.size}</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>

              <Text style={styles.rangeText}>
                {filtered.length === 0
                  ? '0 results'
                  : `Showing ${firstShown}–${lastShown} of ${filtered.length}`}
                {search !== '' ? ` (filtered from ${rows.length})` : ''}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const isSelected = selected.has(item.place_id);
            return (
              <View style={[styles.row, isSelected && { borderColor: accent, borderWidth: 1.5 }]}>
                <TouchableOpacity
                  style={[styles.checkbox, isSelected && { backgroundColor: accent, borderColor: accent }]}
                  onPress={() => toggleOne(item.place_id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                >
                  {isSelected && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.rowInfo} onPress={() => toggleOne(item.place_id)} activeOpacity={0.7}>
                  <Text style={styles.rowName}>{item.restaurant_name}</Text>
                  {!!(item.address || item.city) && (
                    <Text style={styles.rowAddress} numberOfLines={2}>{item.address || item.city}</Text>
                  )}
                  {renderExtra?.(item)}
                </TouchableOpacity>
                {renderAction?.(item)}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>{search ? 'No matches' : emptyText}</Text>
            </View>
          }
          ListFooterComponent={
            pageCount > 1 ? (
              <View style={styles.pager}>
                <TouchableOpacity
                  style={[styles.pagerBtn, safePage === 0 && styles.btnDisabled]}
                  onPress={() => setPage(safePage - 1)}
                  disabled={safePage === 0}
                >
                  <Text style={styles.pagerBtnText}>‹ Prev</Text>
                </TouchableOpacity>
                <Text style={styles.pagerLabel}>Page {safePage + 1} of {pageCount}</Text>
                <TouchableOpacity
                  style={[styles.pagerBtn, safePage >= pageCount - 1 && styles.btnDisabled]}
                  onPress={() => setPage(safePage + 1)}
                  disabled={safePage >= pageCount - 1}
                >
                  <Text style={styles.pagerBtnText}>Next ›</Text>
                </TouchableOpacity>
              </View>
            ) : null
          }
        />
      </View>

      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => !deleting && setConfirmOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Delete {selected.size} restaurant{selected.size === 1 ? '' : 's'}?
            </Text>
            <Text style={styles.modalMessage}>
              This permanently removes them from the cache, along with:{'\n'}
              • customers' saved-restaurant entries for them{'\n'}
              • all of their menu items, including any verified ones, and customers' saved copies of those items{'\n\n'}
              Not touched: restaurants claimed by an owner (they are skipped entirely), and menu items still
              used by another cached location with the same name.{'\n\n'}
              A restaurant comes back the next time someone searches near it.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfirmOpen(false)} disabled={deleting}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmDeleteBtn, deleting && styles.btnDisabled]}
                onPress={handleDelete}
                disabled={deleting}
              >
                {deleting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.confirmDeleteText}>Delete</Text>}
              </TouchableOpacity>
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
  content: { padding: 16, paddingBottom: 32 },

  search: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#222', marginBottom: 10 },

  toolbar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  selectAllBtn: { backgroundColor: '#fff', borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  selectAllText: { fontSize: 12, fontWeight: '700' },
  clearText: { fontSize: 12, fontWeight: '700', color: '#666' },
  deleteBtn: { backgroundColor: '#e53e3e', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  deleteBtnText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  rangeText: { fontSize: 12, color: '#888', marginBottom: 8 },

  row: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, elevation: 1, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderColor: 'transparent' },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#bbb', alignItems: 'center', justifyContent: 'center' },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '800', lineHeight: 16 },
  rowInfo: { flex: 1, gap: 3 },
  rowName: { fontSize: 14, fontWeight: '700', color: '#222' },
  rowAddress: { fontSize: 12, color: '#888' },

  emptyContainer: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#999' },

  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, paddingTop: 12 },
  pagerBtn: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9, elevation: 1 },
  pagerBtnText: { fontSize: 13, fontWeight: '700', color: '#222' },
  pagerLabel: { fontSize: 13, color: '#666', fontWeight: '600' },
  btnDisabled: { opacity: 0.4 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 440 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 8 },
  modalMessage: { fontSize: 13, color: '#555', lineHeight: 19, marginBottom: 18 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelBtnText: { fontSize: 13, fontWeight: '700', color: '#666' },
  confirmDeleteBtn: { backgroundColor: '#e53e3e', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 10, minWidth: 80, alignItems: 'center' },
  confirmDeleteText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});
