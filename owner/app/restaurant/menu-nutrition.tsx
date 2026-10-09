import { useState, useMemo, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, ScrollView,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Alert } from '../../src/utils/alert';
import {
  updateMenuItemNutrition, matchMenuItemNames, getRestaurantMenuItems, NutritionUpdate,
} from '../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { useIsChainRestaurant } from '../../src/hooks/useIsChainRestaurant';
import { ChainMenuNotice } from '../../src/components/common/ChainMenuNotice';
import { useFavoritePages } from '../../src/hooks/useFavoritePages';
import { FavoriteHeart } from '../../src/components/common/FavoriteHeart';
import { parseNutritionText } from '../../src/utils/parseNutritionText';
import { bestFuzzyMatch } from '../../src/utils/stringSimilarity';

const PLACEHOLDER =
  'e.g.\n' +
  'Chicken Tikka Masala | 620 cal | 38g protein | 45g carbs | 28g fat | 890mg sodium\n' +
  'Garlic Naan | 280 cal | 7g protein';

type RowStatus = 'exact' | 'fuzzy' | 'ai-pending' | 'confirmed' | 'rejected' | 'no-match';

interface Row {
  update: NutritionUpdate; // as typed
  fieldCount: number;
  resolvedName: string | null; // the real existing item name to submit, once known
  status: RowStatus;
}

export default function MenuNutritionScreen() {
  const router = useRouter();
  const { owner, restaurant } = useRestaurantOwnerStore();
  const { data: isChain } = useIsChainRestaurant(restaurant?.name);
  const { favorites, toggleFavorite } = useFavoritePages();
  const [nutritionText, setNutritionText] = useState('');
  const [existingNames, setExistingNames] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [checkingAi, setCheckingAi] = useState(false);
  // AI suggestions and owner decisions, keyed by the ORIGINAL typed name —
  // separate from the parsed rows themselves so they survive re-parsing as
  // the owner keeps typing (editing an unrelated line shouldn't reset an
  // already-confirmed suggestion elsewhere in the same paste).
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, string | null>>({});
  const [decisions, setDecisions] = useState<Record<string, 'confirmed' | 'rejected'>>({});

  useFocusEffect(
    useCallback(() => {
      loadExistingNames();
    }, [restaurant])
  );

  async function loadExistingNames() {
    if (!restaurant) return;
    try {
      const items = await getRestaurantMenuItems(restaurant.name, restaurant.google_place_id);
      setExistingNames(items.map((i: any) => i.name));
    } catch (error) {
      console.error('[menu-nutrition] Failed to load existing items:', error);
    }
  }

  const parsed = useMemo(() => parseNutritionText(nutritionText), [nutritionText]);

  // Resolves each parsed line against existing item names — exact match
  // first, then a high-confidence algorithmic fuzzy match, then whatever an
  // AI suggestion + owner decision has settled for it, else unmatched.
  const rows: Row[] = useMemo(() => {
    return parsed.map((update) => {
      const fieldCount = [update.calories, update.protein_g, update.totalCarbs_g, update.totalFat_g, update.sodium_mg]
        .filter((v) => v !== undefined).length;

      const exact = existingNames.find((n) => n.trim().toLowerCase() === update.name.trim().toLowerCase());
      if (exact) return { update, fieldCount, resolvedName: exact, status: 'exact' as const };

      const fuzzy = bestFuzzyMatch(update.name, existingNames);
      if (fuzzy) return { update, fieldCount, resolvedName: fuzzy, status: 'fuzzy' as const };

      const decision = decisions[update.name];
      const suggestion = aiSuggestions[update.name];
      if (decision === 'confirmed' && suggestion) {
        return { update, fieldCount, resolvedName: suggestion, status: 'confirmed' as const };
      }
      if (decision === 'rejected') {
        return { update, fieldCount, resolvedName: null, status: 'rejected' as const };
      }
      if (suggestion === null) {
        return { update, fieldCount, resolvedName: null, status: 'no-match' as const };
      }
      if (suggestion) {
        return { update, fieldCount, resolvedName: null, status: 'ai-pending' as const };
      }
      return { update, fieldCount, resolvedName: null, status: 'no-match' as const };
    });
  }, [parsed, existingNames, aiSuggestions, decisions]);

  const unmatchedForAi = rows.filter((r) => r.status === 'no-match' && !(r.update.name in aiSuggestions));
  const readyRows = rows.filter((r) => r.resolvedName);

  if (!owner || !restaurant) return null;
  if (isChain) return <ChainMenuNotice />;

  async function handleCheckAi() {
    if (!restaurant || unmatchedForAi.length === 0) return;
    setCheckingAi(true);
    try {
      const matches = await matchMenuItemNames(
        restaurant.id,
        unmatchedForAi.map((r) => r.update.name),
        existingNames
      );
      setAiSuggestions((prev) => {
        const next = { ...prev };
        for (const m of matches) next[m.input] = m.suggestion;
        return next;
      });
    } catch (error: any) {
      console.error('[menu-nutrition] AI match error:', error);
      Alert.alert('Error', error.message || 'Failed to check matches');
    } finally {
      setCheckingAi(false);
    }
  }

  function handleConfirm(name: string) {
    setDecisions((prev) => ({ ...prev, [name]: 'confirmed' }));
  }

  function handleReject(name: string) {
    setDecisions((prev) => ({ ...prev, [name]: 'rejected' }));
  }

  async function handleApply() {
    if (!restaurant || readyRows.length === 0) return;
    setSubmitting(true);
    try {
      const payload: NutritionUpdate[] = readyRows.map((r) => ({ ...r.update, name: r.resolvedName! }));
      const result = await updateMenuItemNutrition(restaurant.id, payload);
      const matchedCount = result.filter((r) => r.matched).length;
      Alert.alert(
        'Success',
        `Updated nutrition for ${matchedCount} of ${result.length} item${result.length === 1 ? '' : 's'}.`
      );
      if (matchedCount > 0) {
        setNutritionText('');
        setAiSuggestions({});
        setDecisions({});
        loadExistingNames();
      }
    } catch (error: any) {
      console.error('[menu-nutrition] Update error:', error);
      Alert.alert('Error', error.message || 'Failed to update nutrition info');
    } finally {
      setSubmitting(false);
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
          <View style={styles.titleRow}>
            <Text style={styles.title}>Add Nutrition Info</Text>
            <FavoriteHeart
              active={favorites.has('menu-nutrition')}
              onPress={() => toggleFavorite('menu-nutrition')}
              size="large"
            />
          </View>
          <Text style={styles.subtitle}>{restaurant.name}</Text>
        </View>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🥗 Real Nutrition Info (Optional)</Text>
          <Text style={styles.cardHint}>
            Know the actual calories or macros for some dishes — from a recipe, supplier spec sheet, or
            printed nutrition guide? Paste them below, one dish per line, matched against your existing
            menu item names. Only the fields you enter are updated — anything you leave out stays as our
            AI's estimate. Dishes matched here stop showing the "AI estimate" note to customers.
          </Text>

          <TextInput
            style={styles.textArea}
            placeholder={PLACEHOLDER}
            placeholderTextColor="#999"
            value={nutritionText}
            onChangeText={setNutritionText}
            multiline
            numberOfLines={10}
            textAlignVertical="top"
            editable={!submitting}
          />

          {rows.length > 0 && (
            <View style={styles.previewBox}>
              <Text style={styles.previewTitle}>
                {readyRows.length} of {rows.length} dish{rows.length === 1 ? '' : 'es'} ready to apply
              </Text>
              {rows.map((r, i) => (
                <View key={i} style={styles.previewRow}>
                  <View style={styles.previewMain}>
                    <Text style={styles.previewName} numberOfLines={1}>{r.update.name}</Text>
                    <Text style={styles.previewMeta}>
                      {r.fieldCount} field{r.fieldCount === 1 ? '' : 's'}
                      {r.status === 'exact' && ' · ✓ matched'}
                      {r.status === 'fuzzy' && ` · ✓ matched to "${r.resolvedName}"`}
                      {r.status === 'confirmed' && ` · ✓ confirmed: "${r.resolvedName}"`}
                      {r.status === 'rejected' && ' · skipped'}
                      {r.status === 'no-match' && ' · ⚠️ no matching item'}
                    </Text>
                  </View>
                  {r.status === 'ai-pending' && (
                    <View style={styles.aiSuggestionBox}>
                      <Text style={styles.aiSuggestionText}>
                        🤔 Did you mean "{aiSuggestions[r.update.name]}"?
                      </Text>
                      <View style={styles.aiSuggestionBtnRow}>
                        <TouchableOpacity
                          style={[styles.aiSuggestionBtn, styles.aiSuggestionBtnReject]}
                          onPress={() => handleReject(r.update.name)}
                        >
                          <Text style={styles.aiSuggestionBtnRejectText}>✕ No</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.aiSuggestionBtn, styles.aiSuggestionBtnConfirm]}
                          onPress={() => handleConfirm(r.update.name)}
                        >
                          <Text style={styles.aiSuggestionBtnConfirmText}>✓ Yes</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              ))}

              {unmatchedForAi.length > 0 && (
                <TouchableOpacity
                  style={[styles.aiCheckBtn, checkingAi && styles.applyBtnDisabled]}
                  onPress={handleCheckAi}
                  disabled={checkingAi}
                >
                  {checkingAi ? (
                    <ActivityIndicator color="#1565C0" size="small" />
                  ) : (
                    <Text style={styles.aiCheckBtnText}>
                      🤖 Try AI Match for {unmatchedForAi.length} Unmatched
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}

          <TouchableOpacity
            style={[styles.applyBtn, (readyRows.length === 0 || submitting) && styles.applyBtnDisabled]}
            onPress={handleApply}
            disabled={readyRows.length === 0 || submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.applyBtnText}>Apply Nutrition Info</Text>
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
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: '#222', marginBottom: 2 },
  subtitle: { fontSize: 14, color: '#666' },

  content: { padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, elevation: 1 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 8 },
  cardHint: { fontSize: 13, color: '#888', lineHeight: 18, marginBottom: 14 },

  textArea: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, color: '#222',
    minHeight: 180, marginBottom: 14,
  },

  previewBox: {
    backgroundColor: '#F6F6F6', borderRadius: 10, padding: 12, marginBottom: 14,
  },
  previewTitle: { fontSize: 12.5, fontWeight: '800', color: '#555', marginBottom: 8 },
  previewRow: { paddingVertical: 4, gap: 6 },
  previewMain: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  previewName: { flex: 1, fontSize: 13, fontWeight: '600', color: '#333' },
  previewMeta: { fontSize: 12, color: '#888' },

  aiSuggestionBox: {
    backgroundColor: '#FFF3E0', borderRadius: 8, borderWidth: 1, borderColor: '#FFB74D',
    padding: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  },
  aiSuggestionText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: '#E65100' },
  aiSuggestionBtnRow: { flexDirection: 'row', gap: 6 },
  aiSuggestionBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  aiSuggestionBtnConfirm: { backgroundColor: '#1565C0' },
  aiSuggestionBtnConfirmText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  aiSuggestionBtnReject: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#e53e3e' },
  aiSuggestionBtnRejectText: { fontSize: 12, fontWeight: '800', color: '#e53e3e' },

  aiCheckBtn: {
    alignSelf: 'flex-start', backgroundColor: '#E3F2FD', borderRadius: 10,
    borderWidth: 1.5, borderColor: '#1565C0', paddingHorizontal: 14, paddingVertical: 10, marginTop: 6,
  },
  aiCheckBtnText: { fontSize: 12.5, fontWeight: '800', color: '#1565C0' },

  applyBtn: { backgroundColor: '#1565C0', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  applyBtnDisabled: { opacity: 0.5 },
  applyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
