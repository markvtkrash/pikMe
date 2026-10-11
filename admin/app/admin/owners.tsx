import { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, Modal, ScrollView,
} from 'react-native';
import { Alert } from '../../src/utils/alert';
import { useRouter, useFocusEffect } from 'expo-router';
import { supabase } from '../../src/api/supabase';
import {
  adminListOwners, adminSetOwnerActive, adminSetRestaurantStatus,
  adminUpdateOwner, adminReassignOwner, adminDeleteRestaurant, AdminOwnerRow,
} from '../../src/api/restaurantAuth';
import { ResetOwnerPasswordModal, ResetOwnerTarget } from '../../src/components/common/ResetOwnerPasswordModal';
import { buildDeleteMessage } from '../../src/utils/restaurantDelete';
import { IconText } from '../../src/components/common/AppIcon';
import { useEnterChain } from '../../src/hooks/useEnterChain';
import { getFranchiseNameSet } from '../../src/api/franchiseKinds';
import { OWNER_KINDS, OwnerKind, countByKind, matchesOwnerKind } from '../../src/utils/ownerKinds';

function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const nums = '23456789';
  const special = '!@#$%^&*';
  const all = upper + lower + nums + special;
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
  const chars = [pick(upper), pick(lower), pick(nums), pick(special)];
  for (let i = chars.length; i < 12; i++) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Admin session expired. Please log in again.');
  return token;
}

export default function AdminOwnersScreen() {
  const router = useRouter();
  const [owners, setOwners] = useState<AdminOwnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState<OwnerKind>('all');
  const [franchiseNames, setFranchiseNames] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<ResetOwnerTarget | null>(null);

  const [editTarget, setEditTarget] = useState<AdminOwnerRow | null>(null);
  const [editBusinessName, setEditBusinessName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const [reassignTarget, setReassignTarget] = useState<AdminOwnerRow | null>(null);
  const [reassignEmail, setReassignEmail] = useState('');
  const [reassignPassword, setReassignPassword] = useState('');
  const [reassignBusinessName, setReassignBusinessName] = useState('');
  const [reassignSaving, setReassignSaving] = useState(false);
  const [reassignResult, setReassignResult] = useState<{ email: string; password: string } | null>(null);

  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    destructive: boolean;
    onConfirm: () => void;
  } | null>(null);

  const chainEdit = useEnterChain(2, () => handleSaveEdit());
  const chainReassign = useEnterChain(3, () => handleSaveReassign());

  useFocusEffect(
    useCallback(() => {
      loadOwners();
    }, [])
  );

  async function loadOwners() {
    setLoading(true);
    try {
      const data = await adminListOwners();
      setOwners(data);
      setFranchiseNames(await getFranchiseNameSet(data.map((o) => o.restaurant_name ?? '')));
    } catch (error: any) {
      console.error('[admin-owners] Load error:', error);
      Alert.alert('Error', error.message || 'Failed to load owners');
    } finally {
      setLoading(false);
    }
  }

  // Confirmation goes through an in-app Modal (see confirmAction state)
  // rather than Alert.alert with a custom button array -- that pattern is
  // unreliable on React Native Web (confirmed elsewhere in this app: the
  // claim button had the same silent no-op issue), which is why clicking
  // these used to appear to do nothing.
  function handleToggleActive(owner: AdminOwnerRow) {
    const nextActive = !owner.is_active;
    setConfirmAction({
      title: nextActive ? 'Reactivate owner?' : 'Deactivate owner?',
      message: nextActive
        ? `${owner.business_name} will be able to log in again.`
        : `${owner.business_name} will no longer be able to log in. Their restaurant, menu, and coupons stay untouched.`,
      confirmLabel: nextActive ? 'Reactivate' : 'Deactivate',
      destructive: !nextActive,
      onConfirm: async () => {
        setBusyId(owner.owner_id);
        try {
          await adminSetOwnerActive(owner.owner_id, nextActive);
          setOwners((prev) =>
            prev.map((o) => (o.owner_id === owner.owner_id ? { ...o, is_active: nextActive } : o))
          );
        } catch (error: any) {
          Alert.alert('Error', error.message || 'Failed to update owner');
        } finally {
          setBusyId(null);
        }
      },
    });
  }

  function handleToggleRestaurantStatus(owner: AdminOwnerRow) {
    if (!owner.restaurant_id || !owner.restaurant_status) return;
    const nextStatus = owner.restaurant_status === 'closed' ? 'approved' : 'closed';
    setConfirmAction({
      title: nextStatus === 'closed' ? 'Mark restaurant closed?' : 'Reopen restaurant?',
      message: nextStatus === 'closed'
        ? `${owner.restaurant_name} will be hidden from customer search. Menu and coupon history is kept for auditing.`
        : `${owner.restaurant_name} will be visible to customers again.`,
      confirmLabel: nextStatus === 'closed' ? 'Mark Closed' : 'Reopen',
      destructive: nextStatus === 'closed',
      onConfirm: async () => {
        setBusyId(owner.owner_id);
        try {
          await adminSetRestaurantStatus(owner.restaurant_id!, nextStatus);
          setOwners((prev) =>
            prev.map((o) =>
              o.owner_id === owner.owner_id ? { ...o, restaurant_status: nextStatus } : o
            )
          );
        } catch (error: any) {
          Alert.alert('Error', error.message || 'Failed to update restaurant');
        } finally {
          setBusyId(null);
        }
      },
    });
  }

  // Permanent delete of a closed restaurant (migration 091). A dry run first, so the confirm window
  // can say exactly what will be removed; the owner login stays and just has no restaurant.
  async function handleDeleteRestaurant(owner: AdminOwnerRow) {
    if (!owner.restaurant_id || owner.restaurant_status !== 'closed') return;
    const restaurantId = owner.restaurant_id;
    setBusyId(owner.owner_id);
    let counts;
    try {
      counts = await adminDeleteRestaurant(restaurantId, true);
    } catch (error: any) {
      setBusyId(null);
      Alert.alert('Error', error.message || 'Could not check what would be deleted');
      return;
    }
    setBusyId(null);
    setConfirmAction({
      title: 'Delete restaurant permanently?',
      message: buildDeleteMessage(counts),
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        setBusyId(owner.owner_id);
        try {
          await adminDeleteRestaurant(restaurantId, false);
          setOwners((prev) =>
            prev.map((o) =>
              o.owner_id === owner.owner_id
                ? { ...o, restaurant_id: null, restaurant_name: null, restaurant_status: null, claimed_at: null, google_place_id: null, restaurant_address: null }
                : o
            )
          );
        } catch (error: any) {
          Alert.alert('Error', error.message || 'Failed to delete restaurant');
        } finally {
          setBusyId(null);
        }
      },
    });
  }

  function openEdit(owner: AdminOwnerRow) {
    setEditTarget(owner);
    setEditBusinessName(owner.business_name);
    setEditEmail(owner.email);
  }

  async function handleSaveEdit() {
    if (!editTarget) return;
    if (!editBusinessName.trim() || !editEmail.trim()) {
      Alert.alert('Missing info', 'Business name and email are required');
      return;
    }
    setEditSaving(true);
    try {
      const accessToken = await getAccessToken();
      await adminUpdateOwner({
        ownerId: editTarget.owner_id,
        businessName: editBusinessName.trim(),
        email: editEmail.trim(),
        accessToken,
      });
      setOwners((prev) =>
        prev.map((o) =>
          o.owner_id === editTarget.owner_id
            ? { ...o, business_name: editBusinessName.trim(), email: editEmail.trim() }
            : o
        )
      );
      setEditTarget(null);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update owner');
    } finally {
      setEditSaving(false);
    }
  }

  function openReassign(owner: AdminOwnerRow) {
    setReassignTarget(owner);
    setReassignEmail('');
    setReassignPassword(generatePassword());
    setReassignBusinessName('');
    setReassignResult(null);
  }

  async function handleSaveReassign() {
    if (!reassignTarget?.restaurant_id) return;
    if (!reassignEmail.trim() || !reassignPassword || !reassignBusinessName.trim()) {
      Alert.alert('Missing info', 'New owner email, password, and business name are required');
      return;
    }
    setReassignSaving(true);
    try {
      const accessToken = await getAccessToken();
      await adminReassignOwner({
        restaurantId: reassignTarget.restaurant_id,
        newOwnerEmail: reassignEmail.trim(),
        newOwnerPassword: reassignPassword,
        newOwnerBusinessName: reassignBusinessName.trim(),
        accessToken,
      });
      setReassignResult({ email: reassignEmail.trim(), password: reassignPassword });
      loadOwners();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to reassign restaurant');
    } finally {
      setReassignSaving(false);
    }
  }

  const kindCounts = countByKind(owners, franchiseNames);

  const filtered = owners.filter((o) => {
    if (!matchesOwnerKind(o.restaurant_name, franchiseNames, kind)) return false;
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return (
      o.business_name.toLowerCase().includes(q) ||
      o.email.toLowerCase().includes(q) ||
      (o.restaurant_name ?? '').toLowerCase().includes(q) ||
      (o.restaurant_address ?? '').toLowerCase().includes(q) ||
      (o.google_place_id ?? '').toLowerCase().includes(q)
    );
  });

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
        <View style={styles.header}>
          <Text style={styles.title}>Manage Restaurants</Text>
          <Text style={styles.count}>{owners.length}</Text>
        </View>

        <View style={styles.filterBox}>
          <TextInput
            style={styles.filterInput}
            placeholder="Filter by owner, email, restaurant, address, or place ID..."
            placeholderTextColor="#999"
            value={filter}
            onChangeText={setFilter}
          />
        </View>

        <View style={styles.kindRow}>
          {OWNER_KINDS.map((k) => (
            <TouchableOpacity
              key={k.key}
              style={[styles.kindChip, kind === k.key && styles.kindChipActive]}
              onPress={() => setKind(k.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: kind === k.key }}
            >
              <Text style={[styles.kindChipText, kind === k.key && styles.kindChipTextActive]}>{k.label} ({kindCounts[k.key]})</Text>
            </TouchableOpacity>
          ))}
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(item) => item.owner_id}
          renderItem={({ item }) => {
            const isBusy = busyId === item.owner_id;
            const isClosed = item.restaurant_status === 'closed';
            return (
              <View style={[styles.card, isClosed && styles.cardClosed]}>
                <View style={styles.cardHeader}>
                  <Text style={styles.ownerName}>{item.business_name}</Text>
                  <View style={[styles.badge, item.is_active ? styles.badgeActive : styles.badgeInactive]}>
                    <Text style={[styles.badgeText, item.is_active ? styles.badgeTextActive : styles.badgeTextInactive]}>
                      {item.is_active ? 'Active' : 'Deactivated'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.ownerEmail}>{item.email}</Text>

                {item.restaurant_id ? (
                  <View style={styles.restaurantRow}>
                    <Text style={[styles.restaurantName, isClosed && styles.restaurantNameClosed]}>
                      {isClosed ? '🔒' : '🍽️'} {item.restaurant_name}
                    </Text>
                    <View style={[styles.badge, isClosed ? styles.badgeClosed : styles.badgeApproved]}>
                      <Text style={[styles.badgeText, isClosed ? styles.badgeTextClosed : styles.badgeTextApproved]}>
                        {isClosed ? 'CLOSED' : item.restaurant_status}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <Text style={styles.noRestaurant}>No restaurant claimed</Text>
                )}
                {!!item.restaurant_id && !!item.restaurant_address && (
                  <Text style={styles.address} selectable>📍 {item.restaurant_address}</Text>
                )}
                {!!item.restaurant_id && (
                  <Text style={styles.placeId} selectable>
                    Place ID: {item.google_place_id ?? 'not returned by the server (run migration 083)'}
                  </Text>
                )}

                <View style={styles.actionsRow}>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => openEdit(item)} disabled={isBusy}>
                    <IconText style={styles.actionBtnText} emoji="✏️">Edit</IconText>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => setResetTarget({ ownerId: item.owner_id, name: item.business_name, email: item.email })}
                    disabled={isBusy}
                  >
                    <IconText style={styles.actionBtnText} emoji="🔑">Reset Password</IconText>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionBtn, item.is_active ? styles.actionBtnWarn : styles.actionBtnOk]}
                    onPress={() => handleToggleActive(item)}
                    disabled={isBusy}
                  >
                    {isBusy ? (
                      <ActivityIndicator size="small" color={item.is_active ? '#c62828' : '#1565C0'} />
                    ) : (
                      <Text style={[styles.actionBtnText, item.is_active ? styles.actionBtnWarnText : styles.actionBtnOkText]}>
                        {item.is_active ? '🚫 Deactivate' : '✓ Reactivate'}
                      </Text>
                    )}
                  </TouchableOpacity>

                  {item.restaurant_id && (
                    <TouchableOpacity
                      style={[styles.actionBtn, isClosed ? styles.actionBtnOk : styles.actionBtnWarn]}
                      onPress={() => handleToggleRestaurantStatus(item)}
                      disabled={isBusy}
                    >
                      <Text style={[styles.actionBtnText, isClosed ? styles.actionBtnOkText : styles.actionBtnWarnText]}>
                        {isClosed ? '🔓 Reopen' : '🔒 Mark Closed'}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {item.restaurant_id && isClosed && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionBtnWarn]}
                      onPress={() => handleDeleteRestaurant(item)}
                      disabled={isBusy}
                    >
                      <IconText style={[styles.actionBtnText, styles.actionBtnWarnText]} emoji="🗑">Delete</IconText>
                    </TouchableOpacity>
                  )}

                  {item.restaurant_id && (
                    <TouchableOpacity style={styles.actionBtn} onPress={() => openReassign(item)} disabled={isBusy}>
                      <IconText style={styles.actionBtnText} emoji="🔁">Reassign</IconText>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          }}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.emptyText}>No owners found</Text>}
        />
      </View>

      <ResetOwnerPasswordModal target={resetTarget} onClose={() => setResetTarget(null)} />

      {/* Edit modal */}
      <Modal visible={!!editTarget} transparent animationType="fade" onRequestClose={() => setEditTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Owner</Text>

            <Text style={styles.label}>Business Name</Text>
            <TextInput {...chainEdit(0)}
              style={styles.input}
              value={editBusinessName}
              onChangeText={setEditBusinessName}
              editable={!editSaving}
            />

            <Text style={styles.label}>Email</Text>
            <TextInput {...chainEdit(1)}
              style={styles.input}
              value={editEmail}
              onChangeText={setEditEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!editSaving}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setEditTarget(null)} disabled={editSaving}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveEdit} disabled={editSaving}>
                {editSaving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalSaveBtnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Reassign modal */}
      <Modal visible={!!reassignTarget} transparent animationType="fade" onRequestClose={() => setReassignTarget(null)}>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalCardScroll} contentContainerStyle={styles.modalCard}>
            {reassignResult ? (
              <>
                <Text style={styles.modalTitle}>Reassigned ✅</Text>
                <Text style={styles.hint}>
                  Share these credentials with the new owner in person. They'll be required to change
                  the password on first login. The previous owner has been deactivated.
                </Text>
                <Text style={styles.label}>New Owner Email</Text>
                <Text style={styles.credValue} selectable>{reassignResult.email}</Text>
                <Text style={[styles.label, { marginTop: 12 }]}>Temporary Password</Text>
                <Text style={styles.credValue} selectable>{reassignResult.password}</Text>

                <TouchableOpacity
                  style={[styles.modalSaveBtn, { marginTop: 20 }]}
                  onPress={() => setReassignTarget(null)}
                >
                  <Text style={styles.modalSaveBtnText}>Done</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>Reassign Restaurant</Text>
                <Text style={styles.hint}>
                  {reassignTarget?.restaurant_name} will be transferred to a new owner account.
                  {reassignTarget?.business_name} will be deactivated (not deleted).
                </Text>

                <Text style={styles.label}>New Owner Email</Text>
                <TextInput {...chainReassign(0)}
                  style={styles.input}
                  value={reassignEmail}
                  onChangeText={setReassignEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="newowner@example.com"
                  placeholderTextColor="#999"
                  editable={!reassignSaving}
                />

                <Text style={styles.label}>New Owner Business Name</Text>
                <TextInput {...chainReassign(1)}
                  style={styles.input}
                  value={reassignBusinessName}
                  onChangeText={setReassignBusinessName}
                  placeholder="Business name"
                  placeholderTextColor="#999"
                  editable={!reassignSaving}
                />

                <Text style={styles.label}>Temporary Password</Text>
                <View style={styles.passwordRow}>
                  <TextInput {...chainReassign(2)}
                    style={[styles.input, styles.passwordInput]}
                    value={reassignPassword}
                    onChangeText={setReassignPassword}
                    autoCapitalize="none"
                    editable={!reassignSaving}
                  />
                  <TouchableOpacity
                    style={styles.regenBtn}
                    onPress={() => setReassignPassword(generatePassword())}
                    disabled={reassignSaving}
                  >
                    <IconText style={styles.regenBtnText} emoji="🔄" />
                  </TouchableOpacity>
                </View>

                <View style={styles.modalActions}>
                  <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setReassignTarget(null)} disabled={reassignSaving}>
                    <Text style={styles.modalCancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveReassign} disabled={reassignSaving}>
                    {reassignSaving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalSaveBtnText}>Reassign</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Confirm modal — used instead of Alert.alert, which is unreliable on web */}
      <Modal visible={!!confirmAction} transparent animationType="fade" onRequestClose={() => setConfirmAction(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{confirmAction?.title}</Text>
            <Text style={styles.hint}>{confirmAction?.message}</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setConfirmAction(null)}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSaveBtn, confirmAction?.destructive && styles.modalSaveBtnDestructive]}
                onPress={() => {
                  confirmAction?.onConfirm();
                  setConfirmAction(null);
                }}
              >
                <Text style={styles.modalSaveBtnText}>{confirmAction?.confirmLabel}</Text>
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
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: { backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', elevation: 2 },
  title: { fontSize: 24, fontWeight: '800', color: '#222' },
  count: { fontSize: 18, fontWeight: '800', color: '#1565C0', backgroundColor: '#E3F2FD', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },

  kindRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  kindChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, borderWidth: 1.5, borderColor: '#cfd8dc', backgroundColor: '#fff' },
  kindChipActive: { backgroundColor: '#1565C0', borderColor: '#1565C0' },
  kindChipText: { fontSize: 13, fontWeight: '700', color: '#455A64' },
  kindChipTextActive: { color: '#fff' },
  filterBox: { paddingHorizontal: 16, paddingTop: 12 },
  filterInput: { paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#222', backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#B0BEC5', borderRadius: 8 },

  list: { paddingHorizontal: 16, paddingVertical: 12 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12, elevation: 1, borderWidth: 1, borderColor: '#CFD8DC' },
  cardClosed: { backgroundColor: '#FFF5F5', borderWidth: 1.5, borderColor: '#e53e3e' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 2 },
  ownerName: { fontSize: 16, fontWeight: '800', color: '#222', flex: 1, minWidth: 0 },
  ownerEmail: { fontSize: 12, color: '#666', marginBottom: 8 },

  restaurantRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  restaurantName: { fontSize: 13, fontWeight: '700', color: '#333', flex: 1, minWidth: 0 },
  restaurantNameClosed: { color: '#c62828' },
  address: { fontSize: 12, color: '#555', marginTop: 2 },
  placeId: { fontSize: 11, color: '#888', marginTop: 2 },
  noRestaurant: { fontSize: 12, color: '#999', fontStyle: 'italic', marginBottom: 10 },

  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, flexShrink: 0 },
  badgeText: { fontSize: 11, fontWeight: '800', textTransform: 'capitalize' },
  badgeActive: { backgroundColor: '#E3F2FD' },
  badgeTextActive: { color: '#1565C0' },
  badgeInactive: { backgroundColor: '#FFEBEE' },
  badgeTextInactive: { color: '#c62828' },
  badgeApproved: { backgroundColor: '#E3F2FD' },
  badgeTextApproved: { color: '#1565C0' },
  badgeClosed: { backgroundColor: '#e53e3e' },
  badgeTextClosed: { color: '#fff' },

  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#F5F5F5' },
  actionBtnText: { fontSize: 12, fontWeight: '700', color: '#333' },
  actionBtnWarn: { backgroundColor: '#FFEBEE' },
  actionBtnWarnText: { color: '#c62828' },
  actionBtnOk: { backgroundColor: '#E3F2FD' },
  actionBtnOkText: { color: '#1565C0' },

  emptyText: { fontSize: 14, color: '#999', textAlign: 'center', marginTop: 40 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCardScroll: { width: '100%', maxWidth: 440, maxHeight: '90%' },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 440 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#222', marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '700', color: '#333', marginBottom: 6, marginTop: 4 },
  input: { paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: '#222', marginBottom: 10, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#B0BEC5', borderRadius: 8 },
  hint: { fontSize: 12, color: '#888', lineHeight: 18, marginBottom: 14 },
  passwordRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  passwordInput: { flex: 1 },
  regenBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: '#E3F2FD', alignItems: 'center', justifyContent: 'center' },
  regenBtnText: { fontSize: 18 },
  credValue: { fontSize: 15, fontWeight: '700', color: '#222', backgroundColor: '#fafafa', borderRadius: 8, padding: 10 },

  modalActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  modalCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: '#F5F5F5' },
  modalCancelBtnText: { fontSize: 14, fontWeight: '700', color: '#666' },
  modalSaveBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: '#1565C0' },
  modalSaveBtnDestructive: { backgroundColor: '#e53e3e' },
  modalSaveBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
