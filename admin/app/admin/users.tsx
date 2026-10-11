import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, TextInput, Modal,
} from 'react-native';
import { Alert, confirmDialog } from '../../src/utils/alert';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../../src/api/supabase';
import { adminSetOwnerActive } from '../../src/api/restaurantAuth';
import { filterUsers } from '../../src/utils/userFilter';
import { ResetOwnerPasswordModal, ResetOwnerTarget } from '../../src/components/common/ResetOwnerPasswordModal';
import { IconText } from '../../src/components/common/AppIcon';
import { listRemovableOwners, deleteUserAsAdmin } from '../../src/api/ownerCleanup';
import type { RemovableOwner } from '../../src/utils/ownerCleanup';
import { canDeleteUser, deleteUserQuestion, activityTag, cleanupTag, TONE_COLORS } from '../../src/utils/userDelete';

type UserRole = 'admin' | 'owner' | 'customer';
type RoleFilter = 'all' | UserRole;

const ROLE_TABS: { key: RoleFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'owner', label: 'Owners' },
  { key: 'customer', label: 'Consumers' },
  { key: 'admin', label: 'SuperAdmin' },
];

interface AppUser {
  user_id: string;
  email: string;
  role: UserRole;
  business_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  is_active: boolean | null;
  restaurant_name: string | null;
  restaurant_address: string | null;
}

const ROLE_COLORS: Record<UserRole, string> = {
  admin: '#8E24AA',
  owner: '#1565C0',
  customer: '#1565C0',
};

export default function AdminUsersScreen() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<RoleFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<AppUser | null>(null);
  const [resetTarget, setResetTarget] = useState<ResetOwnerTarget | null>(null);
  // Which owner logins may be deleted yet (no restaurant, deactivated long enough: migration 132), and who is signed in.
  const [ownerRules, setOwnerRules] = useState<Map<string, RemovableOwner>>(new Map());
  const [meId, setMeId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadUsers();
    }, [])
  );

  async function loadUsers() {
    try {
      const { data, error } = await supabase.rpc('list_all_users');
      if (error) throw error;
      setUsers(data || []);
      try {
        const list = await listRemovableOwners();
        setOwnerRules(new Map(list.map((r) => [r.owner_id, r])));
      } catch (e: any) {
        console.warn('[admin-users] Could not load the owner delete rules (is migration 132 applied?):', e?.message);
      }
      const { data: me } = await supabase.auth.getUser();
      setMeId(me.user?.id ?? null);
    } catch (error: any) {
      console.error('[admin-users] Load error:', error);
      Alert.alert('Error', error.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  function handleToggleActiveRequest(user: AppUser) {
    setConfirmTarget(user);
  }

  async function handleToggleActiveConfirm() {
    if (!confirmTarget) return;
    const user = confirmTarget;
    const nextActive = !(user.is_active ?? true);
    setConfirmTarget(null);
    setBusyId(user.user_id);
    try {
      await adminSetOwnerActive(user.user_id, nextActive);
      setUsers((prev) =>
        prev.map((u) => (u.user_id === user.user_id ? { ...u, is_active: nextActive } : u))
      );
    } catch (error: any) {
      console.error('[admin-users] Toggle active error:', error);
      Alert.alert('Error', error.message || 'Failed to update login status');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteUser(user: AppUser) {
    const q = deleteUserQuestion(user.email);
    if (!(await confirmDialog(q.title, q.message, { confirmText: 'Delete permanently', destructive: true }))) return;
    setBusyId(user.user_id);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Admin session expired. Please log in again.');
      await deleteUserAsAdmin(user.user_id, token);
      setUsers((prev) => prev.filter((u) => u.user_id !== user.user_id));
      Alert.alert('Deleted', `${user.email} was deleted.`);
    } catch (error: any) {
      Alert.alert('Could not delete', error.message || 'Failed to delete the user');
    } finally {
      setBusyId(null);
    }
  }

  const filteredUsers = filterUsers(users, activeTab, searchQuery);

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
        <Text style={styles.title}>All Users</Text>
        <Text style={styles.count}>{users.length}</Text>
      </View>

      <View style={styles.tabsContainer}>
        {ROLE_TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by email, business, restaurant or address..."
          placeholderTextColor="#999"
          autoCapitalize="none"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {filteredUsers.length === 0 ? (
        <View style={styles.emptyContainer}>
          <IconText style={styles.emptyIcon} emoji="🔍" />
          <Text style={styles.emptyText}>No users found</Text>
        </View>
      ) : (
        <FlatList
          data={filteredUsers}
          keyExtractor={(item) => item.user_id}
          renderItem={({ item }) => {
            const blocked = item.role === 'owner' && item.is_active === false;
            const busy = busyId === item.user_id;
            return (
              <View style={styles.userRow}>
                <View style={styles.userInfo}>
                  <Text style={styles.email}>{item.email}</Text>
                  {item.business_name ? (
                    <Text style={styles.businessName}>{item.business_name}</Text>
                  ) : null}
                  {item.role === 'owner' && (item.restaurant_name || item.restaurant_address) ? (
                    <Text style={styles.restaurantLine}>
                      🍽️ {[item.restaurant_name, item.restaurant_address].filter(Boolean).join(' — ')}
                    </Text>
                  ) : null}
                  <View style={styles.tagRow}>
                    {[cleanupTag(item.role, ownerRules.get(item.user_id)), activityTag(item.last_sign_in_at, item.created_at)]
                      .filter((t): t is NonNullable<typeof t> => !!t)
                      .map((t) => (
                        <View key={t.label} style={[styles.tag, { backgroundColor: TONE_COLORS[t.tone].bg }]}>
                          <Text style={[styles.tagText, { color: TONE_COLORS[t.tone].fg }]}>{t.label}</Text>
                        </View>
                      ))}
                  </View>
                  <Text style={styles.meta}>
                    Joined {new Date(item.created_at).toLocaleDateString()}
                    {item.last_sign_in_at
                      ? ` · Last active ${new Date(item.last_sign_in_at).toLocaleDateString()}`
                      : ' · Never signed in'}
                  </Text>
                </View>
                <View style={styles.userActions}>
                  <View style={[styles.roleBadge, { backgroundColor: `${ROLE_COLORS[item.role]}20` }]}>
                    <Text style={[styles.roleText, { color: ROLE_COLORS[item.role] }]}>
                      {blocked ? 'DEACTIVATED' : item.role.toUpperCase()}
                    </Text>
                  </View>
                  {item.role === 'owner' && (
                    <TouchableOpacity
                      style={[styles.blockBtn, styles.resetBtn, busy && styles.btnDisabled]}
                      onPress={() =>
                        setResetTarget({
                          ownerId: item.user_id,
                          name: item.business_name || item.email,
                          email: item.email,
                        })
                      }
                      disabled={busy}
                    >
                      <IconText style={[styles.blockBtnText, { color: '#222' }]} emoji="🔑">Reset Password</IconText>
                    </TouchableOpacity>
                  )}
                  {canDeleteUser(item, ownerRules, meId) && (
                    <TouchableOpacity
                      style={[styles.blockBtn, styles.deleteUserBtn, busy && styles.btnDisabled]}
                      onPress={() => handleDeleteUser(item)}
                      disabled={busy}
                      accessibilityLabel={`Delete ${item.email}`}
                    >
                      <IconText style={styles.deleteUserText} emoji="🗑️">Delete</IconText>
                    </TouchableOpacity>
                  )}
                  {item.role === 'owner' && (
                    <TouchableOpacity
                      style={[styles.blockBtn, blocked ? styles.unblockBtn : styles.blockBtnDanger, busy && styles.btnDisabled]}
                      onPress={() => handleToggleActiveRequest(item)}
                      disabled={busy}
                    >
                      {busy ? (
                        <ActivityIndicator size="small" color={blocked ? '#1565C0' : '#e53e3e'} />
                      ) : (
                        <Text style={[styles.blockBtnText, { color: blocked ? '#1565C0' : '#e53e3e' }]}>
                          {blocked ? 'Reactivate' : 'Deactivate'}
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          }}
          contentContainerStyle={styles.list}
        />
      )}
    </View>

    <Modal visible={!!confirmTarget} transparent animationType="fade" onRequestClose={() => setConfirmTarget(null)}>
      <View style={styles.confirmOverlay}>
        <View style={styles.confirmCard}>
          <Text style={styles.confirmTitle}>
            {confirmTarget?.is_active === false ? 'Reactivate this owner?' : 'Deactivate this owner?'}
          </Text>
          <Text style={styles.confirmMessage}>
            {confirmTarget?.is_active === false
              ? `${confirmTarget?.business_name || confirmTarget?.email} will be able to log in again.`
              : `${confirmTarget?.business_name || confirmTarget?.email} will no longer be able to log in until reactivated here. Their restaurant, menu, and coupons stay untouched.`}
          </Text>
          <View style={styles.confirmActions}>
            <TouchableOpacity style={styles.confirmCancelBtn} onPress={() => setConfirmTarget(null)}>
              <Text style={styles.confirmCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={confirmTarget?.is_active === false ? styles.confirmUnblockBtn : styles.confirmBlockBtn}
              onPress={handleToggleActiveConfirm}
            >
              <Text style={styles.confirmActionText}>
                {confirmTarget?.is_active === false ? 'Reactivate' : 'Deactivate'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>

    <ResetOwnerPasswordModal target={resetTarget} onClose={() => setResetTarget(null)} />
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

  tabsContainer: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#e0e0e0', backgroundColor: '#fff' },
  tab: { paddingHorizontal: 16, paddingVertical: 10, marginRight: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#1565C0' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#999' },
  tabTextActive: { color: '#1565C0' },

  searchContainer: { backgroundColor: '#fff', paddingHorizontal: 16, paddingBottom: 12 },
  searchInput: { paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#222', backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#B0BEC5', borderRadius: 8 },

  list: { paddingHorizontal: 16, paddingVertical: 12 },
  userRow: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', elevation: 1, borderWidth: 1, borderColor: '#CFD8DC' },
  userInfo: { flex: 1, marginRight: 12 },
  email: { fontSize: 14, fontWeight: '700', color: '#222', marginBottom: 2 },
  businessName: { fontSize: 12, color: '#1565C0', fontWeight: '600', marginBottom: 2 },
  restaurantLine: { fontSize: 12, color: '#555', marginBottom: 2 },
  meta: { fontSize: 11, color: '#999' },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  roleText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  userActions: { alignItems: 'flex-end', gap: 6 },
  blockBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6, marginBottom: 2 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  tagText: { fontSize: 11, fontWeight: '800' },
  deleteUserBtn: { backgroundColor: '#C62828', borderColor: '#C62828' },
  deleteUserText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  blockBtnDanger: { borderColor: '#e53e3e', backgroundColor: '#FFEBEE' },
  unblockBtn: { borderColor: '#1565C0', backgroundColor: '#E3F2FD' },
  resetBtn: { borderColor: '#ccc', backgroundColor: '#ECEFF1' },
  blockBtnText: { fontSize: 11, fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '700', color: '#222' },

  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  confirmCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 360 },
  confirmTitle: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 8 },
  confirmMessage: { fontSize: 13, color: '#666', marginBottom: 18 },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  confirmCancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  confirmCancelText: { fontSize: 13, fontWeight: '700', color: '#666' },
  confirmBlockBtn: { backgroundColor: '#e53e3e', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  confirmUnblockBtn: { backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  confirmActionText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});
