import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Modal, Pressable } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useRestaurantOwnerStore } from '../../store/restaurantOwnerStore';
import { confirmNavigationAllowed } from '../../store/unsavedChangesStore';
import { BRAND_NAME } from '../../constants/brand';
import { ChangePasswordModal } from './ChangePasswordModal';
import { MenuImportAlertBar } from './MenuImportAlertBar';

function pathIs(pathname: string, target: string) {
  return pathname === target || pathname.startsWith(target + '/');
}

interface SubLink {
  label: string;
  href: string;
}

interface NavItem {
  key: string;
  label: string;
  href: string;
  isActive: (pathname: string) => boolean;
  children?: SubLink[];
}

const NAV_ITEMS: NavItem[] = [
  {
    key: 'dashboard',
    label: '🏠 Dashboard',
    href: '/restaurant/dashboard',
    isActive: (p) => pathIs(p, '/restaurant/dashboard'),
  },
  {
    key: 'menu',
    label: '🍽️ Menu Management',
    href: '/restaurant/menu-management',
    isActive: (p) =>
      pathIs(p, '/restaurant/menu-management') ||
      pathIs(p, '/restaurant/menu-link') ||
      pathIs(p, '/restaurant/menu-items') ||
      pathIs(p, '/restaurant/manual-menu') ||
      pathIs(p, '/restaurant/menu-photo') ||
      pathIs(p, '/restaurant/menu-text') ||
      pathIs(p, '/restaurant/menu-online-link') ||
      pathIs(p, '/restaurant/menu-nutrition'),
    // Edit Menu, Import Menu from Photo, Import Menu from Text and Import Menu from Online Link are entry points reached FROM the Menu
    // Management page (buttons on that page) — its children, not sibling
    // top-level sections of their own.
    children: [
      // AI Assisted Menu Pull (menu-items.tsx) and Add Nutrition Info (menu-nutrition.tsx) temporarily hidden —
      // to be revisited. Routes and backend are untouched.
      { label: 'Edit Menu', href: '/restaurant/manual-menu' },
      { label: 'Import Menu from Photo', href: '/restaurant/menu-photo' },
      { label: 'Import Menu from Text', href: '/restaurant/menu-text' },
      { label: 'Import Menu from Online Link', href: '/restaurant/menu-online-link' },
      // Upload Menu (menu-link.tsx) temporarily hidden — needs more fixes
      // before exposing it again. Route and backend are untouched.
    ],
  },
  {
    key: 'coupons',
    label: '🎟️ Coupons',
    href: '/restaurant/menu',
    isActive: (p) =>
      pathIs(p, '/restaurant/menu') ||
      pathIs(p, '/restaurant/coupon-status') ||
      pathIs(p, '/restaurant/active-coupons') ||
      pathIs(p, '/restaurant/inactive-coupons') ||
      pathIs(p, '/restaurant/expired') ||
      pathIs(p, '/restaurant/orphaned-coupons') ||
      pathIs(p, '/restaurant/coupon'),
    // Active/Inactive/Expired/Orphaned used to each be their own nav
    // destination — replaced by one multi-select status filter row on
    // Manage Coupons (coupon-status.tsx), since a coupon's statuses aren't
    // mutually exclusive (e.g. active AND orphaned at once) and a flat list
    // of nav links can't represent "show me more than one of these together"
    // the way an in-page filter can. The old standalone pages still exist
    // (dashboard's Active/Expired stat links point at them) but are no
    // longer reachable from this nav.
    children: [
      { label: 'Add Coupons', href: '/restaurant/menu' },
      { label: 'Manage Coupons', href: '/restaurant/coupon-status' },
    ],
  },
  {
    key: 'reports',
    label: '📊 Reports',
    href: '/restaurant/reports',
    isActive: (p) => pathIs(p, '/restaurant/reports'),
  },
  {
    key: 'tools',
    label: '🛠️ Tools',
    href: '/restaurant/preview',
    isActive: (p) =>
      pathIs(p, '/restaurant/preview') ||
      pathIs(p, '/restaurant/relocate') ||
      pathIs(p, '/restaurant/visibility'),
    children: [
      { label: 'Preview as a Customer', href: '/restaurant/preview' },
      { label: 'My Restaurant Moved', href: '/restaurant/relocate' },
      { label: 'Visible to Customers', href: '/restaurant/visibility' },
    ],
  },
  {
    key: 'profile',
    label: '🏪 Profile',
    href: '/restaurant/profile',
    isActive: (p) => pathIs(p, '/restaurant/profile'),
  },
  {
    key: 'support',
    label: '💬 Support Ticket',
    href: '/restaurant/support',
    isActive: (p) => pathIs(p, '/restaurant/support'),
  },
];

// Persistent top-level nav for every post-claim restaurant/* screen, so an
// owner can jump directly to any section instead of relying on each page's
// own back button. Sections with sub-pages (Menu, Coupons) show a second row
// of links for whichever section is currently active — tap-based rather
// than hover, since this app runs on both web and touch.
export function OwnerNavHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const { restaurant, logout } = useRestaurantOwnerStore();
  // Tracks the active top-level pill's position (relative to navWrap) so the
  // connector + triangle below it can line up exactly, instead of guessing a
  // fixed spot — pills reflow depending on how many wrap to each row.
  const [pointerX, setPointerX] = useState<number | null>(null);
  const [pillBottom, setPillBottom] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  const activeItem = NAV_ITEMS.find((item) => item.isActive(pathname));

  async function handleLogout() {
    if (!(await confirmNavigationAllowed())) return;
    logout();
    router.replace('/restaurant/auth/login');
  }

  // router.push() adds a screen on top of the stack rather than removing the
  // current one, so a screen's own "leaving with unsaved changes" listener
  // (React Navigation's beforeRemove) never fires for these — this shared
  // check is what actually catches it.
  async function handleNavigate(href: string) {
    if (!(await confirmNavigationAllowed())) return;
    router.push(href as any);
  }

  return (
    <View style={styles.wrapper}>
      {/* The bell alert sits at the very top of every owner page when a menu import came up empty */}
      <MenuImportAlertBar onOpenPhotoImport={() => handleNavigate('/restaurant/menu-photo')} />
      <View style={styles.brandRow}>
        <Image source={require('../../../assets/logo.png')} style={styles.brandLogo} />
        <View style={styles.brandTextGroup}>
          <Text style={styles.brandSmall}>{BRAND_NAME}</Text>
          <Text style={styles.brand} numberOfLines={1}>
            {restaurant ? restaurant.name : 'Owner Portal'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.gearBtn}
          onPress={() => setSettingsOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Account settings"
        >
          <Text style={styles.gearIcon}>⚙️</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={settingsOpen} transparent animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
        <Pressable style={styles.menuOverlay} onPress={() => setSettingsOpen(false)}>
          {/* Inner Pressable swallows taps so touching the menu doesn't close it. */}
          <Pressable style={styles.menuCard} onPress={() => {}}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setSettingsOpen(false);
                setChangePasswordOpen(true);
              }}
            >
              <Text style={styles.menuIcon}>🔑</Text>
              <Text style={styles.menuLabel}>Change Password</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setSettingsOpen(false);
                handleLogout();
              }}
            >
              <Text style={styles.menuIcon}>🚪</Text>
              <Text style={[styles.menuLabel, styles.menuLogout]}>Logout</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <ChangePasswordModal visible={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />

      <View style={styles.navWrapOuter}>
        <View style={styles.navWrap}>
          {NAV_ITEMS.map((item) => {
            const active = item.isActive(pathname);
            return (
              <TouchableOpacity
                key={item.key}
                style={[styles.navBtn, active && styles.navBtnActive]}
                onPress={() => handleNavigate(item.href)}
                onLayout={(e) => {
                  if (active && item.children) {
                    const { x, y, width, height } = e.nativeEvent.layout;
                    setPointerX(x + width / 2);
                    setPillBottom(y + height);
                  }
                }}
              >
                <Text style={[styles.navBtnText, active && styles.navBtnTextActive]}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {activeItem?.children && pointerX !== null && pillBottom !== null && (
          <>
            <View style={[styles.navConnector, { left: pointerX - 1, top: pillBottom, height: 13 }]} />
            <View style={[styles.navPointer, { left: pointerX - 8 }]} />
          </>
        )}
      </View>

      {activeItem?.children && (
        <View style={styles.subRow}>
          {activeItem.children.map((child) => {
            const active = pathIs(pathname, child.href);
            return (
              <TouchableOpacity
                key={child.href}
                style={[styles.subBtn, active && styles.subBtnActive]}
                onPress={() => handleNavigate(child.href)}
              >
                <Text style={[styles.subBtnText, active && styles.subBtnTextActive]}>{child.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  // Brand name and Logout get their own full-width row, separate from the
  // nav — when they shared a row, the nav only got whatever sliver of width
  // was left after the brand name, which on a narrow screen could be less
  // than a single pill's width (a wrapped flex item still can't shrink
  // itself below its own content, so it just overflowed the screen edge
  // instead of wrapping cleanly). Giving nav the full row width fixes that.
  brandRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6,
  },
  brandLogo: { width: 28, height: 28, borderRadius: 14, marginRight: 8 },
  brandTextGroup: { flexShrink: 1 },
  brandSmall: { fontSize: 11, fontWeight: '700', color: '#1565C0', letterSpacing: 0.3 },
  brand: { fontSize: 15, fontWeight: '800', color: '#222', flexShrink: 1 },
  navWrapOuter: { position: 'relative' },
  // Bridges the gap between the pill's own bottom edge and the triangle
  // below (navWrap's 8px bottom padding + the pill's own 4px margin, plus
  // the triangle's own 1px offset = 13px) so the pointer reads as touching
  // the pill instead of floating separately under it. Explicit height, not
  // top+bottom stretch -- that didn't render reliably.
  navConnector: { position: 'absolute', width: 2, backgroundColor: '#1565C0' },
  navWrap: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 8,
  },
  // CSS-triangle trick (a zero-size box with only one colored border edge) --
  // points down from the active top-level pill into the sub-nav row below,
  // so it's visually obvious the row belongs to that pill. Positioned via
  // `left` set dynamically to the pill's measured center.
  navPointer: {
    position: 'absolute', bottom: -1, width: 0, height: 0,
    borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 7,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#1565C0',
  },
  navBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, marginRight: 4, marginBottom: 4,
    borderWidth: 1, borderColor: '#90CAF9', backgroundColor: '#BBDEFB',
  },
  navBtnActive: { backgroundColor: '#1565C0', borderColor: '#1565C0' },
  navBtnText: { fontSize: 13, fontWeight: '700', color: '#555' },
  navBtnTextActive: { color: '#fff' },
  gearBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f0f0f0', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  gearIcon: { fontSize: 18 },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'flex-end', paddingTop: 56, paddingRight: 12 },
  menuCard: {
    backgroundColor: '#fff', borderRadius: 12, paddingVertical: 6, minWidth: 200,
    elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  menuIcon: { fontSize: 16, width: 22, textAlign: 'center' },
  menuLabel: { fontSize: 14, fontWeight: '600', color: '#222' },
  menuLogout: { color: '#e53e3e' },
  menuDivider: { height: 1, backgroundColor: '#eee', marginVertical: 2 },

  subRow: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: '#FAFAFA', borderTopWidth: 1, borderTopColor: '#f0f0f0',
  },
  subBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginRight: 8, marginBottom: 6,
    borderWidth: 1, borderColor: '#90CAF9', backgroundColor: '#BBDEFB',
  },
  subBtnActive: { backgroundColor: '#1565C0', borderColor: '#1565C0' },
  subBtnText: { fontSize: 12, fontWeight: '700', color: '#555' },
  subBtnTextActive: { color: '#fff' },
});
