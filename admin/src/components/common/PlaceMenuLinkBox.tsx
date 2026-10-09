import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { getPlaceMenuLink, setPlaceMenuLink } from '../../api/placeMenuLink';
import {
  adminLinkOnHold, checkMenuLinkInput, describeAdminLinkResult, describeLinkSource, describeLinkStatus, PlaceMenuLink,
} from '../../utils/placeMenuLink';

// The menu link for one restaurant on its Manage page: the link in force and how its last read went, and a box to set
// the admin's own link. Saving queues the restaurant for the browser crawler; the page stays open.
export default function PlaceMenuLinkBox({ placeId }: { placeId: string }) {
  const [current, setCurrent] = useState<PlaceMenuLink | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const link = await getPlaceMenuLink(placeId);
      setCurrent(link);
      setInput(link?.admin_link ?? '');
    } catch (e: any) {
      setError(e?.message || 'Could not load the menu link');
    } finally {
      setLoading(false);
    }
  }, [placeId]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    const checked = checkMenuLinkInput(input);
    if (checked === null) {
      setError('Enter a full web address starting with http:// or https://');
      return;
    }
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const result = await setPlaceMenuLink(placeId, checked);
      setMessage(
        result === 'removed'
          ? 'Your link was removed.'
          : 'Link saved. It will be read at the crawler\'s next run, and dishes found are added to the menu.',
      );
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not save the link');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>🔗 Menu link</Text>
      {loading ? (
        <ActivityIndicator size="small" color="#1565C0" />
      ) : (
        <>
          {current ? (
            <>
              <Text style={styles.current} selectable numberOfLines={2}>{current.link}</Text>
              <Text style={styles.meta}>
                {describeLinkSource(current.source)}
                {describeLinkStatus(current.status) ? ` · ${describeLinkStatus(current.status)}` : ''}
              </Text>
              {!!current.detail && current.status !== 'done' && <Text style={styles.detail} numberOfLines={3}>{current.detail}</Text>}
              {adminLinkOnHold(current) && (
                <Text style={styles.detail}>
                  The owner saved their link after yours, so theirs is the one being read. Your link ({describeAdminLinkResult(current.admin_link_ok)}) is kept
                  and is suggested to the owner if theirs fails and yours worked. Save it again to use it.
                </Text>
              )}
              {current.source === 'admin' && current.admin_link_ok !== null && (
                <Text style={styles.meta}>Your link {describeAdminLinkResult(current.admin_link_ok)}.</Text>
              )}
            </>
          ) : (
            <Text style={styles.meta}>No menu link yet.</Text>
          )}

          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="https://… (leave blank and save to remove your link)"
            placeholderTextColor="#999"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!saving}
          />
          {!!error && <Text style={styles.error}>{error}</Text>}
          {!!message && <Text style={styles.ok}>{message}</Text>}
          <TouchableOpacity style={[styles.saveBtn, saving && styles.disabled]} onPress={save} disabled={saving} accessibilityRole="button">
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveText}>Save link</Text>}
          </TouchableOpacity>
          <Text style={styles.hint}>
            Whichever link was saved last is the one read. It will not work if the online menu is an image: use the photo upload below instead.
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e0e0e0', padding: 12, marginBottom: 12 },
  title: { fontSize: 14, fontWeight: '800', color: '#222', marginBottom: 6 },
  current: { fontSize: 12, color: '#1565C0' },
  meta: { fontSize: 11, color: '#777', marginTop: 2, marginBottom: 6 },
  detail: { fontSize: 11, color: '#E65100', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: '#222', marginTop: 4 },
  error: { fontSize: 12, color: '#c62828', marginTop: 6 },
  ok: { fontSize: 12, color: '#2E7D32', marginTop: 6 },
  saveBtn: { alignSelf: 'flex-start', marginTop: 8, backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  saveText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  hint: { fontSize: 11, color: '#888', marginTop: 8, lineHeight: 15 },
  disabled: { opacity: 0.5 },
});
