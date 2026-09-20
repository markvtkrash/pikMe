import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { extractMenuFromImage } from '../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { confirmAndRetryIfNeeded } from '../../src/utils/menuReplaceConfirm';

// Resized/compressed client-side before it ever leaves the device — a raw
// phone photo can be several MB, and neither the payload size nor the
// vision-API cost needs full resolution to read menu text legibly.
const MAX_DIMENSION = 1600;

export default function MenuPhotoScreen() {
  const router = useRouter();
  const { owner, restaurant, session } = useRestaurantOwnerStore();
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [extracting, setExtracting] = useState(false);

  if (!owner || !restaurant) return null;

  async function pickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please allow photo library access to upload a menu photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]) return;

    setProcessing(true);
    try {
      const asset = result.assets[0];
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: MAX_DIMENSION } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!manipulated.base64) throw new Error('Could not process that image');
      setPreviewUri(manipulated.uri);
      setImageDataUrl(`data:image/jpeg;base64,${manipulated.base64}`);
    } catch (error: any) {
      console.error('[menu-photo] Image processing error:', error);
      Alert.alert('Error', error.message || 'Failed to process that image');
    } finally {
      setProcessing(false);
    }
  }

  async function handleExtract() {
    if (!restaurant || !session?.access_token || !imageDataUrl) return;
    setExtracting(true);
    try {
      let result = await extractMenuFromImage(restaurant.id, restaurant.name, imageDataUrl, session.access_token);
      result = await confirmAndRetryIfNeeded(result, () =>
        extractMenuFromImage(restaurant.id, restaurant.name, imageDataUrl, session.access_token, true)
      );
      if (result.requiresConfirmation) {
        // Owner cancelled at the confirm prompt — nothing was changed.
        return;
      }
      Alert.alert(
        'Success',
        `Saved ${result.itemCount} real menu items read from your photo — customers will now see these.`
      );
      setPreviewUri(null);
      setImageDataUrl(null);
      router.push('/restaurant/menu-items');
    } catch (error: any) {
      console.error('[menu-photo] Extract error:', error);
      Alert.alert('Error', error.message || 'Failed to read that menu photo');
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
          <Text style={styles.title}>Add Menu Items Using a Photo</Text>
          <Text style={styles.subtitle}>{restaurant.name}</Text>
        </View>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📷 Scan a Menu Photo</Text>
          <Text style={styles.cardHint}>
            Upload a clear photo of your printed menu. We'll read the real dish names directly from it —
            we never invent items that aren't in the photo. Saving replaces what's currently cached.
          </Text>

          {previewUri && (
            <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="contain" />
          )}

          <TouchableOpacity style={styles.pickBtn} onPress={pickPhoto} disabled={processing || extracting}>
            {processing ? (
              <ActivityIndicator color="#8E24AA" size="small" />
            ) : (
              <Text style={styles.pickBtnText}>
                {previewUri ? 'Choose a different photo' : '+ Choose a photo'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.extractBtn, (!imageDataUrl || extracting) && styles.extractBtnDisabled]}
            onPress={handleExtract}
            disabled={!imageDataUrl || extracting}
          >
            {extracting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.extractBtnText}>Extract Menu From Photo</Text>
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

  preview: { width: '100%', height: 280, borderRadius: 10, backgroundColor: '#f0f0f0', marginBottom: 14 },

  pickBtn: {
    borderWidth: 1.5, borderColor: '#8E24AA', borderRadius: 10, paddingVertical: 12,
    alignItems: 'center', marginBottom: 10, backgroundColor: '#F3E5F5',
  },
  pickBtnText: { color: '#8E24AA', fontSize: 14, fontWeight: '700' },

  extractBtn: { backgroundColor: '#4CAF50', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  extractBtnDisabled: { opacity: 0.5 },
  extractBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
