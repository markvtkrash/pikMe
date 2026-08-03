import { useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useRestaurantOwnerStore } from '../../../src/store/restaurantOwnerStore';

export default function RestaurantTabScreen() {
  const router = useRouter();
  const { owner, loading } = useRestaurantOwnerStore();

  // If owner is set, redirect to dashboard
  useEffect(() => {
    if (owner) {
      router.replace('/restaurant/dashboard');
    }
  }, [owner]);

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  // No owner logged in
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.icon}>🍽️</Text>
        <Text style={styles.title}>Restaurant Owner</Text>
        <Text style={styles.subtitle}>Manage your restaurant coupons and promotions</Text>

        <View style={styles.buttonGroup}>
          <TouchableOpacity
            style={styles.loginBtn}
            onPress={() => router.push('/restaurant/auth/login')}
          >
            <Text style={styles.loginBtnText}>Sign In</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.signupBtn}
            onPress={() => router.push('/restaurant/auth/signup')}
          >
            <Text style={styles.signupBtnText}>Create Account</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.description}>
          Own a restaurant? Sign in to create and manage promotional coupons for your customers.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 100,
  },
  icon: { fontSize: 72, marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '800', color: '#222', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 32 },
  buttonGroup: { width: '100%', gap: 12, marginBottom: 32 },
  loginBtn: {
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  loginBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  signupBtn: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#4CAF50',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  signupBtnText: { color: '#4CAF50', fontSize: 16, fontWeight: '600' },
  description: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
  },
});
