import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator, TextInput, Platform, Switch,
} from 'react-native';
import { useState, useEffect } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import { supabase } from '../../../src/api/supabase';
import { useUserProfile } from '../../../src/hooks/useUserProfile';
import { upsertUserProfile, deleteAccount } from '../../../src/api/functions';
import { DIETARY_RESTRICTIONS, HEALTH_GOALS, CUISINE_OPTIONS } from '../../../src/constants/dietaryOptions';
import { useFaceIdStore } from '../../../src/store/faceIdStore';
import type { UserProfile } from '../../../src/types';

// React Native's Alert isn't implemented on react-native-web, so on web we fall
// back to the browser's native confirm/alert. Returns whether the user confirmed.
function confirmDestructive(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve((globalThis as any).confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

function notify(title: string, message: string) {
  if (Platform.OS === 'web') {
    (globalThis as any).alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

function LabelRow({ items, emptyText }: { items: string[]; emptyText: string }) {
  if (items.length === 0) return <Text style={styles.emptyText}>{emptyText}</Text>;
  return (
    <View style={styles.tagRow}>
      {items.map((item) => (
        <View key={item} style={styles.tag}>
          <Text style={styles.tagText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function ChipRow({
  options,
  selected,
  onToggle,
}: {
  options: Array<{ value: string; label: string; emoji?: string }>;
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((opt) => (
        <TouchableOpacity
          key={opt.value}
          style={[styles.chip, selected.includes(opt.value) && styles.chipSelected]}
          onPress={() => onToggle(opt.value)}
        >
          <Text style={[styles.chipText, selected.includes(opt.value) && styles.chipTextSelected]}>
            {opt.emoji ? `${opt.emoji} ` : ''}{opt.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function ProfileScreen() {
  const { data: profile, isLoading, error, refetch } = useUserProfile();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState<Partial<UserProfile> | null>(null);
  const [allergenInput, setAllergenInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [faceIdAvailable, setFaceIdAvailable] = useState(false);
  const requireFaceId = useFaceIdStore((s) => s.requireFaceId);
  const setRequireFaceId = useFaceIdStore((s) => s.setRequireFaceId);

  useEffect(() => {
    (async () => {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      setFaceIdAvailable(hasHardware && isEnrolled);
    })();
  }, []);

  const startEdit = () => {
    if (profile) {
      setEditForm({
        displayName: profile.displayName,
        dietaryRestrictions: profile.dietaryRestrictions,
        healthGoals: profile.healthGoals,
        allergens: profile.allergens,
        cuisinePreferences: profile.cuisinePreferences,
        nutritionTargets: profile.nutritionTargets,
        searchRadiusMeters: profile.searchRadiusMeters,
      });
      setAllergenInput(profile.allergens.join(', '));
      setIsEditing(true);
    }
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditForm(null);
    setAllergenInput('');
  };

  const handleSave = async () => {
    if (!editForm || !profile) return;
    setIsSaving(true);
    try {
      await upsertUserProfile({
        displayName: editForm.displayName || profile.displayName,
        dietaryRestrictions: editForm.dietaryRestrictions || profile.dietaryRestrictions,
        healthGoals: editForm.healthGoals || profile.healthGoals,
        allergens: editForm.allergens || profile.allergens,
        cuisinePreferences: editForm.cuisinePreferences || profile.cuisinePreferences,
        nutritionTargets: editForm.nutritionTargets || profile.nutritionTargets,
        searchRadiusMeters: editForm.searchRadiusMeters || profile.searchRadiusMeters,
        onboardingComplete: true,
      });
      Alert.alert('Success', 'Profile updated!');
      await refetch();
      setIsEditing(false);
      setEditForm(null);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to save profile');
    } finally {
      setIsSaving(false);
    }
  };

  async function handleSignOut() {
    const ok = await confirmDestructive('Sign out', 'Are you sure?', 'Sign Out');
    if (!ok) return;
    const { error } = await supabase.auth.signOut();
    if (error) notify('Error', error.message);
  }

  async function handleDeleteAccount() {
    const ok = await confirmDestructive(
      'Delete account',
      'This permanently deletes your account and all your data — saved items, chat history, and preferences. This cannot be undone.',
      'Delete',
    );
    if (!ok) return;
    setIsDeleting(true);
    try {
      await deleteAccount();
      // signOut inside deleteAccount triggers the auth-state redirect.
    } catch (err: any) {
      notify('Error', err?.message ?? 'Failed to delete account. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Could not load profile</Text>
        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const form = isEditing ? editForm! : profile;

  const dietLabels = form.dietaryRestrictions
    .filter((v) => v !== 'none')
    .map((v) => DIETARY_RESTRICTIONS.find((d) => d.value === v)?.label ?? v);

  const goalLabels = form.healthGoals
    .map((v) => HEALTH_GOALS.find((g) => g.value === v)?.label ?? v);

  const cuisineLabels = form.cuisinePreferences
    .map((v) => {
      const found = CUISINE_OPTIONS.find((c) => c.value === v);
      return found ? `${found.emoji} ${found.label}` : v;
    });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {form.displayName.charAt(0).toUpperCase()}
          </Text>
        </View>
        {isEditing ? (
          <TextInput
            style={styles.displayNameInput}
            value={form.displayName}
            onChangeText={(text) => setEditForm({ ...form, displayName: text })}
            placeholder="Name"
          />
        ) : (
          <Text style={styles.displayName}>{form.displayName}</Text>
        )}
      </View>

      {/* Dietary Restrictions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Dietary Restrictions</Text>
        {isEditing ? (
          <ChipRow
            options={DIETARY_RESTRICTIONS}
            selected={form.dietaryRestrictions}
            onToggle={(val) => {
              const updated = form.dietaryRestrictions.includes(val)
                ? form.dietaryRestrictions.filter((v) => v !== val)
                : [...form.dietaryRestrictions, val];
              setEditForm({ ...form, dietaryRestrictions: updated });
            }}
          />
        ) : (
          <LabelRow
            items={dietLabels}
            emptyText={form.dietaryRestrictions.includes('none') ? 'No restrictions' : 'None set'}
          />
        )}
      </View>

      {/* Health Goals */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Health Goals</Text>
        {isEditing ? (
          <ChipRow
            options={HEALTH_GOALS}
            selected={form.healthGoals}
            onToggle={(val) => {
              const updated = form.healthGoals.includes(val)
                ? form.healthGoals.filter((v) => v !== val)
                : [...form.healthGoals, val];
              setEditForm({ ...form, healthGoals: updated });
            }}
          />
        ) : (
          <LabelRow items={goalLabels} emptyText="None set" />
        )}
      </View>

      {/* Allergens */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Allergens</Text>
        {isEditing ? (
          <TextInput
            style={styles.allergenInput}
            value={allergenInput}
            onChangeText={(text) => {
              setAllergenInput(text);
              let parsed: string[] = [];
              if (text.includes(',')) {
                parsed = text.split(',').map((a) => a.trim()).filter((a) => a);
              } else {
                parsed = text.split(/\s+/).filter((a) => a);
              }
              setEditForm({
                ...form,
                allergens: parsed,
              });
            }}
            placeholder="e.g., peanuts, shellfish or peanuts shellfish"
            placeholderTextColor="#aaa"
            multiline
            scrollEnabled
            returnKeyType="done"
          />
        ) : (
          <LabelRow items={form.allergens} emptyText="None reported" />
        )}
      </View>

      {/* Cuisine Preferences */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Cuisine Preferences</Text>
        {isEditing ? (
          <ChipRow
            options={CUISINE_OPTIONS}
            selected={form.cuisinePreferences}
            onToggle={(val) => {
              const updated = form.cuisinePreferences.includes(val)
                ? form.cuisinePreferences.filter((v) => v !== val)
                : [...form.cuisinePreferences, val];
              setEditForm({ ...form, cuisinePreferences: updated });
            }}
          />
        ) : (
          <LabelRow items={cuisineLabels} emptyText="No preferences set" />
        )}
      </View>

      {/* Search Radius */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Search Radius</Text>
        {isEditing ? (
          <View style={styles.inputRow}>
            <TextInput
              style={styles.numberInput}
              value={String(form.searchRadiusMeters / 1000)}
              onChangeText={(text) =>
                setEditForm({
                  ...form,
                  searchRadiusMeters: Math.max(500, parseInt(text) * 1000 || 2000),
                })
              }
              placeholder="km"
              keyboardType="decimal-pad"
            />
            <Text style={styles.inputLabel}>km</Text>
          </View>
        ) : (
          <Text style={styles.targetText}>
            {(form.searchRadiusMeters / 1000).toFixed(1)} km
          </Text>
        )}
      </View>

      {/* Buttons */}
      <View style={styles.buttonGroup}>
        {isEditing ? (
          <>
            <TouchableOpacity
              style={[styles.btn, styles.saveBtn]}
              onPress={handleSave}
              disabled={isSaving}
            >
              <Text style={styles.saveBtnText}>{isSaving ? 'Saving...' : 'Save'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.cancelBtn]} onPress={cancelEdit}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={[styles.btn, styles.editBtn]} onPress={startEdit}>
            <Text style={styles.editBtnText}>Edit Profile</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Security */}
      {faceIdAvailable && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Security</Text>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Require Face ID to open PikMe</Text>
            <Switch
              value={requireFaceId ?? true}
              onValueChange={setRequireFaceId}
              trackColor={{ false: '#ddd', true: '#4CAF50' }}
              thumbColor="#fff"
            />
          </View>
        </View>
      )}

      {/* Sign Out */}
      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>

      {/* Delete Account */}
      <TouchableOpacity
        style={styles.deleteBtn}
        onPress={handleDeleteAccount}
        disabled={isDeleting}
      >
        {isDeleting ? (
          <ActivityIndicator color="#e53e3e" />
        ) : (
          <Text style={styles.deleteText}>Delete Account</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { paddingHorizontal: 24, paddingBottom: 60 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  header: { alignItems: 'center', paddingTop: 40, paddingBottom: 28 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { fontSize: 30, color: '#fff', fontWeight: '700' },
  displayName: { fontSize: 22, fontWeight: '700', color: '#222' },
  displayNameInput: {
    fontSize: 22,
    fontWeight: '700',
    color: '#222',
    borderBottomWidth: 2,
    borderBottomColor: '#4CAF50',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  section: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 18,
    paddingBottom: 10,
    marginBottom: 6,
  },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#888', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    backgroundColor: '#f0faf0',
    borderRadius: 50,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#c3e6cb',
  },
  tagText: { fontSize: 13, color: '#2e7d32', fontWeight: '500' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 50,
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: '#fafafa',
  },
  chipSelected: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  chipText: { fontSize: 13, color: '#666', fontWeight: '500' },
  chipTextSelected: { color: '#fff' },
  allergenInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    minHeight: 60,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  numberInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  inputLabel: { fontSize: 14, color: '#666', fontWeight: '500' },
  emptyText: { fontSize: 14, color: '#bbb', fontStyle: 'italic' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { fontSize: 14, color: '#444', fontWeight: '500', flex: 1, marginRight: 12 },
  targetText: { fontSize: 15, color: '#444', marginBottom: 4 },
  errorText: { fontSize: 15, color: '#999', marginBottom: 24 },
  buttonGroup: { flexDirection: 'column', gap: 10, marginTop: 28, marginBottom: 20 },
  btn: {
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  editBtn: { backgroundColor: '#4CAF50' },
  editBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  saveBtn: { backgroundColor: '#4CAF50' },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cancelBtn: { borderWidth: 1, borderColor: '#999' },
  cancelBtnText: { color: '#666', fontSize: 15, fontWeight: '600' },
  signOutBtn: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#e53e3e',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  signOutText: { color: '#e53e3e', fontSize: 15, fontWeight: '600' },
  deleteBtn: {
    marginTop: 12,
    paddingVertical: 13,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  deleteText: { color: '#e53e3e', fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
});
