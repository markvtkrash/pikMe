import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { FavoriteHeart } from '../../src/components/common/FavoriteHeart';
import { useFavoritePages } from '../../src/hooks/useFavoritePages';

interface ReportCard {
  key: string;
  icon: string;
  title: string;
  subtitle: string;
  color: string;
  bg: string;
  href: string;
}

// Add a card here for each new report page under restaurant/reports/.
const REPORTS: ReportCard[] = [
  {
    key: 'coupon-performance',
    icon: '📊',
    title: 'Coupon Performance',
    subtitle: 'Usage and expiry for your active coupons',
    color: '#1565C0',
    bg: '#E3F2FD',
    href: '/restaurant/reports/coupon-performance',
  },
  {
    key: 'redemptions-over-time',
    icon: '📈',
    title: 'Redemptions Over Time',
    subtitle: 'How often customers actually use your coupons, by week',
    color: '#2e7d32',
    bg: '#E8F5E9',
    href: '/restaurant/reports/redemptions-over-time',
  },
  {
    key: 'coupon-status-overview',
    icon: '🎟️',
    title: 'Coupon Status Overview',
    subtitle: 'Active, inactive, expired, and orphaned at a glance',
    color: '#E65100',
    bg: '#FFF3E0',
    href: '/restaurant/reports/coupon-status-overview',
  },
  {
    key: 'menu-verification-status',
    icon: '✅',
    title: 'Menu Verification Status',
    subtitle: 'How much of your menu is reviewed and confirmed',
    color: '#8E24AA',
    bg: '#F3E5F5',
    href: '/restaurant/reports/menu-verification-status',
  },
  {
    key: 'top-coupons',
    icon: '🏆',
    title: 'Top Performing Coupons',
    subtitle: 'Which of your coupons customers actually redeem most',
    color: '#2e7d32',
    bg: '#E8F5E9',
    href: '/restaurant/reports/top-coupons',
  },
];

export default function ReportsScreen() {
  const router = useRouter();
  const { favorites, toggleFavorite } = useFavoritePages();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Reports</Text>
      <Text style={styles.subtitle}>Pick a report to see the details — heart one to pin it to your Dashboard</Text>

      <View style={styles.grid}>
        {REPORTS.map((report) => {
          const favoriteKey = `report-${report.key}`;
          return (
            <TouchableOpacity
              key={report.key}
              style={[styles.card, { backgroundColor: report.bg }]}
              onPress={() => router.push(report.href as any)}
            >
              <View style={styles.cardTopRow}>
                <Text style={styles.cardIcon}>{report.icon}</Text>
                <FavoriteHeart active={favorites.has(favoriteKey)} onPress={() => toggleFavorite(favoriteKey)} />
              </View>
              <Text style={[styles.cardTitle, { color: report.color }]}>{report.title}</Text>
              <Text style={styles.cardSubtitle}>{report.subtitle}</Text>
            </TouchableOpacity>
          );
        })}
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
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardIcon: { fontSize: 26 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  cardSubtitle: { fontSize: 12, color: '#666', lineHeight: 17 },
});
