import { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, TextInput,
  ActivityIndicator, Alert, Modal,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { getRestaurantMenuItems, refreshRestaurantMenu, verifyMenuItem, unverifyMenuItem, deleteMenuItem } from '../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { confirmAndRetryIfNeeded } from '../../src/utils/menuReplaceConfirm';

interface MenuItem {
  id: string;
  name: string;
  calories: number | null;
  protein_g: number | null;
  item_id: string;
  is_verified: boolean;
}

// The canonical place to view and verify the restaurant's full menu data
// (verified and unverified together) — separate from Menu Management (the
// dashboard: stats + how to source/replace data) and separate from the
// Coupons page (its own list, focused on picking an item to attach a coupon
// to, not on reviewing data accuracy).
export default function MenuItemsScreen() {
  const router = useRouter();
  const { owner, restaurant, session } = useRestaurantOwnerStore();
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [verifyModalItem, setVerifyModalItem] = useState<MenuItem | null>(null);
  const [verifyModalName, setVerifyModalName] = useState('');
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<MenuItem | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadMenuItems();
    }, [restaurant])
  );

  async function loadMenuItems() {
    if (!restaurant) {
      setLoading(false);
      return;
    }
    try {
      const items = await getRestaurantMenuItems(restaurant.name);
      setMenuItems(items);
    } catch (error) {
      console.error('[menu-items] Failed to load items:', error);
      Alert.alert('Error', 'Failed to load menu items');
    } finally {
      setLoading(false);
    }
  }

  // Only ever touches unverified rows — an AI-found item lands unverified
  // alongside whatever's already there, so this is additive (finds items you
  // haven't added yet) rather than a destructive full replace. Your
  // already-verified items are never read or touched by this call.
  async function handlePullWithAi() {
    if (!restaurant || !session?.access_token) {
      Alert.alert('Error', 'Session not found');
      return;
    }
    setRefreshing(true);
    try {
      let result = await refreshRestaurantMenu(
        restaurant.id, restaurant.name, session.access_token, false, true
      );
      result = await confirmAndRetryIfNeeded(result, () =>
        refreshRestaurantMenu(restaurant.id, restaurant.name, session.access_token, true, true)
      );
      if (result.requiresConfirmation) {
        // Owner cancelled at the confirm prompt — nothing was changed.
        return;
      }
      await loadMenuItems();
      const sourceNote = result.usedRealWebsite
        ? ' Found real items from your website — marked verified.'
        : '';
      Alert.alert('Success', 'New items pulled with AI!' + sourceNote);
    } catch (error: any) {
      console.error('[menu-items] Pull error:', error);
      Alert.alert('Error', error.message || 'Failed to pull new items');
    } finally {
      setRefreshing(false);
    }
  }

  function openVerifyModal(item: MenuItem) {
    setVerifyModalItem(item);
    setVerifyModalName(item.name);
  }

  async function confirmVerify() {
    if (!verifyModalItem) return;
    const itemId = verifyModalItem.item_id;
    const trimmedName = verifyModalName.trim();
    if (!trimmedName) return;
    setVerifyingId(itemId);
    try {
      const nameChanged = trimmedName !== verifyModalItem.name;
      await verifyMenuItem(itemId, nameChanged ? trimmedName : undefined);
      setMenuItems((prev) =>
        prev.map((i) => (i.item_id === itemId ? { ...i, name: trimmedName, is_verified: true } : i))
      );
      setVerifyModalItem(null);
    } catch (error: any) {
      console.error('[menu-items] Verify error:', error);
      Alert.alert('Error', error.message || 'Failed to verify item');
    } finally {
      setVerifyingId(null);
    }
  }

  async function handleUnverify(itemId: string) {
    setVerifyingId(itemId);
    try {
      await unverifyMenuItem(itemId);
      setMenuItems((prev) =>
        prev.map((i) => (i.item_id === itemId ? { ...i, is_verified: false } : i))
      );
    } catch (error: any) {
      console.error('[menu-items] Unverify error:', error);
      Alert.alert('Error', error.message || 'Failed to unconfirm item');
    } finally {
      setVerifyingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteConfirmItem) return;
    const itemId = deleteConfirmItem.item_id;
    setDeleteConfirmItem(null);
    setDeletingId(itemId);
    try {
      let result = await deleteMenuItem(itemId);
      result = await confirmAndRetryIfNeeded(result, () => deleteMenuItem(itemId, true));
      if (result.requiresConfirmation) {
        // Owner cancelled at the coupon-orphan confirm prompt — nothing was changed.
        return;
      }
      setMenuItems((prev) => prev.filter((i) => i.item_id !== itemId));
    } catch (error: any) {
      console.error('[menu-items] Delete error:', error);
      Alert.alert('Error', error.message || 'Failed to delete item');
    } finally {
      setDeletingId(null);
    }
  }

  const filteredItems = menuItems.filter((item) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const verifiedCount = menuItems.filter((i) => i.is_verified).length;
  const unverifiedCount = menuItems.length - verifiedCount;

  if (!owner || !restaurant) return null;

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.pageWrapper}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>AI Assisted Menu Pull</Text>
            <Text style={styles.subtitle}>{restaurant.name}</Text>
            {menuItems.length > 0 && (
              <Text style={unverifiedCount > 0 ? styles.summaryUnverified : styles.summaryVerified}>
                {unverifiedCount > 0
                  ? `${verifiedCount} verified · ${unverifiedCount} unconfirmed`
                  : '✓ All items verified'}
              </Text>
            )}
          </View>
        </View>

        {/* Pull new items with AI — additive only, never touches verified items */}
        <View style={styles.refreshBox}>
          <Text style={styles.refreshBoxTitle}>🔍 Pull New Items with AI</Text>
          <Text style={styles.refreshBoxHint}>
            Pull menu items to add to your existing menu using AI. If we know your restaurant's website, it
            tries to pull real items from it automatically — otherwise it falls back to an AI guess from
            just your restaurant name (least accurate; use Manual Entry or add items from a photo when you can). Your
            already-verified items are never touched.
          </Text>
          <TouchableOpacity
            style={[styles.refreshBtn, styles.refreshBtnSolid, refreshing && styles.refreshBtnDisabled]}
            onPress={handlePullWithAi}
            disabled={refreshing}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Text style={[styles.refreshBtnText, { color: '#fff' }]}>Pull New Items</Text>
                <Text style={[styles.refreshBtnSubtext, { color: '#FFE0B2' }]}>
                  {verifiedCount > 0
                    ? `Keeps your ${verifiedCount} verified item${verifiedCount === 1 ? '' : 's'} untouched`
                    : 'Adds AI-guessed items you can verify afterward'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {menuItems.length > 0 && (
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search menu items..."
              placeholderTextColor="#999"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
        )}

        {menuItems.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyText}>No menu items yet</Text>
            <Text style={styles.emptySubtext}>Pull with AI above, or add a real link / type your menu from Menu Management</Text>
          </View>
        ) : (
          <FlatList
            data={filteredItems}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text style={styles.noResultsText}>No items match "{searchQuery}"</Text>
            }
            renderItem={({ item }) => (
              <View style={styles.itemCard}>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemNutrition}>
                    {item.calories ? `${Math.round(item.calories)} cal` : 'N/A'} •{' '}
                    {item.protein_g ? `${item.protein_g}g protein` : 'N/A'}
                  </Text>
                  {item.is_verified ? (
                    <Text style={styles.verifiedTag}>✓ Verified</Text>
                  ) : (
                    <Text style={styles.unconfirmedHint}>Unconfirmed — is this actually on your menu?</Text>
                  )}
                </View>
                <View style={styles.itemAction}>
                  {item.is_verified ? (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.unconfirmBtn]}
                      onPress={() => handleUnverify(item.item_id)}
                      disabled={verifyingId === item.item_id}
                    >
                      {verifyingId === item.item_id ? (
                        <ActivityIndicator size="small" color="#E65100" />
                      ) : (
                        <Text style={styles.unconfirmBtnText}>↩ Unconfirm</Text>
                      )}
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.verifyBtn]}
                      onPress={() => openVerifyModal(item)}
                      disabled={verifyingId === item.item_id}
                    >
                      {verifyingId === item.item_id ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.verifyBtnText}>Yes, Verify/Edit it?</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => setDeleteConfirmItem(item)}
                  disabled={deletingId === item.item_id}
                >
                  {deletingId === item.item_id ? (
                    <ActivityIndicator size="small" color="#e53e3e" />
                  ) : (
                    <Text style={styles.deleteBtnText}>✕</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </View>

      <Modal
        visible={!!verifyModalItem}
        transparent
        animationType="fade"
        onRequestClose={() => setVerifyModalItem(null)}
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
                onPress={() => setVerifyModalItem(null)}
              >
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnConfirm, !verifyModalName.trim() && styles.modalBtnDisabled]}
                onPress={confirmVerify}
                disabled={!verifyModalName.trim() || verifyingId === verifyModalItem?.item_id}
              >
                {verifyingId === verifyModalItem?.item_id ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalBtnConfirmText}>Confirm</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!deleteConfirmItem}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteConfirmItem(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete Menu Item</Text>
            <Text style={styles.modalHint}>
              Delete "{deleteConfirmItem?.name}"? This can't be undone.
            </Text>
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setDeleteConfirmItem(null)}
              >
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnDanger]}
                onPress={confirmDelete}
              >
                <Text style={styles.modalBtnDangerText}>Delete</Text>
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
  header: { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, elevation: 2, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  backBtn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#f0f0f0' },
  backBtnText: { fontSize: 13, fontWeight: '600', color: '#e53e3e' },
  title: { fontSize: 24, fontWeight: '800', color: '#222', marginBottom: 2 },
  subtitle: { fontSize: 14, color: '#666' },
  summaryVerified: { fontSize: 12, color: '#2e7d32', fontWeight: '600', marginTop: 4 },
  summaryUnverified: { fontSize: 12, color: '#E65100', fontWeight: '600', marginTop: 4 },

  refreshBox: {
    marginHorizontal: 16, marginTop: 12, backgroundColor: '#FFF8F0',
    borderWidth: 1.5, borderColor: '#FFCC80', borderRadius: 10, padding: 12,
  },
  refreshBoxTitle: { fontSize: 13, fontWeight: '800', color: '#E65100', marginBottom: 4 },
  refreshBoxHint: { fontSize: 11.5, color: '#8D6E63', lineHeight: 16, marginBottom: 10 },
  refreshBtn: { borderRadius: 8, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center' },
  refreshBtnDisabled: { opacity: 0.6 },
  refreshBtnSolid: { backgroundColor: '#E65100' },
  refreshBtnText: { fontSize: 12, fontWeight: '800' },
  refreshBtnSubtext: { fontSize: 9.5, color: '#8D6E63', marginTop: 2, textAlign: 'center' },

  searchContainer: { paddingHorizontal: 16, paddingVertical: 12 },
  searchInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#222',
  },

  list: { paddingHorizontal: 16, paddingBottom: 20 },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    elevation: 1,
  },
  // minWidth:0 lets this shrink below its own content width (name text)
  // when the row is tight — without it, a flex:1 item's default min-width
  // is "big enough to fit its content," so it refuses to shrink and pushes
  // the action button / delete button off the visible row instead of just
  // wrapping the name text.
  itemInfo: { flex: 1, minWidth: 0 },
  itemName: { fontSize: 15, fontWeight: '700', color: '#222', marginBottom: 4 },
  itemNutrition: { fontSize: 12, color: '#666' },
  unconfirmedHint: { fontSize: 11, color: '#E65100', fontWeight: '600', marginTop: 4 },
  verifiedTag: { fontSize: 11, color: '#2e7d32', fontWeight: '700', marginTop: 4 },

  // Shared sizing so the verify and unconfirm buttons occupy the exact same
  // slot regardless of which state an item is in — only actionBtn's own
  // color variant (unconfirmBtn / verifyBtn) differs.
  itemAction: { width: 132, alignItems: 'flex-end', flexShrink: 0 },
  actionBtn: {
    width: '100%', alignItems: 'center', justifyContent: 'center',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10,
  },
  unconfirmBtn: { backgroundColor: '#FFF3E0', borderWidth: 1.5, borderColor: '#E65100' },
  unconfirmBtnText: { fontSize: 12, color: '#E65100', fontWeight: '800' },
  verifyBtn: { backgroundColor: '#4CAF50', elevation: 1 },
  verifyBtnText: { fontSize: 12, color: '#fff', fontWeight: '800', textAlign: 'center' },
  deleteBtn: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: '#FFEBEE',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  deleteBtnText: { fontSize: 14, fontWeight: '700', color: '#e53e3e' },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 30, paddingTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#222', marginBottom: 4 },
  emptySubtext: { fontSize: 13, color: '#666', textAlign: 'center' },

  noResultsText: { fontSize: 14, color: '#999', textAlign: 'center', marginTop: 20 },

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
  modalBtnDisabled: { opacity: 0.6 },
  modalBtnCancel: { backgroundColor: '#f0f0f0' },
  modalBtnCancelText: { fontSize: 14, fontWeight: '700', color: '#555' },
  modalBtnConfirm: { backgroundColor: '#4CAF50' },
  modalBtnConfirmText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  modalBtnDanger: { backgroundColor: '#e53e3e' },
  modalBtnDangerText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
