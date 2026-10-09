import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { useIsChainRestaurant } from '../../src/hooks/useIsChainRestaurant';
import { MenuUrlSection } from '../../src/components/common/MenuUrlSection';
import { ONLINE_LINK_TITLE } from '../../src/utils/menuImportText';

// "Import Menu from Online Link" on its own page, so it has an entry in the top menu like the other imports (Edit Menu,
// Import Menu from Photo, Import Menu from Text). It is the same section that sits on the Menu Management page: the same
// field, the same Import Menu button, the same (i) explanation.
export default function MenuOnlineLinkScreen() {
  const router = useRouter();
  const { owner, restaurant } = useRestaurantOwnerStore();
  const { data: isChain } = useIsChainRestaurant(restaurant?.name);

  if (!owner || !restaurant) return null;

  return (
    <View style={styles.container}>
    <View style={styles.pageWrapper}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{ONLINE_LINK_TITLE}</Text>
          <Text style={styles.subtitle}>{restaurant.name}</Text>
        </View>
      </View>

      <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
        <MenuUrlSection isChain={isChain === true} />
      </ScrollView>
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  header: { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, elevation: 2, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  backBtn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#f0f0f0' },
  backBtnText: { fontSize: 13, fontWeight: '600', color: '#e53e3e' },
  title: { fontSize: 24, fontWeight: '800', color: '#222', marginBottom: 2 },
  subtitle: { fontSize: 14, color: '#666' },
  content: { paddingHorizontal: 16, paddingBottom: 24 },
});
