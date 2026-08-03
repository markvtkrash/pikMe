import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BRAND_COLORS } from '../../constants/brandTheme';

interface Props {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function CouponConfirmModal({ visible, onCancel, onConfirm }: Props) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.icon}>⏱️</Text>
          <Text style={styles.title}>Activate this coupon?</Text>
          <Text style={styles.body}>
            This coupon will expire in 5 minutes once activated. Only activate it when
            you're ready to show it to restaurant staff.
          </Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.85}>
              <Text style={styles.cancelBtnText}>Not yet</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmBtn} onPress={onConfirm} activeOpacity={0.85}>
              <Text style={styles.confirmBtnText}>Activate</Text>
            </TouchableOpacity>
          </View>
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
  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 8, alignSelf: 'stretch' },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#F0F0F0',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelBtnText: { color: '#555', fontSize: 15, fontWeight: '700' },
  confirmBtn: {
    flex: 1,
    backgroundColor: BRAND_COLORS.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
