import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, TextInput, Modal,
} from 'react-native';
import { Alert } from '../../src/utils/alert';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../../src/api/supabase';
import { adminSetOwnerActive } from '../../src/api/restaurantAuth';

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
}

const ROLE_COLORS: Record<UserRole, string> = {
  admin: '#8E24AA',
  owner: '#1565C0',
  customer: '#2E7D32',
};

export default function AdminUsersScreen() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<RoleFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<AppUser | null>(null);

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

  const filteredUsers = users.filter((u) => {
    const matchesTab = activeTab === 'all' || u.role === activeTab;
    if (!matchesTab) return false;

    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return (
      u.email?.toLowerCase().includes(query) ||
      u.business_name?.toLowerCase().includes(query)
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
          placeholder="Search by email or business name..."
          placeholderTextColor="#999"
          autoCapitalize="none"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {filteredUsers.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🔍</Text>
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
                      {blocked ? 'BLOCKED' : item.role.toUpperCase()}
                    </Text>
                  </View>
                  {item.role === 'owner' && (
                    <TouchableOpacity
                      style={[styles.blockBtn, blocked ? styles.unblockBtn : styles.blockBtnDanger, busy && styles.btnDisabled]}
                      onPress={() => handleToggleActiveRequest(item)}
                      disabled={busy}
                    >
                      {busy ? (
                        <ActivityIndicator size="small" color={blocked ? '#2e7d32' : '#e53e3e'} />
                      ) : (
                        <Text style={[styles.blockBtnText, { color: blocked ? '#2e7d32' : '#e53e3e' }]}>
                          {blocked ? 'Unblock' : 'Block'}
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
            {confirmTarget?.is_active === false ? 'Unblock this owner?' : 'Block this owner?'}
          </Text>
          <Text style={styles.confirmMessage}>
            {confirmTarget?.is_active === false
              ? `${confirmTarget?.business_name || confirmTarget?.email} will be able to log in again.`
              : `${confirmTarget?.business_name || confirmTarget?.email} will no longer be able to log in until unblocked here. Their restaurant, menu, and coupons stay untouched.`}
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
                {confirmTarget?.is_active === false ? 'Unblock' : 'Block'}
              </Text>
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

  tabsContainer: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#e0e0e0', backgroundColor: '#fff' },
  tab: { paddingHorizontal: 16, paddingVertical: 10, marginRight: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#1565C0' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#999' },
  tabTextActive: { color: '#1565C0' },

  searchContainer: { backgroundColor: '#fff', paddingHorizontal: 16, paddingBottom: 12 },
  searchInput: { backgroundColor: '#f0f0f0', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#222' },

  list: { paddingHorizontal: 16, paddingVertical: 12 },
  userRow: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', elevation: 1 },
  userInfo: { flex: 1, marginRight: 12 },
  email: { fontSize: 14, fontWeight: '700', color: '#222', marginBottom: 2 },
  businessName: { fontSize: 12, color: '#1565C0', fontWeight: '600', marginBottom: 2 },
  meta: { fontSize: 11, color: '#999' },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  roleText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  userActions: { alignItems: 'flex-end', gap: 6 },
  blockBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  blockBtnDanger: { borderColor: '#e53e3e', backgroundColor: '#FFEBEE' },
  unblockBtn: { borderColor: '#2e7d32', backgroundColor: '#E8F5E9' },
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
  confirmUnblockBtn: { backgroundColor: '#2e7d32', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  confirmActionText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});
