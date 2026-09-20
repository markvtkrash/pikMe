import { View, StyleSheet } from 'react-native';
import { Slot, useSegments } from 'expo-router';
import { OwnerNavHeader } from '../../src/components/common/OwnerNavHeader';

// Auth screens (login/signup/change-password) and the pre-claim flow don't
// have a restaurant to navigate around yet, so they render bare — everything
// else under restaurant/* gets the persistent nav header.
const NO_HEADER_SEGMENTS = new Set(['auth', 'claim']);

export default function RestaurantLayout() {
  const segments = useSegments() as string[];
  const secondSegment = segments[1];
  const showHeader = !secondSegment || !NO_HEADER_SEGMENTS.has(secondSegment);

  if (!showHeader) {
    return <Slot />;
  }

  return (
    <View style={styles.container}>
      <OwnerNavHeader />
      <View style={styles.content}>
        <Slot />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  content: { flex: 1 },
});
