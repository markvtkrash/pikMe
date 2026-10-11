import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, } from 'react-native';
import { Alert } from '../../src/utils/alert';
import { useRouter } from 'expo-router';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { CategoryPicker } from '../../src/components/common/CategoryPicker';
import { getGoogleGuess, getRestaurantCategories, getStoredGoogleTypes, saveRestaurantCategories } from '../../src/api/categories';
import {
  CategoryChoice, choiceForEditing, cleanChoice, EMPTY_CHOICE, needsCategories, RestaurantCategory, sameChoice, suggestDineIn,
  validateChoice,
} from '../../src/utils/categories';
import { IconText } from '../../src/components/common/AppIcon';

// What an owner sees about their restaurant: the address (read-only; it follows the restaurant's Google listing, and
// "My Restaurant Moved" changes it) and what kind of place it is (place type, ways to order, cuisine). The page the menu is
// read from is set on the Menu Management page, not here.
export default function RestaurantProfileScreen() {
  const router = useRouter();
  const { owner, restaurant, setRestaurant } = useRestaurantOwnerStore();
  const [saving, setSaving] = useState(false);
  // What the place is, how customers get the food, and what it serves: the saved choice, else Google's guess for what is not set.
  const [categories, setCategories] = useState<RestaurantCategory[]>([]);
  const [choice, setChoice] = useState<CategoryChoice>(EMPTY_CHOICE);
  const [loadedChoice, setLoadedChoice] = useState<CategoryChoice>(EMPTY_CHOICE);
  const [categoriesReady, setCategoriesReady] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  useEffect(() => {
    if (!restaurant) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await getRestaurantCategories();
        const googleTypes = await getStoredGoogleTypes(restaurant.google_place_id);
        const guess = await getGoogleGuess(googleTypes);
        if (cancelled) return;
        let initial = cleanChoice(choiceForEditing(restaurant, guess), list);
        // Only when the owner has not set their ways to order yet: suggest Dine-in for a Restaurant or Bar (they can untick it)
        if (!Array.isArray(restaurant.services)) initial = suggestDineIn(initial, list);
        setCategories(list);
        setChoice(initial);
        setLoadedChoice(initial);
        setCategoriesReady(true);
      } catch (e: any) {
        console.warn('[profile] Could not load the categories:', e?.message);
        if (!cancelled) setCategoriesError('The place choices could not be loaded.');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant?.id]);

  if (!owner || !restaurant) return null;

  async function handleSave() {
    setSaving(true);
    try {
      // Only the place choices are saved here. The menu page is saved from Menu Management, so saving this page never
      // asks for the menu to be read again.
      // The place choices are saved when they changed, or when the owner has not chosen yet (confirming Google's guess counts).
      let saved: { venue_types: string[]; services: string[]; cuisines: string[] } | null = null;
      if (categoriesReady && (needsCategories(restaurant) || !sameChoice(choice, loadedChoice))) {
        const problem = validateChoice(choice);
        if (problem) {
          Alert.alert('One more thing', problem);
          return;
        }
        saved = await saveRestaurantCategories(restaurant!.id, choice);
        setLoadedChoice(choice);
      }

      setRestaurant({ ...restaurant!, ...(saved ?? {}) });
      Alert.alert('Success', 'Restaurant profile updated.');
    } catch (error: any) {
      console.error('[profile] Save error:', error);
      Alert.alert('Error', error.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
    <View style={styles.pageWrapper}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Restaurant Profile</Text>
          <Text style={styles.subtitle}>{restaurant.name}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.addressRow}>
          <IconText style={styles.addressText} emoji="📍">{restaurant.address || 'No address on file'}</IconText>
          <Text style={styles.addressNote}>
            From your Google listing. Moved?{' '}
            <Text style={styles.link} onPress={() => router.push('/restaurant/relocate' as any)}>Tell us</Text>
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeadRow}>
            <View style={{ flex: 1 }}>
              <IconText style={styles.cardTitle} emoji="🏷️">About your place</IconText>
              <Text style={styles.cardHint}>How customers find you in the filters. Pre-filled from Google; change what is not right.</Text>
            </View>
            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={saving}
              accessibilityRole="button"
            >
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Save</Text>}
            </TouchableOpacity>
          </View>
          {categoriesError ? (
            <Text style={styles.cardHint}>{categoriesError}</Text>
          ) : !categoriesReady ? (
            <ActivityIndicator color="#1565C0" size="small" />
          ) : (
            <CategoryPicker categories={categories} value={choice} onChange={setChoice} disabled={saving} />
          )}
        </View>
      </View>
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  header: { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, elevation: 2, flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#f0f0f0' },
  backBtnText: { fontSize: 13, fontWeight: '600', color: '#e53e3e' },
  title: { fontSize: 20, fontWeight: '800', color: '#222' },
  subtitle: { fontSize: 13, color: '#546E7A' },

  content: { padding: 10 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 10, marginBottom: 6, elevation: 1, borderWidth: 1, borderColor: '#CFD8DC' },
  cardHeadRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 6 },
  cardTitle: { fontSize: 14, fontWeight: '800', color: '#222', marginBottom: 2 },
  cardHint: { fontSize: 11.5, color: '#546E7A', lineHeight: 15 },
  input: { paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: '#222', backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#B0BEC5', borderRadius: 8 },

  addressRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6, backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 6, borderWidth: 1, borderColor: '#CFD8DC' },
  addressText: { fontSize: 13.5, fontWeight: '700', color: '#263238' },
  addressNote: { fontSize: 11.5, color: '#546E7A' },
  link: { color: '#1565C0', fontWeight: '700' },

  saveBtn: { backgroundColor: '#1565C0', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 18, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
