import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { FavoriteHeart } from '../../src/components/common/FavoriteHeart';
import { useFavoritePages } from '../../src/hooks/useFavoritePages';
import { IconText } from '../../src/components/common/AppIcon';

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
    color: '#00796B',
    bg: '#E0F2F1',
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
    color: '#7B1FA2',
    bg: '#F3E5F5',
    href: '/restaurant/reports/menu-verification-status',
  },
  {
    key: 'top-coupons',
    icon: '🏆',
    title: 'Top Performing Coupons',
    subtitle: 'Which of your coupons customers actually redeem most',
    color: '#C62828',
    bg: '#FFEBEE',
    href: '/restaurant/reports/top-coupons',
  },
];

export default function ReportsScreen() {
  const router = useRouter();
  const { favorites, toggleFavorite } = useFavoritePages();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Reports</Text>
        <FavoriteHeart active={favorites.has('main-reports')} onPress={() => toggleFavorite('main-reports')} size="large" />
      </View>
      <Text style={styles.subtitle}>Pick a report to see the details — heart one to pin it to your Dashboard</Text>

      <View style={styles.grid}>
        {REPORTS.map((report) => {
          const favoriteKey = `report-${report.key}`;
          return (
            <TouchableOpacity
              key={report.key}
              style={[styles.card, { backgroundColor: report.bg, borderColor: report.color }]}
              onPress={() => router.push(report.href as any)}
              accessibilityRole="button"
            >
              <View style={styles.heartCorner}>
                <FavoriteHeart active={favorites.has(favoriteKey)} onPress={() => toggleFavorite(favoriteKey)} />
              </View>
              <View style={styles.cardTop}>
                <View style={[styles.badge, { backgroundColor: report.color }]}>
                  <IconText style={styles.badgeIcon} emoji={report.icon} iconColor="#fff" />
                </View>
                <Text style={[styles.cardTitle, { color: report.color }]} numberOfLines={2}>{report.title}</Text>
              </View>
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  title: { fontSize: 22, fontWeight: '800', color: '#222', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#546E7A', marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { width: '48.8%', minWidth: 240, minHeight: 92, borderRadius: 12, borderWidth: 2, padding: 12, paddingRight: 30, gap: 6, position: 'relative' },
  heartCorner: { position: 'absolute', top: 6, right: 6, zIndex: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  badgeIcon: { fontSize: 16, color: '#fff' },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: '800' },
  cardSubtitle: { fontSize: 12, color: '#37474F', lineHeight: 16 },
});
