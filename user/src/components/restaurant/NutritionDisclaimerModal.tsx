import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BRAND_COLORS } from '../../constants/brandTheme';

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

export function NutritionDisclaimerModal({ visible, onDismiss }: Props) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.icon}>⚠️</Text>
          <Text style={styles.title}>Before you browse</Text>
          <Text style={styles.body}>
            Nutrition numbers shown here are estimates, not lab-verified values — actual
            calories, allergens, and ingredients can vary by location and preparation.
          </Text>
          <Text style={styles.body}>
            If you have a food allergy, medical condition, or other health concern, please
            confirm directly with restaurant staff before ordering.
          </Text>
          <TouchableOpacity style={styles.button} onPress={onDismiss} activeOpacity={0.85}>
            <Text style={styles.buttonText}>OK, got it</Text>
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
  icon: { fontSize: 40 },
  title: { fontSize: 18, fontWeight: '800', color: '#141414' },
  body: { fontSize: 14, color: '#555', textAlign: 'center', lineHeight: 20 },
  button: {
    marginTop: 8,
    backgroundColor: BRAND_COLORS.primary,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
