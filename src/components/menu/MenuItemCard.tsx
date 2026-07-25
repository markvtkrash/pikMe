import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming, FadeIn, SlideInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { BRAND_COLORS, BRAND_SHADOWS, BRAND_TYPOGRAPHY } from '../../constants/brandTheme';
import type { Recommendation, MenuItem } from '../../types';
import { getItemAnalysis } from '../../api/functions';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useSavedStore } from '../../store/savedStore';
import { useSaved } from '../../hooks/useSaved';
import { getItemWarnings, getSafeIndicator } from './menuItemWarnings';

interface Props {
  recommendation: Recommendation;
  itemCoupons?: any[];
}

function ScoreBadge({ score }: { score: number }) {
  const isGood = score >= 75;
  const isMid  = score >= 50;
  const color  = isGood ? '#2e7d32' : isMid ? '#e65100' : '#c62828';
  const bg     = isGood ? '#E8F5E9' : isMid ? '#FFF3E0' : '#FFEBEE';
  return (
    <View style={[styles.scoreBadge, { backgroundColor: bg }]}>
      <Text style={[styles.scoreNum, { color }]}>{score}</Text>
      <Text style={[styles.scoreLabel, { color }]}>score</Text>
    </View>
  );
}

function Macro({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <View style={styles.macro}>
      <Text style={[styles.macroVal, { color }]}>{Math.round(value)}<Text style={styles.macroUnit}>{unit}</Text></Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

export function MenuItemCard({ recommendation, itemCoupons = [] }: Props) {
  const { menuItem: item, score, reasons, warnings } = recommendation;
  const n = item.nutrition;
  const { data: profile } = useUserProfile();

  const isSaved = useSavedStore((s) => s.menuItemIds.has(item.itemId));
  const { toggleMenuItem } = useSaved();

  const [analysisText, setAnalysisText]     = useState('');
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisOpen, setAnalysisOpen]     = useState(false);

  // Animation values
  const buttonScale = useSharedValue(1);
  const analysisPanelOpacity = useSharedValue(0);

  const buttonAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const analysisPanelAnimStyle = useAnimatedStyle(() => ({
    opacity: analysisPanelOpacity.value,
  }));

  // Handle button press animation
  const handleButtonPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    buttonScale.value = withSpring(0.95, { damping: 10, mass: 1, overshootClamping: false });
    setTimeout(() => {
      buttonScale.value = withSpring(1, { damping: 10, mass: 1, overshootClamping: false });
    }, 50);
    handleAskAi();
  };

  const { allergenWarnings, restrictionWarnings } = getItemWarnings(
    item,
    profile?.allergens ?? [],
    profile?.dietaryRestrictions ?? []
  );
  const isSafe = getSafeIndicator(item, score);
  const hasWarnings = allergenWarnings.length > 0 || restrictionWarnings.length > 0;
  // The name-keyword warning check can't see hidden ingredients, so when the user
  // has allergens/restrictions set, nudge them to the full AI check before trusting
  // the nutrition-only "good" signal.
  const hasDietaryProfile =
    (profile?.allergens?.length ?? 0) > 0 ||
    (profile?.dietaryRestrictions?.length ?? 0) > 0;

  async function handleAskAi() {
    if (analysisOpen) {
      analysisPanelOpacity.value = withTiming(0, { duration: 300 });
      setTimeout(() => setAnalysisOpen(false), 300);
      return;
    }
    if (analysisText) {
      setAnalysisOpen(true);
      analysisPanelOpacity.value = withTiming(1, { duration: 300 });
      return;
    }
    if (!profile) return;
    setAnalysisLoading(true);
    setAnalysisOpen(true);
    analysisPanelOpacity.value = withTiming(1, { duration: 300 });
    try {
      const text = await getItemAnalysis(item.itemId, item, profile);
      setAnalysisText(text);
    } catch {
      setAnalysisText('Could not get analysis. Please try again.');
    } finally {
      setAnalysisLoading(false);
    }
  }

  const goodChips = reasons.slice(0, 2);
  const warnChips = warnings.slice(0, 1);

  return (
    <View style={styles.card}>
      {/* Header row */}
      <View style={styles.headerRow}>
        <ScoreBadge score={score} />
        <View style={styles.titleBlock}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                toggleMenuItem(item.itemId, item);
              }}
              hitSlop={10}
            >
              <Text style={styles.heart}>{isSaved ? '❤️' : '🤍'}</Text>
            </TouchableOpacity>
          </View>
          {!item.isVerified && (
            <View style={styles.estimatedBadge}>
              <Text style={styles.estimatedText}>Estimated</Text>
            </View>
          )}
        </View>
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Macros */}
      <View style={styles.macroRow}>
        <View style={styles.calBlock}>
          <Text style={styles.calNum}>{n.calories}</Text>
          <Text style={styles.calLabel}>cal</Text>
        </View>
        <View style={styles.macroDivider} />
        <View style={styles.macros}>
          <Macro label="protein"  value={n.protein_g}    unit="g"  color="#1565C0" />
          <Macro label="carbs"    value={n.totalCarbs_g} unit="g"  color="#6A1B9A" />
          <Macro label="fat"      value={n.totalFat_g}   unit="g"  color="#E65100" />
          <Macro label="sodium"   value={n.sodium_mg}    unit="mg" color="#B71C1C" />
        </View>
      </View>

      {/* Chips */}
      {(goodChips.length > 0 || warnChips.length > 0) && (
        <View style={styles.chipRow}>
          {goodChips.map((r) => (
            <View key={`good-${r}`} style={styles.chipGood}>
              <Text style={styles.chipGoodText}>✓ {r}</Text>
            </View>
          ))}
          {warnChips.map((w) => (
            <View key={`warn-${w}`} style={styles.chipWarn}>
              <Text style={styles.chipWarnText}>⚠ {w}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Allergen & Restriction Warnings */}
      {hasWarnings && (
        <View style={styles.warningsContainer}>
          {restrictionWarnings.length > 0 && (
            <View style={styles.restrictionWarningBox}>
              <Text style={styles.warningIconLarge}>🚫</Text>
              <View style={{ flex: 1 }}>
                {restrictionWarnings.map((warn) => (
                  <Text key={`restriction-${warn}`} style={styles.restrictionWarningText}>{warn}</Text>
                ))}
              </View>
            </View>
          )}
          {allergenWarnings.length > 0 && (
            <View style={[styles.allergenWarningBox, restrictionWarnings.length > 0 && { marginTop: 8 }]}>
              <Text style={styles.allergenIconLarge}>⚠️</Text>
              <View style={{ flex: 1 }}>
                {allergenWarnings.map((warn) => (
                  <Text key={`allergen-${warn}`} style={styles.allergenWarningText}>{warn}</Text>
                ))}
              </View>
            </View>
          )}
        </View>
      )}

      {/* Nutrition-fit indicator (scoped to calories & macros, not allergen/diet safety) */}
      {isSafe && !hasWarnings && !analysisText.startsWith('No') && (
        <View style={styles.safeBox}>
          <View style={styles.safeHeaderRow}>
            <Text style={styles.safeIconLarge}>✅</Text>
            <Text style={styles.safeText}>Fits your nutrition goals</Text>
          </View>
          {hasDietaryProfile && (
            <Text style={styles.safeCaveat}>
              Based on calories & macros. Tap “🤔 Should I get this?” below to check it against your allergies & dietary restrictions.
            </Text>
          )}
        </View>
      )}

      {/* Item-Specific Coupons - PROMINENT BANNER */}
      {itemCoupons.length > 0 && (
        <View style={styles.couponBannerContainer}>
          {itemCoupons.map((coupon) => (
            <View key={coupon.id} style={styles.couponBannerBox}>
              <View style={styles.couponBannerLeft}>
                <Text style={styles.couponSaveLabel}>SAVE</Text>
                <View style={styles.couponAmountBox}>
                  <Text style={styles.couponAmount}>
                    {coupon.discount_value}
                  </Text>
                  <Text style={styles.couponUnit}>
                    {coupon.coupon_type.includes('percent') ? '%' : '$'}
                  </Text>
                </View>
              </View>
              <View style={styles.couponBannerDivider} />
              <View style={styles.couponBannerRight}>
                <Text style={styles.couponCode}>Code: {coupon.coupon_code}</Text>
                <Text style={styles.couponType}>
                  {coupon.coupon_type.includes('percent')
                    ? `${coupon.discount_value}% off`
                    : `$${coupon.discount_value} off`}
                </Text>
              </View>
              <Text style={styles.couponStarRight}>⭐</Text>
            </View>
          ))}
        </View>
      )}

      {/* AI button */}
      <Animated.View style={[styles.aiBtn, analysisOpen && styles.aiBtnOpen, buttonAnimStyle]}>
        <TouchableOpacity
          onPress={handleButtonPress}
          disabled={analysisLoading}
          activeOpacity={1}
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
        >
          <Text style={[styles.aiBtnText, analysisOpen && styles.aiBtnTextOpen]}>
            {analysisOpen ? 'Close ▲' : '🤔💭  Should I get this?'}
          </Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Analysis panel */}
      {analysisOpen && (
        <Animated.View
          style={[
            styles.analysisBox,
            analysisText.startsWith('Yes') ? styles.analysisPositive : analysisText.startsWith('No') ? styles.analysisNegative : {},
            analysisPanelAnimStyle
          ]}
          entering={SlideInDown.duration(400)}
        >
          {analysisLoading
            ? <View style={styles.analysingRow}>
                <ActivityIndicator size="small" color="#4CAF50" />
                <Text style={styles.analysingText}>Analysing…</Text>
              </View>
            : analysisText.startsWith('Yes')
            ? <Animated.View style={styles.analysisPositiveContainer} entering={FadeIn.duration(500)}>
                <Text style={styles.yesEmoji}>✅</Text>
                <Text style={styles.yesText}>YES</Text>
                <Text style={[
                  styles.analysisText,
                  styles.analysisPositiveText
                ]}>{analysisText}</Text>
              </Animated.View>
            : analysisText.startsWith('No')
            ? <Animated.View style={styles.analysisNegativeContainer} entering={FadeIn.duration(500)}>
                <Text style={styles.noEmoji}>❌</Text>
                <Text style={styles.noText}>NO</Text>
                <Text style={[
                  styles.analysisText,
                  styles.analysisNegativeText
                ]}>{analysisText}</Text>
              </Animated.View>
            : <Animated.View entering={FadeIn.duration(500)}><Text style={styles.analysisText}>{analysisText}</Text></Animated.View>
          }
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 3,
  },

  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },

  scoreBadge: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  scoreNum: { fontSize: 18, fontWeight: '800', lineHeight: 20 },
  scoreLabel: { fontSize: 9, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },

  titleBlock: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  name: { flex: 1, fontSize: 15, fontWeight: '700', color: '#141414', lineHeight: 21 },
  heart: { fontSize: 19, marginTop: 1 },

  estimatedBadge: {
    alignSelf: 'flex-start',
    marginTop: 5,
    backgroundColor: '#F3E5F5',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  estimatedText: { fontSize: 10, color: '#7B1FA2', fontWeight: '700', letterSpacing: 0.3 },

  divider: { height: 1, backgroundColor: '#F3F3F3', marginBottom: 12 },

  macroRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  calBlock: { alignItems: 'center', paddingRight: 14 },
  calNum: { fontSize: 22, fontWeight: '800', color: '#141414', lineHeight: 24 },
  calLabel: { fontSize: 10, color: '#6B6B6B', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  macroDivider: { width: 1, height: 36, backgroundColor: '#F0F0F0', marginRight: 14 },
  macros: { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },
  macro: { alignItems: 'center' },
  macroVal: { fontSize: 14, fontWeight: '700' },
  macroUnit: { fontSize: 10, fontWeight: '500' },
  macroLabel: { fontSize: 10, color: '#AEAEB2', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.3 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  chipGood: { backgroundColor: '#E8F5E9', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  chipGoodText: { fontSize: 11, color: '#2e7d32', fontWeight: '600' },
  chipWarn: { backgroundColor: '#FFF8E1', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  chipWarnText: { fontSize: 11, color: '#E65100', fontWeight: '600' },

  warningsContainer: {
    marginBottom: 12,
    gap: 0,
  },

  restrictionWarningBox: {
    backgroundColor: '#FF1744',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    shadowColor: '#FF1744',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  warningIconLarge: { fontSize: 24, marginTop: 2 },
  restrictionWarningText: { fontSize: 13, color: '#fff', fontWeight: '700', lineHeight: 18 },

  allergenWarningBox: {
    backgroundColor: '#FF6F00',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    shadowColor: '#FF6F00',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  allergenIconLarge: { fontSize: 22, marginTop: 2 },
  allergenWarningText: { fontSize: 13, color: '#fff', fontWeight: '700', lineHeight: 18 },

  safeBox: {
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    flexDirection: 'column',
    gap: 8,
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  safeHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  safeIconLarge: { fontSize: 22 },
  safeText: { fontSize: 13, color: '#fff', fontWeight: '700', flex: 1 },
  safeCaveat: { fontSize: 11.5, color: 'rgba(255,255,255,0.95)', fontWeight: '600', lineHeight: 16 },

  aiBtn: {
    backgroundColor: BRAND_COLORS.primary,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    marginVertical: 8,
  },
  aiBtnOpen: { backgroundColor: BRAND_COLORS.primaryDark },
  aiBtnText: { fontSize: 15, color: '#fff', fontWeight: '700', letterSpacing: 0.3 },
  aiBtnTextOpen: { color: '#fff' },

  analysisBox: {
    marginTop: 10,
    backgroundColor: '#F6F6F6',
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: '#4CAF50',
  },
  analysisPositive: {
    backgroundColor: '#E8F5E9',
    borderLeftColor: '#2e7d32',
  },
  analysisNegative: {
    backgroundColor: '#FFEBEE',
    borderLeftColor: '#C62828',
  },
  analysisPositiveContainer: {
    alignItems: 'center',
    gap: 8,
  },
  analysisNegativeContainer: {
    alignItems: 'center',
    gap: 8,
  },
  yesEmoji: {
    fontSize: 48,
  },
  yesText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#2e7d32',
    letterSpacing: 1,
  },
  noEmoji: {
    fontSize: 48,
  },
  noText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#C62828',
    letterSpacing: 1,
  },
  analysingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  analysingText: { fontSize: 13, color: '#888' },
  analysisText: { fontSize: 13, color: '#333', lineHeight: 21 },
  analysisPositiveText: { color: '#2e7d32', fontWeight: '600' },
  analysisNegativeText: { color: '#C62828', fontWeight: '600' },

  couponBannerContainer: { gap: 10, marginBottom: 12, marginHorizontal: -16, marginLeft: -16, marginRight: -16, paddingHorizontal: 16 },
  couponBannerBox: {
    backgroundColor: '#FFD54F',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FBC02D',
    shadowColor: '#FFD54F',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  couponBannerLeft: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingRight: 12,
  },
  couponSaveLabel: {
    fontSize: 11,
    fontWeight: '900',
    color: '#E65100',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  couponAmountBox: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  couponAmount: {
    fontSize: 32,
    fontWeight: '900',
    color: '#D84315',
  },
  couponUnit: {
    fontSize: 18,
    fontWeight: '900',
    color: '#D84315',
    marginLeft: 2,
  },
  couponBannerDivider: {
    width: 2,
    height: 56,
    backgroundColor: '#D84315',
    marginHorizontal: 12,
  },
  couponBannerRight: {
    flex: 1,
  },
  couponCode: {
    fontSize: 13,
    fontWeight: '800',
    color: '#D84315',
    marginBottom: 3,
  },
  couponType: {
    fontSize: 11,
    fontWeight: '600',
    color: '#E65100',
    textTransform: 'capitalize',
  },
  couponStarRight: {
    fontSize: 24,
    marginLeft: 8,
  },
});
