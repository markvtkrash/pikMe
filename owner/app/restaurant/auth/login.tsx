import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, Alert, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { loginRestaurantOwner, getRestaurantForOwner } from '../../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../../src/store/restaurantOwnerStore';
import { supabase } from '../../../src/api/supabase';
import { BRAND_NAME } from '../../../src/constants/brand';
import { IconText } from '../../../src/components/common/AppIcon';
import { useEnterChain } from '../../../src/hooks/useEnterChain';

export default function RestaurantLoginScreen() {
  const router = useRouter();
  const { setOwner, setRestaurant, setSession, setRestaurantError, setMustChangePassword } = useRestaurantOwnerStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const chain = useEnterChain(2, () => handleLogin());

  async function handleLogin() {
    setError('');

    if (!email.trim() || !password) {
      setError('Please enter email and password');
      return;
    }

    setLoading(true);
    try {
      // Login via edge function
      const result = await loginRestaurantOwner(email.trim(), password);

      console.log('[restaurant-login] Login result:', JSON.stringify(result, null, 2));
      console.log('[restaurant-login] Session object:', JSON.stringify(result.session, null, 2));
      console.log('[restaurant-login] Session access_token:', result.session?.access_token);

      // Set session in Supabase
      await supabase.auth.setSession(result.session);

      // Force password change on first login (admin-provisioned accounts)
      if (result.mustChangePassword) {
        // Flag first, so the route guard already knows when the owner appears in the store.
        setMustChangePassword(true);
        setOwner(result.user);
        setSession(result.session);
        router.replace('/restaurant/auth/change-password');
        return;
      }
      setMustChangePassword(false);

      // Look the restaurant up BEFORE storing the owner: storing the owner is
      // what lets the route guard move us to the dashboard, and doing it first
      // meant a failed lookup was hidden behind an empty dashboard.
      let restaurant = null;
      let lookupError: string | null = null;
      try {
        restaurant = await getRestaurantForOwner();
      } catch (lookupErr: any) {
        console.error('[restaurant-login] Restaurant lookup failed:', lookupErr);
        lookupError = lookupErr?.message || 'Could not load your restaurant';
      }

      setOwner(result.user);
      setSession(result.session);
      setRestaurantError(lookupError);
      console.log('[restaurant-login] Session set in store');

      if (restaurant) {
        setRestaurant(restaurant);
        router.replace('/restaurant/dashboard');
      } else if (lookupError) {
        // The lookup FAILED (not "no restaurant"): the dashboard shows the error and a retry.
        router.replace('/restaurant/dashboard');
      } else {
        // No restaurant claimed yet
        router.replace('/restaurant/claim');
      }
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.topLeftBar}>
        <Image source={require('../../../assets/logo.png')} style={styles.topLeftLogo} />
      </View>
      <ScrollView contentContainerStyle={styles.inner}>
        <Text style={styles.brand}>{BRAND_NAME}</Text>
        <IconText style={styles.title} emoji="🍽️">Restaurant Owner</IconText>
        <Text style={styles.subtitle}>Sign in to your account</Text>

        <TextInput {...chain(0)}
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#999"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={(t) => { setEmail(t); setError(''); }}
        />

        <TextInput {...chain(1)}
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#999"
          secureTextEntry
          value={password}
          onChangeText={(t) => { setPassword(t); setError(''); }}
        />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>Sign In</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.push('/restaurant/auth/signup')}
        >
          <Text style={styles.linkText}>Don't have an account? Sign up</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 40,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  topLeftBar: { paddingTop: 16, paddingLeft: 16 },
  topLeftLogo: { width: 32, height: 32, borderRadius: 16 },
  brand: { fontSize: 15, fontWeight: '700', color: '#1565C0', textAlign: 'center', marginBottom: 4, letterSpacing: 0.5 },
  title: { fontSize: 32, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 32 },
  input: { paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, marginBottom: 12, color: '#222', backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#B0BEC5', borderRadius: 8 },
  errorText: {
    color: '#e53e3e',
    fontSize: 14,
    marginBottom: 10,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#1565C0',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    minHeight: 48,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkText: { color: '#1565C0', fontSize: 14, textAlign: 'center', marginTop: 20, fontWeight: '600' },
});
