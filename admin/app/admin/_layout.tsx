import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { supabase } from '../../src/api/supabase';

function BackButton() {
  const router = useRouter();
  return (
    <TouchableOpacity
      onPress={() => router.push('/admin')}
      style={styles.backBtn}
    >
      <Text style={styles.backBtnText}>← Dashboard</Text>
    </TouchableOpacity>
  );
}

export default function AdminLayout() {
  const router = useRouter();

  // Don't enforce admin check here - let individual screens handle auth
  // Login screen doesn't require auth, but dashboard/claims do

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: '#1565C0' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '800', fontSize: 18 },
      }}
    >
      <Stack.Screen
        name="login"
        options={{
          title: 'Admin Login',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="index"
        options={{
          title: 'Admin Dashboard',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="coupons"
        options={{
          title: '🎟️ Coupon Management',
          headerLeft: () => <BackButton />,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => supabase.auth.signOut().then(() => router.replace('/admin/login'))}
              style={styles.logoutBtn}
            >
              <Text style={styles.logoutText}>Logout</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <Stack.Screen
        name="claims"
        options={{
          title: 'Pending Claims',
          headerLeft: () => <BackButton />,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => supabase.auth.signOut().then(() => router.replace('/admin/login'))}
              style={styles.logoutBtn}
            >
              <Text style={styles.logoutText}>Logout</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <Stack.Screen
        name="create-owner"
        options={{
          title: '➕ Create Owner',
          headerLeft: () => <BackButton />,
        }}
      />
    </Stack>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  backBtn: { marginLeft: 16, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 6 },
  backBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  logoutBtn: { marginRight: 16, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 6 },
  logoutText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
