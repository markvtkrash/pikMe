import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useRestaurantOwnerStore } from '../../store/restaurantOwnerStore';

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
      pathIs(p, '/restaurant/menu-text'),
    // AI Pull, Edit Menu, Add Photo, and Add Text are all entry points
    // reached FROM the Menu Management page (buttons on that page) — its
    // children, not sibling top-level sections of their own.
    children: [
      { label: 'AI Assisted Menu Pull', href: '/restaurant/menu-items' },
      { label: 'Edit Menu', href: '/restaurant/manual-menu' },
      { label: 'Update Menu Items Using a Photo', href: '/restaurant/menu-photo' },
      { label: 'Update Menu Items From Text', href: '/restaurant/menu-text' },
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
    label: '💬 Support',
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

  const activeItem = NAV_ITEMS.find((item) => item.isActive(pathname));

  function handleLogout() {
    logout();
    router.replace('/restaurant/auth/login');
  }

  return (
    <View style={styles.wrapper}>
      <View style={styles.brandRow}>
        <Text style={styles.brand} numberOfLines={1}>
          {restaurant ? restaurant.name : 'CraveID Owner'}
        </Text>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutBtnText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.navWrapOuter}>
        <View style={styles.navWrap}>
          {NAV_ITEMS.map((item) => {
            const active = item.isActive(pathname);
            return (
              <TouchableOpacity
                key={item.key}
                style={[styles.navBtn, active && styles.navBtnActive]}
                onPress={() => router.push(item.href as any)}
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
                onPress={() => router.push(child.href as any)}
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
  brand: { fontSize: 15, fontWeight: '800', color: '#222', flexShrink: 1 },
  navWrapOuter: { position: 'relative' },
  // Bridges the gap between the pill's own bottom edge and the triangle
  // below (navWrap's 8px bottom padding + the pill's own 4px margin, plus
  // the triangle's own 1px offset = 13px) so the pointer reads as touching
  // the pill instead of floating separately under it. Explicit height, not
  // top+bottom stretch -- that didn't render reliably.
  navConnector: { position: 'absolute', width: 2, backgroundColor: '#4CAF50' },
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
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#4CAF50',
  },
  navBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, marginRight: 4, marginBottom: 4,
    borderWidth: 1, borderColor: '#A5D6A7', backgroundColor: '#C8E6C9',
  },
  navBtnActive: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  navBtnText: { fontSize: 13, fontWeight: '700', color: '#555' },
  navBtnTextActive: { color: '#fff' },
  logoutBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#f0f0f0', flexShrink: 0 },
  logoutBtnText: { fontSize: 13, fontWeight: '700', color: '#e53e3e' },

  subRow: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: '#FAFAFA', borderTopWidth: 1, borderTopColor: '#f0f0f0',
  },
  subBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginRight: 8, marginBottom: 6,
    borderWidth: 1, borderColor: '#A5D6A7', backgroundColor: '#C8E6C9',
  },
  subBtnActive: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  subBtnText: { fontSize: 12, fontWeight: '700', color: '#555' },
  subBtnTextActive: { color: '#fff' },
});
