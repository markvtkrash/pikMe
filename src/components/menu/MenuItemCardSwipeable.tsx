import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { MenuItemCard } from './MenuItemCard';
import type { Recommendation, Coupon } from '../../types';

interface Props {
  recommendation: Recommendation;
  itemCoupons?: Coupon[];
  onCouponClosed?: (couponId: string) => void;
}

export function MenuItemCardSwipeable({ recommendation, itemCoupons = [], onCouponClosed }: Props) {
  const translateX = useSharedValue(0);

  const pan = Gesture.Pan()
    .onUpdate((event) => {
      if (Math.abs(event.translationX) < 100) {
        translateX.value = event.translationX;
      }
    })
    .onEnd((event) => {
      if (Math.abs(event.translationX) > 50) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      translateX.value = withSpring(0, { damping: 12, mass: 1 });
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={animatedStyle}>
        <MenuItemCard recommendation={recommendation} itemCoupons={itemCoupons} onCouponClosed={onCouponClosed} />
      </Animated.View>
    </GestureDetector>
  );
}
