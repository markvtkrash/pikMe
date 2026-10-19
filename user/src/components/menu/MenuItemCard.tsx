import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Pressable, Platform, Modal, ScrollView } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { BRAND_COLORS, BRAND_SHADOWS, BRAND_TYPOGRAPHY } from '../../constants/brandTheme';
import type { Recommendation, MenuItem, Coupon } from '../../types';
import { getItemAnalysis } from '../../api/functions';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useIsFranchise } from '../../hooks/useIsFranchise';
import { useSavedStore } from '../../store/savedStore';
import { useSaved } from '../../hooks/useSaved';
import { useCouponActivation } from '../../hooks/useCouponActivation';
import { getItemWarnings, getSafeIndicator } from './menuItemWarnings';
import { CouponActivationModal } from '../coupon/CouponActivationModal';
import { CouponConfirmModal } from '../coupon/CouponConfirmModal';
import { NutritionInfoModal } from './NutritionInfoModal';
import { showNutritionFor } from '../../utils/menuStatus';
import { useShare } from '../../hooks/useShare';
import { dishShareMessage } from '../../utils/shareText';
import { remainingPersonalUses, remainingTotalUses, isLowStock } from '../../utils/couponDisplay';
import {
  unverifiedNotice, hasDietOrAllergen, ingredientCaution, AI_DISCLAIMER, VERDICT_GOOD, VERDICT_NOT_GOOD,
} from '../../utils/menuItemNotices';
import { tileIcons } from '../../utils/menuLayout';
import { Alert } from '../../utils/alert';
import { useThemedStyles, useThemeColor } from '../../theme/useTheme';

interface Props {
  recommendation: Recommendation;
  itemCoupons?: Coupon[];
  onCouponClosed?: (couponId: string) => void;
  // 'list': the compact card. 'tile': half-width, shows only the name and a few tiny icons, with a dropdown for the details.
  variant?: 'list' | 'tile';
}

// Every card has the same color. It is never chosen by what the dish is called: a name does not say what is in a dish (a "cheese burger" may have
// beef, "Mexican rice" may be cooked in chicken or beef stock), and a color by dish type would read as a claim about its ingredients.
const CARD_ACCENT = '#2E7D32';
const CARD_TINT = '#E8F5E9';
// the card outline: thicker and a deeper green than the accent, so each card stands out from the page
const CARD_BORDER = '#1B5E20';

// The score as a small rounded chip, tinted by how good it is.
function ScoreChip({ score }: { score: number }) {
  const styles = useThemedStyles(baseStyles);
  const { color: tc } = useThemeColor();
  const isGood = score >= 75;
  const isMid  = score >= 50;
  const color  = isGood ? '#1565C0' : isMid ? '#e65100' : '#c62828';
  const bg     = isGood ? '#E3F2FD' : isMid ? '#FFF3E0' : '#FFEBEE';
  return (
    <View style={[styles.scoreChip, { backgroundColor: tc(bg, 'backgroundColor') }]} accessibilityLabel={`Score ${score}`}>
      <Text style={[styles.scoreChipText, { color: tc(color) }]}>★ {score}</Text>
    </View>
  );
}

export function MenuItemCard({ recommendation, itemCoupons = [], onCouponClosed, variant = 'list' }: Props) {
  const styles = useThemedStyles(baseStyles);
  const { color: tc } = useThemeColor();
  const isTile = variant === 'tile';
  const [expanded, setExpanded] = useState(false);
  const { menuItem: item, score, reasons, warnings } = recommendation;
  const n = item.nutrition;
  const { data: isFranchise = false } = useIsFranchise(recommendation.restaurant?.name);
  const { data: profile } = useUserProfile();

  const isSaved = useSavedStore((s) => s.menuItemIds.has(item.itemId));
  const { toggleMenuItem } = useSaved();
  const share = useShare();
  const couponActivation = useCouponActivation({ onClosed: onCouponClosed });

  const [analysisText, setAnalysisText]     = useState('');
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisOpen, setAnalysisOpen]     = useState(false);
  const [nutritionModalOpen, setNutritionModalOpen] = useState(false);

  // Animation values
  const buttonScale = useSharedValue(1);

  const buttonAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
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
  // A tap on a tile opens its details in a popup (closed by a tap outside it or the X).
  function handleCardPress() {
    if (isTile) {
      setExpanded(true);
    }
  }

  // The Quick take opens in a small popup (below). It is closed by a tap anywhere outside it.
  async function handleAskAi() {
    if (analysisText) {
      setAnalysisOpen(true);
      return;
    }
    if (!profile) return;
    setAnalysisLoading(true);
    setAnalysisOpen(true);
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

  const notice = unverifiedNotice(item, isFranchise);
  const showFit = isSafe && !hasWarnings && !analysisText.startsWith('No');
  // A name never proves what is in a dish, so EVERY card says its ingredients are not verified: a visible tag for a person with a diet or an allergen set,
  // a small quiet line for everyone else. A card with no warning is "not checked", never "fine".
  const caution = ingredientCaution(hasDietOrAllergen(profile));
  const cautionEl = caution.strong ? (
    <View style={[styles.tag, styles.cautionTag]}>
      <View style={[styles.marker, { borderColor: '#E65100', backgroundColor: '#E65100' }]} />
      <Text style={[styles.tagText, { color: tc('#BF360C') }]}>{caution.text}</Text>
    </View>
  ) : (
    <Text style={styles.cautionQuiet}>{caution.text}</Text>
  );

  const detailsView = (
    <>
      {!isTile && <View style={styles.cautionRow}>{cautionEl}</View>}

      {/* Small marker tags: not verified (tap for the full wording), may fit, and the top reasons. The menu list explains the tags once. */}
      {(notice || showFit || goodChips.length > 0 || warnChips.length > 0) && (
        <View style={styles.pillRow}>
          {notice && (
            <TouchableOpacity
              style={[styles.tag, { borderColor: notice.tag.startsWith('⚠') ? '#E65100' : '#1565C0' }]}
              onPress={() => Alert.alert(notice.title, notice.message)}
              accessibilityRole="button"
              accessibilityLabel={`${notice.title}. Tap for details.`}
            >
              <View style={[styles.marker, { borderColor: notice.tag.startsWith('⚠') ? '#E65100' : '#1565C0' }]} />
              <Text style={[styles.tagText, { color: tc(notice.tag.startsWith('⚠') ? '#BF360C' : '#0D47A1') }]}>{notice.tag.replace(/^\S+\s+/, '')}</Text>
            </TouchableOpacity>
          )}
          {showFit && (
            <View style={[styles.tag, { borderColor: tc('#2E7D32') }]}>
              <View style={[styles.marker, { borderColor: tc('#2E7D32'), backgroundColor: '#2E7D32' }]} />
              <Text style={[styles.tagText, { color: tc('#1B5E20') }]}>Calories & macros: may fit your goals</Text>
            </View>
          )}
          {goodChips.map((r) => (
            <View key={`good-${r}`} style={[styles.pill, styles.chipGood]}>
              <Text style={styles.chipGoodText}>✓ {r}</Text>
            </View>
          ))}
          {warnChips.map((w) => (
            <View key={`warn-${w}`} style={[styles.pill, styles.chipWarn]}>
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

      {/* Nutrition as a quiet link, and the AI verdict as an outlined button on the right */}
      <View style={[styles.actionRow, isTile && styles.actionRowStacked]}>
        {showNutritionFor(item) ? (
          <TouchableOpacity
            style={[styles.nutritionLink, isTile && styles.tileBtn]}
            onPress={() => setNutritionModalOpen(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Text style={[styles.nutritionLinkText, { color: tc(CARD_ACCENT) }]}>🍎 Nutrition ›</Text>
          </TouchableOpacity>
        ) : (
          // an estimated item shows no nutrition numbers; the empty space keeps the button on the right
          !isTile && <View style={styles.nutritionLink} />
        )}
        <Animated.View style={[styles.aiBtn, isTile && styles.tileBtn, buttonAnimStyle]}>
          <TouchableOpacity
            onPress={handleButtonPress}
            disabled={analysisLoading}
            activeOpacity={1}
            style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
            accessibilityRole="button"
          >
            <Text style={styles.aiBtnText}>Quick take</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* Coupons: a thin strip each, so a coupon does not take a whole banner */}
      {itemCoupons.length > 0 && (
        <View style={styles.couponStripContainer}>
          {itemCoupons.map((coupon) => (
            <TouchableOpacity
              key={coupon.id}
              style={styles.couponStrip}
              onPress={() => couponActivation.handlePress(coupon)}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text style={styles.couponStripSave}>
                ⭐ SAVE {coupon.discount_value}{coupon.coupon_type.includes('percent') ? '%' : '$'}
              </Text>
              <Text style={styles.couponStripCode} numberOfLines={1}>Code: {coupon.coupon_code}</Text>
              <View style={styles.couponTapHintPill}>
                <Text style={styles.couponTapHintText}>
                  {coupon.activated_at ? '⏱ Active — tap to view' : '👉 Tap to activate'}
                </Text>
              </View>
              <View style={styles.usesLeftPill}>
                <Text style={styles.usesLeftText}>
                  🔁 {remainingPersonalUses(coupon)} more {remainingPersonalUses(coupon) === 1 ? 'use' : 'uses'}
                </Text>
              </View>
              {isLowStock(coupon) && (
                <View style={styles.lowStockPill}>
                  <Text style={styles.lowStockText}>🔥 {remainingTotalUses(coupon)} left</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </>
  );

  const icons = tileIcons({ warnings: hasWarnings, noticeTag: notice?.tag ?? null, fit: showFit, coupons: itemCoupons.length });

  const shareButton = (
    <TouchableOpacity
      onPress={() => share(dishShareMessage({ dish: item.name, restaurantName: recommendation.restaurant?.name ?? item.restaurantName, confirmed: item.isVerified === true, placeId: recommendation.restaurant?.placeId }), 'dish', item.itemId)}
      hitSlop={10}
      style={styles.shareWrap}
      accessibilityRole="button"
      accessibilityLabel={`Share ${item.name}`}
    >
      <Text style={styles.shareIcon}>➦</Text>
    </TouchableOpacity>
  );

  const heartButton = (
    <TouchableOpacity
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        toggleMenuItem(item.itemId, item);
      }}
      hitSlop={10}
      style={[styles.heartWrap, !isSaved && styles.heartWrapEmpty]}
    >
      {isSaved ? <Text style={styles.heart}>❤️</Text> : <Text style={styles.heartEmpty}>♡</Text>}
    </TouchableOpacity>
  );

  return (
    <>
    <Pressable
      style={[styles.card, isTile && styles.tileCard, { borderColor: tc(CARD_BORDER) }]}
      onPress={handleCardPress}
    >
      {isTile ? (
        <>
          {/* A tile: the score and the heart on one line, the name, then tiny status icons and a hint; a tap opens the details. */}
          <View style={[styles.nameBand, styles.tileBand]}>
            <View style={styles.tileTopRow}>
              <ScoreChip score={score} />
              {heartButton}
            </View>
            <Text style={[styles.name, styles.tileName, styles.nameOnBand]} numberOfLines={2}>{item.name}</Text>
          </View>
          <View style={styles.tileCaution}>{cautionEl}</View>
          <View style={styles.tileFooter}>
            <View style={styles.tileIcons}>
              {icons.map((i) => (
                <Text key={i.icon} style={styles.tileIcon} accessibilityLabel={i.label}>{i.icon}</Text>
              ))}
            </View>
            <Text style={styles.tileHint}>Tap for details ▾</Text>
          </View>
        </>
      ) : (
        <>
          <View style={[styles.headerRow, styles.nameBand]}>
            <Text style={[styles.name, styles.nameOnBand]} numberOfLines={2}>{item.name}</Text>
            <ScoreChip score={score} />
            {shareButton}
            {heartButton}
          </View>
          {detailsView}
        </>
      )}
    </Pressable>
    {/* A tile's details: a popup over a dimmed background; a tap outside it, or the X, closes it. It is a sibling of the tile, not inside it, so a tap in
        the popup never reaches the tile. */}
    {isTile && (
      <Modal visible={expanded} transparent animationType="fade" onRequestClose={() => setExpanded(false)}>
        <Pressable style={styles.popupBackdrop} onPress={() => setExpanded(false)} accessibilityLabel="Close details">
          <Pressable style={styles.popupCard} onPress={() => {}}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.popupContent}>
              <View style={[styles.headerRow, styles.nameBand]}>
                <Text style={[styles.name, styles.nameOnBand]}>{item.name}</Text>
                <ScoreChip score={score} />
                {shareButton}
                {heartButton}
              </View>
              <View style={styles.cautionRow}>{cautionEl}</View>
              {detailsView}
            </ScrollView>
            <TouchableOpacity style={styles.popupClose} onPress={() => setExpanded(false)} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={styles.popupCloseText}>✕</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    )}
    {/* Quick take: a small popup over a dimmed background, closed by a tap anywhere outside it. One neutral look for every kind of answer. */}
    <Modal visible={analysisOpen} transparent animationType="fade" onRequestClose={() => setAnalysisOpen(false)}>
      <Pressable style={styles.quickBackdrop} onPress={() => setAnalysisOpen(false)} accessibilityLabel="Close quick take">
        <Pressable style={styles.quickCard} onPress={() => {}}>
          <Text style={styles.quickTitle}>Quick take</Text>
          <Text style={styles.quickDish} numberOfLines={2}>{item.name}</Text>
          {analysisLoading ? (
            <View style={styles.analysingRow}>
              <ActivityIndicator size="small" color="#455A64" />
              <Text style={styles.analysingText}>Working it out…</Text>
            </View>
          ) : (
            <>
              {analysisText.startsWith('Yes') ? <Text style={styles.quickLead}>{VERDICT_GOOD}</Text>
                : analysisText.startsWith('No') ? <Text style={styles.quickLead}>{VERDICT_NOT_GOOD}</Text> : null}
              <Text style={styles.analysisText}>{analysisText}</Text>
              <Text style={styles.aiDisclaimer}>{AI_DISCLAIMER}</Text>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
    <CouponActivationModal
      visible={!!couponActivation.activeCoupon}
      coupon={couponActivation.activeCoupon}
      expiresAt={couponActivation.expiresAt}
      onDone={couponActivation.handleDone}
      itemName={recommendation.menuItem.name}
    />
    <CouponConfirmModal
      visible={!!couponActivation.pendingCoupon}
      onCancel={couponActivation.cancelActivate}
      onConfirm={couponActivation.confirmActivate}
    />
    <NutritionInfoModal
      visible={nutritionModalOpen}
      nutrition={n}
      onClose={() => setNutritionModalOpen(false)}
    />
    </>
  );
}

const baseStyles = StyleSheet.create({
  popupBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  popupCard: { width: '100%', maxWidth: 440, maxHeight: '85%', backgroundColor: '#fff', borderRadius: 20, borderWidth: 3, borderColor: '#1B5E20', overflow: 'hidden' },
  popupContent: { padding: 14, paddingTop: 22 },
  popupClose: { position: 'absolute', top: 4, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#BDBDBD' },
  popupCloseText: { fontSize: 13, fontWeight: '900', color: '#444' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 3,
    borderColor: BRAND_COLORS.primary,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10, minHeight: 58 },
  // minWidth 0 lets the name shrink in its row, and on the web a single very long word breaks instead of pushing the score and heart out
  name: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: '700', color: '#141414', lineHeight: 21, ...(Platform.OS === 'web' ? ({ overflowWrap: 'anywhere' } as any) : {}) },
  heart: { fontSize: 16 },
  // not saved: a red outline heart in a red-ringed circle, so it shows clearly on the white circle and the green name band
  heartEmpty: { fontSize: 20, lineHeight: 24, fontWeight: '900', color: '#D32F2F' },
  heartWrapEmpty: { borderWidth: 2, borderColor: '#D32F2F' },
  shareWrap: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shareIcon: { fontSize: 20, fontWeight: '900', color: '#1565C0', lineHeight: 24 },
  heartWrap: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },

  // the name sits on a green band, whatever the dish
  nameBand: { backgroundColor: '#2E7D32', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10 },
  nameOnBand: { color: '#fff' },

  scoreChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  scoreChipText: { fontSize: 12.5, fontWeight: '800' },

  // tile (two per row): the score and heart, the name, and a hint; the details open on a tap
  // every tile is at least this tall and fills its grid cell, so the tiles in a row are the same height
  tileCard: { flex: 1, minHeight: 176, marginHorizontal: 0, marginBottom: 0, padding: 12, borderRadius: 16 },
  tileTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  tileBand: { borderRadius: 10, padding: 8, marginBottom: 8 },
  tileName: { flex: 0, fontSize: 14, lineHeight: 18, minHeight: 36 },
  tileFooter: { marginTop: 'auto', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  tileIcons: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, flexShrink: 1 },
  tileIcon: { fontSize: 14 },
  // a solid green pill, so it reads as the thing to tap
  tileHint: { fontSize: 11.5, fontWeight: '800', color: '#fff', backgroundColor: '#2E7D32', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: 'hidden' },
  tileDetails: { marginTop: 10 },
  actionRowStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 6 },
  tileBtn: { flex: 0, alignSelf: 'stretch' },

  // small marker tags in one wrapping row: a thin outline with a small square marker
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, maxWidth: '100%' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#fff', maxWidth: '100%' },
  marker: { width: 9, height: 9, borderRadius: 2, borderWidth: 1.5, backgroundColor: '#fff' },
  tagText: { fontSize: 11.5, fontWeight: '700', flexShrink: 1 },
  cautionRow: { marginBottom: 8 },
  cautionTag: { backgroundColor: '#FFF3E0', borderColor: '#E65100', alignSelf: 'flex-start' },
  cautionQuiet: { fontSize: 11, color: '#757575', flexShrink: 1 },
  tileCaution: { marginBottom: 8 },
  chipGood: { backgroundColor: '#E3F2FD' },
  chipGoodText: { fontSize: 11, color: '#1565C0', fontWeight: '600' },
  chipWarn: { backgroundColor: '#FFF8E1' },
  chipWarnText: { fontSize: 11, color: '#E65100', fontWeight: '600' },

  warningsContainer: {
    marginBottom: 10,
    gap: 0,
  },

  restrictionWarningBox: {
    backgroundColor: '#FDECEA',
    borderWidth: 1.5,
    borderColor: '#E57373',
    borderRadius: 12,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  warningIconLarge: { fontSize: 20, marginTop: 1 },
  restrictionWarningText: { fontSize: 13, color: '#B71C1C', fontWeight: '700', lineHeight: 18 },

  allergenWarningBox: {
    backgroundColor: '#FFF3E0',
    borderWidth: 1.5,
    borderColor: '#FFB74D',
    borderRadius: 12,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  allergenIconLarge: { fontSize: 20, marginTop: 1 },
  allergenWarningText: { fontSize: 13, color: '#A84300', fontWeight: '700', lineHeight: 18 },

  // Nutrition is a quiet link on the left; the AI Verdict is an outlined button on the right
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  nutritionLink: { flex: 1, paddingVertical: 8 },
  nutritionLinkText: { fontSize: 13.5, fontWeight: '800' },

  // the one orange accent on a card: the main action
  aiBtn: {
    backgroundColor: '#E65100',
    borderWidth: 1.5,
    borderColor: '#BF360C',
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiBtnText: { fontSize: 14, fontWeight: '800', letterSpacing: 0.2, color: '#fff' },

  // the Quick take popup: one neutral look, whatever the answer says
  quickBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  quickCard: { width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1.5, borderColor: '#CFD8DC', padding: 16, gap: 6 },
  quickTitle: { fontSize: 12, fontWeight: '800', color: '#607D8B', textTransform: 'uppercase', letterSpacing: 0.6 },
  quickDish: { fontSize: 15, fontWeight: '700', color: '#222' },
  quickLead: { fontSize: 15, fontWeight: '800', color: '#37474F', marginTop: 4 },
  aiDisclaimer: { fontSize: 11, color: '#666', marginTop: 8, lineHeight: 15 },
  analysingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  analysingText: { fontSize: 13, color: '#607D8B' },
  analysisText: { fontSize: 13, color: '#333', lineHeight: 20 },

  couponStripContainer: { gap: 4, marginTop: 6, alignItems: 'flex-start' },
  couponStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#2E7D32',
    paddingVertical: 3,
    paddingHorizontal: 7,
  },
  couponStripSave: { fontSize: 12.5, fontWeight: '900', color: '#1B5E20', letterSpacing: 0.3 },
  couponStripCode: { fontSize: 11, fontWeight: '800', color: '#2E7D32', flexShrink: 1 },
  couponTapHintPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#2E7D32',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  couponTapHintPillActive: {
    backgroundColor: '#2E7D32',
  },
  couponTapHintText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#fff',
  },
  usesLeftPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#E3F2FD',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#1565C0',
  },
  usesLeftText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#1565C0',
  },
  lowStockPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFEBEE',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#e53e3e',
  },
  lowStockText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#c62828',
  },
});
