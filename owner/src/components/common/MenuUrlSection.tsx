import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Alert } from '../../utils/alert';
import { supabase } from '../../api/supabase';
import { useRestaurantOwnerStore } from '../../store/restaurantOwnerStore';
import { isReadableWebAddress, normalizeUrl } from '../../utils/urlInput';
import { ONLINE_LINK_TITLE, linkHelpMessage, onlineLinkHelp, onlineLinkSavedMessage } from '../../utils/menuImportText';
import { getMenuLinkHelp } from '../../api/menuImport';
import { MENU_IMPORT_ALERT_KEY } from './MenuImportAlertBar';
import { CARD } from '../../constants/cardStyle';

// The page a restaurant's menu is on. Saving it asks us to read that page again (within about a day) and add any new
// dishes to the menu. Saving the SAME address again counts too: the page behind it may have changed, so the Import Menu
// button is always available. It lives on the Menu Management page, next to the other ways of updating the menu, and not on the
// Profile page. A chain's owner can set it too: for a chain it is passed to our team as a suggestion for the chain's menu
// page and only used after they review it. Styled like the import cards above it (round icon, title, short line).
export function MenuUrlSection({ isChain }: { isChain: boolean }) {
  const { restaurant, setRestaurant } = useRestaurantOwnerStore();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(restaurant?.menu_link || '');
  const [saving, setSaving] = useState(false);
  // shown when the last read of the saved link found no dishes (and the link has not been changed since)
  const { data: help } = useQuery({
    queryKey: MENU_LINK_HELP_KEY,
    queryFn: getMenuLinkHelp,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  if (!restaurant) return null;

  async function handleSave(override?: string) {
    const menu_link = normalizeUrl(override ?? value);
    if (menu_link && !isReadableWebAddress(override ?? value)) {
      Alert.alert('That does not look like a web address', 'Type the full address of your menu page, for example yoursite.com/menu.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('restaurants')
        .update({ menu_link, updated_at: new Date().toISOString() })
        .eq('id', restaurant!.id);
      if (error) throw error;
      setRestaurant({ ...restaurant!, menu_link });
      setValue(menu_link ?? '');
      // a saved link is waiting to be read again, so any earlier "import was not successful" bell is out of date
      queryClient.invalidateQueries({ queryKey: MENU_IMPORT_ALERT_KEY });
      queryClient.setQueryData(MENU_LINK_HELP_KEY, null);
      Alert.alert('Saved', onlineLinkSavedMessage(!!menu_link, isChain));
    } catch (error: any) {
      console.error('[menu-url] Save error:', error);
      Alert.alert('Error', error.message || 'Failed to save the menu page address');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeIcon}>🔗</Text>
        </View>
        <Text style={styles.title}>{ONLINE_LINK_TITLE}</Text>
        <TouchableOpacity
          onPress={() => { const h = onlineLinkHelp(isChain); Alert.alert(h.title, h.message); }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="How importing from an online link works"
        >
          <Text style={styles.infoBtn}>ⓘ</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.hint}>
        {isChain
          ? 'The page your menu is on. For a chain it is passed to our team as a suggestion and only used after they review it.'
          : 'The page your menu is on (for example yoursite.com/menu). Tap ⓘ to see what works and what does not.'}
      </Text>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder="https://yourrestaurant.com/menu"
          placeholderTextColor="#9AA5B1"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={value}
          onChangeText={setValue}
          editable={!saving}
        />
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={() => handleSave()}
          disabled={saving}
          accessibilityRole="button"
        >
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Import Menu</Text>}
        </TouchableOpacity>
      </View>
      {!!help && (() => {
        const msg = linkHelpMessage(help.suggestedLink, help.ownerLinkFailed);
        return (
          <View style={styles.helpBox} accessibilityRole="alert">
            <Text style={styles.helpText}>{msg.text}</Text>
            {!!msg.suggestion && (
              <>
                <Text style={styles.helpLink} selectable>{msg.suggestion}</Text>
                <TouchableOpacity
                  style={[styles.useBtn, saving && styles.saveBtnDisabled]}
                  onPress={() => { setValue(msg.suggestion!); handleSave(msg.suggestion!); }}
                  disabled={saving}
                  accessibilityRole="button"
                >
                  <Text style={styles.useBtnText}>Use this link</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        );
      })()}
    </View>
  );
}

export const MENU_LINK_HELP_KEY = ['menuLinkHelp'];

const styles = StyleSheet.create({
  card: { ...CARD, padding: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  badge: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#E3F2FD', alignItems: 'center', justifyContent: 'center' },
  badgeIcon: { fontSize: 18 },
  title: { flex: 1, fontSize: 15.5, fontWeight: '800', color: '#1565C0' },
  infoBtn: { fontSize: 22, color: '#1565C0', fontWeight: '700', paddingLeft: 6 },
  hint: { fontSize: 13, color: '#78909C', lineHeight: 18, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1, borderWidth: 1, borderColor: '#DDE3EA', borderRadius: 12, backgroundColor: '#FAFBFD',
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#1F2A44',
  },
  saveBtn: { backgroundColor: '#1565C0', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center', minWidth: 96 },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  helpBox: { marginTop: 12, backgroundColor: '#FFF8E1', borderLeftWidth: 4, borderLeftColor: '#F9A825', borderRadius: 10, padding: 12 },
  helpText: { fontSize: 13, color: '#5D4037', lineHeight: 18 },
  helpLink: { fontSize: 13, color: '#1565C0', marginTop: 6 },
  useBtn: { alignSelf: 'flex-start', marginTop: 8, backgroundColor: '#1565C0', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  useBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
