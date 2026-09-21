import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Slot, useSegments, useRouter } from 'expo-router';
import { OwnerNavHeader } from '../../src/components/common/OwnerNavHeader';
import { OwnerTipsSidebar } from '../../src/components/common/OwnerTipsSidebar';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';

// Auth screens (login/signup/change-password) and the pre-claim flow don't
// have a restaurant to navigate around yet, so they render bare — everything
// else under restaurant/* gets the persistent nav header (once approved —
// see below).
const NO_HEADER_SEGMENTS = new Set(['auth', 'claim']);

function PendingApprovalScreen() {
  const router = useRouter();
  const { restaurant, logout } = useRestaurantOwnerStore();
  if (!restaurant) return null;

  const isRejected = restaurant.status === 'rejected';

  async function handleLogout() {
    await logout();
    router.replace('/restaurant/auth/login');
  }

  return (
    <View style={styles.pendingContainer}>
      <View style={styles.pendingCard}>
        <Text style={styles.pendingIcon}>{isRejected ? '✕' : '⏳'}</Text>
        <Text style={styles.pendingRestaurantName}>{restaurant.name}</Text>
        <Text style={styles.pendingAddress}>{restaurant.address}</Text>
        <View style={[styles.pendingBadge, isRejected && styles.pendingBadgeRejected]}>
          <Text style={[styles.pendingBadgeText, isRejected && styles.pendingBadgeTextRejected]}>
            {isRejected ? 'Claim Rejected' : 'Pending Admin Approval'}
          </Text>
        </View>
        <Text style={styles.pendingMessage}>
          {isRejected
            ? 'An admin has reviewed and rejected this claim. If you believe this is a mistake, reach out and we’ll take another look.'
            : 'An admin needs to review and approve your claim before you can manage this restaurant’s menu and coupons. This unlocks automatically once that happens — check back soon.'}
        </Text>
        <TouchableOpacity style={styles.pendingLogoutBtn} onPress={handleLogout}>
          <Text style={styles.pendingLogoutBtnText}>Logout</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function RestaurantLayout() {
  const segments = useSegments() as string[];
  const secondSegment = segments[1];
  const showHeader = !secondSegment || !NO_HEADER_SEGMENTS.has(secondSegment);
  const { restaurant } = useRestaurantOwnerStore();

  if (!showHeader) {
    return <Slot />;
  }

  // Claimed but not yet approved — show nothing but the bare status screen,
  // regardless of which restaurant/* URL was requested. Same minimal
  // surface an owner sees before/during claiming, not the full app.
  if (restaurant && restaurant.status !== 'approved') {
    return <PendingApprovalScreen />;
  }

  return (
    <View style={styles.container}>
      <OwnerNavHeader />
      <View style={styles.content}>
        <OwnerTipsSidebar />
        <Slot />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  // position:'relative' so OwnerTipsSidebar's absolute-positioned panels
  // anchor to THIS box (which already sits below the header, whatever its
  // current height is) instead of needing to know the header's exact pixel
  // height to avoid overlapping it.
  content: { flex: 1, position: 'relative' },

  pendingContainer: { flex: 1, backgroundColor: '#f6f6f6', justifyContent: 'center', alignItems: 'center', padding: 24 },
  pendingCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 440,
    alignItems: 'center', elevation: 2,
  },
  pendingIcon: { fontSize: 48, marginBottom: 12 },
  pendingRestaurantName: { fontSize: 20, fontWeight: '800', color: '#222', textAlign: 'center', marginBottom: 4 },
  pendingAddress: { fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 16 },
  pendingBadge: { backgroundColor: '#FFF3E0', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, marginBottom: 16 },
  pendingBadgeRejected: { backgroundColor: '#FFEBEE' },
  pendingBadgeText: { fontSize: 13, fontWeight: '800', color: '#E65100' },
  pendingBadgeTextRejected: { color: '#c62828' },
  pendingMessage: { fontSize: 14, color: '#555', textAlign: 'center', lineHeight: 21, marginBottom: 24 },
  pendingLogoutBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, backgroundColor: '#f0f0f0' },
  pendingLogoutBtnText: { fontSize: 13, fontWeight: '700', color: '#e53e3e' },
});
