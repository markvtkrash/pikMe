import { useEffect, useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Animated, Modal,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/api/supabase';
import { getOpenTicketCounts } from '../../src/api/supportTickets';
import { PasswordChangeModal } from './PasswordChangeModal';
import { BRAND_NAME } from '../../src/constants/brand';

interface Stats {
  totalUsers: number;
  totalRestaurants: number;
  approvedRestaurants: number;
  pendingRestaurants: number;
  totalCoupons: number;
  activeCoupons: number;
  pendingClaims: number;
  pendingRelocations: number;
  openTickets: number;
  openOwnerTickets: number;
  openConsumerTickets: number;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats>({
    totalUsers: 0,
    totalRestaurants: 0,
    approvedRestaurants: 0,
    pendingRestaurants: 0,
    totalCoupons: 0,
    activeCoupons: 0,
    pendingClaims: 0,
    pendingRelocations: 0,
    openTickets: 0,
    openOwnerTickets: 0,
    openConsumerTickets: 0,
  });
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string>('');
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showEasterEgg, setShowEasterEgg] = useState(false);
  const blinkAnim = useRef(new Animated.Value(1)).current;
  const titleTapCount = useRef(0);
  const titleTapResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleTitleTap() {
    titleTapCount.current += 1;
    if (titleTapResetTimer.current) clearTimeout(titleTapResetTimer.current);

    if (titleTapCount.current >= 7) {
      titleTapCount.current = 0;
      setShowEasterEgg(true);
      return;
    }

    // Reset the streak if taps stop coming in quickly
    titleTapResetTimer.current = setTimeout(() => {
      titleTapCount.current = 0;
    }, 1500);
  }

  useEffect(() => {
    loadUserInfo();
    loadStats();
  }, []);

  // Blink the support-ticket count while there's at least one open ticket.
  useEffect(() => {
    if (stats.openTickets > 0) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(blinkAnim, { toValue: 0.3, duration: 600, useNativeDriver: true }),
          Animated.timing(blinkAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
    blinkAnim.setValue(1);
  }, [stats.openTickets]);

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

      // Get user count — auth.users isn't exposed to PostgREST directly, so
      // this goes through the same list_all_users() RPC the Users list uses.
      const { data: allUsers } = await supabase.rpc('list_all_users');
      const userCount = allUsers?.length ?? 0;

      // Get restaurant count
      const { count: restaurantCount } = await supabase
        .from('restaurants')
        .select('*', { count: 'exact', head: true });

      const { count: approvedRestaurants } = await supabase
        .from('restaurants')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'approved');

      const { count: pendingRestaurants } = await supabase
        .from('restaurants')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

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
        .eq('status', 'pending');

      // Get pending relocation requests
      const { count: pendingRelocations } = await supabase
        .from('restaurant_relocation_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      // Get open support tickets, split by who filed them
      const ticketCounts = await getOpenTicketCounts();

      setStats({
        totalUsers: userCount || 0,
        totalRestaurants: restaurantCount || 0,
        approvedRestaurants: approvedRestaurants || 0,
        pendingRestaurants: pendingRestaurants || 0,
        totalCoupons: totalCoupons || 0,
        activeCoupons: activeCoupons || 0,
        pendingClaims: pendingClaims || 0,
        pendingRelocations: pendingRelocations || 0,
        openTickets: ticketCounts.total,
        openOwnerTickets: ticketCounts.owner,
        openConsumerTickets: ticketCounts.consumer,
      });

      console.log('[admin-index] Stats loaded:', { userCount, restaurantCount, approvedRestaurants, pendingRestaurants, totalCoupons, activeCoupons, pendingClaims, ticketCounts });
    } catch (error: any) {
      console.error('[admin-index] Error loading stats:', error);
      Alert.alert('Error', 'Failed to load admin stats');
    } finally {
      setLoading(false);
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
    <View style={{ flex: 1 }}>
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <TouchableOpacity activeOpacity={1} onPress={handleTitleTap}>
            <Text style={styles.title}>🏢 {BRAND_NAME} Admin</Text>
          </TouchableOpacity>
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

      <View style={styles.pageWrapper}>
      {/* Admin Sections */}
      <Text style={styles.sectionTitle}>Administration</Text>

      <View style={styles.adminTilesGrid}>
        <Animated.View style={[styles.adminTileWrapper, { opacity: stats.openTickets > 0 ? blinkAnim : 1 }]}>
          <TouchableOpacity
            style={[
              styles.adminTile, styles.adminTileTicketsNeutral,
              stats.openTickets > 0 && styles.adminTileTicketsAlert,
              { width: '100%' },
            ]}
            onPress={() => router.push('/admin/tickets?status=open')}
          >
            {stats.openTickets > 0 && (
              <View style={styles.adminTileBadge}>
                <Text style={styles.adminTileBadgeText}>{stats.openTickets}</Text>
              </View>
            )}
            <Text style={styles.adminTileIcon}>🎧</Text>
            <Text style={[styles.adminTileTitle, stats.openTickets > 0 && styles.adminTileTitleAlert]}>Support</Text>
            {stats.openTickets > 0 && (
              <Text style={styles.adminTileDetailAlert}>
                {stats.openOwnerTickets} owner · {stats.openConsumerTickets} consumer
              </Text>
            )}
          </TouchableOpacity>
        </Animated.View>

        <TouchableOpacity
          style={[styles.adminTile, styles.adminTileClaims]}
          onPress={() => router.push('/admin/claims')}
        >
          {stats.pendingClaims > 0 && (
            <View style={styles.adminTileBadge}>
              <Text style={styles.adminTileBadgeText}>{stats.pendingClaims}</Text>
            </View>
          )}
          <Text style={styles.adminTileIcon}>📋</Text>
          <Text style={styles.adminTileTitle}>Pending Claims</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.adminTile, styles.adminTileRelocations]}
          onPress={() => router.push('/admin/relocations')}
        >
          {stats.pendingRelocations > 0 && (
            <View style={styles.adminTileBadge}>
              <Text style={styles.adminTileBadgeText}>{stats.pendingRelocations}</Text>
            </View>
          )}
          <Text style={styles.adminTileIcon}>📍</Text>
          <Text style={styles.adminTileTitle}>Relocation Requests</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.adminTile, styles.adminTileRestaurants]}
          onPress={() => router.push('/admin/restaurants')}
        >
          {stats.totalRestaurants > 0 && (
            <View style={styles.adminTileBadge}>
              <Text style={styles.adminTileBadgeText}>{stats.totalRestaurants}</Text>
            </View>
          )}
          <Text style={styles.adminTileIcon}>🍽️</Text>
          <Text style={styles.adminTileTitle}>Manage Restaurants</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.adminTile, styles.adminTileCoupons]}
          onPress={() => router.push('/admin/coupons')}
        >
          {stats.totalCoupons > 0 && (
            <View style={styles.adminTileBadge}>
              <Text style={styles.adminTileBadgeText}>{stats.totalCoupons}</Text>
            </View>
          )}
          <Text style={styles.adminTileIcon}>🎟️</Text>
          <Text style={styles.adminTileTitle}>Coupon Management</Text>
          <Text style={styles.adminTileDetail}>{stats.activeCoupons} active</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.adminTile, styles.adminTileOwner]}
          onPress={() => router.push('/admin/owners')}
        >
          <Text style={styles.adminTileIcon}>👤</Text>
          <Text style={styles.adminTileTitle}>Manage Owners</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.adminTile, styles.adminTileUsers]}
          onPress={() => router.push('/admin/users')}
        >
          {stats.totalUsers > 0 && (
            <View style={styles.adminTileBadge}>
              <Text style={styles.adminTileBadgeText}>{stats.totalUsers}</Text>
            </View>
          )}
          <Text style={styles.adminTileIcon}>👥</Text>
          <Text style={styles.adminTileTitle}>Manage Users</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.adminTile, styles.adminTileCreateOwner]}
          onPress={() => router.push('/admin/create-owner')}
        >
          <Text style={styles.adminTileIcon}>➕</Text>
          <Text style={styles.adminTileTitle}>Create Restaurant Owner</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.adminTile, styles.adminTileReports]}
          onPress={() => router.push('/admin/reports')}
        >
          <Text style={styles.adminTileIcon}>📊</Text>
          <Text style={styles.adminTileTitle}>Reports</Text>
        </TouchableOpacity>
      </View>
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

    {/* Easter Egg — tap the header title 7 times */}
    <Modal visible={showEasterEgg} transparent animationType="fade" onRequestClose={() => setShowEasterEgg(false)}>
      <View style={styles.easterEggOverlay}>
        <View style={styles.easterEggCard}>
          <Text style={styles.easterEggIcon}>🎉</Text>
          <Text style={styles.easterEggText}>Built with ❤️ by</Text>
          <Text style={styles.easterEggName}>Vikram R Vallurupalli</Text>
          <Text style={styles.easterEggRole}>Lead Engineer</Text>
          <TouchableOpacity style={styles.easterEggCloseBtn} onPress={() => setShowEasterEgg(false)}>
            <Text style={styles.easterEggCloseBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  pageWrapper: { width: '100%', maxWidth: 900, alignSelf: 'center' },

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

  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#222', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },

  adminTilesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingBottom: 16,
    gap: 10,
  },
  adminTile: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 6,
    elevation: 1,
    position: 'relative',
  },
  adminTileClaims: { backgroundColor: '#E3F2FD' },
  adminTileRelocations: { backgroundColor: '#B2DFDB' },
  adminTileRestaurants: { backgroundColor: '#F3E5F5' },
  adminTileCoupons: { backgroundColor: '#FFF3E0' },
  adminTileOwner: { backgroundColor: '#FCE4EC' },
  adminTileUsers: { backgroundColor: '#E0F7FA' },
  adminTileCreateOwner: { backgroundColor: '#E8EAF6' },
  adminTileReports: { backgroundColor: '#FFF9C4' },
  adminTileWrapper: { width: '48%' },
  adminTileTicketsNeutral: { backgroundColor: '#F5F5F5' },
  adminTileTicketsAlert: { backgroundColor: '#e53e3e' },
  adminTileTitleAlert: { color: '#fff' },
  adminTileDetailAlert: { fontSize: 11, fontWeight: '700', color: '#fff', marginTop: 2, opacity: 0.9 },
  adminTileIcon: { fontSize: 26 },
  adminTileTitle: { fontSize: 13, fontWeight: '700', color: '#222', textAlign: 'center' },
  adminTileDetail: { fontSize: 11, fontWeight: '700', color: '#2e7d32', marginTop: 2 },
  adminTileBadge: {
    position: 'absolute', top: 8, right: 8, backgroundColor: '#e53e3e', borderRadius: 10,
    minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  adminTileBadgeText: { fontSize: 11, fontWeight: '800', color: '#fff' },

  easterEggOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  easterEggCard: { backgroundColor: '#fff', borderRadius: 20, paddingVertical: 32, paddingHorizontal: 28, alignItems: 'center', width: '100%', maxWidth: 340 },
  easterEggIcon: { fontSize: 48, marginBottom: 12 },
  easterEggText: { fontSize: 14, color: '#666', marginBottom: 4 },
  easterEggName: { fontSize: 22, fontWeight: '800', color: '#1565C0', textAlign: 'center', marginBottom: 4 },
  easterEggRole: { fontSize: 13, color: '#999', fontWeight: '600', marginBottom: 24 },
  easterEggCloseBtn: { backgroundColor: '#1565C0', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 },
  easterEggCloseBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
