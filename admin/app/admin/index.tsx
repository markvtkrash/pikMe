import { useEffect, useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal,
  ActivityIndicator, Image, } from 'react-native';
import { Alert } from '../../src/utils/alert';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/api/supabase';
import { getOpenTicketCounts } from '../../src/api/supportTickets';
import { PasswordChangeModal } from './PasswordChangeModal';
import { BRAND_NAME } from '../../src/constants/brand';
import { AppIcon, IconText } from '../../src/components/common/AppIcon';

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

  // The dashboard shortcuts. A red number on a card is a count that needs attention; the small line is extra detail.
  const tiles: { key: string; icon: string; title: string; href: string; color: string; bg: string; count?: number; detail?: string }[] = [
    { key: 'claims', icon: '📋', title: 'Pending Claims', href: '/admin/claims', color: '#1565C0', bg: '#E3F2FD', count: stats.pendingClaims },
    { key: 'relocations', icon: '📍', title: 'Relocation Requests', href: '/admin/relocations', color: '#00796B', bg: '#E0F2F1', count: stats.pendingRelocations },
    { key: 'menu', icon: '🍽️', title: 'Menu Management', href: '/admin/menu-management', color: '#7B1FA2', bg: '#F3E5F5' },
    { key: 'coupons', icon: '🎟️', title: 'Coupon Management', href: '/admin/coupons', color: '#E65100', bg: '#FFF3E0', count: stats.totalCoupons, detail: `${stats.activeCoupons} active` },
    { key: 'owners', icon: '🏪', title: 'Manage Restaurants', href: '/admin/owners', color: '#C2185B', bg: '#FCE4EC' },
    { key: 'users', icon: '👥', title: 'Manage Users', href: '/admin/users', color: '#0277BD', bg: '#E1F5FE', count: stats.totalUsers },
    { key: 'create-owner', icon: '➕', title: 'Create Restaurant Owner', href: '/admin/create-owner', color: '#3949AB', bg: '#E8EAF6' },
    { key: 'reports', icon: '📊', title: 'Reports', href: '/admin/reports', color: '#F9A825', bg: '#FFFDE7' },
    { key: 'franchise-lookup', icon: '🍔', title: 'Franchise Lookup', href: '/admin/franchises', color: '#455A64', bg: '#ECEFF1' },
    { key: 'franchise-menus', icon: '🔗', title: 'Franchise Menu Management', href: '/admin/chain-menus', color: '#455A64', bg: '#ECEFF1' },
    { key: 'tools', icon: '🧰', title: 'Tools', href: '/admin/tools', color: '#455A64', bg: '#ECEFF1', detail: 'Scheduled builds · App config' },
    {
      key: 'support', icon: '🎧', title: 'Support', href: '/admin/tickets?status=open', color: '#C62828', bg: '#FFEBEE', count: stats.openTickets,
      detail: stats.openTickets > 0 ? `${stats.openOwnerTickets} owner · ${stats.openConsumerTickets} consumer` : undefined,
    },
  ];

  return (
    <View style={{ flex: 1 }}>
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <TouchableOpacity activeOpacity={1} onPress={handleTitleTap} style={styles.titleRow}>
            <Image source={require('../../assets/logo.png')} style={styles.titleLogo} />
            <Text style={styles.title}>{BRAND_NAME} Admin</Text>
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
            <IconText style={styles.settingsBtnText} emoji="⚙️" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.pageWrapper}>
      {/* Admin Sections */}
      <Text style={styles.sectionTitle}>Administration</Text>

      <View style={styles.adminTilesGrid}>
        {tiles.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.adminTile, { backgroundColor: t.bg, borderColor: t.color }]}
            onPress={() => router.push(t.href as any)}
            accessibilityRole="button"
          >
            {!!t.count && t.count > 0 && (
              <View style={styles.adminTileBadge}>
                <Text style={styles.adminTileBadgeText}>{t.count}</Text>
              </View>
            )}
            <View style={styles.adminTileTop}>
              <View style={[styles.adminTileCircle, { backgroundColor: t.color }]}>
                <AppIcon emoji={t.icon} size={16} color="#fff" />
              </View>
              <Text style={[styles.adminTileTitle, { color: t.color }]} numberOfLines={2}>{t.title}</Text>
            </View>
            {!!t.detail && <Text style={styles.adminTileDetail}>{t.detail}</Text>}
          </TouchableOpacity>
        ))}
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
          <IconText style={styles.settingsOptionText} emoji="🔐">Change Password</IconText>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingsOption}
          onPress={handleLogout}
        >
          <IconText style={styles.settingsOptionTextLogout} emoji="🚪">Logout</IconText>
        </TouchableOpacity>
      </View>
    )}

    {/* Password Change Modal Component */}
    <PasswordChangeModal visible={showPasswordModal} userEmail={userEmail} onClose={() => setShowPasswordModal(false)} />

    {/* Easter Egg — tap the header title 7 times */}
    <Modal visible={showEasterEgg} transparent animationType="fade" onRequestClose={() => setShowEasterEgg(false)}>
      <View style={styles.easterEggOverlay}>
        <View style={styles.easterEggCard}>
          <IconText style={styles.easterEggIcon} emoji="🎉" />
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  titleLogo: { width: 32, height: 32, borderRadius: 16 },
  title: { fontSize: 28, fontWeight: '800', color: '#fff' },
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
    width: '32%',
    minWidth: 200,
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 2,
    paddingVertical: 12,
    paddingHorizontal: 12,
    justifyContent: 'center',
    gap: 4,
    position: 'relative',
  },
  adminTileTop: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 18 },
  adminTileCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  adminTileIcon: { fontSize: 26 },
  adminTileTitle: { flex: 1, fontSize: 14, fontWeight: '800' },
  adminTileDetail: { fontSize: 11.5, fontWeight: '700', color: '#37474F', marginLeft: 44 },
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
