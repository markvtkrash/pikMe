import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { OnboardingProgress } from '../../src/components/common/OnboardingProgress';
import { useUserProfileStore } from '../../src/store/userProfileStore';
import { upsertUserProfile } from '../../src/api/functions';
import { supabase } from '../../src/api/supabase';
import { LegalDocumentModal } from '../../src/components/common/LegalDocumentModal';

export default function LocationPermissionScreen() {
  const router = useRouter();
  const { draft, setOnboardingComplete, resetDraft } = useUserProfileStore();
  const [loading, setLoading] = useState(false);
  const [understoodDisclaimer, setUnderstoodDisclaimer] = useState(false);
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);

  async function saveProfileAndNavigate() {
    if (!understoodDisclaimer) {
      Alert.alert(
        'Food Disclaimer',
        'You must acknowledge that nutritional information are approximations and allergen/restriction info could have changed.',
      );
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const displayName = draft.displayName || user?.email?.split('@')[0] || 'User';

      await upsertUserProfile({
        displayName,
        dietaryRestrictions: draft.dietaryRestrictions,
        healthGoals: draft.healthGoals,
        allergens: draft.allergens,
        cuisinePreferences: draft.cuisinePreferences,
        nutritionTargets: draft.nutritionTargets,
        searchRadiusMeters: 2000,
        onboardingComplete: true,
      });

      // Record food disclaimer agreement
      try {
        await supabase.rpc('record_user_agreement', {
          p_agreement_type: 'food_disclaimer',
          p_version: '1.0',
        });
        console.log('[PikMe onboarding] Food disclaimer agreement recorded');
      } catch (agreementErr) {
        console.warn('[PikMe onboarding] Failed to record food disclaimer:', agreementErr);
        // Don't fail onboarding if agreement recording fails
      }

      setOnboardingComplete(true);
      resetDraft();
      router.replace('/(main)/(tabs)');
    } catch (err: any) {
      Alert.alert(
        'Setup failed',
        err?.message?.includes('does not exist')
          ? 'Database not set up. Please run the Supabase migrations first.'
          : (err?.message ?? 'Could not save your profile. Please try again.'),
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleEnableLocation() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location not enabled',
          'You can enable location later in your device settings. Continuing without location.',
          [{ text: 'Continue', onPress: saveProfileAndNavigate }],
        );
        return;
      }
    } catch {
      // Location not available on web — proceed anyway
    }
    await saveProfileAndNavigate();
  }

  return (
    <View style={styles.container}>
      <OnboardingProgress step={6} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.icon}>📍</Text>
        <Text style={styles.title}>Find restaurants near you</Text>
        <Text style={styles.description}>
          PikMe uses your location to surface nearby restaurants and personalise
          food recommendations based on what's available around you.
        </Text>
        <Text style={styles.note}>Your location is never stored or shared.</Text>

        {/* Food Disclaimer */}
        <View style={styles.disclaimerBox}>
          <Text style={styles.disclaimerIcon}>⚠️</Text>
          <Text style={styles.disclaimerTitle}>Food Disclaimer</Text>
          <Text style={styles.disclaimerText}>
            Nutritional information are approximations. Allergen and dietary restriction info could have changed.{'\n'}
            {'\n'}
            <Text style={{ fontWeight: '600' }}>Verify important info before consuming.</Text>
          </Text>
          <TouchableOpacity onPress={() => setShowDisclaimerModal(true)} style={styles.readMoreLink}>
            <Text style={styles.readMoreText}>Read full disclaimer →</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.disclaimerCheckRow}
            onPress={() => setUnderstoodDisclaimer(!understoodDisclaimer)}
          >
            <View style={[styles.disclaimerCheckbox, understoodDisclaimer && styles.disclaimerCheckboxChecked]}>
              {understoodDisclaimer && <Text style={styles.disclaimerCheckmark}>✓</Text>}
            </View>
            <Text style={styles.disclaimerCheckText}>I understand</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleEnableLocation}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Enable Location & Finish</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.skipBtn}
          onPress={saveProfileAndNavigate}
          disabled={loading}
        >
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Food Disclaimer Modal */}
      <LegalDocumentModal
        visible={showDisclaimerModal}
        documentType="food_disclaimer"
        onClose={() => setShowDisclaimerModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 60,
  },
  icon: { fontSize: 72, marginBottom: 20 },
  title: { fontSize: 26, fontWeight: '700', color: '#222', textAlign: 'center', marginBottom: 14 },
  description: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    lineHeight: 23,
    marginBottom: 10,
  },
  note: { fontSize: 12, color: '#aaa', marginBottom: 44 },
  button: {
    backgroundColor: '#4CAF50',
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 40,
    alignItems: 'center',
    width: '100%',
    marginBottom: 14,
    minHeight: 52,
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  skipBtn: { paddingVertical: 10 },
  skipText: { fontSize: 14, color: '#aaa' },

  disclaimerBox: {
    backgroundColor: '#FFF3E0',
    borderRadius: 12,
    padding: 16,
    marginBottom: 28,
    borderLeftWidth: 4,
    borderLeftColor: '#FF6B6B',
  },
  disclaimerIcon: { fontSize: 24, marginBottom: 8 },
  disclaimerTitle: { fontSize: 16, fontWeight: '700', color: '#d84315', marginBottom: 8 },
  disclaimerText: { fontSize: 12, color: '#555', lineHeight: 18, marginBottom: 12 },
  disclaimerCheckRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  disclaimerCheckbox: {
    width: 18,
    height: 18,
    borderWidth: 2,
    borderColor: '#FF6B6B',
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disclaimerCheckboxChecked: { backgroundColor: '#FF6B6B', borderColor: '#FF6B6B' },
  disclaimerCheckmark: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  disclaimerCheckText: { fontSize: 12, color: '#555', fontWeight: '500' },

  readMoreLink: { marginTop: 10 },
  readMoreText: { fontSize: 12, color: '#FF6B6B', fontWeight: '600', textDecorationLine: 'underline' },
});
