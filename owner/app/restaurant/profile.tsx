import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { supabase } from '../../src/api/supabase';

// Lets an owner set/edit the two URLs the menu-sourcing features key off of:
// the homepage (used as a domain-lock anchor for Upload Menu, and as a
// fallback candidate for Refresh with AI's real-website extraction) and the
// specific menu page (tried first by Refresh with AI, since a menu is often
// not on the homepage). Both are owner-provided, not independently verified
// — see the comment in extract-menu-from-link for what that does and doesn't
// guard against.
export default function RestaurantProfileScreen() {
  const router = useRouter();
  const { owner, restaurant, setRestaurant } = useRestaurantOwnerStore();
  const [website, setWebsite] = useState(restaurant?.website_url || '');
  const [menuPage, setMenuPage] = useState(restaurant?.menu_link || '');
  const [saving, setSaving] = useState(false);

  if (!owner || !restaurant) return null;

  function normalizeUrl(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      return new URL(withProtocol).toString();
    } catch {
      return trimmed; // let the save fail with a clear DB/validation error rather than silently drop it
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const website_url = normalizeUrl(website);
      const menu_link = normalizeUrl(menuPage);

      const { error } = await supabase
        .from('restaurants')
        .update({ website_url, menu_link, updated_at: new Date().toISOString() })
        .eq('id', restaurant!.id);

      if (error) throw error;

      setRestaurant({ ...restaurant!, website_url, menu_link });
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
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🏠 Website</Text>
          <Text style={styles.cardHint}>
            Your restaurant's homepage. Used to confirm a menu link belongs to you, and as a fallback
            source for automatic menu refresh.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="https://yourrestaurant.com"
            placeholderTextColor="#999"
            autoCapitalize="none"
            keyboardType="url"
            value={website}
            onChangeText={setWebsite}
            editable={!saving}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>📋 Menu Page URL</Text>
          <Text style={styles.cardHint}>
            The exact page your menu is on, if it's different from your homepage (e.g. yoursite.com/menu).
            Automatic menu refresh tries this page first, since menus often aren't on the homepage itself.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="https://yourrestaurant.com/menu"
            placeholderTextColor="#999"
            autoCapitalize="none"
            keyboardType="url"
            value={menuPage}
            onChangeText={setMenuPage}
            editable={!saving}
          />
        </View>

        <Text style={styles.trustNote}>
          ℹ️ These aren't independently verified — they're only used to keep your own menu-sourcing
          features pointed at the right pages.
        </Text>

        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.saveBtnText}>Save Profile</Text>
          )}
        </TouchableOpacity>
      </View>
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

  content: { padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, elevation: 1 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 8 },
  cardHint: { fontSize: 13, color: '#888', lineHeight: 18, marginBottom: 14 },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, color: '#222',
  },

  trustNote: { fontSize: 12, color: '#8D6E63', lineHeight: 17, marginBottom: 16 },

  saveBtn: { backgroundColor: '#4CAF50', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
