import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert, TextInput,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../../src/api/supabase';

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
          renderItem={({ item }) => (
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
              <View style={[styles.roleBadge, { backgroundColor: `${ROLE_COLORS[item.role]}20` }]}>
                <Text style={[styles.roleText, { color: ROLE_COLORS[item.role] }]}>
                  {item.role.toUpperCase()}
                </Text>
              </View>
            </View>
          )}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
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

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '700', color: '#222' },
});
