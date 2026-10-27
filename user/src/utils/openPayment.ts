import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

// Opens Stripe's secure payment page. On the web the whole page goes there and Stripe brings the person back to their order; in the
// phone app it opens in the in-app browser, and the order screen (which refreshes by itself) shows the payment once it is confirmed.
export async function openPaymentPage(url: string): Promise<void> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.location.assign(url);
    return;
  }
  await WebBrowser.openBrowserAsync(url);
}
