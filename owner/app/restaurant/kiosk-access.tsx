import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Alert, confirmDialog } from '../../src/utils/alert';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { getKioskLink, regenerateKioskLink, KioskLink } from '../../src/api/kiosk';
import { EXPIRY_CHOICES, ExpiryChoiceKey, buildKioskUrl, describeLinkEnd, expiryFor } from '../../src/utils/kiosk';
import { kioskBaseUrl } from '../../src/utils/kioskBaseUrl';
import { QrCode } from '../../src/components/common/QrCode';
import { FavoriteHeart } from '../../src/components/common/FavoriteHeart';
import { useFavoritePages } from '../../src/hooks/useFavoritePages';

// Tools -> Order Station Link. The owner makes the secret link staff open on the restaurant's tablet, and scans or copies it there.
export default function KioskAccessScreen() {
  const router = useRouter();
  const restaurant = useRestaurantOwnerStore((s) => s.restaurant);
  const { favorites, toggleFavorite } = useFavoritePages();
  const [link, setLink] = useState<KioskLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<ExpiryChoiceKey>('tonight');

  const restaurantId = restaurant?.id;
  const load = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    try {
      setLink(await getKioskLink(restaurantId));
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'The link could not be loaded');
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!restaurant) return null;

  const baseUrl = kioskBaseUrl();
  const url = link && baseUrl ? buildKioskUrl(baseUrl, link.token) : null;
  const live = !!link && !link.expired;

  async function regenerate() {
    if (live) {
      const ok = await confirmDialog(
        'Replace the staff link?',
        'The current link stops working right away. The tablet will need the new link.',
        { confirmText: 'Replace link' }
      );
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      setLink(await regenerateKioskLink(restaurant!.id, expiryFor(choice, Date.now())));
    } catch (e: any) {
      setError(e?.message || 'The link could not be created');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    const ok = await Clipboard.setStringAsync(url).catch(() => false);
    Alert.alert(ok ? 'Link copied' : 'Could not copy', ok ? 'Paste it into the tablet\'s browser.' : 'Select the link and copy it by hand.');
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Order Station Link</Text>
        <FavoriteHeart active={favorites.has('tool-kiosk')} onPress={() => toggleFavorite('tool-kiosk')} size="large" />
      </View>
      <Text style={styles.subtitle}>{restaurant.name}</Text>
      <Text style={styles.intro}>
        Your staff open this link on a tablet or monitor in the restaurant to see new orders and mark them accepted, ready and picked
        up. They don't log in and can't reach anything else in your account.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {loading ? 'Checking…' : !link ? 'No link yet' : link.expired ? 'The link has ended' : 'Link is live'}
        </Text>
        {!!link && <Text style={styles.cardHint}>{describeLinkEnd(link.expiresAt, Date.now())}</Text>}

        {loading && <ActivityIndicator style={styles.spinner} color="#1565C0" />}

        {!!link && live && !baseUrl && (
          <Text style={styles.warn}>
            Open this page on the owner website to get the link and QR code (this app doesn't know the website's address).
          </Text>
        )}

        {!!url && live && (
          <>
            <Text selectable style={styles.url}>{url}</Text>
            <View style={styles.row}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={copy} accessibilityRole="button">
                <Text style={styles.secondaryText}>Copy link</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => Linking.openURL(url)} accessibilityRole="button">
                <Text style={styles.secondaryText}>Open it here</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.qrBox}>
              <QrCode value={url} size={220} />
              <Text style={styles.qrHint}>Scan this with the tablet's camera.</Text>
            </View>
          </>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{link ? 'Make a new link' : 'Make the link'}</Text>
        <Text style={styles.cardHint}>
          {link ? 'A new link replaces the old one at once.' : 'Choose how long it should work.'} Tonight ends at your restaurant's
          midnight, so you'd make a new one each morning; a longer one saves that.
        </Text>
        <View style={styles.chips}>
          {EXPIRY_CHOICES.map((c) => (
            <TouchableOpacity
              key={c.key}
              style={[styles.chip, choice === c.key && styles.chipOn]}
              onPress={() => setChoice(c.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: choice === c.key }}
            >
              <Text style={[styles.chipText, choice === c.key && styles.chipTextOn]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={[styles.primaryBtn, busy && styles.off]} onPress={regenerate} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{link ? 'Replace link' : 'Create link'}</Text>}
        </TouchableOpacity>
        {!!error && <Text style={styles.error}>{error}</Text>}
        {!!error && /ordering|timezone/i.test(error) && (
          <TouchableOpacity onPress={() => router.push('/restaurant/ordering' as any)} accessibilityRole="link">
            <Text style={styles.linkText}>Go to Online Ordering →</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Setting up the tablet</Text>
        <Text style={styles.step}>1. On the tablet, scan the QR code or paste the link into its browser.</Text>
        <Text style={styles.step}>
          2. Add it to the home screen (in the browser's share or menu button, choose "Add to Home Screen"). It then opens full screen
          with no address bar, so staff never see or copy the link.
        </Text>
        <Text style={styles.step}>3. Tap the bell bar once so the tablet plays a sound for each new order and stays awake.</Text>
        <Text style={styles.step}>
          4. If you opened the link while signed in here, the screen offers to sign you out of your owner account on that device. Say yes.
        </Text>
        <Text style={styles.note}>
          Anyone who has the link can see and update your orders until it ends, so don't share it. If it gets out, make a new one.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  content: { padding: 16, width: '100%', maxWidth: 640, alignSelf: 'center', paddingBottom: 40, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800', color: '#222' },
  subtitle: { fontSize: 14, color: '#546E7A', marginTop: -6 },
  intro: { fontSize: 14, color: '#37474F', lineHeight: 20 },
  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#CFD8DC', padding: 16, gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#222' },
  cardHint: { fontSize: 13, color: '#546E7A', lineHeight: 18 },
  spinner: { alignSelf: 'flex-start' },
  warn: { fontSize: 13, color: '#E65100', lineHeight: 18 },
  url: { fontSize: 12, color: '#1565C0', backgroundColor: '#E3F2FD', borderRadius: 8, padding: 10 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  secondaryBtn: { backgroundColor: '#ECEFF1', borderColor: '#1565C0', borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  secondaryText: { fontSize: 13, fontWeight: '800', color: '#1565C0' },
  qrBox: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  qrHint: { fontSize: 12, color: '#546E7A' },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#ECEFF1', borderWidth: 1.5, borderColor: '#B0BEC5' },
  chipOn: { backgroundColor: '#1565C0', borderColor: '#1565C0' },
  chipText: { fontSize: 13, fontWeight: '800', color: '#546E7A' },
  chipTextOn: { color: '#fff' },
  primaryBtn: { backgroundColor: '#2E7D32', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  off: { opacity: 0.6 },
  error: { fontSize: 13, color: '#c62828' },
  linkText: { fontSize: 13, fontWeight: '800', color: '#1565C0' },
  step: { fontSize: 13, color: '#37474F', lineHeight: 19 },
  note: { fontSize: 12, color: '#7A4A00', backgroundColor: '#FFF8E1', borderRadius: 8, padding: 10, lineHeight: 17 },
});
