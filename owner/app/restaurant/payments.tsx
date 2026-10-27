import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Linking, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Alert } from '../../src/utils/alert';
import { useRestaurantOwnerStore } from '../../src/store/restaurantOwnerStore';
import { getPaymentStatus, refreshStripeStatus, startStripeOnboarding, PaymentStatus, StripeReport } from '../../src/api/payments';
import { FavoriteHeart } from '../../src/components/common/FavoriteHeart';
import { useFavoritePages } from '../../src/hooks/useFavoritePages';

// Tools -> Get Paid: connect the restaurant to its own Stripe account. Stripe collects the business and bank details on its own pages;
// the money from each order goes straight to the restaurant's account, and pikMe takes nothing from it.
export default function PaymentsScreen() {
  const restaurant = useRestaurantOwnerStore((s) => s.restaurant);
  const { favorites, toggleFavorite } = useFavoritePages();
  const params = useLocalSearchParams<{ return?: string; refresh?: string }>();
  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'start' | 'refresh' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<StripeReport | null>(null);

  const restaurantId = restaurant?.id;

  const load = useCallback(async (askStripe: boolean) => {
    if (!restaurantId) return;
    try {
      // coming back from Stripe: ask Stripe now rather than wait for its message to arrive
      let askError: string | null = null;
      if (askStripe) {
        try {
          setReport(await refreshStripeStatus(restaurantId));
        } catch (e: any) {
          // do not hide this: the page would otherwise show an old "incomplete" with no hint that the check itself failed
          askError = e?.message || 'Could not check with Stripe';
        }
      }
      setStatus(await getPaymentStatus(restaurantId));
      setError(askError);
    } catch (e: any) {
      setError(e?.message || 'The payment status could not be loaded');
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    load(params.return === '1' || params.refresh === '1');
  }, [load, params.return, params.refresh]);

  if (!restaurant) return null;

  function openStripe(url: string) {
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.href = url;
    else Linking.openURL(url);
  }

  async function connect() {
    setBusy('start');
    setError(null);
    try {
      openStripe(await startStripeOnboarding(restaurant!.id));
    } catch (e: any) {
      setError(e?.message || 'Could not start the Stripe setup');
    } finally {
      setBusy(null);
    }
  }

  async function check() {
    setBusy('refresh');
    setError(null);
    try {
      await load(true);
      Alert.alert('Checked with Stripe', 'This page now shows the latest from Stripe.');
    } finally {
      setBusy(null);
    }
  }

  const ready = !!status?.canTakePayments;
  const title = loading ? 'Checking…' : ready ? '🟢 Payments are connected' : status?.connected ? '🟠 Setup is not finished' : '⚪ Not connected yet';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Get Paid</Text>
        <FavoriteHeart active={favorites.has('tool-payments')} onPress={() => toggleFavorite('tool-payments')} size="large" />
      </View>
      <Text style={styles.subtitle}>{restaurant.name}</Text>
      <Text style={styles.intro}>
        Customers pay by card when they order. The money goes straight to your own Stripe account and then to your bank. pikMe does not
        take a cut of your orders, and you never share your bank details with pikMe: you enter them on Stripe's own pages.
      </Text>

      <View style={[styles.card, ready && styles.cardOn]}>
        <Text style={styles.cardTitle}>{title}</Text>
        {loading && <ActivityIndicator style={styles.spinner} color="#1565C0" />}

        {!loading && !!status && (
          <View style={styles.checks}>
            <Text style={[styles.check, status.connected ? styles.met : styles.missing]}>{status.connected ? '✓' : '○'} Stripe account created</Text>
            <Text style={[styles.check, status.detailsSubmitted ? styles.met : styles.missing]}>{status.detailsSubmitted ? '✓' : '○'} Business and bank details sent</Text>
            <Text style={[styles.check, status.canTakePayments ? styles.met : styles.missing]}>{status.canTakePayments ? '✓' : '○'} Stripe has approved you to take card payments</Text>
            <Text style={[styles.check, status.payoutsEnabled ? styles.met : styles.missing]}>{status.payoutsEnabled ? '✓' : '○'} Payouts to your bank are on</Text>
          </View>
        )}

        {!loading && !!report && (report.cardPaymentsStatus || report.cardPaymentsReasons.length > 0) && (
          <Text style={styles.small}>
            Stripe says: card payments are "{report.cardPaymentsStatus ?? 'unknown'}"
            {report.cardPaymentsReasons.length > 0 ? ` (${report.cardPaymentsReasons.join(', ')})` : ''}
            {report.payoutsStatus ? `; payouts "${report.payoutsStatus}"` : ''}.
          </Text>
        )}

        {!loading && !ready && (
          <Text style={styles.hint}>
            {status?.connected
              ? 'Stripe still needs something from you. Continue on Stripe to finish; it can take a few minutes to be approved afterwards.'
              : 'Set up takes a few minutes. You will need your business details and a bank account.'}
          </Text>
        )}

        {!ready && (
          <TouchableOpacity style={[styles.primaryBtn, busy === 'start' && styles.off]} disabled={!!busy} onPress={connect} accessibilityRole="button">
            {busy === 'start' ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{status?.connected ? 'Continue on Stripe' : 'Connect with Stripe'}</Text>}
          </TouchableOpacity>
        )}
        {!!status?.connected && (
          <TouchableOpacity style={[styles.secondaryBtn, busy === 'refresh' && styles.off]} disabled={!!busy} onPress={check} accessibilityRole="button">
            <Text style={styles.secondaryText}>I've finished: check again</Text>
          </TouchableOpacity>
        )}
        {!!error && <Text style={styles.error}>{error}</Text>}
      </View>

      {!!status?.required && !ready && !loading && (
        <Text style={styles.note}>You need to finish this before you can turn on online ordering.</Text>
      )}
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
  cardOn: { borderColor: '#2E7D32', backgroundColor: '#F1F8F2' },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#222' },
  spinner: { alignSelf: 'flex-start' },
  checks: { gap: 4 },
  check: { fontSize: 13, fontWeight: '700' },
  met: { color: '#2E7D32' },
  missing: { color: '#E65100' },
  hint: { fontSize: 13, color: '#546E7A', lineHeight: 18 },
  small: { fontSize: 12, color: '#78909C', lineHeight: 17 },
  primaryBtn: { backgroundColor: '#635BFF', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryBtn: { backgroundColor: '#ECEFF1', borderColor: '#1565C0', borderWidth: 1.5, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  secondaryText: { color: '#1565C0', fontSize: 14, fontWeight: '800' },
  off: { opacity: 0.6 },
  error: { fontSize: 13, color: '#c62828' },
  note: { fontSize: 13, color: '#7A4A00', backgroundColor: '#FFF8E1', borderRadius: 8, padding: 10, lineHeight: 18 },
});
