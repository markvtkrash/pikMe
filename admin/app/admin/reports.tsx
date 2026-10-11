import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { AppIcon } from '../../src/components/common/AppIcon';

interface ReportCard {
  key: string;
  icon: string;
  title: string;
  subtitle: string;
  color: string;
  bg: string;
  href: string;
}

// Add a card here for each new report page under admin/reports/.
const REPORTS: ReportCard[] = [
  {
    key: 'restaurants',
    icon: '🍽️',
    title: 'Restaurants',
    subtitle: 'Every claimed restaurant and its claim status',
    color: '#8E24AA',
    bg: '#F3E5F5',
    href: '/admin/restaurants',
  },
  {
    key: 'restaurant-growth',
    icon: '📈',
    title: 'Restaurant Growth',
    subtitle: 'Claims over time, approval speed, and current status mix',
    color: '#1565C0',
    bg: '#E3F2FD',
    href: '/admin/reports/restaurant-growth',
  },
  {
    key: 'coupon-status',
    icon: '🎟️',
    title: 'Coupon Status',
    subtitle: 'Active, inactive, expired, and orphaned right now',
    color: '#E65100',
    bg: '#FFF3E0',
    href: '/admin/reports/coupon-status',
  },
  {
    key: 'redemptions-over-time',
    icon: '📊',
    title: 'Redemptions Over Time',
    subtitle: 'Coupon activations across all restaurants, by week',
    color: '#1565C0',
    bg: '#E3F2FD',
    href: '/admin/reports/redemptions-over-time',
  },
  {
    key: 'top-coupons',
    icon: '🏆',
    title: 'Top Coupons',
    subtitle: 'Ranked by redemption count, across all restaurants',
    color: '#1565C0',
    bg: '#E3F2FD',
    href: '/admin/reports/top-coupons',
  },
  {
    key: 'owner-engagement',
    icon: '👤',
    title: 'Owner Engagement',
    subtitle: 'Active/deactivated owners, plus who still needs a nudge',
    color: '#8E24AA',
    bg: '#F3E5F5',
    href: '/admin/reports/owner-engagement',
  },
  {
    key: 'menu-health',
    icon: '🍽️',
    title: 'Menu Data Health',
    subtitle: 'Verified vs unverified items, and gaps by restaurant',
    color: '#8E24AA',
    bg: '#F3E5F5',
    href: '/admin/reports/menu-health',
  },
  {
    key: 'franchise-matches',
    icon: '🍔',
    title: 'Franchise Matches',
    subtitle: 'Cached restaurants that match the franchise lookup',
    color: '#1565C0',
    bg: '#E3F2FD',
    href: '/admin/reports/franchise-matches',
  },
  {
    key: 'non-franchise',
    icon: '🏠',
    title: 'Non-Franchise Restaurants',
    subtitle: 'Cached restaurants that did not match the franchise lookup',
    color: '#E65100',
    bg: '#FFF3E0',
    href: '/admin/reports/non-franchise',
  },
  {
    key: 'franchise-menu-issues',
    icon: '🍔',
    title: 'Franchise Menu Issues',
    subtitle: 'Franchises whose menu could not be built, and why',
    color: '#1565C0',
    bg: '#E3F2FD',
    href: '/admin/chain-menus?filter=attention',
  },
  {
    key: 'restaurant-menu-issues',
    icon: '🍽️',
    title: 'Independent Restaurant Menu Issues',
    subtitle: 'Restaurants customers opened whose menu could not be built, most-opened first',
    color: '#2E7D32',
    bg: '#E8F5E9',
    href: '/admin/restaurant-menu-issues',
  },
  {
    key: 'support-tickets',
    icon: '🎧',
    title: 'Support Tickets',
    subtitle: 'By status and submitter type, plus resolution time',
    color: '#1565C0',
    bg: '#E3F2FD',
    href: '/admin/reports/support-tickets',
  },
];

export default function AdminReportsScreen() {
  const router = useRouter();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Reports</Text>
      <Text style={styles.subtitle}>Pick a report to see the details</Text>

      <View style={styles.grid}>
        {REPORTS.map((report) => (
          <TouchableOpacity
            key={report.key}
            style={[styles.card, { backgroundColor: report.bg }]}
            onPress={() => router.push(report.href as any)}
          >
            <AppIcon emoji={report.icon} size={30} color={report.color} />
            <Text style={[styles.cardTitle, { color: report.color }]}>{report.title}</Text>
            <Text style={styles.cardSubtitle}>{report.subtitle}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  content: { padding: 16, width: '100%', maxWidth: 900, alignSelf: 'center' },
  title: { fontSize: 22, fontWeight: '800', color: '#222', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#888', marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    width: '48%', minWidth: 160, borderRadius: 14, padding: 16,
    gap: 6, elevation: 1,
  },
  cardIcon: { fontSize: 26 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  cardSubtitle: { fontSize: 12, color: '#666', lineHeight: 17 },
});
