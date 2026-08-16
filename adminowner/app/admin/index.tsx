import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/api/supabase';
import { PasswordChangeModal } from './PasswordChangeModal';

interface Stats {
  totalUsers: number;
  totalRestaurants: number;
  totalCoupons: number;
  activeCoupons: number;
  pendingClaims: number;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats>({
    totalUsers: 0,
    totalRestaurants: 0,
    totalCoupons: 0,
    activeCoupons: 0,
    pendingClaims: 0,
  });
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string>('');
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  useEffect(() => {
    loadUserInfo();
    loadStats();
  }, []);

  async function loadUserInfo() {
    try {
      const { data } = await supabase.auth.getUser();
      if (data.user?.email) {
        setUserEmail(data.user.email);
        console.log('[admin-index] User email:', data.user.email);
      }
    } catch (error: any) {
      console.error('[admin-index] Error loading user info:', error);
    }
  }

  function handleChangePasswordClick() {
    setShowSettingsMenu(false);
    setShowPasswordModal(true);
  }


  async function handleLogout() {
    try {
      await supabase.auth.signOut();
      router.replace('/admin/login');
    } catch (error: any) {
      Alert.alert('Error', 'Failed to logout');
    }
  }

  async function loadStats() {
    setLoading(true);
    try {
      console.log('[admin-index] Loading stats');

      // Get user count
      const { count: userCount } = await supabase
        .from('auth.users')
        .select('*', { count: 'exact', head: true });

      // Get restaurant count
      const { count: restaurantCount } = await supabase
        .from('restaurants')
        .select('*', { count: 'exact', head: true });

      // Get total coupons
      const { count: totalCoupons } = await supabase
        .from('coupons')
        .select('*', { count: 'exact', head: true })
        .eq('is_deleted', false);

      // Get active coupons
      const now = new Date().toISOString();
      const { count: activeCoupons } = await supabase
        .from('coupons')
        .select('*', { count: 'exact', head: true })
        .eq('is_deleted', false)
        .eq('is_active', true)
        .gt('expiry_date', now);

      // Get pending claims
      const { count: pendingClaims } = await supabase
        .from('restaurants')
        .select('*', { count: 'exact', head: true })
        .is('claimed_at', null);

      setStats({
        totalUsers: userCount || 0,
        totalRestaurants: restaurantCount || 0,
        totalCoupons: totalCoupons || 0,
        activeCoupons: activeCoupons || 0,
        pendingClaims: pendingClaims || 0,
      });

      console.log('[admin-index] Stats loaded:', { userCount, restaurantCount, totalCoupons, activeCoupons, pendingClaims });
    } catch (error: any) {
      console.error('[admin-index] Error loading stats:', error);
      Alert.alert('Error', 'Failed to load admin stats');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace('/admin/login');
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.title}>🏢 PikMe Admin</Text>
          <Text style={styles.subtitle}>Administration Dashboard</Text>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.userSection}>
            <Text style={styles.userEmail}>{userEmail}</Text>
          </View>
          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={() => setShowSettingsMenu(!showSettingsMenu)}
          >
            <Text style={styles.settingsBtnText}>⚙️</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Stats Overview */}
      <View style={styles.statsGrid}>
        <View style={[styles.statBox, styles.statBoxUsers]}>
          <Text style={styles.statIcon}>👥</Text>
          <Text style={styles.statNumber}>{stats.totalUsers}</Text>
          <Text style={styles.statLabel}>Users</Text>
        </View>
        <View style={[styles.statBox, styles.statBoxRestaurants]}>
          <Text style={styles.statIcon}>🍽️</Text>
          <Text style={styles.statNumber}>{stats.totalRestaurants}</Text>
          <Text style={styles.statLabel}>Restaurants</Text>
        </View>
        <View style={[styles.statBox, styles.statBoxCoupons]}>
          <Text style={styles.statIcon}>🎫</Text>
          <Text style={styles.statNumber}>{stats.totalCoupons}</Text>
          <Text style={styles.statLabel}>Coupons</Text>
        </View>
        <View style={[styles.statBox, styles.statBoxActive]}>
          <Text style={styles.statIcon}>✅</Text>
          <Text style={styles.statNumber}>{stats.activeCoupons}</Text>
          <Text style={styles.statLabel}>Active</Text>
        </View>
      </View>

      {/* Admin Sections */}
      <Text style={styles.sectionTitle}>Administration</Text>

      <TouchableOpacity
        style={styles.adminCard}
        onPress={() => router.push('/admin/claims')}
      >
        <View style={styles.adminCardIcon}>
          <Text style={styles.adminCardIconText}>📋</Text>
        </View>
        <View style={styles.adminCardContent}>
          <Text style={styles.adminCardTitle}>Pending Claims</Text>
          <Text style={styles.adminCardSubtitle}>
            {stats.pendingClaims} restaurants awaiting approval
          </Text>
        </View>
        <Text style={styles.adminCardArrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.adminCard}
        onPress={() => router.push('/admin/coupons')}
      >
        <View style={[styles.adminCardIcon, styles.adminCardIconCoupons]}>
          <Text style={styles.adminCardIconText}>🎟️</Text>
        </View>
        <View style={styles.adminCardContent}>
          <Text style={styles.adminCardTitle}>Coupon Management</Text>
          <Text style={styles.adminCardSubtitle}>
            View, restore, or purge coupons
          </Text>
        </View>
        <Text style={styles.adminCardArrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.adminCard}
        onPress={() => router.push('/admin/create-owner')}
      >
        <View style={[styles.adminCardIcon, styles.adminCardIconUsers]}>
          <Text style={styles.adminCardIconText}>➕</Text>
        </View>
        <View style={styles.adminCardContent}>
          <Text style={styles.adminCardTitle}>Create Restaurant Owner</Text>
          <Text style={styles.adminCardSubtitle}>
            Provision and approve an owner account
          </Text>
        </View>
        <Text style={styles.adminCardArrow}>›</Text>
      </TouchableOpacity>

      <View style={[styles.adminCard, styles.adminCardDisabled]}>
        <View style={[styles.adminCardIcon, styles.adminCardIconSettings]}>
          <Text style={styles.adminCardIconText}>⚙️</Text>
        </View>
        <View style={styles.adminCardContent}>
          <Text style={styles.adminCardTitle}>Settings</Text>
          <Text style={styles.adminCardSubtitle}>
            Coming soon - system configuration
          </Text>
        </View>
        <Text style={styles.adminCardArrowDisabled}>⏳</Text>
      </View>
    </ScrollView>

    {/* Settings Dropdown - Rendered at root level to avoid ScrollView clipping */}
    {showSettingsMenu && (
      <View style={styles.settingsDropdownContainer}>
        <TouchableOpacity
          style={styles.settingsOption}
          onPress={handleChangePasswordClick}
        >
          <Text style={styles.settingsOptionText}>🔐 Change Password</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingsOption}
          onPress={handleLogout}
        >
          <Text style={styles.settingsOptionTextLogout}>🚪 Logout</Text>
        </TouchableOpacity>
      </View>
    )}

    {/* Password Change Modal Component */}
    <PasswordChangeModal visible={showPasswordModal} userEmail={userEmail} onClose={() => setShowPasswordModal(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    backgroundColor: '#1565C0',
    paddingHorizontal: 16,
    paddingVertical: 20,
    paddingTop: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerContent: { flex: 1 },
  title: { fontSize: 28, fontWeight: '800', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.8)' },
  headerRight: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  userSection: { paddingVertical: 8 },
  userEmail: { fontSize: 12, color: 'rgba(255,255,255,0.9)', fontWeight: '600' },
  settingsBtn: { width: 40, height: 40, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  settingsBtnText: { fontSize: 20 },
  settingsDropdownContainer: { position: 'absolute', top: 70, right: 16, backgroundColor: '#fff', borderRadius: 12, minWidth: 220, paddingVertical: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 10, zIndex: 9999 },
  settingsOption: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  settingsOptionText: { fontSize: 13, fontWeight: '600', color: '#222' },
  settingsOptionTextLogout: { fontSize: 13, fontWeight: '600', color: '#e53e3e' },
  settingsDivider: { height: 0, display: 'none' },

  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingVertical: 16,
    gap: 12,
  },
  statBox: {
    width: '48%',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: 'center',
    gap: 8,
  },
  statBoxUsers: { backgroundColor: '#E3F2FD' },
  statBoxRestaurants: { backgroundColor: '#F3E5F5' },
  statBoxCoupons: { backgroundColor: '#FFF3E0' },
  statBoxActive: { backgroundColor: '#E8F5E9' },
  statIcon: { fontSize: 32 },
  statNumber: { fontSize: 24, fontWeight: '800', color: '#222' },
  statLabel: { fontSize: 11, fontWeight: '600', color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 },

  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#222', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },

  adminCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    elevation: 1,
  },
  adminCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
  },
  adminCardIconCoupons: { backgroundColor: '#FFF3E0' },
  adminCardIconUsers: { backgroundColor: '#F3E5F5' },
  adminCardIconSettings: { backgroundColor: '#E8F5E9' },
  adminCardIconText: { fontSize: 24 },
  adminCardContent: { flex: 1 },
  adminCardTitle: { fontSize: 15, fontWeight: '700', color: '#222', marginBottom: 2 },
  adminCardSubtitle: { fontSize: 12, color: '#999' },
  adminCardArrow: { fontSize: 24, color: '#1565C0', fontWeight: '800' },
  adminCardDisabled: { opacity: 0.6 },
  adminCardArrowDisabled: { fontSize: 20, color: '#999', fontWeight: '800' },
});
