import { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, Alert, ScrollView, Modal,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { getRestaurantMenuItems, submitManualMenuItems, verifyMenuItem, unverifyMenuItem } from '../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { confirmAndRetryIfNeeded } from '../../src/utils/menuReplaceConfirm';

const MAX_ITEMS = 30;

interface ManualItem {
  name: string;
  // null = new row, not yet loaded from what's actually saved — nothing to
  // show a badge for until it's been confirmed one way or the other.
  isVerified: boolean | null;
  // null for a brand-new, not-yet-saved row — nothing to call unverify on yet.
  itemId: string | null;
}

export default function ManualMenuScreen() {
  const router = useRouter();
  const { owner, restaurant, session } = useRestaurantOwnerStore();
  const [items, setItems] = useState<ManualItem[]>([
    { name: '', isVerified: null, itemId: null },
    { name: '', isVerified: null, itemId: null },
    { name: '', isVerified: null, itemId: null },
  ]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSavedCount, setLastSavedCount] = useState<number | null>(null);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [unverifyingIndex, setUnverifyingIndex] = useState<number | null>(null);
  const [removeConfirmIndex, setRemoveConfirmIndex] = useState<number | null>(null);
  const [verifyModalIndex, setVerifyModalIndex] = useState<number | null>(null);
  const [verifyModalName, setVerifyModalName] = useState('');
  const [verifyingIndex, setVerifyingIndex] = useState<number | null>(null);

  // Pre-fill with whatever is currently cached for this restaurant (from any
  // source — manual, link, or AI) so this screen doubles as a view/update
  // page instead of always starting from a blank form.
  useFocusEffect(
    useCallback(() => {
      loadCurrentItems();
    }, [restaurant])
  );

  async function loadCurrentItems() {
    if (!restaurant) {
      setLoading(false);
      return;
    }
    try {
      const loaded = await getRestaurantMenuItems(restaurant.name);
      if (loaded.length > 0) {
        setItems(loaded.map((i) => ({ name: i.name, isVerified: i.is_verified, itemId: i.item_id })));
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
        <ActivityIndicator size="large" color="#4CAF50" />
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
      setItems((prev) => [...prev, { name: trimmed, isVerified: null, itemId: null }]);
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
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Manual Entry</Text>
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

      <ScrollView style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>✏️ Real Menu Items</Text>
          <Text style={styles.cardHint}>
            No website to link? Type in the real dish names from your menu below. We'll only estimate
            nutrition for the names you enter — we never invent dishes. Saving replaces what's currently
            cached with these items.
          </Text>

          {items.length < MAX_ITEMS && (
            <TouchableOpacity style={[styles.addBtn, styles.addBtnTop]} onPress={openAddModal} disabled={saving}>
              <Text style={styles.addBtnText}>+ Add another item</Text>
            </TouchableOpacity>
          )}

          {items.map((item, index) => (
            <View key={index} style={styles.itemRow}>
              <TextInput
                style={styles.itemInput}
                placeholder={`Item ${index + 1} (e.g. Chicken Tikka Masala)`}
                placeholderTextColor="#999"
                value={item.name}
                onChangeText={(text) => updateName(index, text)}
                editable={!saving}
              />
              {item.isVerified !== null && (
                <View style={[styles.verifiedBadge, item.isVerified ? styles.verifiedBadgeYes : styles.verifiedBadgeNo]}>
                  <Text style={[styles.verifiedBadgeText, item.isVerified ? styles.verifiedBadgeTextYes : styles.verifiedBadgeTextNo]}>
                    {item.isVerified ? '✓ Verified' : 'Unconfirmed'}
                  </Text>
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
                    <Text style={styles.unconfirmBtnText}>↩ Unconfirm</Text>
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
                    <Text style={styles.verifyBtnText}>Verify</Text>
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
  backBtn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#f0f0f0' },
  backBtnText: { fontSize: 13, fontWeight: '600', color: '#e53e3e' },
  title: { fontSize: 24, fontWeight: '800', color: '#222', marginBottom: 2 },
  subtitle: { fontSize: 14, color: '#666' },
  topSaveBtn: { backgroundColor: '#4CAF50', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 14, alignSelf: 'flex-start' },
  topSaveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  content: { padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, elevation: 1 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 8 },
  cardHint: { fontSize: 13, color: '#888', lineHeight: 18, marginBottom: 14 },

  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  // minWidth:0 lets this shrink below its own content width when the row is
  // tight (a flex item's default min-width is "big enough to fit its
  // content," not 0) — without it, this refuses to shrink and pushes the
  // badge/verify/remove buttons off the visible row entirely instead of
  // just making the input narrower. Same underlying issue as the nav bug.
  itemInput: {
    flex: 1, minWidth: 0, borderWidth: 1, borderColor: '#ddd', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, color: '#222',
  },
  removeBtn: {
    width: 36, height: 36, borderRadius: 8, backgroundColor: '#FFEBEE',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  removeBtnText: { fontSize: 15, fontWeight: '700', color: '#e53e3e' },

  verifiedBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, flexShrink: 0 },
  verifiedBadgeYes: { backgroundColor: '#E8F5E9' },
  verifiedBadgeNo: { backgroundColor: '#FFF3E0' },
  verifiedBadgeText: { fontSize: 10.5, fontWeight: '700' },
  verifiedBadgeTextYes: { color: '#2e7d32' },
  verifiedBadgeTextNo: { color: '#E65100' },

  unconfirmBtn: {
    backgroundColor: '#FFF3E0', borderWidth: 1.5, borderColor: '#E65100',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, flexShrink: 0,
  },
  unconfirmBtnText: { fontSize: 11, color: '#E65100', fontWeight: '800' },

  verifyBtn: {
    backgroundColor: '#4CAF50', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8,
    elevation: 1, flexShrink: 0,
  },
  verifyBtnText: { fontSize: 12, color: '#fff', fontWeight: '800' },

  addBtn: { alignSelf: 'flex-start', paddingVertical: 8, marginBottom: 14 },
  addBtnTop: { marginBottom: 10 },
  addBtnText: { fontSize: 14, fontWeight: '700', color: '#4CAF50' },

  saveBtn: { backgroundColor: '#4CAF50', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  lastSaved: { fontSize: 13, color: '#2e7d32', fontWeight: '600', marginTop: 12 },

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
  modalBtnAdd: { backgroundColor: '#4CAF50' },
  modalBtnAddText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  modalBtnDanger: { backgroundColor: '#e53e3e' },
  modalBtnDangerText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
