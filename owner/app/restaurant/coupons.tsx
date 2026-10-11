import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { FavoriteHeart } from '../../src/components/common/FavoriteHeart';
import { useFavoritePages } from '../../src/hooks/useFavoritePages';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { IconText } from '../../src/components/common/AppIcon';

interface ToolCard {
  key: string;
  favoriteKey: string;
  icon: string;
  title: string;
  subtitle: string;
  color: string;
  bg: string;
  href: string;
}

// The owner's Coupons page (top menu -> Coupons, and the Coupon Management card on the dashboard). Add a card here for each new coupon page.
const TOOLS: ToolCard[] = [
  {
    key: 'add',
    favoriteKey: 'coupon-add-coupons',
    icon: '🎟️',
    title: 'Add Coupons',
    subtitle: 'Create a new coupon for your whole menu or for one dish',
    color: '#1565C0',
    bg: '#E3F2FD',
    href: '/restaurant/menu',
  },
  {
    key: 'manage',
    favoriteKey: 'coupon-manage-coupons',
    icon: '📋',
    title: 'Manage Coupons',
    subtitle: 'See, edit, deactivate or delete your coupons, filtered by status',
    color: '#00796B',
    bg: '#E0F2F1',
    href: '/restaurant/coupon-status',
  },
];

export default function OwnerCouponsScreen() {
  const router = useRouter();
  const { favorites, toggleFavorite } = useFavoritePages();
  const restaurant = useRestaurantOwnerStore((s) => s.restaurant);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Coupon Management</Text>
        <FavoriteHeart active={favorites.has('main-coupons')} onPress={() => toggleFavorite('main-coupons')} size="large" />
      </View>
      <Text style={styles.subtitle}>
        Pick what to do{restaurant ? ` for ${restaurant.name}` : ''} — heart one to pin it to your Favorites
      </Text>

      <View style={styles.grid}>
        {TOOLS.map((tool) => (
          <TouchableOpacity
            key={tool.key}
            style={[styles.card, { backgroundColor: tool.bg, borderColor: tool.color }]}
            onPress={() => router.push(tool.href as any)}
            accessibilityRole="button"
          >
            <View style={styles.heartCorner}>
              <FavoriteHeart active={favorites.has(tool.favoriteKey)} onPress={() => toggleFavorite(tool.favoriteKey)} />
            </View>
            <View style={styles.cardTop}>
              <View style={[styles.badge, { backgroundColor: tool.color }]}>
                <IconText style={styles.badgeIcon} emoji={tool.icon} iconColor="#fff" />
              </View>
              <Text style={[styles.cardTitle, { color: tool.color }]} numberOfLines={2}>{tool.title}</Text>
            </View>
            <Text style={styles.cardSubtitle}>{tool.subtitle}</Text>
          </TouchableOpacity>
        ))}
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
