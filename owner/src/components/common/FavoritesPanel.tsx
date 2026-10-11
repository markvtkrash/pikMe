import { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useFavoritePages } from '../../hooks/useFavoritePages';
import { FAVORITABLE_PAGES_BY_KEY } from '../../constants/favoritablePages';
import { FavoriteHeart } from './FavoriteHeart';
import { IconText } from './AppIcon';

// The pages the owner pinned with the heart icon. 'side' is a narrow list for the left sidebar on wide screens; 'inline' is the
// card on the dashboard, used when the screen is too narrow for a sidebar. It reloads on every page change, so a heart tapped on
// another page shows up here.
export function FavoritesPanel({ variant }: { variant: 'side' | 'inline' }) {
  const router = useRouter();
  const pathname = usePathname();
  const { favorites, toggleFavorite, reload } = useFavoritePages();

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const pages = Array.from(favorites).map((key) => FAVORITABLE_PAGES_BY_KEY[key]).filter(Boolean);
  const side = variant === 'side';

  return (
    <View style={styles.box}>
      <IconText style={styles.title} emoji="⭐">Favorites</IconText>
      {pages.length > 0 ? (
        <View style={side ? styles.list : styles.grid}>
          {pages.map((page) => (
            <TouchableOpacity
              key={page.key}
              style={side ? styles.row : styles.card}
              onPress={() => router.push(page.href as any)}
              accessibilityRole="button"
            >
              <IconText style={styles.icon} emoji={page.icon} iconColor="#F9A825" />
              <Text style={side ? styles.rowText : styles.cardText} numberOfLines={2}>{page.label}</Text>
              <View style={side ? undefined : styles.corner}>
                <FavoriteHeart active onPress={() => toggleFavorite(page.key)} />
              </View>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>Tap the heart on any page to pin it here.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: 12, borderRadius: 14, backgroundColor: '#FFFBEA', borderWidth: 1.5, borderColor: '#F9E08B', borderStyle: 'dashed' },
  title: { fontSize: 14, fontWeight: '800', color: '#222', marginBottom: 8 },
  empty: { fontSize: 12, color: '#546E7A', fontStyle: 'italic', lineHeight: 17 },
  list: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#F3E29A' },
  rowText: { flex: 1, fontSize: 12, fontWeight: '700', color: '#333' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: {
    flexBasis: '30%', flexGrow: 1, minWidth: 100, alignItems: 'center', gap: 4, paddingVertical: 12, paddingHorizontal: 8,
    borderRadius: 12, backgroundColor: '#FFFDE7', borderWidth: 1.5, borderColor: '#FBC02D', position: 'relative',
  },
  corner: { position: 'absolute', top: 4, right: 4 },
  icon: { fontSize: 20 },
  cardText: { fontSize: 12, fontWeight: '700', color: '#333', textAlign: 'center' },
});
