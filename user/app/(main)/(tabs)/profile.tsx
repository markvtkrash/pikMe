import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, TextInput, Switch,
} from 'react-native';
import { Alert } from '../../../src/utils/alert';
import { useState, useEffect, useCallback } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { supabase } from '../../../src/api/supabase';
import { useUserProfile } from '../../../src/hooks/useUserProfile';
import { upsertUserProfile, deleteAccount } from '../../../src/api/functions';
import { getMyTickets, markTicketResolutionSeen, SupportTicket } from '../../../src/api/supportTickets';
import { DIETARY_RESTRICTIONS, HEALTH_GOALS, CUISINE_OPTIONS } from '../../../src/constants/dietaryOptions';
import { useFaceIdStore } from '../../../src/store/faceIdStore';
import { useThemeStore } from '../../../src/store/themeStore';
import { BRAND_COLORS, BRAND_NAME } from '../../../src/constants/brandTheme';
import type { UserProfile } from '../../../src/types';
import { useCustomerConfig } from '../../../src/hooks/useCustomerConfig';
import { categoryChoices, choiceLabels } from '../../../src/utils/profilePlaces';
import { toggleFilter } from '../../../src/utils/categories';
import { activeDiets, DIET_PREFERENCE_NOTE } from '../../../src/utils/dietFilter';
import { useThemedStyles } from '../../../src/theme/useTheme';

// Alert (../../../src/utils/alert) renders an actual in-app modal on every
// platform including web, so this no longer needs a native-browser-dialog
// fallback. Returns whether the user confirmed.
function confirmDestructive(title: string, message: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

function notify(title: string, message: string) {
  Alert.alert(title, message);
}

function LabelRow({ items, emptyText }: { items: string[]; emptyText: string }) {
  const styles = useThemedStyles(baseStyles);
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
  const styles = useThemedStyles(baseStyles);
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
  const styles = useThemedStyles(baseStyles);
  const router = useRouter();
  const { data: profile, isLoading, error, refetch } = useUserProfile();
  const [isEditing, setIsEditing] = useState(false);
  // the email of the signed-in account, shown on the Sign Out button so it is clear which account it signs out
  const [accountEmail, setAccountEmail] = useState('');
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setAccountEmail(data.session?.user?.email ?? '');
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState<Partial<UserProfile> | null>(null);
  // the categories (what a place is, how you get the food, what it serves): the same list the Explore filters and the owners use
  const { data: customerConfig } = useCustomerConfig();
  const categories = customerConfig?.categories ?? [];
  const [isDeleting, setIsDeleting] = useState(false);
  const [faceIdAvailable, setFaceIdAvailable] = useState(false);
  const [resolvedTickets, setResolvedTickets] = useState<SupportTicket[]>([]);
  const requireFaceId = useFaceIdStore((s) => s.requireFaceId);
  const setRequireFaceId = useFaceIdStore((s) => s.setRequireFaceId);
  const themePreference = useThemeStore((s) => s.preference);
  const setThemePreference = useThemeStore((s) => s.setPreference);

  useEffect(() => {
    (async () => {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      setFaceIdAvailable(hasHardware && isEnrolled);
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadResolvedTickets();
    }, [])
  );

  async function loadResolvedTickets() {
    try {
      const tickets = await getMyTickets();
      setResolvedTickets(tickets.filter((t) => t.status === 'resolved' && !t.submitter_seen_resolution));
    } catch (err) {
      console.error('[profile] Failed to load resolved tickets:', err);
    }
  }

  async function handleDismissResolution(ticketId: string) {
    setResolvedTickets((prev) => prev.filter((t) => t.id !== ticketId));
    try {
      await markTicketResolutionSeen(ticketId);
    } catch (err) {
      console.error('[profile] Failed to mark ticket seen:', err);
    }
  }

  const startEdit = () => {
    if (profile) {
      setEditForm({
        displayName: profile.displayName,
        dietaryRestrictions: profile.dietaryRestrictions,
        healthGoals: profile.healthGoals,
        allergens: profile.allergens,
        cuisinePreferences: profile.cuisinePreferences,
        venuePreferences: profile.venuePreferences ?? [],
        servicePreferences: profile.servicePreferences ?? [],
        nutritionTargets: profile.nutritionTargets,
      });
      setIsEditing(true);
    }
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditForm(null);
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
        venuePreferences: editForm.venuePreferences || profile.venuePreferences || [],
        servicePreferences: editForm.servicePreferences || profile.servicePreferences || [],
        nutritionTargets: editForm.nutritionTargets || profile.nutritionTargets,
        // Allergens are no longer collected or edited here; whatever is already stored is passed through unchanged.
        // Not editable here (nothing reads it); the stored value is passed through unchanged.
        searchRadiusMeters: profile.searchRadiusMeters,
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
    const ok = await confirmDestructive('Sign out', accountEmail ? `Sign out of ${accountEmail}?` : 'Are you sure?', 'Sign Out');
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
        <ActivityIndicator size="large" color="#1565C0" />
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

  // with the category list, the labels are the admin's; an older server sends no list, and the earlier fixed cuisine list is used then
  const hasCategories = categories.length > 0;
  const cuisineLabels = hasCategories
    ? choiceLabels(form.cuisinePreferences, categories, 'cuisine')
    : form.cuisinePreferences.map((v) => {
        const found = CUISINE_OPTIONS.find((c) => c.value === v);
        return found ? `${found.emoji} ${found.label}` : v;
      });
  const venueLabels = choiceLabels(form.venuePreferences, categories, 'venue');
  const serviceLabels = choiceLabels(form.servicePreferences, categories, 'service');

  // Edit / Save / Cancel are shown at the top AND the bottom of the profile, so nobody has to scroll for them.
  const actionButtons = (top: boolean) => isEditing ? (
    <>
      <TouchableOpacity style={[styles.btn, styles.saveBtn, top && styles.btnTop]} onPress={handleSave} disabled={isSaving}>
        <Text style={styles.saveBtnText}>{isSaving ? 'Saving...' : 'Save'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.btn, styles.cancelBtn, top && styles.btnTop]} onPress={cancelEdit}>
        <Text style={styles.cancelBtnText}>Cancel</Text>
      </TouchableOpacity>
    </>
  ) : (
    <TouchableOpacity style={[styles.btn, styles.editBtn, top && styles.btnTop]} onPress={startEdit}>
      <Text style={styles.editBtnText}>Edit Profile</Text>
    </TouchableOpacity>
  );

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

      <View style={styles.topActions}>{actionButtons(true)}</View>

      {/* Orders for pickup: right at the top, where a person with an order in progress looks first */}
      <View style={styles.section}>
        <TouchableOpacity style={[styles.supportBtn, styles.ordersBtn]} onPress={() => router.push('/order' as any)} accessibilityRole="button">
          {/* Drawn from plain views because an emoji cart can't be recolored */}
          <View style={styles.ordersBtnCart}>
            <View style={styles.cartIcon}>
              <View style={styles.cartHandle} />
              <View style={styles.cartBasket} />
              <View style={[styles.cartWheel, { left: 6 }]} />
              <View style={[styles.cartWheel, { left: 15 }]} />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.supportBtnTitle, styles.ordersBtnTitle]}>My orders</Text>
            <Text style={[styles.supportBtnSubtitle, styles.ordersBtnSubtitle]}>See your pickup orders and where they are</Text>
          </View>
          <Text style={[styles.supportBtnArrow, styles.ordersBtnTitle]}>→</Text>
        </TouchableOpacity>
      </View>

      {/* Resolved ticket notifications */}
      {resolvedTickets.map((ticket) => (
        <View key={ticket.id} style={styles.resolvedBanner}>
          <Text style={styles.resolvedBannerIcon}>✅</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.resolvedBannerTitle}>"{ticket.subject}" has been resolved</Text>
            {ticket.resolution && (
              <Text style={styles.resolvedBannerText}>{ticket.resolution}</Text>
            )}
          </View>
          <TouchableOpacity
            style={styles.resolvedBannerDismiss}
            onPress={() => handleDismissResolution(ticket.id)}
          >
            <Text style={styles.resolvedBannerDismissText}>Got it</Text>
          </TouchableOpacity>
        </View>
      ))}

      {/* Dietary Preferences */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Dietary Preferences</Text>
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
            emptyText={form.dietaryRestrictions.includes('none') ? 'No preferences' : 'None set'}
          />
        )}
        {activeDiets(form.dietaryRestrictions).length > 0 && <Text style={styles.dietNote}>{DIET_PREFERENCE_NOTE}</Text>}
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

      {/* Places I like: the same three groups as the Explore filters, and what owners choose for their restaurant */}
      {hasCategories && (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Kind of Place</Text>
            {isEditing ? (
              <ChipRow
                options={categoryChoices(categories, 'venue')}
                selected={form.venuePreferences ?? []}
                onToggle={(val) => setEditForm({ ...form, venuePreferences: toggleFilter(form.venuePreferences ?? [], val) })}
              />
            ) : (
              <LabelRow items={venueLabels} emptyText="No preferences set" />
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>How I Like to Get Food</Text>
            {isEditing ? (
              <ChipRow
                options={categoryChoices(categories, 'service')}
                selected={form.servicePreferences ?? []}
                onToggle={(val) => setEditForm({ ...form, servicePreferences: toggleFilter(form.servicePreferences ?? [], val) })}
              />
            ) : (
              <LabelRow items={serviceLabels} emptyText="No preferences set" />
            )}
          </View>
        </>
      )}

      {/* Cuisine Preferences */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Cuisine Preferences</Text>
        {isEditing ? (
          <ChipRow
            options={hasCategories ? categoryChoices(categories, 'cuisine') : CUISINE_OPTIONS}
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

      {/* Buttons */}
      <View style={styles.buttonGroup}>{actionButtons(false)}</View>

      {/* Appearance */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Dark mode</Text>
          <Switch
            value={themePreference === 'dark'}
            onValueChange={(v) => setThemePreference(v ? 'dark' : 'light')}
            trackColor={{ false: '#ddd', true: '#1565C0' }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* Security */}
      {faceIdAvailable && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Security</Text>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Require Face ID to open {BRAND_NAME}</Text>
            <Switch
              value={requireFaceId ?? true}
              onValueChange={setRequireFaceId}
              trackColor={{ false: '#ddd', true: '#1565C0' }}
              thumbColor="#fff"
            />
          </View>
        </View>
      )}

      {/* Support */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Support</Text>
        <TouchableOpacity
          style={styles.supportBtn}
          onPress={() => router.push('/(main)/support')}
        >
          <Text style={styles.supportBtnIcon}>🎫</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.supportBtnTitle}>Submit a Support Ticket</Text>
            <Text style={styles.supportBtnSubtitle}>Send us a message or check on an existing one</Text>
          </View>
          <Text style={styles.supportBtnArrow}>→</Text>
        </TouchableOpacity>
      </View>

      {/* Sign Out, with the account it signs out of */}
      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
        {!!accountEmail && <Text style={styles.signOutEmail} numberOfLines={1}>{accountEmail}</Text>}
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

const baseStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { paddingHorizontal: 24, paddingBottom: 60 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  header: { alignItems: 'center', paddingTop: 40, paddingBottom: 28 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1565C0',
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
    borderBottomColor: '#1565C0',
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
  tagText: { fontSize: 13, color: '#1565C0', fontWeight: '500' },
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
    backgroundColor: '#1565C0',
    borderColor: '#1565C0',
  },
  chipText: { fontSize: 13, color: '#666', fontWeight: '500' },
  chipTextSelected: { color: '#fff' },
  emptyText: { fontSize: 14, color: '#bbb', fontStyle: 'italic' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { fontSize: 14, color: '#444', fontWeight: '500', flex: 1, marginRight: 12 },
  errorText: { fontSize: 15, color: '#999', marginBottom: 24 },
  btnTop: { flex: 1, paddingVertical: 10 },
  topActions: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  buttonGroup: { flexDirection: 'column', gap: 10, marginTop: 28, marginBottom: 20 },
  btn: {
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  editBtn: { backgroundColor: '#1565C0' },
  editBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  saveBtn: { backgroundColor: '#E65100' },
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
  // under the diet choices: names are not ingredients, verify with the staff
  dietNote: { fontSize: 13, lineHeight: 18, color: '#7A4A00', backgroundColor: '#FFF3E0', borderRadius: 8, borderWidth: 1, borderColor: '#E65100', paddingHorizontal: 10, paddingVertical: 8, marginTop: 10 },
  signOutText: { color: '#e53e3e', fontSize: 15, fontWeight: '600' },
  signOutEmail: { color: '#7A7A7A', fontSize: 12.5, marginTop: 2, paddingHorizontal: 12 },
  deleteBtn: {
    marginTop: 12,
    paddingVertical: 13,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  deleteText: { color: '#e53e3e', fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },

  resolvedBanner: {
    backgroundColor: BRAND_COLORS.primaryLight, marginBottom: 16, paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 10, borderLeftWidth: 4, borderLeftColor: BRAND_COLORS.primary, flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  resolvedBannerIcon: { fontSize: 20 },
  resolvedBannerTitle: { fontSize: 13, fontWeight: '700', color: BRAND_COLORS.primary },
  resolvedBannerText: { fontSize: 12, color: BRAND_COLORS.primary, marginTop: 2 },
  resolvedBannerDismiss: { backgroundColor: BRAND_COLORS.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  resolvedBannerDismissText: { fontSize: 12, fontWeight: '700', color: '#fff' },

  supportBtn: {
    backgroundColor: '#f9f9f9', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  supportBtnIcon: { fontSize: 22 },
  supportBtnTitle: { fontSize: 14, fontWeight: '700', color: '#1a1a1a' },
  supportBtnSubtitle: { fontSize: 12, color: '#888', marginTop: 2 },
  supportBtnArrow: { fontSize: 18, color: BRAND_COLORS.primary, fontWeight: '600' },

  // My orders: a filled, colored button so it stands apart from the plain rows below it
  ordersBtn: { backgroundColor: '#0D47A1' },
  ordersBtnCart: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  cartIcon: { width: 24, height: 20 },
  cartHandle: { position: 'absolute', left: 0, top: 1, width: 6, height: 3, borderRadius: 1.5, backgroundColor: '#FF6B6B' },
  cartBasket: {
    position: 'absolute', left: 4, top: 3, width: 19, height: 10,
    backgroundColor: '#FF6B6B', borderTopLeftRadius: 2, borderTopRightRadius: 2, borderBottomLeftRadius: 5, borderBottomRightRadius: 5,
  },
  cartWheel: { position: 'absolute', top: 15, width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#FF6B6B' },
  ordersBtnTitle: { color: '#fff' },
  ordersBtnSubtitle: { color: 'rgba(255,255,255,0.85)' },
});
