import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { BrandBar } from '../../../src/components/common/BrandBar';
import { signUpRestaurantOwner, getRestaurantForOwner } from '../../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../../src/store/restaurantOwnerStore';
import { supabase } from '../../../src/api/supabase';
import { DataSourcesNotice } from '../../../src/components/common/DataSourcesNotice';
import { IconText } from '../../../src/components/common/AppIcon';
import { useEnterChain } from '../../../src/hooks/useEnterChain';
import { PasswordInput } from '../../../src/components/common/PasswordInput';

export default function RestaurantSignupScreen() {
  const router = useRouter();
  const { setOwner, setRestaurant, setSession, setRestaurantError, setMustChangePassword } = useRestaurantOwnerStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const chain = useEnterChain(3, () => handleSignup());

  async function handleSignup() {
    setError('');
    setSuccessMsg('');

    if (!email.trim() || !password || !businessName.trim()) {
      setError('Please fill in all fields');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      const result = await signUpRestaurantOwner(email.trim(), password, businessName.trim());

      // The project's Auth settings decide whether signUp() comes back with a
      // session (email confirmation off) or not (confirmation required). When
      // there's no session we genuinely can't sign the owner in yet, so fall
      // back to the old "check your email" message.
      if (!result.session) {
        setSuccessMsg(result.message || 'Account created! Check your email to confirm.');
        setTimeout(() => {
          router.push('/restaurant/auth/login');
        }, 2000);
        return;
      }

      // From here on, mirror exactly what a normal login does, so a fresh
      // signup lands wherever signing in would have taken this owner.
      await supabase.auth.setSession(result.session);
      setMustChangePassword(false);

      let restaurant = null;
      let lookupError: string | null = null;
      try {
        restaurant = await getRestaurantForOwner();
      } catch (lookupErr: any) {
        lookupError = lookupErr?.message || 'Could not load your restaurant';
      }

      setOwner(result.user);
      setSession(result.session);
      setRestaurantError(lookupError);

      if (restaurant) {
        setRestaurant(restaurant);
        router.replace('/restaurant/dashboard');
      } else if (lookupError) {
        router.replace('/restaurant/dashboard');
      } else {
        // Brand new owner, nothing claimed yet — same place login sends them.
        router.replace('/restaurant/claim');
      }
    } catch (err: any) {
      setError(err.message || 'Signup failed');
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
        <BrandBar />
      </View>
      <ScrollView contentContainerStyle={styles.inner}>
        <IconText style={styles.title} emoji="🍽️">Restaurant Owner</IconText>
        <Text style={styles.subtitle}>Create your account</Text>

        <TextInput {...chain(0)}
          style={styles.input}
          placeholder="Business Name"
          placeholderTextColor="#999"
          value={businessName}
          onChangeText={(t) => { setBusinessName(t); setError(''); }}
        />

        <TextInput {...chain(1)}
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#999"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={(t) => { setEmail(t); setError(''); }}
        />

        <PasswordInput {...chain(2)}
          style={styles.input}
          placeholder="Password (min 8 characters)"
          placeholderTextColor="#999"
          value={password}
          onChangeText={(t) => { setPassword(t); setError(''); }}
        />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {successMsg ? <Text style={styles.successText}>{successMsg}</Text> : null}

        <DataSourcesNotice />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignup}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>Create Account</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.push('/restaurant/auth/login')}
        >
          <Text style={styles.linkText}>Already have an account? Sign in</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  topLeftBar: { paddingTop: 16, paddingLeft: 16 },
  topLeftLogo: { width: 32, height: 32, borderRadius: 16 },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 40,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  title: { fontSize: 32, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 32 },
  input: { paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, marginBottom: 12, color: '#222', backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#B0BEC5', borderRadius: 8 },
  errorText: {
    color: '#e53e3e',
    fontSize: 14,
    marginBottom: 10,
    textAlign: 'center',
  },
  successText: {
    color: '#1565C0',
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
