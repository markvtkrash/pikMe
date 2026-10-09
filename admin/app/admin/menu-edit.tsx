import { useState, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator,
  Modal, Switch,
} from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Alert, confirmDialog } from '../../src/utils/alert';
import {
  getRestaurantMenuForEdit, getMenuSharingInfo, saveMenuItem, previewDeleteMenuItems, deleteMenuItems, verifyMenuItems,
  EditableMenuItem, MenuSharingInfo, DeleteMenuItemsResult,
} from '../../src/api/menuAdmin';
import {
  emptyMenuItemForm, formFromItem, validateMenuItemForm,
  MenuItemFormValues, MenuItemFormField,
} from '../../src/utils/menuItemForm';

import {
  toggleUnverifiedSelection, unverifiedIds, verifiableSelection, verifySelectedQuestion,
} from '../../src/utils/menuEditSelection';

const PAGE_SIZE = 50;

type FormErrors = Partial<Record<MenuItemFormField, string>>;

const NUMBER_FIELDS: { field: MenuItemFormField; label: string; hint?: string }[] = [
  { field: 'calories', label: 'Calories *' },
  { field: 'protein_g', label: 'Protein (g) *' },
  { field: 'total_carbs_g', label: 'Carbs (g) *' },
  { field: 'total_fat_g', label: 'Fat (g) *' },
  { field: 'sodium_mg', label: 'Sodium (mg) *' },
  { field: 'saturated_fat_g', label: 'Saturated fat (g)' },
  { field: 'dietary_fiber_g', label: 'Fiber (g)' },
  { field: 'sugars_g', label: 'Sugars (g)' },
  { field: 'serving_weight_grams', label: 'Serving size (g)' },
];

// Defined at module level (not inside the screen) so typing in a field doesn't
// remount the form and drop focus.
function ItemForm({
  values, errors, onChange, onSave, onCancel, saving, saveLabel,
}: {
  values: MenuItemFormValues;
  errors: FormErrors;
  onChange: (next: MenuItemFormValues) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  saveLabel: string;
}) {
  const set = (field: MenuItemFormField, value: string | boolean) => onChange({ ...values, [field]: value });

  return (
    <View style={styles.form}>
      <Text style={styles.fieldLabel}>Item name *</Text>
      <TextInput
        style={[styles.input, !!errors.name && styles.inputError]}
        value={values.name}
        onChangeText={(t) => set('name', t)}
        placeholder="e.g. Crunchy Taco"
        placeholderTextColor="#999"
        editable={!saving}
      />
      {!!errors.name && <Text style={styles.errorText}>{errors.name}</Text>}

      <View style={styles.fieldGrid}>
        {NUMBER_FIELDS.map(({ field, label }) => (
          <View key={field} style={styles.fieldCell}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <TextInput
              style={[styles.input, !!errors[field] && styles.inputError]}
              value={String(values[field])}
              onChangeText={(t) => set(field, t)}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor="#999"
              editable={!saving}
            />
            {!!errors[field] && <Text style={styles.errorText}>{errors[field]}</Text>}
          </View>
        ))}
      </View>

      <View style={styles.switchRow}>
        <View style={styles.switchItem}>
          <Switch value={values.is_verified} onValueChange={(v) => set('is_verified', v)} disabled={saving} />
          <Text style={styles.switchLabel}>Verified</Text>
        </View>
        <View style={styles.switchItem}>
          <Switch value={values.is_out_of_stock} onValueChange={(v) => set('is_out_of_stock', v)} disabled={saving} />
          <Text style={styles.switchLabel}>Out of stock</Text>
        </View>
      </View>
      <Text style={styles.formHint}>
        Mark an item Verified only if the restaurant has confirmed it. Entering nutrition values marks them as
        manually provided instead of AI-estimated.
      </Text>

      <View style={styles.formActions}>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} disabled={saving}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.saveBtn, saving && styles.btnDisabled]} onPress={onSave} disabled={saving}>
          {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>{saveLabel}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function nutritionSummary(i: EditableMenuItem) {
  const n = (v: number | null) => (v === null || v === undefined ? '—' : String(Math.round(Number(v) * 10) / 10));
  return `${n(i.calories)} cal · P ${n(i.protein_g)}g · C ${n(i.total_carbs_g)}g · F ${n(i.total_fat_g)}g · Na ${n(i.sodium_mg)}mg`;
}

// Admin Manual Edit: add, update and mass-delete the items of one restaurant's
// menu (menu_items). An independent is edited by place (migration 108), so a
// change touches that location only. A franchise is keyed by name, so a change
// applies to every location sharing it; the banner says so.
export default function AdminMenuEditScreen() {
  const router = useRouter();
  const { name, placeId, address } = useLocalSearchParams<{ name: string; placeId?: string; address?: string }>();

  const [items, setItems] = useState<EditableMenuItem[]>([]);
  const [sharing, setSharing] = useState<MenuSharingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<MenuItemFormValues>(emptyMenuItemForm());
  const [addErrors, setAddErrors] = useState<FormErrors>({});
  const [addSaving, setAddSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<MenuItemFormValues>(emptyMenuItemForm());
  const [editErrors, setEditErrors] = useState<FormErrors>({});
  const [editSaving, setEditSaving] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preview, setPreview] = useState<DeleteMenuItemsResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [name, placeId])
  );

  async function loadAll() {
    if (!name) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [menu, info] = await Promise.all([
        getRestaurantMenuForEdit(name, placeId),
        getMenuSharingInfo(name, placeId),
      ]);
      setItems(menu);
      setSharing(info);
    } catch (error: any) {
      console.error('[admin-menu-edit] Load error:', error);
      Alert.alert('Error', error.message || 'Failed to load menu');
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
  }, [items, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.item_id));

  const sharedCount = (sharing?.cached_locations ?? 0) + (sharing?.claimed_locations ?? 0);

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageRows.forEach((r) => next.delete(r.item_id));
      else pageRows.forEach((r) => next.add(r.item_id));
      return next;
    });
  }

  // "Select unverified": ticks every unverified item matching the search, on every page (press again to untick them).
  function selectUnverified() {
    setSelected((prev) => toggleUnverifiedSelection(prev, filtered));
  }

  // "Verify": marks the ticked unverified items as verified in one step, after asking first.
  async function handleVerifySelected() {
    const ids = verifiableSelection(items, selected);
    if (ids.length === 0) return;
    if (!(await confirmDialog('Verify items?', verifySelectedQuestion(ids.length), { confirmText: 'Verify' }))) return;
    setVerifying(true);
    try {
      await verifyMenuItems(ids);
      setSelected(new Set());
      Alert.alert('Verified', `${ids.length} item${ids.length === 1 ? '' : 's'} marked as verified.`);
      await loadAll();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to verify the items');
    } finally {
      setVerifying(false);
    }
  }

  async function handleAdd() {
    const result = validateMenuItemForm(addForm);
    if (!result.ok) {
      setAddErrors(result.errors);
      return;
    }
    setAddErrors({});
    setAddSaving(true);
    try {
      await saveMenuItem({ restaurantName: name!, placeId, itemId: null, ...result.value });
      setAddForm(emptyMenuItemForm());
      setAddOpen(false);
      await loadAll();
    } catch (error: any) {
      Alert.alert('Could not add item', error.message || 'Failed to add item');
    } finally {
      setAddSaving(false);
    }
  }

  function startEdit(item: EditableMenuItem) {
    setEditingId(item.item_id);
    setEditForm(formFromItem(item));
    setEditErrors({});
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    const result = validateMenuItemForm(editForm);
    if (!result.ok) {
      setEditErrors(result.errors);
      return;
    }
    setEditErrors({});
    setEditSaving(true);
    try {
      await saveMenuItem({ restaurantName: name!, placeId, itemId: editingId, ...result.value });
      setEditingId(null);
      await loadAll();
    } catch (error: any) {
      Alert.alert('Could not save item', error.message || 'Failed to save item');
    } finally {
      setEditSaving(false);
    }
  }

  async function openDeleteConfirm() {
    setConfirmOpen(true);
    setPreview(null);
    setPreviewLoading(true);
    try {
      setPreview(await previewDeleteMenuItems(Array.from(selected)));
    } catch (error: any) {
      setConfirmOpen(false);
      Alert.alert('Error', error.message || 'Could not check what deleting would affect');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const result = await deleteMenuItems(Array.from(selected));
      setConfirmOpen(false);
      setSelected(new Set());
      const parts = [`${result.items} item${result.items === 1 ? '' : 's'} deleted`];
      if (result.coupons > 0) parts.push(`${result.coupons} coupon${result.coupons === 1 ? '' : 's'} deactivated`);
      if (result.savedCopies > 0) parts.push(`${result.savedCopies} saved cop${result.savedCopies === 1 ? 'y' : 'ies'} removed`);
      Alert.alert('Deleted', parts.join('\n'));
      await loadAll();
    } catch (error: any) {
      setConfirmOpen(false);
      Alert.alert('Error', error.message || 'Failed to delete items');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.pageWrapper}>
        <FlatList
          data={pageRows}
          keyExtractor={(item) => item.item_id}
          contentContainerStyle={styles.content}
          extraData={[selected, editingId, editForm, editErrors, editSaving]}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View>
              <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                <Text style={styles.backBtnText}>← Back to Menu Management</Text>
              </TouchableOpacity>
              <Text style={styles.title}>{name}</Text>
              <Text style={styles.subtitle}>Manual Edit — add, update or delete menu items</Text>

              {placeId ? (
                <View style={styles.infoBanner}>
                  <Text style={styles.infoText}>
                    This menu belongs to this location only{address ? ` (${address})` : ''}.
                  </Text>
                </View>
              ) : sharedCount > 1 || sharing?.is_franchise ? (
                <View style={styles.warnBanner}>
                  <Text style={styles.warnText}>
                    ⚠️ This menu is shared by every location of this franchise
                    {sharedCount > 1 ? ` (${sharedCount} locations named “${name}”)` : ''}. Any change here applies to
                    all of them.
                  </Text>
                </View>
              ) : (
                <View style={styles.infoBanner}>
                  <Text style={styles.infoText}>
                    Menus are matched by restaurant name, so changes apply wherever “{name}” is used.
                  </Text>
                </View>
              )}

              {addOpen ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Add a menu item</Text>
                  <ItemForm
                    values={addForm}
                    errors={addErrors}
                    onChange={setAddForm}
                    onSave={handleAdd}
                    onCancel={() => { setAddOpen(false); setAddForm(emptyMenuItemForm()); setAddErrors({}); }}
                    saving={addSaving}
                    saveLabel="Add item"
                  />
                </View>
              ) : (
                <TouchableOpacity style={styles.addBtn} onPress={() => setAddOpen(true)}>
                  <Text style={styles.addBtnText}>＋ Add item</Text>
                </TouchableOpacity>
              )}

              <TextInput
                style={styles.search}
                placeholder={`Search ${items.length} items…`}
                placeholderTextColor="#999"
                value={search}
                onChangeText={(t) => { setSearch(t); setPage(0); }}
                autoCapitalize="none"
              />

              <View style={styles.toolbar}>
                <TouchableOpacity
                  style={styles.selectAllBtn}
                  onPress={toggleSelectPage}
                  disabled={pageRows.length === 0}
                >
                  <Text style={styles.selectAllText}>{allOnPageSelected ? 'Deselect page' : 'Select all on this page'}</Text>
                </TouchableOpacity>
                {unverifiedIds(filtered).length > 0 && (
                  <TouchableOpacity style={styles.selectAllBtn} onPress={selectUnverified}>
                    <Text style={styles.selectAllText}>Select unverified ({unverifiedIds(filtered).length})</Text>
                  </TouchableOpacity>
                )}
                {selected.size > 0 && (
                  <>
                    {verifiableSelection(items, selected).length > 0 && (
                      <TouchableOpacity
                        style={[styles.verifyBtn, verifying && styles.verifyBtnDisabled]}
                        onPress={handleVerifySelected}
                        disabled={verifying}
                      >
                        {verifying ? (
                          <ActivityIndicator size="small" color="#2E7D32" />
                        ) : (
                          <Text style={styles.verifyBtnText}>✓ Verify {verifiableSelection(items, selected).length}</Text>
                        )}
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => setSelected(new Set())}>
                      <Text style={styles.clearText}>Clear ({selected.size})</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.deleteBtn} onPress={openDeleteConfirm}>
                      <Text style={styles.deleteBtnText}>🗑 Delete {selected.size}</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
              <Text style={styles.rangeText}>
                {filtered.length === 0
                  ? '0 items'
                  : `Showing ${safePage * PAGE_SIZE + 1}–${Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of ${filtered.length}`}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const isSelected = selected.has(item.item_id);
            const isEditing = editingId === item.item_id;
            return (
              <View style={[styles.row, isSelected && styles.rowSelected]}>
                <View style={styles.rowMain}>
                  <TouchableOpacity
                    style={[styles.checkbox, isSelected && styles.checkboxOn]}
                    onPress={() => toggleOne(item.item_id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isSelected }}
                  >
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
                  </TouchableOpacity>
                  <View style={styles.rowInfo}>
                    <View style={styles.rowTop}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <View style={[styles.badge, item.is_verified ? styles.badgeVerified : styles.badgeUnverified]}>
                        <Text style={[styles.badgeText, item.is_verified ? styles.badgeVerifiedText : styles.badgeUnverifiedText]}>
                          {item.is_verified ? '✓ Verified' : '⚠ Unverified'}
                        </Text>
                      </View>
                      {item.is_out_of_stock && (
                        <View style={[styles.badge, styles.badgeOut]}>
                          <Text style={[styles.badgeText, styles.badgeOutText]}>Out of stock</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.nutrition}>{nutritionSummary(item)}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.editBtn}
                    onPress={() => (isEditing ? setEditingId(null) : startEdit(item))}
                  >
                    <Text style={styles.editBtnText}>{isEditing ? 'Close' : 'Edit'}</Text>
                  </TouchableOpacity>
                </View>
                {isEditing && (
                  <ItemForm
                    values={editForm}
                    errors={editErrors}
                    onChange={setEditForm}
                    onSave={handleSaveEdit}
                    onCancel={() => setEditingId(null)}
                    saving={editSaving}
                    saveLabel="Save changes"
                  />
                )}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {items.length === 0 ? 'No menu items yet. Use “Add item” to create one.' : 'No items match'}
              </Text>
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
              Delete {selected.size} item{selected.size === 1 ? '' : 's'}?
            </Text>
            {previewLoading || !preview ? (
              <ActivityIndicator style={{ marginVertical: 16 }} color="#1565C0" />
            ) : (
              <Text style={styles.modalMessage}>
                This permanently removes {preview.items} item{preview.items === 1 ? '' : 's'} from “{name}”
                {sharedCount > 1 ? `, for all ${sharedCount} locations that share this menu` : ''}.{'\n\n'}
                • {preview.coupons} active item coupon{preview.coupons === 1 ? '' : 's'} will be deactivated{'\n'}
                • {preview.savedCopies} customer saved cop{preview.savedCopies === 1 ? 'y' : 'ies'} will be removed
              </Text>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfirmOpen(false)} disabled={deleting}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmDeleteBtn, (deleting || previewLoading || !preview) && styles.btnDisabled]}
                onPress={handleDelete}
                disabled={deleting || previewLoading || !preview}
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
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f6f6f6' },
  content: { padding: 16, paddingBottom: 32 },

  backBtn: { alignSelf: 'flex-start', paddingVertical: 6, marginBottom: 8 },
  backBtnText: { color: '#1565C0', fontWeight: '700', fontSize: 13 },
  title: { fontSize: 22, fontWeight: '800', color: '#222' },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 12 },

  warnBanner: { backgroundColor: '#FFF3E0', borderLeftWidth: 4, borderLeftColor: '#E65100', borderRadius: 8, padding: 12, marginBottom: 12 },
  warnText: { fontSize: 13, color: '#7A4A00', fontWeight: '600', lineHeight: 18 },
  infoBanner: { backgroundColor: '#E3F2FD', borderRadius: 8, padding: 12, marginBottom: 12 },
  infoText: { fontSize: 12, color: '#0D47A1', lineHeight: 17 },

  addBtn: { backgroundColor: '#1565C0', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginBottom: 12 },
  addBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12, elevation: 1 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#222', marginBottom: 8 },

  form: { marginTop: 8 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#555', marginBottom: 4, marginTop: 8 },
  input: { backgroundColor: '#f0f0f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: '#222', borderWidth: 1, borderColor: 'transparent' },
  inputError: { borderColor: '#e53e3e', backgroundColor: '#FFEBEE' },
  errorText: { fontSize: 11, color: '#c62828', fontWeight: '600', marginTop: 2 },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  fieldCell: { flexBasis: '47%', flexGrow: 1, minWidth: 130 },
  switchRow: { flexDirection: 'row', gap: 24, marginTop: 14 },
  switchItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  switchLabel: { fontSize: 13, fontWeight: '700', color: '#333' },
  formHint: { fontSize: 11, color: '#888', marginTop: 8, lineHeight: 16 },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelBtnText: { fontSize: 13, fontWeight: '700', color: '#666' },
  saveBtn: { backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 10, minWidth: 110, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  btnDisabled: { opacity: 0.45 },

  search: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#222', marginBottom: 10 },
  toolbar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  selectAllBtn: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#1565C0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  selectAllText: { fontSize: 12, fontWeight: '700', color: '#1565C0' },
  clearText: { fontSize: 12, fontWeight: '700', color: '#666' },
  deleteBtn: { backgroundColor: '#e53e3e', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  deleteBtnText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  verifyBtn: { backgroundColor: '#E8F5E9', borderWidth: 1.5, borderColor: '#2E7D32', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  verifyBtnDisabled: { opacity: 0.5 },
  verifyBtnText: { color: '#2E7D32', fontWeight: '800', fontSize: 12 },
  rangeText: { fontSize: 12, color: '#888', marginBottom: 8 },

  row: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, elevation: 1, borderWidth: 1.5, borderColor: 'transparent' },
  rowSelected: { borderColor: '#1565C0' },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#bbb', alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: '#1565C0', borderColor: '#1565C0' },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '800', lineHeight: 16 },
  rowInfo: { flex: 1, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  itemName: { fontSize: 14, fontWeight: '700', color: '#222' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 10, fontWeight: '800' },
  badgeVerified: { backgroundColor: '#E3F2FD' },
  badgeVerifiedText: { color: '#1565C0' },
  badgeUnverified: { backgroundColor: '#FFF3E0' },
  badgeUnverifiedText: { color: '#E65100' },
  badgeOut: { backgroundColor: '#FFEBEE' },
  badgeOutText: { color: '#c62828' },
  nutrition: { fontSize: 12, color: '#666' },
  editBtn: { backgroundColor: '#ECEFF1', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  editBtnText: { color: '#222', fontWeight: '700', fontSize: 12 },

  emptyContainer: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#999', textAlign: 'center' },

  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, paddingTop: 12 },
  pagerBtn: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9, elevation: 1 },
  pagerBtnText: { fontSize: 13, fontWeight: '700', color: '#222' },
  pagerLabel: { fontSize: 13, color: '#666', fontWeight: '600' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 440 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 8 },
  modalMessage: { fontSize: 13, color: '#555', lineHeight: 19, marginBottom: 18 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  confirmDeleteBtn: { backgroundColor: '#e53e3e', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 10, minWidth: 80, alignItems: 'center' },
  confirmDeleteText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});
