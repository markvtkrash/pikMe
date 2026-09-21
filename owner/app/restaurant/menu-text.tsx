import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { extractMenuFromText } from '../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { confirmAndRetryIfNeeded } from '../../src/utils/menuReplaceConfirm';

export default function MenuTextScreen() {
  const router = useRouter();
  const { owner, restaurant, session } = useRestaurantOwnerStore();
  const [menuText, setMenuText] = useState('');
  const [extracting, setExtracting] = useState(false);

  if (!owner || !restaurant) return null;

  async function handleExtract() {
    if (!restaurant || !session?.access_token) {
      Alert.alert('Error', 'Session not found');
      return;
    }
    if (!menuText.trim()) {
      Alert.alert('Error', 'Paste your menu text first');
      return;
    }
    setExtracting(true);
    try {
      let result = await extractMenuFromText(restaurant.id, restaurant.name, menuText, session.access_token);
      result = await confirmAndRetryIfNeeded(result, () =>
        extractMenuFromText(restaurant.id, restaurant.name, menuText, session.access_token, true, result.items)
      );
      if (result.requiresConfirmation) {
        // Owner cancelled at the confirm prompt — nothing was changed.
        return;
      }
      Alert.alert(
        'Success',
        `Added ${result.itemCount} real menu items read from your text to your menu. Edit or remove any of them from Manual Entry.`
      );
      setMenuText('');
      router.push('/restaurant/menu-items');
    } catch (error: any) {
      console.error('[menu-text] Extract error:', error);
      Alert.alert('Error', error.message || 'Failed to read that menu text');
    } finally {
      setExtracting(false);
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
          <Text style={styles.title}>Add Menu Items From Text</Text>
          <Text style={styles.subtitle}>{restaurant.name}</Text>
        </View>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📋 Paste Your Menu Text</Text>
          <Text style={styles.cardHint}>
            Copy your real menu text from anywhere — a PDF, an email, a document, a site that's hard to
            link — and paste it below. We'll read the real dish names directly from it — we never invent
            items that aren't in the text. This adds to your existing menu without removing anything —
            edit or remove individual items afterward from Manual Entry.
          </Text>

          <TextInput
            style={styles.textArea}
            placeholder={'e.g.\nChicken Tikka Masala - $14.99\nGarlic Naan - $3.99\nMango Lassi - $4.99'}
            placeholderTextColor="#999"
            value={menuText}
            onChangeText={setMenuText}
            multiline
            numberOfLines={12}
            textAlignVertical="top"
            editable={!extracting}
          />

          <TouchableOpacity
            style={[styles.extractBtn, (!menuText.trim() || extracting) && styles.extractBtnDisabled]}
            onPress={handleExtract}
            disabled={!menuText.trim() || extracting}
          >
            {extracting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.extractBtnText}>Extract Menu From Text</Text>
            )}
          </TouchableOpacity>
        </View>
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

  content: { padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, elevation: 1 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 8 },
  cardHint: { fontSize: 13, color: '#888', lineHeight: 18, marginBottom: 14 },

  textArea: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, color: '#222',
    minHeight: 220, marginBottom: 14,
  },

  extractBtn: { backgroundColor: '#4CAF50', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  extractBtnDisabled: { opacity: 0.5 },
  extractBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
