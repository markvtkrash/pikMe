import { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, ScrollView, Modal, Platform,
} from 'react-native';
import { Alert } from '../../src/utils/alert';
import { useRouter, useFocusEffect, useNavigation } from 'expo-router';
import { getRestaurantMenuItems, submitManualMenuItems, verifyMenuItem, unverifyMenuItem, setMenuItemOutOfStock } from '../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { useUnsavedChangesStore } from '../../src/store/unsavedChangesStore';
import { supabase } from '../../src/api/supabase';
import { confirmAndRetryIfNeeded } from '../../src/utils/menuReplaceConfirm';
import { getMaxManualMenuItems } from '../../src/constants/menuLimits';

interface ManualItem {
  name: string;
  // null = new row, not yet loaded from what's actually saved — nothing to
  // show a badge for until it's been confirmed one way or the other.
  isVerified: boolean | null;
  // null for a brand-new, not-yet-saved row — nothing to call unverify on yet.
  itemId: string | null;
  isOutOfStock: boolean;
}

export default function ManualMenuScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { owner, restaurant, session } = useRestaurantOwnerStore();
  // Read once per render rather than as a module-level constant — its
  // value can come from an async DB fetch resolved before this screen ever
  // mounts (see appConfig.ts), so it can't be computed at module-load time.
  const MAX_ITEMS = getMaxManualMenuItems();
  // Snapshot of what's actually persisted — set right after load and right
  // after a successful save — compared against the live list to know
  // whether there's anything a leaving-the-page warning should protect.
  const savedNamesRef = useRef<string[]>([]);
  const [items, setItems] = useState<ManualItem[]>([
    { name: '', isVerified: null, itemId: null, isOutOfStock: false },
    { name: '', isVerified: null, itemId: null, isOutOfStock: false },
    { name: '', isVerified: null, itemId: null, isOutOfStock: false },
  ]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSavedCount, setLastSavedCount] = useState<number | null>(null);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [unverifyingIndex, setUnverifyingIndex] = useState<number | null>(null);
  const [togglingStockIndex, setTogglingStockIndex] = useState<number | null>(null);
  const [removeConfirmIndex, setRemoveConfirmIndex] = useState<number | null>(null);
  const [verifyModalIndex, setVerifyModalIndex] = useState<number | null>(null);
  const [verifyModalName, setVerifyModalName] = useState('');
  const [verifyingIndex, setVerifyingIndex] = useState<number | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [bulkRemoveConfirm, setBulkRemoveConfirm] = useState(false);
  const [sortMode, setSortMode] = useState<'none' | 'name' | 'status'>('none');

  // Pre-fill with whatever is currently cached for this restaurant (from any
  // source — manual, link, or AI) so this screen doubles as a view/update
  // page instead of always starting from a blank form.
  useFocusEffect(
    useCallback(() => {
      loadCurrentItems();
    }, [restaurant])
  );

  // Kept unconditional (before the owner/restaurant/loading early returns
  // below) so these hooks run in the same order on every render — Rules of
  // Hooks. hasUnsavedChanges is just false during the loading/no-restaurant
  // states, since items hasn't diverged from an empty snapshot yet.
  const currentCleanNames = items.map((it) => it.name.trim()).filter(Boolean);
  const hasUnsavedChanges = JSON.stringify(currentCleanNames) !== JSON.stringify(savedNamesRef.current);

  // Guards actual removal of this screen — the native/back-gesture path
  // (browser back, hardware back). This does NOT fire for OwnerNavHeader's
  // top-nav links, which router.push() onto the stack rather than remove
  // this screen — that path is covered separately below via the shared
  // unsavedChangesStore, which OwnerNavHeader checks before every nav push.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (!hasUnsavedChanges) return;
      e.preventDefault();
      const proceed = confirm('You have unsaved menu changes. Leave without saving?');
      if (proceed) navigation.dispatch(e.data.action);
    });
    return unsubscribe;
  }, [navigation, hasUnsavedChanges]);

  // Guards a full page reload / tab close on web, which neither of the
  // mechanisms above can catch.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!hasUnsavedChanges) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Publishes this screen's dirty state to the shared store so OwnerNavHeader
  // (and anything else navigating via router.push) can prompt before
  // actually leaving. Cleared on unmount so a later, genuinely-clean screen
  // doesn't inherit a stale "unsaved" flag.
  const setUnsavedChanges = useUnsavedChangesStore((s) => s.setUnsavedChanges);
  useEffect(() => {
    setUnsavedChanges(hasUnsavedChanges, 'You have unsaved menu changes. Leave without saving?');
    return () => setUnsavedChanges(false);
  }, [hasUnsavedChanges, setUnsavedChanges]);

  // Display-only ordering — every handler below (updateName, remove, verify,
  // select) is still keyed by the item's ORIGINAL index in `items`, so
  // sorting for display never disturbs save order or in-flight edits.
  // Unconfirmed ranks before new/blank rows before verified, since that's
  // roughly "what needs my attention first."
  function statusRank(item: ManualItem): number {
    if (item.isVerified === false) return 0;
    if (item.isVerified === null) return 1;
    return 2;
  }
  const displayItems = useMemo(() => {
    const indexed = items.map((item, index) => ({ item, index }));
    if (sortMode === 'name') {
      return indexed.sort((a, b) =>
        a.item.name.trim().toLowerCase().localeCompare(b.item.name.trim().toLowerCase())
      );
    }
    if (sortMode === 'status') {
      return indexed.sort((a, b) => statusRank(a.item) - statusRank(b.item));
    }
    return indexed;
  }, [items, sortMode]);

  // Direct, synchronous check on this page's own Back button — belt-and-
  // suspenders alongside the beforeRemove listener above, since we'd rather
  // double-guard than risk router.back() slipping past it on web.
  function handleBack() {
    if (hasUnsavedChanges && !confirm('You have unsaved menu changes. Leave without saving?')) {
      return;
    }
    router.back();
  }

  async function loadCurrentItems() {
    if (!restaurant) {
      setLoading(false);
      return;
    }
    try {
      const loaded = await getRestaurantMenuItems(restaurant.name);
      if (loaded.length > 0) {
        setItems(loaded.map((i: any) => ({
          name: i.name, isVerified: i.is_verified, itemId: i.item_id, isOutOfStock: !!i.is_out_of_stock,
        })));
        savedNamesRef.current = loaded.map((i) => i.name.trim()).filter(Boolean);
      } else {
        savedNamesRef.current = [];
      }
    } catch (error) {
      console.error('[manual-menu] Failed to load current items:', error);
    } finally {
      setLoading(false);
    }
  }

  if (!owner || !restaurant) return null;

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  function updateName(index: number, text: string) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, name: text } : it)));
  }

  function openAddModal() {
    if (items.length >= MAX_ITEMS) return;
    setNewItemName('');
    setAddModalVisible(true);
  }

  function confirmAddItem() {
    const trimmed = newItemName.trim();
    if (trimmed) {
      setItems((prev) => [...prev, { name: trimmed, isVerified: null, itemId: null, isOutOfStock: false }]);
    }
    setAddModalVisible(false);
  }

  function removeRow(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function confirmRemoveRow() {
    if (removeConfirmIndex === null) return;
    removeRow(removeConfirmIndex);
    setRemoveConfirmIndex(null);
  }

  function toggleSelectionMode() {
    setSelectionMode((prev) => !prev);
    setSelectedIndices(new Set());
  }

  function toggleSelectRow(index: number) {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  // Toggles against every row currently in the list (not just what's visible
  // after sorting — sort only reorders, it never filters), so this always
  // means "every item," matching what Delete Selected would then remove.
  function toggleSelectAll() {
    setSelectedIndices((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((_, i) => i))
    );
  }

  function confirmBulkRemove() {
    setItems((prev) => prev.filter((_, i) => !selectedIndices.has(i)));
    setSelectedIndices(new Set());
    setSelectionMode(false);
    setBulkRemoveConfirm(false);
  }

  async function handleUnverify(index: number) {
    const item = items[index];
    if (!item.itemId) return;
    setUnverifyingIndex(index);
    try {
      await unverifyMenuItem(item.itemId);
      setItems((prev) => prev.map((it, i) => (i === index ? { ...it, isVerified: false } : it)));
    } catch (error: any) {
      console.error('[manual-menu] Unverify error:', error);
      Alert.alert('Error', error.message || 'Failed to unconfirm item');
    } finally {
      setUnverifyingIndex(null);
    }
  }

  // Hides the item from customers without deleting it — nutrition data,
  // verification, and coupon associations all stay intact for when it's
  // back in stock.
  async function handleToggleOutOfStock(index: number) {
    const item = items[index];
    if (!item.itemId) return;
    const nextValue = !item.isOutOfStock;
    setTogglingStockIndex(index);
    try {
      await setMenuItemOutOfStock(item.itemId, nextValue);
      setItems((prev) => prev.map((it, i) => (i === index ? { ...it, isOutOfStock: nextValue } : it)));
    } catch (error: any) {
      console.error('[manual-menu] Out-of-stock toggle error:', error);
      Alert.alert('Error', error.message || 'Failed to update stock status');
    } finally {
      setTogglingStockIndex(null);
    }
  }

  function openVerifyModal(index: number) {
    setVerifyModalIndex(index);
    setVerifyModalName(items[index].name);
  }

  async function confirmVerify() {
    if (verifyModalIndex === null) return;
    const index = verifyModalIndex;
    const item = items[index];
    if (!item.itemId) return;
    const trimmedName = verifyModalName.trim();
    if (!trimmedName) return;
    setVerifyingIndex(index);
    try {
      const nameChanged = trimmedName !== item.name;
      // TEMP DEBUG — remove once the "Not authorized" mismatch is diagnosed.
      console.log('[manual-menu] [debug] logged-in owner.id:', owner?.id, '| restaurant.owner_id:', restaurant?.owner_id, '| restaurant.name:', restaurant?.name);
      const { data: sessionCheck } = await supabase.auth.getSession();
      console.log('[manual-menu] [debug] SDK session at call time — user.id:', sessionCheck.session?.user?.id, '| access_token present:', !!sessionCheck.session?.access_token, '| expires_at:', sessionCheck.session?.expires_at);
      await verifyMenuItem(item.itemId, nameChanged ? trimmedName : undefined);
      setItems((prev) =>
        prev.map((it, i) => (i === index ? { ...it, name: trimmedName, isVerified: true } : it))
      );
      setVerifyModalIndex(null);
    } catch (error: any) {
      console.error('[manual-menu] Verify error:', error);
      Alert.alert('Error', error.message || 'Failed to verify item');
    } finally {
      setVerifyingIndex(null);
    }
  }

  async function handleSave() {
    if (!restaurant || !session?.access_token) {
      Alert.alert('Error', 'Session not found');
      return;
    }
    const cleanNames = items.map((it) => it.name.trim()).filter(Boolean);
    if (cleanNames.length === 0) {
      Alert.alert('Error', 'Type at least one real menu item name');
      return;
    }
    setSaving(true);
    try {
      let result = await submitManualMenuItems(
        restaurant.id,
        restaurant.name,
        cleanNames,
        session.access_token
      );
      result = await confirmAndRetryIfNeeded(result, () =>
        submitManualMenuItems(restaurant.id, restaurant.name, cleanNames, session.access_token, true)
      );

      if (result.requiresConfirmation) {
        // Owner cancelled at the confirm prompt — nothing was changed.
        return;
      }

      setLastSavedCount(result.itemCount ?? 0);
      savedNamesRef.current = cleanNames;
      Alert.alert(
        'Success',
        `Saved ${result.itemCount} real menu items — customers will now see these instead of AI-guessed ones.`
      );
    } catch (error: any) {
      console.error('[manual-menu] Save error:', error);
      Alert.alert('Error', error.message || 'Failed to save your menu items');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
    <View style={styles.pageWrapper}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Edit Menu</Text>
          <Text style={styles.subtitle}>{restaurant.name}</Text>
        </View>
        <TouchableOpacity
          style={[styles.topSaveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.topSaveBtnText}>Save Menu</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Sticky toolbar — outside the ScrollView so Add/Select-to-Delete/
          Cancel stay reachable regardless of scroll position, same as
          Save Menu above. Cancel in particular needs to stay reachable —
          scrolling deep into a long list to start selecting shouldn't strand
          the only way to back out. */}
      <View style={styles.toolbarBar}>
        <View style={styles.selectionToolbar}>
          {items.length < MAX_ITEMS ? (
            <TouchableOpacity style={[styles.addBtn, styles.addBtnTop]} onPress={openAddModal} disabled={saving}>
              <Text style={styles.addBtnText}>+ Add another item</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.limitReachedText}>Maximum {MAX_ITEMS} items reached</Text>
          )}
          <TouchableOpacity
            style={[styles.selectToggleBtn, selectionMode && styles.selectToggleBtnCancel]}
            onPress={toggleSelectionMode}
            disabled={saving}
          >
            <Text style={[styles.selectToggleText, selectionMode && styles.selectToggleTextCancel]}>
              {selectionMode ? 'Cancel' : '− Select to Delete'}
            </Text>
          </TouchableOpacity>
        </View>

        {selectionMode && (
          <View style={styles.bulkActionsRow}>
            <TouchableOpacity style={styles.selectAllBtn} onPress={toggleSelectAll}>
              <Text style={styles.selectAllBtnText}>
                {selectedIndices.size === items.length ? 'Deselect All' : 'Select All'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.bulkDeleteBtn, selectedIndices.size === 0 && styles.saveBtnDisabled]}
              onPress={() => setBulkRemoveConfirm(true)}
              disabled={selectedIndices.size === 0}
            >
              <Text style={styles.bulkDeleteBtnText}>
                🗑 Delete Selected ({selectedIndices.size})
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>✏️ Real Menu Items</Text>
          <Text style={styles.cardHint}>
            No website to link? Type in the real dish names from your menu below. We'll only estimate
            nutrition for the names you enter — we never invent dishes. Saving replaces what's currently
            cached with these items.
          </Text>

          <View style={styles.sortRow}>
            <Text style={styles.sortLabel}>Sort:</Text>
            <TouchableOpacity
              style={[styles.sortChip, sortMode === 'name' && styles.sortChipActive]}
              onPress={() => setSortMode((prev) => (prev === 'name' ? 'none' : 'name'))}
            >
              <Text style={[styles.sortChipText, sortMode === 'name' && styles.sortChipTextActive]}>Name</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sortChip, sortMode === 'status' && styles.sortChipActive]}
              onPress={() => setSortMode((prev) => (prev === 'status' ? 'none' : 'status'))}
            >
              <Text style={[styles.sortChipText, sortMode === 'status' && styles.sortChipTextActive]}>
                Verified/Unverified
              </Text>
            </TouchableOpacity>
          </View>

          {displayItems.map(({ item, index }) => (
            <View key={index} style={styles.itemCard}>
              <View style={styles.itemPrimaryRow}>
                {selectionMode && (
                  <TouchableOpacity
                    style={[styles.checkbox, selectedIndices.has(index) && styles.checkboxChecked]}
                    onPress={() => toggleSelectRow(index)}
                  >
                    {selectedIndices.has(index) && <Text style={styles.checkboxMark}>✓</Text>}
                  </TouchableOpacity>
                )}
                <TextInput
                  style={styles.itemInput}
                  placeholder={`Item ${index + 1}`}
                  placeholderTextColor="#999"
                  value={item.name}
                  onChangeText={(text) => updateName(index, text)}
                  editable={!saving}
                />

                {item.isVerified !== null && (
                  <View style={[styles.verifiedBadge, item.isVerified ? styles.verifiedBadgeYes : styles.verifiedBadgeNo]}>
                    <Text style={[styles.verifiedBadgeText, item.isVerified ? styles.verifiedBadgeTextYes : styles.verifiedBadgeTextNo]} numberOfLines={1}>
                      {item.isVerified ? '✓ Verified' : 'Unconfirmed'}
                    </Text>
                  </View>
                )}

                {item.isOutOfStock && (
                  <View style={styles.outOfStockBadge}>
                    <Text style={styles.outOfStockBadgeText} numberOfLines={1}>🚫 Out of Stock</Text>
                  </View>
                )}

                {item.isVerified === true && item.itemId && (
                  <TouchableOpacity
                    style={styles.unconfirmBtn}
                    onPress={() => handleUnverify(index)}
                    disabled={saving || unverifyingIndex === index}
                  >
                    {unverifyingIndex === index ? (
                      <ActivityIndicator size="small" color="#E65100" />
                    ) : (
                      <Text style={styles.unconfirmBtnText} numberOfLines={1}>↩ Unconfirm</Text>
                    )}
                  </TouchableOpacity>
                )}
                {item.isVerified === false && item.itemId && (
                  <TouchableOpacity
                    style={styles.verifyBtn}
                    onPress={() => openVerifyModal(index)}
                    disabled={saving || verifyingIndex === index}
                  >
                    {verifyingIndex === index ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.verifyBtnText} numberOfLines={1}>Verify</Text>
                    )}
                  </TouchableOpacity>
                )}
                {item.itemId && (
                  <TouchableOpacity
                    style={[styles.stockToggleBtn, item.isOutOfStock && styles.stockToggleBtnBack]}
                    onPress={() => handleToggleOutOfStock(index)}
                    disabled={saving || togglingStockIndex === index}
                  >
                    {togglingStockIndex === index ? (
                      <ActivityIndicator size="small" color={item.isOutOfStock ? '#1565C0' : '#c62828'} />
                    ) : (
                      <Text style={[styles.stockToggleBtnText, item.isOutOfStock && styles.stockToggleBtnBackText]} numberOfLines={1}>
                        {item.isOutOfStock ? '✓ In Stock' : '🚫 Out of Stock'}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={() => setRemoveConfirmIndex(index)}
                  disabled={saving}
                >
                  <Text style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          {items.length < MAX_ITEMS && (
            <TouchableOpacity style={styles.addBtn} onPress={openAddModal} disabled={saving}>
              <Text style={styles.addBtnText}>+ Add another item</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Save Menu</Text>
            )}
          </TouchableOpacity>

          {lastSavedCount !== null && (
            <Text style={styles.lastSaved}>✓ {lastSavedCount} real items currently showing to customers</Text>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={addModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAddModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Menu Item</Text>
            <Text style={styles.modalHint}>Type the real dish name exactly as it appears on your menu.</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Chicken Tikka Masala"
              placeholderTextColor="#999"
              value={newItemName}
              onChangeText={setNewItemName}
              autoFocus
              onSubmitEditing={confirmAddItem}
              returnKeyType="done"
            />
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setAddModalVisible(false)}
              >
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnAdd, !newItemName.trim() && styles.saveBtnDisabled]}
                onPress={confirmAddItem}
                disabled={!newItemName.trim()}
              >
                <Text style={styles.modalBtnAddText}>Add Item</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={removeConfirmIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRemoveConfirmIndex(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Remove Menu Item</Text>
            <Text style={styles.modalHint}>
              Remove {removeConfirmIndex !== null && items[removeConfirmIndex].name.trim()
                ? `"${items[removeConfirmIndex].name.trim()}"`
                : 'this item'}? This only takes effect once you Save Menu.
            </Text>
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setRemoveConfirmIndex(null)}
              >
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnDanger]}
                onPress={confirmRemoveRow}
              >
                <Text style={styles.modalBtnDangerText}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={bulkRemoveConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setBulkRemoveConfirm(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Remove {selectedIndices.size} Menu Items</Text>
            <Text style={styles.modalHint}>
              Remove {selectedIndices.size} selected item{selectedIndices.size === 1 ? '' : 's'}?
              This only takes effect once you Save Menu.
            </Text>
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setBulkRemoveConfirm(false)}
              >
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnDanger]}
                onPress={confirmBulkRemove}
              >
                <Text style={styles.modalBtnDangerText}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={verifyModalIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setVerifyModalIndex(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Verify Menu Item</Text>
            <Text style={styles.modalHint}>
              Confirm this is really on your menu — fix the name here first if it's not quite right.
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Item name"
              placeholderTextColor="#999"
              value={verifyModalName}
              onChangeText={setVerifyModalName}
              autoFocus
              onSubmitEditing={confirmVerify}
              returnKeyType="done"
            />
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setVerifyModalIndex(null)}
              >
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnAdd, !verifyModalName.trim() && styles.saveBtnDisabled]}
                onPress={confirmVerify}
                disabled={!verifyModalName.trim() || verifyingIndex !== null}
              >
                {verifyingIndex !== null ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalBtnAddText}>Confirm</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f6f6f6' },
  header: { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, elevation: 2, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  toolbarBar: { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  backBtn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#f0f0f0' },
  backBtnText: { fontSize: 13, fontWeight: '600', color: '#e53e3e' },
  title: { fontSize: 24, fontWeight: '800', color: '#222', marginBottom: 2 },
  subtitle: { fontSize: 14, color: '#666' },
  topSaveBtn: { backgroundColor: '#1565C0', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 14, alignSelf: 'flex-start' },
  topSaveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  content: { padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, elevation: 1 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 8 },
  cardHint: { fontSize: 13, color: '#888', lineHeight: 18, marginBottom: 14 },

  // Two stacked rows per item instead of one long flex row — cramming the
  // input, verified badge, and verify/unconfirm button all on one line left
  // no room to breathe (and on narrower screens pushed things off entirely).
  // The primary row (input + remove) is the always-present action; the meta
  // row (verification status) is secondary and drops below it.
  itemCard: {
    backgroundColor: '#FAFAFA', borderRadius: 10, borderWidth: 1, borderColor: '#eee',
    padding: 10, marginBottom: 10,
  },
  // Everything for a row lives in one line — name input, verified/out-of-
  // stock badges, verify/unconfirm, stock toggle, remove. The badges/
  // buttons keep their full original labels, so the input is what gives up
  // width first (flex:1 + minWidth:0 lets it shrink below its own content
  // size instead of pushing anything else off the row).
  itemPrimaryRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  outOfStockBadge: { backgroundColor: '#FFEBEE', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 3, flexShrink: 0 },
  outOfStockBadgeText: { fontSize: 9.5, fontWeight: '700', color: '#c62828' },
  stockToggleBtn: {
    backgroundColor: '#FFEBEE', borderWidth: 1.5, borderColor: '#e53e3e',
    borderRadius: 7, paddingHorizontal: 6, paddingVertical: 4, flexShrink: 0,
  },
  stockToggleBtnText: { fontSize: 9.5, fontWeight: '800', color: '#c62828' },
  stockToggleBtnBack: { backgroundColor: '#E3F2FD', borderColor: '#1565C0' },
  stockToggleBtnBackText: { color: '#1565C0' },
  // minWidth:0 lets this shrink below its own content width when the row is
  // tight (a flex item's default min-width is "big enough to fit its
  // content," not 0) — without it, this refuses to shrink and pushes
  // everything else off the visible row instead of just making the input
  // narrower. Same underlying issue as the nav bug.
  itemInput: {
    flex: 1, minWidth: 0, borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 6, fontSize: 12, color: '#222',
  },
  removeBtn: {
    width: 26, height: 26, borderRadius: 6, backgroundColor: '#FFEBEE',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  removeBtnText: { fontSize: 12, fontWeight: '700', color: '#e53e3e' },

  verifiedBadge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 10, flexShrink: 0 },
  verifiedBadgeYes: { backgroundColor: '#E3F2FD' },
  verifiedBadgeNo: { backgroundColor: '#FFF3E0' },
  verifiedBadgeText: { fontSize: 9.5, fontWeight: '700' },
  verifiedBadgeTextYes: { color: '#1565C0' },
  verifiedBadgeTextNo: { color: '#E65100' },

  unconfirmBtn: {
    backgroundColor: '#FFF3E0', borderWidth: 1.5, borderColor: '#E65100',
    borderRadius: 7, paddingHorizontal: 6, paddingVertical: 4, flexShrink: 0,
  },
  unconfirmBtnText: { fontSize: 9.5, color: '#E65100', fontWeight: '800' },

  verifyBtn: {
    backgroundColor: '#1565C0', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 4,
    elevation: 1, flexShrink: 0,
  },
  verifyBtnText: { fontSize: 10.5, color: '#fff', fontWeight: '800' },

  addBtn: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#E3F2FD', borderWidth: 1.5, borderColor: '#1565C0',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14,
  },
  addBtnTop: { marginBottom: 10 },
  addBtnText: { fontSize: 14, fontWeight: '700', color: '#1565C0' },

  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  sortLabel: { fontSize: 13, fontWeight: '700', color: '#666' },
  sortChip: {
    borderWidth: 1.5, borderColor: '#ddd', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#fff',
  },
  sortChipActive: { backgroundColor: '#1565C0', borderColor: '#1565C0' },
  sortChipText: { fontSize: 12.5, fontWeight: '700', color: '#555' },
  sortChipTextActive: { color: '#fff' },

  selectionToolbar: { flexDirection: 'column', alignItems: 'flex-start' },
  selectToggleBtn: {
    alignSelf: 'flex-start', backgroundColor: '#FFEBEE', borderWidth: 1.5, borderColor: '#e53e3e',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10,
  },
  selectToggleBtnCancel: { backgroundColor: '#f0f0f0', borderColor: '#ccc' },
  selectToggleText: { fontSize: 14, fontWeight: '700', color: '#e53e3e' },
  selectToggleTextCancel: { color: '#555' },
  limitReachedText: { fontSize: 13, fontWeight: '600', color: '#E65100' },
  bulkActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  selectAllBtn: {
    backgroundColor: '#f0f0f0', borderWidth: 1.5, borderColor: '#ccc',
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10,
  },
  selectAllBtnText: { fontSize: 13, fontWeight: '800', color: '#555' },
  bulkDeleteBtn: {
    backgroundColor: '#FFEBEE', borderWidth: 1.5, borderColor: '#e53e3e',
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10,
  },
  bulkDeleteBtnText: { fontSize: 13, fontWeight: '800', color: '#e53e3e' },
  checkbox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: '#ccc',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  checkboxChecked: { backgroundColor: '#e53e3e', borderColor: '#e53e3e' },
  checkboxMark: { fontSize: 14, fontWeight: '800', color: '#fff' },

  saveBtn: { backgroundColor: '#1565C0', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  lastSaved: { fontSize: 13, color: '#1565C0', fontWeight: '600', marginTop: 12 },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20,
  },
  modalCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 20, width: '100%', maxWidth: 420, elevation: 4,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#222', marginBottom: 4 },
  modalHint: { fontSize: 13, color: '#888', marginBottom: 14, lineHeight: 18 },
  modalInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, color: '#222', marginBottom: 16,
  },
  modalBtnRow: { flexDirection: 'row', gap: 10 },
  modalBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  modalBtnCancel: { backgroundColor: '#f0f0f0' },
  modalBtnCancelText: { fontSize: 14, fontWeight: '700', color: '#555' },
  modalBtnAdd: { backgroundColor: '#1565C0' },
  modalBtnAddText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  modalBtnDanger: { backgroundColor: '#e53e3e' },
  modalBtnDangerText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
