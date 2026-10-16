import { Text, View, StyleSheet, useWindowDimensions } from 'react-native';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs } from 'expo-router';
import { useThemedStyles, useThemeColor } from '../../../src/theme/useTheme';

// The tab bar's own height (icon, dot, label and padding), not counting the bottom safe area.
const TAB_BAR_HEIGHT = 72;

export default function TabLayout() {
  const styles = useThemedStyles(baseStyles);
  const { color: tc } = useThemeColor();
  const insets = useSafeAreaInsets();
  // on a very narrow screen six labels do not fit at the normal size
  const narrow = useWindowDimensions().width < 350;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // the height includes the phone's bottom safe area: a fixed height with that area added as padding left no room for the icons and labels
        tabBarStyle: [styles.tabBar, { height: TAB_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom + 8 }],
        // a soft orange band: light enough that the icons keep their own colors; dark labels, deep orange for the tab you are on
        tabBarActiveTintColor: '#8E2400',
        tabBarInactiveTintColor: '#3E2723',
        tabBarLabelStyle: [styles.label, narrow && styles.labelNarrow],
        tabBarItemStyle: styles.item,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Map',
          tabBarIcon: ({ focused }) => <TabIcon emoji="🗺️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explore',
          tabBarIcon: ({ focused }) => <TabIcon emoji="🔍" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Saved',
          tabBarIcon: ({ focused }) => <TabIcon emoji="❤️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Quick Find',
          tabBarIcon: ({ focused }) => <TabIcon emoji="⚡" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="help"
        options={{
          title: 'Help',
          tabBarIcon: ({ focused }) => <TabIcon emoji="🛟" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean; color?: ColorValue }) {
  const styles = useThemedStyles(baseStyles);
  return (
    <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
      <Text style={styles.icon}>{emoji}</Text>
    </View>
  );
}

const baseStyles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#FFA94D',
    // a deep orange line along the top of the orange band
    borderTopWidth: 3,
    borderTopColor: '#E65100',
    paddingBottom: 8,
    paddingTop: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 12,
  },
  // six tabs share the width, so the items have no side padding and the labels are a little smaller ("Quick Fix" was cut to "Quick Fi…" on a phone)
  item: { paddingTop: 4, paddingHorizontal: 0 },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0,
  },
  labelNarrow: { fontSize: 8.5 },
  iconWrap: { alignItems: 'center', justifyContent: 'center', width: 46, height: 32, borderRadius: 16 },
  // the tab you are on sits in a white pill with an orange outline
  iconWrapActive: { backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#E65100' },
  icon: { fontSize: 22 },
});
