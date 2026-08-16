import { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BRAND_COLORS } from '../../constants/brandTheme';
import type { Coupon } from '../../types';

interface Props {
  visible: boolean;
  coupon: Coupon | null;
  expiresAt: string | null;
  onDone: () => void;
}

function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatDiscount(coupon: Coupon): string {
  const unit = coupon.coupon_type.includes('percent') ? '%' : '$';
  const scope = coupon.coupon_type.startsWith('item') ? 'this item' : 'your order';
  return `${coupon.discount_value}${unit} off ${scope}`;
}

export function CouponActivationModal({ visible, coupon, expiresAt, onDone }: Props) {
  const [msRemaining, setMsRemaining] = useState(0);
  const hasAutoClosed = useRef(false);

  useEffect(() => {
    if (!visible || !expiresAt) return;

    hasAutoClosed.current = false;
    const expiryTime = new Date(expiresAt).getTime();

    const tick = () => {
      const remaining = expiryTime - Date.now();
      setMsRemaining(remaining);
      if (remaining <= 0 && !hasAutoClosed.current) {
        hasAutoClosed.current = true;
        onDone();
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [visible, expiresAt, onDone]);

  if (!coupon) return null;

  const now = new Date();
  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const timeLabel = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onDone} transparent={false}>
      <View style={styles.container}>
        <Text style={styles.eyebrow}>COUPON ACTIVE</Text>

        <View style={styles.timerBox}>
          <Text style={styles.timer}>{formatCountdown(msRemaining)}</Text>
          <Text style={styles.timerLabel}>time remaining</Text>
        </View>

        <View style={styles.detailsCard}>
          <Text style={styles.discount}>{formatDiscount(coupon)}</Text>
          <Text style={styles.code}>Code: {coupon.coupon_code}</Text>
          <Text style={styles.dateTime}>{dateLabel} · {timeLabel}</Text>
        </View>

        <Text style={styles.instructions}>
          Show this screen to the restaurant staff at checkout.
        </Text>
        <Text style={styles.subInstructions}>
          It will disappear automatically when the timer ends — no need to do anything else.
        </Text>

        <TouchableOpacity style={styles.doneBtn} onPress={onDone} activeOpacity={0.85}>
          <Text style={styles.doneBtnText}>Done, I've shown this</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#141414',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 20,
  },
  eyebrow: {
    color: '#AEAEB2',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
  },
  timerBox: {
    alignItems: 'center',
  },
  timer: {
    fontSize: 72,
    fontWeight: '800',
    color: '#fff',
    fontVariant: ['tabular-nums'],
  },
  timerLabel: {
    fontSize: 13,
    color: '#AEAEB2',
    marginTop: 4,
  },
  detailsCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 6,
    width: '100%',
  },
  discount: {
    fontSize: 22,
    fontWeight: '800',
    color: BRAND_COLORS.primary,
  },
  code: {
    fontSize: 15,
    fontWeight: '700',
    color: '#141414',
  },
  dateTime: {
    fontSize: 13,
    color: '#888',
    marginTop: 4,
  },
  instructions: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  subInstructions: {
    fontSize: 13,
    color: '#AEAEB2',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: -8,
  },
  doneBtn: {
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  doneBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
