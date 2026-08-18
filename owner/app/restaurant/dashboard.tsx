import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { getRestaurantCoupons } from '../../src/api/restaurantAuth';
import { getMyTickets, markTicketResolutionSeen, SupportTicket } from '../../src/api/supportTickets';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';

interface Coupon {
  id: string;
  coupon_type: string;
  discount_value: number;
  coupon_code: string;
  expiry_date: string;
  usage_limit: number | null;
  times_used: number;
  is_active: boolean;
}

export default function RestaurantDashboardScreen() {
  const router = useRouter();
  const { owner, restaurant, logout } = useRestaurantOwnerStore();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [expiredCount, setExpiredCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [resolvedTickets, setResolvedTickets] = useState<SupportTicket[]>([]);

  useEffect(() => {
    if (!owner) {
      router.replace('/restaurant/auth/login');
      return;
    }
  }, [owner]);

  // Refetch coupons whenever page comes into focus
  useFocusEffect(
    useCallback(() => {
      loadCoupons();
      loadResolvedTickets();
    }, [restaurant])
  );

  async function loadResolvedTickets() {
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

  async function loadCoupons() {
    if (!restaurant) {
      setLoading(false);
      return;
    }

    try {
      console.log('[dashboard] Loading coupons for restaurant:', restaurant.id, 'owner:', restaurant.owner_id);
      const data = await getRestaurantCoupons(restaurant.id);

      // Separate active and expired coupons
      const now = new Date();
      const activeCoupons = data.filter(c =>
        c.is_active && new Date(c.expiry_date) > now
      );
      const expired = data.filter(c =>
        new Date(c.expiry_date) <= now
      );

      setCoupons(activeCoupons);
      setExpiredCount(expired.length);
    } catch (error: any) {
      console.error('[dashboard] Failed to load coupons:', JSON.stringify(error, null, 2));
      console.error('[dashboard] Restaurant object:', JSON.stringify(restaurant, null, 2));
    } finally {
      setLoading(false);
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

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={[styles.statBox, styles.statBoxGreen]}>
          <Text style={styles.statBoxTitle}>Coupons</Text>
          <View style={styles.couponLinksRow}>
            <TouchableOpacity
              style={styles.couponLink}
              onPress={() => router.push('/restaurant/menu')}
            >
              <Text style={styles.statNumber}>{coupons.length}</Text>
              <Text style={styles.couponLinkLabel}>Active</Text>
            </TouchableOpacity>
            <View style={styles.couponLinkDivider} />
            <TouchableOpacity
              style={styles.couponLink}
              onPress={() => router.push('/restaurant/expired')}
            >
              <Text style={[styles.statNumber, { color: '#e53e3e' }]}>{expiredCount}</Text>
              <Text style={[styles.couponLinkLabel, { color: '#e53e3e' }]}>Expired</Text>
            </TouchableOpacity>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.statBox, styles.statBoxSupport]}
          onPress={() => router.push('/restaurant/support')}
        >
          <Text style={styles.statIcon}>💬</Text>
          <Text style={styles.statLabel}>Support</Text>
        </TouchableOpacity>
      </View>

      {/* Menu Items Link */}
      <TouchableOpacity
        style={[styles.headingBlock, styles.headingBlockGreen]}
        onPress={() => router.push('/restaurant/menu')}
      >
        <Text style={styles.headingBlockIcon}>📋</Text>
        <Text style={[styles.headingBlockText, { color: '#2e7d32' }]}>Add Coupons to Menu Items</Text>
        <Text style={[styles.headingBlockArrow, { color: '#2e7d32' }]}>→</Text>
      </TouchableOpacity>

      {/* Show warning if not approved */}
      {restaurant.status !== 'approved' && (
        <View style={styles.warningBox}>
          <Text style={styles.warningIcon}>⏳</Text>
          <Text style={styles.warningText}>Waiting for admin approval to manage coupons</Text>
        </View>
      )}

      {/* Coupon performance table */}
      <View style={styles.couponTableSection}>
        <View style={[styles.headingBlock, styles.headingBlockBlue, styles.headingBlockNoMargin]}>
          <Text style={styles.headingBlockIcon}>📊</Text>
          <Text style={[styles.headingBlockText, { color: '#1565C0' }]}>Coupon Performance</Text>
        </View>
        {coupons.length === 0 ? (
          <View style={styles.emptyList}>
            <Text style={styles.emptyListText}>No active coupons yet</Text>
            <Text style={styles.emptyListSubtext}>Add one from Menu Items</Text>
          </View>
        ) : (
          <View style={styles.table}>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.tableHeaderCell, styles.tableCodeCol]}>Code</Text>
              <Text style={[styles.tableHeaderCell, styles.tableDiscountCol]}>Discount</Text>
              <Text style={[styles.tableHeaderCell, styles.tableUsedCol]}>Used</Text>
              <Text style={[styles.tableHeaderCell, styles.tableExpiresCol]}>Expires</Text>
              <View style={styles.tableChevronCol} />
            </View>
            {coupons.map((coupon, index) => {
              const usageRatio = coupon.usage_limit
                ? Math.min(coupon.times_used / coupon.usage_limit, 1)
                : 0;
              const daysUntilExpiry = Math.ceil(
                (new Date(coupon.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
              );
              const expiringSoon = daysUntilExpiry <= 7;

              return (
                <TouchableOpacity
                  key={coupon.id}
                  style={[styles.tableRow, index % 2 === 1 && styles.tableRowAlt]}
                  onPress={() => router.push(`/restaurant/coupon/${coupon.id}/edit`)}
                >
                  <View style={styles.tableCodeCol}>
                    <View style={styles.codeBadge}>
                      <Text style={styles.codeBadgeText} numberOfLines={1}>{coupon.coupon_code}</Text>
                    </View>
                  </View>

                  <View style={styles.tableDiscountCol}>
                    <View style={styles.discountBadge}>
                      <Text style={styles.discountBadgeText}>
                        {coupon.coupon_type.includes('percent')
                          ? `${coupon.discount_value}%`
                          : `$${coupon.discount_value}`} off
                      </Text>
                    </View>
                  </View>

                  <View style={styles.tableUsedCol}>
                    <Text style={styles.usedText}>
                      {coupon.times_used}/{coupon.usage_limit ?? '∞'}
                    </Text>
                    {coupon.usage_limit ? (
                      <View style={styles.usageBarTrack}>
                        <View style={[styles.usageBarFill, { width: `${usageRatio * 100}%` }]} />
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.tableExpiresCol}>
                    <Text style={[styles.expiresText, expiringSoon && styles.expiresTextSoon]}>
                      {new Date(coupon.expiry_date).toLocaleDateString()}
                    </Text>
                  </View>

                  <View style={styles.tableChevronCol}>
                    <Text style={styles.rowChevron}>›</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
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

  statsRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  statBox: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    minHeight: 92,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
  statBoxGreen: { backgroundColor: '#E8F5E9', borderWidth: 2, borderColor: '#4CAF50' },
  statBoxSupport: { backgroundColor: '#fff', borderWidth: 2, borderColor: '#ddd' },
  statIcon: { fontSize: 24, marginBottom: 4 },
  statNumber: { fontSize: 22, fontWeight: '800', color: '#4CAF50' },
  statBoxTitle: { fontSize: 11, fontWeight: '700', color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  couponLinksRow: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  couponLink: { flex: 1, alignItems: 'center' },
  couponLinkLabel: { fontSize: 11, color: '#4CAF50', fontWeight: '600', marginTop: 2 },
  couponLinkDivider: { width: 1, height: 32, backgroundColor: 'rgba(0,0,0,0.08)' },
  statLabel: { fontSize: 11, color: '#999', marginTop: 4 },

  headingBlock: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 16,
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderLeftWidth: 4,
  },
  headingBlockNoMargin: { marginHorizontal: 0, marginTop: 0, marginBottom: 12 },
  headingBlockGreen: { backgroundColor: '#E8F5E9', borderLeftColor: '#4CAF50' },
  headingBlockBlue: { backgroundColor: '#E3F2FD', borderLeftColor: '#1565C0' },
  headingBlockIcon: { fontSize: 18 },
  headingBlockText: { flex: 1, fontSize: 14, fontWeight: '800' },
  headingBlockArrow: { fontSize: 16, fontWeight: '800' },

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

  emptyList: { alignItems: 'center', paddingVertical: 40 },
  emptyListText: { fontSize: 16, fontWeight: '600', color: '#222' },
  emptyListSubtext: { fontSize: 12, color: '#999', marginTop: 4 },

  emptyBox: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#222' },
  emptyBody: { fontSize: 14, color: '#666', textAlign: 'center' },
  claimBtn: { backgroundColor: '#4CAF50', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, marginTop: 12 },
  claimBtnText: { color: '#fff', fontWeight: '600' },

  couponTableSection: { paddingHorizontal: 16, paddingTop: 8 },
  table: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#eee',
    elevation: 2,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  tableHeaderCell: { fontSize: 10, fontWeight: '800', color: '#999', textTransform: 'uppercase', letterSpacing: 0.5 },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  tableRowAlt: { backgroundColor: '#FAFCFB' },
  tableCodeCol: { flex: 1.3 },
  tableDiscountCol: { flex: 1 },
  tableUsedCol: { flex: 1 },
  tableExpiresCol: { flex: 1.1, textAlign: 'right', alignItems: 'flex-end' },
  tableChevronCol: { width: 16, alignItems: 'flex-end' },

  codeBadge: { backgroundColor: '#E8F5E9', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' },
  codeBadgeText: { fontSize: 12, fontWeight: '800', color: '#2e7d32' },
  discountBadge: { backgroundColor: '#FFF3E0', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' },
  discountBadgeText: { fontSize: 11, fontWeight: '700', color: '#E65100' },
  usedText: { fontSize: 12, color: '#444', fontWeight: '600', marginBottom: 4 },
  usageBarTrack: { height: 4, width: '80%', backgroundColor: '#eee', borderRadius: 2, overflow: 'hidden' },
  usageBarFill: { height: 4, backgroundColor: '#4CAF50', borderRadius: 2 },
  expiresText: { fontSize: 12, color: '#666' },
  expiresTextSoon: { color: '#e53e3e', fontWeight: '700' },
  rowChevron: { fontSize: 20, color: '#ccc', fontWeight: '700' },
});
