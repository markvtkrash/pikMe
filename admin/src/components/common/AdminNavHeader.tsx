import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Modal, Pressable, ScrollView } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { supabase } from '../../api/supabase';

// Every admin page, in the same order as the dashboard tiles. Add new pages
// here and they show up in the header menu on every screen.
const NAV_ITEMS: { label: string; icon: string; href: string; match: string }[] = [
  { label: 'Dashboard', icon: '🏠', href: '/admin', match: '/admin' },
  { label: 'Pending Claims', icon: '📋', href: '/admin/claims', match: '/admin/claims' },
  { label: 'Relocations', icon: '📍', href: '/admin/relocations', match: '/admin/relocations' },
  { label: 'Restaurants', icon: '🍽️', href: '/admin/restaurants', match: '/admin/restaurants' },
  { label: 'Menu Management', icon: '🧾', href: '/admin/menu-management', match: '/admin/menu-management' },
  { label: 'Coupons', icon: '🎟️', href: '/admin/coupons', match: '/admin/coupons' },
  { label: 'Manage Restaurants', icon: '🏪', href: '/admin/owners', match: '/admin/owners' },
  { label: 'Users', icon: '👥', href: '/admin/users', match: '/admin/users' },
  { label: 'Create Owner', icon: '➕', href: '/admin/create-owner', match: '/admin/create-owner' },
  { label: 'Reports', icon: '📊', href: '/admin/reports', match: '/admin/reports' },
  { label: 'Franchise Lookup', icon: '🍔', href: '/admin/franchises', match: '/admin/franchises' },
  { label: 'App Config', icon: '⚙️', href: '/admin/config', match: '/admin/config' },
  { label: 'Support Tickets', icon: '🎧', href: '/admin/tickets?status=open', match: '/admin/tickets' },
];

function isActive(pathname: string, match: string) {
  if (match === '/admin') return pathname === '/admin';
  return pathname === match || pathname.startsWith(`${match}/`);
}

// Header-left for every admin screen: logo, a Dashboard button, and — on a
// report page — a link back up to the Reports list.
export function AdminHeaderLeft() {
  const router = useRouter();
  const pathname = usePathname();
  const onDashboard = pathname === '/admin';
  const onReportPage = pathname.startsWith('/admin/reports/');

  return (
    <View style={styles.leftRow}>
      <Image source={require('../../../assets/logo.png')} style={styles.logo} />
      {!onDashboard && (
        <TouchableOpacity onPress={() => router.push('/admin')} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>🏠 Dashboard</Text>
        </TouchableOpacity>
      )}
      {onReportPage && (
        <TouchableOpacity onPress={() => router.push('/admin/reports')} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>‹ Reports</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Header-right for every admin screen: a menu that jumps to any page, plus
// Logout. A dropdown rather than a row of buttons so it fits at any width.
export function AdminHeaderRight() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  function go(href: string) {
    setOpen(false);
    router.push(href as any);
  }

  async function logout() {
    setOpen(false);
    await supabase.auth.signOut();
    router.replace('/admin/login');
  }

  return (
    <View style={styles.rightRow}>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.headerBtn} accessibilityLabel="Open navigation menu">
        <Text style={styles.headerBtnText}>☰ Menu</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          {/* Inner Pressable swallows taps so touching the card doesn't close it. */}
          <Pressable style={styles.menuCard} onPress={() => {}}>
            <ScrollView showsVerticalScrollIndicator={false}>
              {NAV_ITEMS.map((item) => {
                const active = isActive(pathname, item.match);
                return (
                  <TouchableOpacity
                    key={item.href}
                    style={[styles.menuItem, active && styles.menuItemActive]}
                    onPress={() => go(item.href)}
                  >
                    <Text style={styles.menuIcon}>{item.icon}</Text>
                    <Text style={[styles.menuLabel, active && styles.menuLabelActive]}>{item.label}</Text>
                  </TouchableOpacity>
                );
              })}
              <View style={styles.menuDivider} />
              <TouchableOpacity style={styles.menuItem} onPress={logout}>
                <Text style={styles.menuIcon}>🚪</Text>
                <Text style={[styles.menuLabel, styles.logoutLabel]}>Logout</Text>
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  leftRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 16 },
  rightRow: { marginRight: 16 },
  logo: { width: 24, height: 24, borderRadius: 12 },
  headerBtn: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 6 },
  headerBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'flex-end', paddingTop: 56, paddingRight: 12 },
  menuCard: {
    backgroundColor: '#fff', borderRadius: 12, paddingVertical: 6, minWidth: 220, maxHeight: '80%',
    elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 11 },
  menuItemActive: { backgroundColor: '#E3F2FD' },
  menuIcon: { fontSize: 16, width: 22, textAlign: 'center' },
  menuLabel: { fontSize: 14, fontWeight: '600', color: '#222' },
  menuLabelActive: { color: '#1565C0', fontWeight: '800' },
  menuDivider: { height: 1, backgroundColor: '#eee', marginVertical: 4 },
  logoutLabel: { color: '#c62828' },
});
