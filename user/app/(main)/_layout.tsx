import { Slot } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { BRAND_COLORS } from '../../src/constants/brandTheme';
import { LocationTracker } from '../../src/components/common/LocationTracker';
import { useThemedStyles } from '../../src/theme/useTheme';

export default function MainLayout() {
  const styles = useThemedStyles(baseStyles);
  return (
    <View style={styles.container}>
      <LocationTracker />
      <View style={styles.content}>
        <Slot />
      </View>
    </View>
  );
}

const baseStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BRAND_COLORS.background.page },
  content: { flex: 1 },
});
