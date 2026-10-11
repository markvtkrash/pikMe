import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { getMenuBuildStatus, MENU_BUILD_MESSAGE } from '../../api/menuBuild';
import { IconText } from './AppIcon';

// Dashboard message for an owner of an independent restaurant whose menu could not be built automatically:
// it says so and links to the two ways to add it. Shows nothing when there is no problem (or nothing can be read).
export function MenuBuildBanner() {
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ['menuBuildStatus'],
    queryFn: getMenuBuildStatus,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (!data) return null;

  return (
    <View style={styles.banner}>
      <IconText style={styles.title} emoji="📋">Your menu needs your help</IconText>
      <Text style={styles.text}>{MENU_BUILD_MESSAGE}</Text>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.button} onPress={() => router.push('/restaurant/menu-photo')} accessibilityRole="button">
          <IconText style={styles.buttonText} emoji="📷">Add with a photo</IconText>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={() => router.push('/restaurant/menu-text')} accessibilityRole="button">
          <IconText style={styles.buttonText} emoji="📋">Paste the text</IconText>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: '#FFF8E1', borderRadius: 12, padding: 14, marginHorizontal: 16, marginBottom: 12, borderWidth: 1, borderColor: '#FFE082' },
  title: { fontSize: 14, fontWeight: '800', color: '#6D4C00', marginBottom: 4 },
  text: { fontSize: 13, color: '#6D4C00', lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  button: { backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  buttonText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
