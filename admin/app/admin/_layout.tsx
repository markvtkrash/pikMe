import { Stack } from 'expo-router';
import { AdminHeaderLeft, AdminHeaderRight } from '../../src/components/common/AdminNavHeader';

// Every admin screen gets the same header: logo + Dashboard button on the
// left, and a menu to jump to any page (plus Logout) on the right — see
// AdminNavHeader. Screens below only need a title; login and the dashboard
// itself hide the header.
//
// Don't enforce an admin check here - let individual screens handle auth.
// Login doesn't require auth, but dashboard/claims do.
export default function AdminLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: '#1565C0' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '800', fontSize: 18 },
        headerLeft: () => <AdminHeaderLeft />,
        headerRight: () => <AdminHeaderRight />,
      }}
    >
      <Stack.Screen name="login" options={{ title: 'Admin Login', headerShown: false }} />
      <Stack.Screen name="index" options={{ title: 'Admin Dashboard', headerShown: false }} />
      <Stack.Screen name="claims" options={{ title: 'Pending Claims' }} />
      <Stack.Screen name="relocations" options={{ title: '📍 Relocations' }} />
      <Stack.Screen name="restaurants" options={{ title: '🍽️ Restaurants' }} />
      <Stack.Screen name="menu-management" options={{ title: '🧾 Menu Management' }} />
      <Stack.Screen name="menu-management/[id]" options={{ title: 'Menu Items' }} />
      <Stack.Screen name="menu-view" options={{ title: '👁 View Menu' }} />
      <Stack.Screen name="menu-edit" options={{ title: '📝 Manual Edit' }} />
      <Stack.Screen name="coupons" options={{ title: '🎟️ Coupon Management' }} />
      <Stack.Screen name="owners" options={{ title: '🏪 Manage Restaurants' }} />
      <Stack.Screen name="users" options={{ title: '👥 All Users' }} />
      <Stack.Screen name="create-owner" options={{ title: '➕ Create Owner' }} />
      <Stack.Screen name="reports" options={{ title: '📊 Reports' }} />
      <Stack.Screen name="reports/restaurant-growth" options={{ title: '📈 Restaurant Growth' }} />
      <Stack.Screen name="reports/coupon-status" options={{ title: '🎟️ Coupon Status' }} />
      <Stack.Screen name="reports/redemptions-over-time" options={{ title: '📊 Redemptions' }} />
      <Stack.Screen name="reports/top-coupons" options={{ title: '🏆 Top Coupons' }} />
      <Stack.Screen name="reports/owner-engagement" options={{ title: '👤 Owner Engagement' }} />
      <Stack.Screen name="reports/menu-health" options={{ title: '🍽️ Menu Data Health' }} />
      <Stack.Screen name="reports/franchise-matches" options={{ title: '🍔 Franchise Matches' }} />
      <Stack.Screen name="reports/non-franchise" options={{ title: '🏠 Non-Franchise' }} />
      <Stack.Screen name="reports/support-tickets" options={{ title: '🎧 Support Reports' }} />
      <Stack.Screen name="franchises" options={{ title: '🍔 Franchise Lookup' }} />
      <Stack.Screen name="chain-menus" options={{ title: '🔗 Franchise Menu Management' }} />
      <Stack.Screen name="restaurant-menu-issues" options={{ title: '🍽️ Restaurant Menu Issues' }} />
      <Stack.Screen name="tools" options={{ title: '🧰 Tools' }} />
      <Stack.Screen name="scheduled-builds" options={{ title: '⏱️ Scheduled Builds' }} />
      <Stack.Screen name="config" options={{ title: '⚙️ App Config' }} />
      <Stack.Screen name="tickets" options={{ title: '🎫 Support Tickets' }} />
      <Stack.Screen name="tickets/[id]" options={{ title: 'Ticket Details' }} />
    </Stack>
  );
}
