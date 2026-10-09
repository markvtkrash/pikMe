import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { CHAIN_MENU_MESSAGE } from '../../api/chainMenu';

// Full-screen replacement for a menu-editing screen when the restaurant is part
// of a chain: its menu is managed centrally, so there is nothing to edit here.
export function ChainMenuNotice({ title = 'Menu managed centrally' }: { title?: string }) {
  const router = useRouter();
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.icon}>🔒</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{CHAIN_MENU_MESSAGE}</Text>
        <TouchableOpacity style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>← Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Small banner for screens that stay visible (the item list, the dashboard) but
// become read-only for a chain restaurant.
export function ChainMenuBanner() {
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>🔒 {CHAIN_MENU_MESSAGE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 24, maxWidth: 440, width: '100%', alignItems: 'center', elevation: 2, gap: 8 },
  icon: { fontSize: 32 },
  title: { fontSize: 18, fontWeight: '800', color: '#222', textAlign: 'center' },
  message: { fontSize: 14, color: '#555', lineHeight: 20, textAlign: 'center' },
  button: { marginTop: 8, backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  banner: { backgroundColor: '#FFF8E1', borderRadius: 10, padding: 12, marginHorizontal: 16, marginVertical: 8, borderWidth: 1, borderColor: '#FFE082' },
  bannerText: { fontSize: 13, color: '#6D4C00', lineHeight: 18 },
});
