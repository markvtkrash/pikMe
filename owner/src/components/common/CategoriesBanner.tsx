import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useRestaurantOwnerStore } from '../../store/restaurantOwnerStore';
import { needsCategories } from '../../utils/categories';

// Dashboard nudge for an owner who has not yet told customers what their place is (and how they get the food). It goes away
// once they have chosen. Nothing is shown to a restaurant that has already chosen.
export function CategoriesBanner() {
  const router = useRouter();
  const restaurant = useRestaurantOwnerStore((s) => s.restaurant);
  if (!needsCategories(restaurant)) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.title}>🏷️ Tell customers about your place</Text>
      <Text style={styles.text}>Say if you are a cafe, bar, bakery or restaurant, and whether you offer takeaway or delivery, so customers find you in the right filters.</Text>
      <TouchableOpacity style={styles.button} onPress={() => router.push('/restaurant/profile' as any)} accessibilityRole="button">
        <Text style={styles.buttonText}>Choose now</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: '#E3F2FD', borderRadius: 12, padding: 14, marginHorizontal: 16, marginBottom: 12, borderWidth: 1, borderColor: '#BBDEFB' },
  title: { fontSize: 14, fontWeight: '800', color: '#0D47A1', marginBottom: 4 },
  text: { fontSize: 13, color: '#0D47A1', lineHeight: 18 },
  button: { alignSelf: 'flex-start', marginTop: 10, backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  buttonText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
