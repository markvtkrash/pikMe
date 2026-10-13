import { Text, View, StyleSheet, useWindowDimensions } from 'react-native';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs } from 'expo-router';

// The tab bar's own height (icon, dot, label and padding), not counting the bottom safe area.
const TAB_BAR_HEIGHT = 72;

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  // on a very narrow screen six labels do not fit at the normal size
  const narrow = useWindowDimensions().width < 350;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // the height includes the phone's bottom safe area: a fixed height with that area added as padding left no room for the icons and labels
        tabBarStyle: [styles.tabBar, { height: TAB_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom + 8 }],
        tabBarActiveTintColor: '#141414',
        tabBarInactiveTintColor: '#AEAEB2',
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
  return (
    <View style={styles.iconWrap}>
      {focused && <View style={styles.activeDot} />}
      <Text style={[styles.icon, { opacity: focused ? 1 : 0.45 }]}>{emoji}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
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
    fontWeight: '600',
    letterSpacing: 0,
  },
  labelNarrow: { fontSize: 8.5 },
  iconWrap: { alignItems: 'center', width: 36 },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#1565C0',
    marginBottom: 3,
  },
  icon: { fontSize: 22 },
});
