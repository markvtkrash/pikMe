import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BRAND_COLORS } from '../../constants/brandTheme';
import { getNutritionFlags, NutritionLike } from '../../utils/nutritionFlags';

interface Props {
  visible: boolean;
  nutrition: NutritionLike;
  onClose: () => void;
}

// Deliberately shows only qualitative "High X" flags, never exact numbers or
// any "Low/Moderate" claim — nutrition values here are AI estimates, and a
// wrong "low sodium" claim could give someone a false sense of safety in a
// way an omitted label never would. See utils/nutritionFlags.ts.
export function NutritionInfoModal({ visible, nutrition, onClose }: Props) {
  const flags = getNutritionFlags(nutrition);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.icon}>📊</Text>
          <Text style={styles.title}>Nutrition Info</Text>

          {flags.length > 0 ? (
            <View style={styles.flagRow}>
              {flags.map((flag) => (
                <View key={flag} style={styles.flagPill}>
                  <Text style={styles.flagText}>{flag}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.noFlagsText}>
              Nothing here cleared our "high" threshold for calories, sodium, saturated fat, or sugar.
            </Text>
          )}

          <View style={styles.disclaimerBox}>
            <Text style={styles.disclaimerText}>
              ⚠️ Nutrition values are AI-estimated and may be inaccurate. This is not medical advice —
              if you have a health condition or allergy that depends on exact numbers, please verify
              directly with the restaurant before ordering.
            </Text>
          </View>

          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    gap: 12,
  },
  icon: { fontSize: 36 },
  title: { fontSize: 18, fontWeight: '800', color: '#141414' },

  // Neutral gray, not red/green/orange — these are informational flags, not
  // a pass/fail judgment, and the app never shows a "Low X" counterpart to
  // imply the reverse is safe.
  flagRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  flagPill: {
    backgroundColor: '#F0F0F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  flagText: { fontSize: 13, fontWeight: '700', color: '#444' },

  noFlagsText: { fontSize: 13, color: '#777', textAlign: 'center', lineHeight: 19 },

  disclaimerBox: {
    backgroundColor: '#F6F6F6',
    borderRadius: 12,
    padding: 12,
    alignSelf: 'stretch',
  },
  disclaimerText: { fontSize: 11.5, color: '#666', lineHeight: 16 },

  closeBtn: {
    backgroundColor: BRAND_COLORS.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: 4,
  },
  closeBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
