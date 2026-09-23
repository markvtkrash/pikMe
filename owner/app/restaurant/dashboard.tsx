import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { getMyTickets, markTicketResolutionSeen, SupportTicket } from '../../src/api/supportTickets';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { useFavoritePages } from '../../src/hooks/useFavoritePages';
import { FAVORITABLE_PAGES_BY_KEY } from '../../src/constants/favoritablePages';
import { FavoriteHeart } from '../../src/components/common/FavoriteHeart';

export default function RestaurantDashboardScreen() {
  const router = useRouter();
  const { owner, restaurant, logout } = useRestaurantOwnerStore();
  const [resolvedTickets, setResolvedTickets] = useState<SupportTicket[]>([]);
  const { favorites, toggleFavorite } = useFavoritePages();

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

  function handleLogout() {
    logout();
    router.replace('/restaurant/auth/login');
  }

  if (!owner) return null;

  if (!restaurant) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>📍</Text>
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
                      restaurant.status === 'approved' ? '#E8F5E9' : '#FFEBEE';
  const statusTextColor = restaurant.status === 'pending' ? '#E65100' :
                          restaurant.status === 'approved' ? '#2e7d32' : '#c62828';
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
          {restaurant.status && (
            <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
              <Text style={[styles.statusText, { color: statusTextColor }]}>
                {statusIcon} {restaurant.status === 'pending' ? 'Pending Approval' :
                            restaurant.status === 'approved' ? 'Approved Business' : 'Rejected'}
              </Text>
            </View>
          )}
        </View>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Favorites */}
      <View style={styles.favoritesSection}>
        <Text style={styles.favoritesSectionTitle}>⭐ Favorites</Text>
        {favorites.size > 0 ? (
          <View style={styles.favoritesGrid}>
            {Array.from(favorites)
              .map((key) => FAVORITABLE_PAGES_BY_KEY[key])
              .filter(Boolean)
              .map((page) => (
                <TouchableOpacity
                  key={page.key}
                  style={styles.favoriteCard}
                  onPress={() => router.push(page.href as any)}
                >
                  <View style={styles.favoriteCorner}>
                    <FavoriteHeart active onPress={() => toggleFavorite(page.key)} />
                  </View>
                  <Text style={styles.favoriteCardIcon}>{page.icon}</Text>
                  <Text style={styles.favoriteCardText}>{page.label}</Text>
                </TouchableOpacity>
              ))}
          </View>
        ) : (
          <Text style={styles.favoritesEmptyText}>
            Tap the ❤️ heart icon on any page to pin it here.
          </Text>
        )}
      </View>

      {/* Resolved ticket notifications */}
      {resolvedTickets.map((ticket) => (
        <View key={ticket.id} style={styles.resolvedBanner}>
          <Text style={styles.resolvedBannerIcon}>✅</Text>
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
          <Text style={styles.warningIcon}>⏳</Text>
          <Text style={styles.warningText}>Waiting for admin approval to manage coupons</Text>
        </View>
      )}

      {/* Quick links — compact tiles, several per row */}
      <View style={styles.quickLinksGrid}>
        <TouchableOpacity
          style={[styles.quickLink, styles.quickLinkGreen]}
          onPress={() => router.push('/restaurant/menu')}
        >
          <Text style={styles.quickLinkIcon}>📋</Text>
          <Text style={[styles.quickLinkText, { color: '#2e7d32' }]}>Coupon Management</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.quickLink, styles.quickLinkPurple]}
          onPress={() => router.push('/restaurant/menu-management')}
        >
          <Text style={styles.quickLinkIcon}>🍽️</Text>
          <Text style={[styles.quickLinkText, { color: '#8E24AA' }]}>Menu Management</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.quickLink, styles.quickLinkBlue]}
          onPress={() => router.push('/restaurant/reports')}
        >
          <Text style={styles.quickLinkIcon}>📊</Text>
          <Text style={[styles.quickLinkText, { color: '#1565C0' }]}>Reports</Text>
        </TouchableOpacity>
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
  greeting: { fontSize: 12, color: '#999' },
  businessName: { fontSize: 18, fontWeight: '800', color: '#222', marginBottom: 2 },
  restaurantName: { fontSize: 14, color: '#666', marginBottom: 2 },
  restaurantAddress: { fontSize: 12, color: '#999', fontStyle: 'italic', marginBottom: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, alignSelf: 'flex-start' },
  statusText: { fontSize: 12, fontWeight: '700' },
  logoutBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#f0f0f0' },
  logoutText: { fontSize: 12, color: '#e53e3e', fontWeight: '600' },

  resolvedBanner: {
    backgroundColor: '#E8F5E9', marginHorizontal: 16, marginTop: 12, paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 10, borderLeftWidth: 4, borderLeftColor: '#4CAF50', flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  resolvedBannerIcon: { fontSize: 20 },
  resolvedBannerTitle: { fontSize: 13, fontWeight: '700', color: '#2e7d32' },
  resolvedBannerText: { fontSize: 12, color: '#2e7d32', marginTop: 2 },
  resolvedBannerDismiss: { backgroundColor: '#4CAF50', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  resolvedBannerDismissText: { fontSize: 12, fontWeight: '700', color: '#fff' },

  favoritesSection: { paddingHorizontal: 16, paddingTop: 12 },
  favoritesSectionTitle: { fontSize: 14, fontWeight: '800', color: '#222', marginBottom: 8 },
  favoritesEmptyText: { fontSize: 13, color: '#999', fontStyle: 'italic' },
  favoritesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  favoriteCard: {
    flexBasis: '30%', flexGrow: 1, minWidth: 100,
    alignItems: 'center', gap: 4, paddingVertical: 12, paddingHorizontal: 8,
    borderRadius: 12, backgroundColor: '#FFFDE7', borderWidth: 1.5, borderColor: '#FBC02D',
    position: 'relative',
  },
  favoriteCorner: { position: 'absolute', top: 4, right: 4 },
  favoriteCardIcon: { fontSize: 20 },
  favoriteCardText: { fontSize: 12, fontWeight: '700', color: '#333', textAlign: 'center' },

  quickLinksGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
    paddingHorizontal: 16, marginTop: 16,
  },
  quickLink: {
    flexBasis: '30%', flexGrow: 1, minWidth: 100,
    alignItems: 'center', gap: 6, paddingVertical: 14, paddingHorizontal: 8,
    borderRadius: 12, borderLeftWidth: 4,
  },
  quickLinkGreen: { backgroundColor: '#E8F5E9', borderLeftColor: '#4CAF50' },
  quickLinkBlue: { backgroundColor: '#E3F2FD', borderLeftColor: '#1565C0' },
  quickLinkPurple: { backgroundColor: '#F3E5F5', borderLeftColor: '#8E24AA' },
  quickLinkIcon: { fontSize: 22 },
  quickLinkText: { fontSize: 12.5, fontWeight: '800', textAlign: 'center' },

  warningBox: { backgroundColor: '#FFF3E0', marginHorizontal: 16, marginTop: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderLeftWidth: 4, borderLeftColor: '#E65100', flexDirection: 'row', alignItems: 'center', gap: 10 },
  warningIcon: { fontSize: 20 },
  warningText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#E65100' },

  section: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#222' },
  buttonGroup: { flexDirection: 'row', gap: 8 },
  addBtn: { backgroundColor: '#4CAF50', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  addBtnDisabled: { opacity: 0.5 },
  addBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  emptyBox: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#222' },
  emptyBody: { fontSize: 14, color: '#666', textAlign: 'center' },
  claimBtn: { backgroundColor: '#4CAF50', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, marginTop: 12 },
  claimBtnText: { color: '#fff', fontWeight: '600' },

});
