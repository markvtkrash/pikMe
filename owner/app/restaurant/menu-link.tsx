import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { updateRestaurantMenuLink } from '../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { confirmAndRetryIfNeeded } from '../../src/utils/menuReplaceConfirm';

export default function MenuLinkScreen() {
  const router = useRouter();
  const { owner, restaurant, session } = useRestaurantOwnerStore();
  const [menuLinkInput, setMenuLinkInput] = useState(restaurant?.menu_link || '');
  const [saving, setSaving] = useState(false);
  const [lastSavedCount, setLastSavedCount] = useState<number | null>(null);

  if (!owner || !restaurant) return null;

  let requiredDomain: string | null = null;
  if (restaurant.website_url) {
    try {
      requiredDomain = new URL(restaurant.website_url).hostname.replace(/^www\./, '');
    } catch {
      requiredDomain = null;
    }
  }

  async function handleSave() {
    if (!restaurant || !session?.access_token) {
      Alert.alert('Error', 'Session not found');
      return;
    }
    if (!menuLinkInput.trim()) {
      Alert.alert('Error', 'Please enter a menu URL first');
      return;
    }
    setSaving(true);
    try {
      let result = await updateRestaurantMenuLink(
        restaurant.id,
        restaurant.name,
        menuLinkInput.trim(),
        session.access_token
      );
      result = await confirmAndRetryIfNeeded(result, () =>
        updateRestaurantMenuLink(restaurant.id, restaurant.name, menuLinkInput.trim(), session.access_token, true, result.items)
      );

      if (result.requiresConfirmation) {
        // Owner cancelled at the confirm prompt — nothing was changed.
        return;
      }

      setLastSavedCount(result.itemCount ?? 0);
      Alert.alert(
        'Success',
        `Found ${result.itemCount} real menu items from your link — customers will now see these instead of AI-guessed ones.`
      );
    } catch (error: any) {
      console.error('[menu-link] Extraction error:', error);
      Alert.alert('Error', error.message || 'Failed to extract menu from that link');
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
          <Text style={styles.title}>Upload Menu</Text>
          <Text style={styles.subtitle}>{restaurant.name}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🔗 Menu Link</Text>
          <Text style={styles.cardHint}>
            Add a link to your real online menu (a webpage, not a PDF) so customers see actual dishes
            instead of AI-guessed ones. You can update this any time — saving again replaces what's
            currently cached with a fresh extraction from the link.
          </Text>
          {requiredDomain && (
            <Text style={styles.domainHint}>
              Must be a page on your own website ({requiredDomain}).
            </Text>
          )}
          <TextInput
            style={styles.input}
            placeholder="https://yourrestaurant.com/menu"
            placeholderTextColor="#999"
            autoCapitalize="none"
            keyboardType="url"
            value={menuLinkInput}
            onChangeText={setMenuLinkInput}
            editable={!saving}
          />
          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Save & Fetch Real Menu</Text>
            )}
          </TouchableOpacity>

          {restaurant.menu_link && (
            <Text style={styles.currentLink} numberOfLines={1}>
              Currently linked: {restaurant.menu_link}
            </Text>
          )}
          {lastSavedCount !== null && (
            <Text style={styles.lastSaved}>✓ {lastSavedCount} real items currently showing to customers</Text>
          )}
        </View>

        <TouchableOpacity style={styles.manualLink} onPress={() => router.push('/restaurant/manual-menu')}>
          <Text style={styles.manualLinkText}>No website? Type your menu items instead →</Text>
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
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, elevation: 1 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 8 },
  cardHint: { fontSize: 13, color: '#888', lineHeight: 18, marginBottom: 14 },
  domainHint: { fontSize: 12, color: '#E65100', fontWeight: '600', marginBottom: 12 },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, color: '#222', marginBottom: 12,
  },
  saveBtn: { backgroundColor: '#4CAF50', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  currentLink: { fontSize: 12, color: '#999', marginTop: 12 },
  lastSaved: { fontSize: 13, color: '#2e7d32', fontWeight: '600', marginTop: 10 },
  manualLink: { alignItems: 'center', paddingVertical: 16 },
  manualLinkText: { fontSize: 14, fontWeight: '600', color: '#8E24AA' },
});
