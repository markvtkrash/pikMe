import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, ScrollView,
  ActivityIndicator, Alert, useWindowDimensions,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { getMyTickets, markTicketResolutionSeen, SupportTicket } from '../../src/api/supportTickets';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { getRestaurantForOwner, setRestaurantPaused } from '../../src/api/restaurantAuth';
import { Alert as ModalAlert, confirmDialog } from '../../src/utils/alert';
import { FavoritesPanel } from '../../src/components/common/FavoritesPanel';
import { sidebarsVisible } from '../../src/components/common/OwnerTipsSidebar';
import { MenuBuildBanner } from '../../src/components/common/MenuBuildBanner';
import { CategoriesBanner } from '../../src/components/common/CategoriesBanner';
import { AppIcon, IconText } from '../../src/components/common/AppIcon';

// The four dashboard shortcuts, in reading order. Same card style as the import cards on Menu Management.
const DASHBOARD_TILES: { icon: string; label: string; blurb: string; href: string; color: string; bg: string }[] = [
  { icon: '🎟️', label: 'Coupon Management', blurb: 'Create and manage your coupons.', href: '/restaurant/coupons', color: '#1565C0', bg: '#E3F2FD' },
  { icon: '📊', label: 'Reports', blurb: 'See how your coupons perform.', href: '/restaurant/reports', color: '#00796B', bg: '#E0F2F1' },
  { icon: '🍽️', label: 'Menu Management', blurb: 'Edit and import your menu.', href: '/restaurant/menu-management', color: '#7B1FA2', bg: '#F3E5F5' },
  { icon: '🏪', label: 'Profile', blurb: 'Your address, website and place type.', href: '/restaurant/profile', color: '#E65100', bg: '#FFF3E0' },
];

export default function RestaurantDashboardScreen() {
  const router = useRouter();
  const { owner, restaurant, logout, restaurantError, setRestaurant, setRestaurantError } = useRestaurantOwnerStore();
  const [retrying, setRetrying] = useState(false);
  const [resolvedTickets, setResolvedTickets] = useState<SupportTicket[]>([]);
  const { width } = useWindowDimensions();

  useEffect(() => {
    if (!owner) {
      router.replace('/restaurant/auth/login');
      return;
    }
  }, [owner]);

  useFocusEffect(
    useCallback(() => {
      loadResolvedTickets();
    }, [restaurant])
  );

  async function loadResolvedTickets() {
    if (!restaurant) return;

    try {
      const tickets = await getMyTickets();
      setResolvedTickets(tickets.filter((t) => t.status === 'resolved' && !t.submitter_seen_resolution));
    } catch (error) {
      console.error('[dashboard] Failed to load resolved tickets:', error);
    }
  }

  async function handleDismissResolution(ticketId: string) {
    setResolvedTickets((prev) => prev.filter((t) => t.id !== ticketId));
    try {
      await markTicketResolutionSeen(ticketId);
    } catch (error) {
      console.error('[dashboard] Failed to mark ticket seen:', error);
    }
  }

  async function handleRetryRestaurant() {
    setRetrying(true);
    try {
      setRestaurantError(null);
      const found = await getRestaurantForOwner();
      setRestaurant(found);
    } catch (err: any) {
      console.error('[dashboard] Retry restaurant lookup failed:', err);
      setRestaurantError(err?.message || 'Could not load your restaurant');
    } finally {
      setRetrying(false);
    }
  }

  const [togglingPause, setTogglingPause] = useState(false);

  // Pauses (hides from customers) or resumes the restaurant, after asking first.
  async function handleTogglePause() {
    if (!restaurant || togglingPause) return;
    const nextPaused = !restaurant.is_paused;
    const ok = await confirmDialog(
      nextPaused ? 'Pause your restaurant?' : 'Resume your restaurant?',
      nextPaused
        ? 'Customers will not see your restaurant until you resume. Use this when you are closed for a few days. Nothing is deleted.'
        : 'Your restaurant will show to customers again right away.',
      { confirmText: nextPaused ? 'Pause' : 'Resume', destructive: nextPaused }
    );
    if (!ok) return;
    setTogglingPause(true);
    try {
      await setRestaurantPaused(restaurant.id, nextPaused);
      setRestaurant({ ...restaurant, is_paused: nextPaused, paused_at: nextPaused ? new Date().toISOString() : null });
    } catch (error: any) {
      ModalAlert.alert('Error', error.message || 'Failed to update');
    } finally {
      setTogglingPause(false);
    }
  }

  function handleLogout() {
    logout();
    router.replace('/restaurant/auth/login');
  }

  if (!owner) return null;

  if (!restaurant && restaurantError) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyBox}>
          <IconText style={styles.emptyIcon} emoji="⚠️" />
          <Text style={styles.emptyTitle}>Couldn't load your restaurant</Text>
          <Text style={styles.emptyBody}>{restaurantError}</Text>
          <TouchableOpacity style={styles.claimBtn} onPress={handleRetryRestaurant} disabled={retrying}>
            {retrying ? <ActivityIndicator color="#fff" /> : <Text style={styles.claimBtnText}>Try again</Text>}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!restaurant) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyBox}>
          <IconText style={styles.emptyIcon} emoji="📍" />
          <Text style={styles.emptyTitle}>No Restaurant Claimed</Text>
          <Text style={styles.emptyBody}>Claim your restaurant to start managing coupons</Text>
          <TouchableOpacity
            style={styles.claimBtn}
            onPress={() => router.push('/restaurant/claim')}
          >
            <Text style={styles.claimBtnText}>Claim Restaurant</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Show status badge if pending approval
  const statusColor = restaurant.status === 'pending' ? '#FFF3E0' :
                      restaurant.status === 'approved' ? '#E3F2FD' : '#FFEBEE';
  const statusTextColor = restaurant.status === 'pending' ? '#E65100' :
                          restaurant.status === 'approved' ? '#1565C0' : '#c62828';
  const statusIcon = restaurant.status === 'pending' ? '⏳' :
                     restaurant.status === 'approved' ? '✓' : '✕';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>Welcome back!</Text>
          <Text style={styles.businessName}>{owner.businessName}</Text>
          <Text style={styles.restaurantName}>{restaurant.name}</Text>
          <Text style={styles.restaurantAddress}>{restaurant.address}</Text>
        {restaurant.status === 'approved' && (
          <TouchableOpacity
            onPress={handleTogglePause}
            disabled={togglingPause}
            style={[styles.pauseBtn, restaurant.is_paused ? styles.resumeBtn : null, togglingPause && { opacity: 0.6 }]}
            accessibilityRole="button"
          >
            {togglingPause ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <IconText style={styles.pauseBtnText} emoji={restaurant.is_paused ? '🔄' : '⏸️'}>
                {restaurant.is_paused ? 'Resume My Restaurant' : 'Pause My Restaurant'}
              </IconText>
            )}
          </TouchableOpacity>
        )}
          {restaurant.status && (
            <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
              <Text style={[styles.statusText, { color: statusTextColor }]}>
                {statusIcon} {restaurant.status === 'pending' ? 'Pending Approval' :
                            restaurant.status === 'approved' ? 'Approved Business' : 'Rejected'}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
            <IconText style={styles.logoutText} emoji="🚪">Logout</IconText>
          </TouchableOpacity>
        </View>
      </View>

      {/* The automatic menu build failed for this restaurant: tell the owner how to add the menu */}
      {restaurant.status === 'approved' && <MenuBuildBanner />}

      {/* Not told customers yet what the place is: a short nudge to the profile page */}
      <CategoriesBanner />

      {/* Resolved ticket notifications */}
      {resolvedTickets.map((ticket) => (
        <View key={ticket.id} style={styles.resolvedBanner}>
          <IconText style={styles.resolvedBannerIcon} emoji="✅" />
          <View style={{ flex: 1 }}>
            <Text style={styles.resolvedBannerTitle}>"{ticket.subject}" has been resolved</Text>
            {ticket.resolution && (
              <Text style={styles.resolvedBannerText}>{ticket.resolution}</Text>
            )}
          </View>
          <TouchableOpacity
            style={styles.resolvedBannerDismiss}
            onPress={() => handleDismissResolution(ticket.id)}
          >
            <Text style={styles.resolvedBannerDismissText}>Got it</Text>
          </TouchableOpacity>
        </View>
      ))}

      {/* Show warning if not approved */}
      {restaurant.status !== 'approved' && (
        <View style={styles.warningBox}>
          <IconText style={styles.warningIcon} emoji="⏳" />
          <Text style={styles.warningText}>Waiting for admin approval to manage coupons</Text>
        </View>
      )}

      {/* Favorites: in the left sidebar on wide screens (see OwnerTipsSidebar), here on the page otherwise */}
      {!sidebarsVisible(width) && (
        <View style={styles.favoritesWrap}>
          <FavoritesPanel variant="inline" />
        </View>
      )}

      {/* The dashboard shortcuts */}
      <View style={styles.dashboardCard}>
        <Text style={styles.dashboardTitle}>Dashboard</Text>
        <View style={styles.quickLinksGrid}>
          {DASHBOARD_TILES.map((tile) => (
            <TouchableOpacity
              key={tile.label}
              style={[styles.quickLink, { backgroundColor: tile.bg, borderColor: tile.color }]}
              onPress={() => router.push(tile.href as any)}
              accessibilityRole="button"
            >
              <View style={styles.quickLinkTop}>
                <View style={[styles.quickLinkBadge, { backgroundColor: tile.color }]}>
                  <AppIcon emoji={tile.icon} size={16} color="#fff" />
                </View>
                <Text style={[styles.quickLinkText, { color: tile.color }]} numberOfLines={2}>{tile.label}</Text>
              </View>
              <Text style={styles.quickLinkBlurb}>{tile.blurb}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  scrollContent: { paddingBottom: 24, width: '100%', maxWidth: 900, alignSelf: 'center' },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    elevation: 2,
  },
  greeting: { fontSize: 13, fontWeight: '700', color: '#1565C0' },
  businessName: { fontSize: 19, fontWeight: '800', color: '#111', marginBottom: 2 },
  restaurantName: { fontSize: 15, fontWeight: '700', color: '#263238', marginBottom: 2 },
  restaurantAddress: { fontSize: 13, fontWeight: '600', color: '#263238', marginBottom: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, alignSelf: 'flex-start' },
  statusText: { fontSize: 12, fontWeight: '700' },
  headerActions: { alignItems: 'flex-end', gap: 8 },
  pauseBtn: { alignSelf: 'flex-start', backgroundColor: '#C62828', borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10, marginBottom: 8, alignItems: 'center', justifyContent: 'center' },
  resumeBtn: { backgroundColor: '#2E7D32' },
  pauseBtnText: { color: '#fff', fontSize: 11.5, fontWeight: '800' },
  logoutBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#37474F' },
  logoutText: { fontSize: 13, color: '#fff', fontWeight: '800' },

  resolvedBanner: {
    backgroundColor: '#E3F2FD', marginHorizontal: 16, marginTop: 12, paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 10, borderLeftWidth: 4, borderLeftColor: '#1565C0', flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  resolvedBannerIcon: { fontSize: 20 },
  resolvedBannerTitle: { fontSize: 13, fontWeight: '700', color: '#1565C0' },
  resolvedBannerText: { fontSize: 12, color: '#1565C0', marginTop: 2 },
  resolvedBannerDismiss: { backgroundColor: '#1565C0', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  resolvedBannerDismissText: { fontSize: 12, fontWeight: '700', color: '#fff' },

  dashboardCard: { backgroundColor: '#fff', marginHorizontal: 16, marginTop: 12, borderRadius: 14, padding: 12, elevation: 1, borderWidth: 1, borderColor: '#CFD8DC' },
  dashboardTitle: { fontSize: 14, fontWeight: '800', color: '#222', marginBottom: 10 },
  favoritesWrap: { marginHorizontal: 16, marginTop: 14 },

  quickLinksGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickLink: { width: '48.8%', minWidth: 240, minHeight: 92, padding: 12, borderRadius: 12, borderWidth: 2, gap: 6 },
  quickLinkTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  quickLinkBadge: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  quickLinkText: { flex: 1, fontSize: 14, fontWeight: '800' },
  quickLinkBlurb: { fontSize: 12, color: '#37474F', lineHeight: 16 },

  warningBox: { backgroundColor: '#FFF3E0', marginHorizontal: 16, marginTop: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderLeftWidth: 4, borderLeftColor: '#E65100', flexDirection: 'row', alignItems: 'center', gap: 10 },
  warningIcon: { fontSize: 20 },
  warningText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#E65100' },

  section: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#222' },
  buttonGroup: { flexDirection: 'row', gap: 8 },
  addBtn: { backgroundColor: '#1565C0', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  addBtnDisabled: { opacity: 0.5 },
  addBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  emptyBox: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#222' },
  emptyBody: { fontSize: 14, color: '#666', textAlign: 'center' },
  claimBtn: { backgroundColor: '#1565C0', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, marginTop: 12 },
  claimBtnText: { color: '#fff', fontWeight: '600' },

});
