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
    // AI Pull, Manual Entry, Add Photo, and Add Text are all entry points
    // reached FROM the Menu Management page (buttons on that page) — its
    // children, not sibling top-level sections of their own.
    children: [
      { label: 'AI Assisted Menu Pull', href: '/restaurant/menu-items' },
      { label: 'Manual Entry', href: '/restaurant/manual-menu' },
      { label: 'Add Menu Items Using a Photo', href: '/restaurant/menu-photo' },
      { label: 'Add Menu Items From Text', href: '/restaurant/menu-text' },
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
      pathIs(p, '/restaurant/expired') ||
      pathIs(p, '/restaurant/orphaned-coupons') ||
      pathIs(p, '/restaurant/coupon'),
    children: [
      { label: 'Add Coupons', href: '/restaurant/menu' },
      { label: 'Expired', href: '/restaurant/expired' },
      { label: 'Orphaned', href: '/restaurant/orphaned-coupons' },
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

      <View style={styles.navWrap}>
        {NAV_ITEMS.map((item) => {
          const active = item.isActive(pathname);
          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.navBtn, active && styles.navBtnActive]}
              onPress={() => router.push(item.href as any)}
            >
              <Text style={[styles.navBtnText, active && styles.navBtnTextActive]}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
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
  navWrap: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 8,
  },
  navBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, marginRight: 4, marginBottom: 4 },
  navBtnActive: { backgroundColor: '#E8F5E9' },
  navBtnText: { fontSize: 13, fontWeight: '700', color: '#666' },
  navBtnTextActive: { color: '#2e7d32' },
  logoutBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#f0f0f0', flexShrink: 0 },
  logoutBtnText: { fontSize: 13, fontWeight: '700', color: '#e53e3e' },

  subRow: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: '#FAFAFA', borderTopWidth: 1, borderTopColor: '#f0f0f0',
  },
  subBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginRight: 8, marginBottom: 6,
    borderWidth: 1, borderColor: '#ddd',
  },
  subBtnActive: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  subBtnText: { fontSize: 12, fontWeight: '700', color: '#555' },
  subBtnTextActive: { color: '#fff' },
});
