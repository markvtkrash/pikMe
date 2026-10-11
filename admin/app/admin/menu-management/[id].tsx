import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image, ActivityIndicator,
  ScrollView, TextInput,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../../../src/api/supabase';
import { extractMenuFromImage, extractMenuFromText } from '../../../src/api/restaurantAuth';
import { confirmAndRetryIfNeeded } from '../../../src/utils/menuReplaceConfirm';
import PlaceMenuLinkBox from '../../../src/components/common/PlaceMenuLinkBox';
import { IconText } from '../../../src/components/common/AppIcon';

interface RestaurantInfo {
  // A claimed restaurant has an id; one no owner has claimed is named by its Google place ID instead.
  id?: string;
  placeId?: string;
  // a claimed restaurant's own place ID (the link box works by place ID)
  googlePlaceId?: string;
  name: string;
  address: string;
}

// Resized/compressed client-side before it ever leaves the device — same
// cap as owner app's menu-photo.tsx.
const MAX_DIMENSION = 1600;

// Admin equivalent of the owner app's Update Menu Items Using a Photo / From
// Text pages, combined into one screen since an admin is doing this
// occasionally for a specific restaurant rather than living on this page —
// both extract-menu-from-* edge functions accept an admin caller (checked
// via user_roles) as well as the restaurant's own owner.
export default function AdminMenuManagementRestaurantScreen() {
  const router = useRouter();
  // /admin/menu-management/<restaurant id> for a claimed restaurant, or
  // /admin/menu-management/by-place?placeId=<Google place ID> for one nobody has claimed (saved by its place ID).
  const { id, placeId } = useLocalSearchParams<{ id: string; placeId?: string }>();
  const [restaurant, setRestaurant] = useState<RestaurantInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [extractingPhoto, setExtractingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoSuccess, setPhotoSuccess] = useState<string | null>(null);

  const [menuText, setMenuText] = useState('');
  const [extractingText, setExtractingText] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [textSuccess, setTextSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadRestaurant();
  }, [id, placeId]);

  async function loadRestaurant() {
    if (!id && !placeId) return;
    try {
      if (placeId) {
        // The Google cache, else the customer's click record or the saved menu items (migration 131), so a place that is not in
        // the cache can still be managed.
        const { data: info, error } = await supabase.rpc('admin_get_place_info', { p_place_id: placeId });
        if (error) throw error;
        const data = Array.isArray(info) ? info[0] : info;
        if (data) {
          setRestaurant({ placeId: data.place_id, name: data.name, address: data.address ?? '' });
          return;
        }
        // Not in the Google cache: it may be a claimed restaurant (an owner's menu link recorded under its place ID),
        // which is managed by its own id.
        const { data: claimed, error: claimedError } = await supabase
          .from('restaurants')
          .select('id')
          .eq('google_place_id', placeId)
          .limit(1)
          .maybeSingle();
        if (claimedError) throw claimedError;
        if (claimed?.id) {
          router.replace({ pathname: '/admin/menu-management/[id]', params: { id: claimed.id } } as any);
          return;
        }
        console.warn('[admin-menu-management] No restaurant found for place', placeId);
        return;
      }
      const { data, error } = await supabase
        .from('restaurants')
        .select('id, name, address, google_place_id')
        .eq('id', id)
        .single();
      if (error) throw error;
      setRestaurant({ id: data.id, name: data.name, address: data.address ?? '', googlePlaceId: data.google_place_id ?? undefined });
    } catch (error) {
      console.error('[admin-menu-management] Failed to load restaurant:', error);
    } finally {
      setLoading(false);
    }
  }

  async function getAccessToken(): Promise<string> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Admin session expired. Please log in again.');
    return token;
  }

  async function pickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPhotoError('Please allow photo library access to upload a menu photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]) return;

    setPhotoError(null);
    setPhotoSuccess(null);
    setProcessingPhoto(true);
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
      console.error('[admin-menu-management] Image processing error:', error);
      setPhotoError(error.message || 'Failed to process that image');
    } finally {
      setProcessingPhoto(false);
    }
  }

  async function handleExtractPhoto() {
    if (!restaurant || !imageDataUrl) return;
    setPhotoError(null);
    setPhotoSuccess(null);
    setExtractingPhoto(true);
    try {
      const token = await getAccessToken();
      const target = restaurant.id ?? { placeId: restaurant.placeId as string };
      let result = await extractMenuFromImage(target, restaurant.name, imageDataUrl, token);
      result = await confirmAndRetryIfNeeded(result, () =>
        extractMenuFromImage(target, restaurant.name, imageDataUrl, token, true, result.items)
      );
      if (result.requiresConfirmation) return; // admin cancelled at the confirm prompt

      setPhotoSuccess(`Added ${result.itemCount} real menu items read from the photo.`);
      setPreviewUri(null);
      setImageDataUrl(null);
    } catch (error: any) {
      console.error('[admin-menu-management] Photo extract error:', error);
      setPhotoError(error.message || 'Failed to read that menu photo');
    } finally {
      setExtractingPhoto(false);
    }
  }

  async function handleExtractText() {
    if (!restaurant || !menuText.trim()) return;
    setTextError(null);
    setTextSuccess(null);
    setExtractingText(true);
    try {
      const token = await getAccessToken();
      const target = restaurant.id ?? { placeId: restaurant.placeId as string };
      let result = await extractMenuFromText(target, restaurant.name, menuText, token);
      result = await confirmAndRetryIfNeeded(result, () =>
        extractMenuFromText(target, restaurant.name, menuText, token, true, result.items)
      );
      if (result.requiresConfirmation) return; // admin cancelled at the confirm prompt

      setTextSuccess(`Added ${result.itemCount} real menu items read from the text.`);
      setMenuText('');
    } catch (error: any) {
      console.error('[admin-menu-management] Text extract error:', error);
      setTextError(error.message || 'Failed to read that menu text');
    } finally {
      setExtractingText(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  if (!restaurant) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyText}>Restaurant not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
    <View style={styles.pageWrapper}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Update Menu</Text>
          <Text style={styles.subtitle}>{restaurant.name}</Text>
        </View>
      </View>

      <ScrollView style={styles.content}>
        {/* Menu link (by the restaurant's place ID, for claimed and unclaimed restaurants alike) */}
        {!!(restaurant.placeId || restaurant.googlePlaceId) && (
          <PlaceMenuLinkBox placeId={(restaurant.placeId || restaurant.googlePlaceId) as string} />
        )}

        {/* Photo */}
        <View style={styles.card}>
          <IconText style={styles.cardTitle} emoji="📷">Update Menu Items Using a Photo</IconText>
          <Text style={styles.cardHint}>
            Upload a clear photo of the restaurant's printed menu. This reads the real dish names
            directly from it — it never invents items that aren't in the photo. Adds to the existing
            menu without removing anything.
          </Text>

          {previewUri && (
            <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="contain" />
          )}

          {photoError && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{photoError}</Text>
            </View>
          )}
          {photoSuccess && (
            <View style={styles.successBanner}>
              <Text style={styles.successBannerText}>{photoSuccess}</Text>
            </View>
          )}

          <TouchableOpacity style={styles.pickBtn} onPress={pickPhoto} disabled={processingPhoto || extractingPhoto}>
            {processingPhoto ? (
              <ActivityIndicator color="#8E24AA" size="small" />
            ) : (
              <Text style={styles.pickBtnText}>
                {previewUri ? 'Choose a different photo' : '+ Choose a photo'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.extractBtn, (!imageDataUrl || extractingPhoto) && styles.extractBtnDisabled]}
            onPress={handleExtractPhoto}
            disabled={!imageDataUrl || extractingPhoto}
          >
            {extractingPhoto ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.extractBtnText}>Extract Menu From Photo</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Text */}
        <View style={styles.card}>
          <IconText style={styles.cardTitle} emoji="📋">Update Menu Items From Text</IconText>
          <Text style={styles.cardHint}>
            Paste the restaurant's real menu text from anywhere — a PDF, an email, a document, a site
            that's hard to link. This reads the real dish names directly from it — it never invents
            items that aren't in the text. Adds to the existing menu without removing anything.
          </Text>

          {textError && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{textError}</Text>
            </View>
          )}
          {textSuccess && (
            <View style={styles.successBanner}>
              <Text style={styles.successBannerText}>{textSuccess}</Text>
            </View>
          )}

          <TextInput
            style={styles.textArea}
            placeholder={'e.g.\nChicken Tikka Masala - $14.99\nGarlic Naan - $3.99\nMango Lassi - $4.99'}
            placeholderTextColor="#999"
            value={menuText}
            onChangeText={setMenuText}
            multiline
            numberOfLines={12}
            textAlignVertical="top"
            editable={!extractingText}
          />

          <TouchableOpacity
            style={[styles.extractBtn, (!menuText.trim() || extractingText) && styles.extractBtnDisabled]}
            onPress={handleExtractText}
            disabled={!menuText.trim() || extractingText}
          >
            {extractingText ? (
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
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f6f6f6' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  header: { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, elevation: 2, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  backBtn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#f0f0f0' },
  backBtnText: { fontSize: 13, fontWeight: '600', color: '#e53e3e' },
  title: { fontSize: 24, fontWeight: '800', color: '#222', marginBottom: 2 },
  subtitle: { fontSize: 14, color: '#666' },

  content: { padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, elevation: 1, marginBottom: 16, borderWidth: 1, borderColor: '#CFD8DC' },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 8 },
  cardHint: { fontSize: 13, color: '#888', lineHeight: 18, marginBottom: 14 },

  preview: { width: '100%', height: 280, borderRadius: 10, backgroundColor: '#f0f0f0', marginBottom: 14 },

  pickBtn: {
    borderWidth: 1.5, borderColor: '#8E24AA', borderRadius: 10, paddingVertical: 12,
    alignItems: 'center', marginBottom: 10, backgroundColor: '#F3E5F5',
  },
  pickBtnText: { color: '#8E24AA', fontSize: 14, fontWeight: '700' },

  textArea: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, color: '#222',
    minHeight: 220, marginBottom: 14,
  },

  extractBtn: { backgroundColor: '#1565C0', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  extractBtnDisabled: { opacity: 0.5 },
  extractBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  errorBanner: {
    backgroundColor: '#FFEBEE', borderRadius: 10, borderLeftWidth: 4, borderLeftColor: '#e53e3e',
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12,
  },
  errorBannerText: { fontSize: 13, fontWeight: '600', color: '#c62828', lineHeight: 18 },
  successBanner: {
    backgroundColor: '#E3F2FD', borderRadius: 10, borderLeftWidth: 4, borderLeftColor: '#1565C0',
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12,
  },
  successBannerText: { fontSize: 13, fontWeight: '600', color: '#1565C0', lineHeight: 18 },

  emptyText: { fontSize: 14, color: '#999' },
});
