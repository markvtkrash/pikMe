import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { supabase } from '../../src/api/supabase';

// Logo pinned to the top-left on every screen that shows this, alongside
// the back button where there is one — headerLeft (not headerTitle) is what
// actually guarantees a left position, since headerTitle centers by default
// on iOS.
function BackButton() {
  const router = useRouter();
  return (
    <View style={styles.headerLeftRow}>
      <Image source={require('../../assets/logo.png')} style={styles.headerLogo} />
      <TouchableOpacity
        onPress={() => router.push('/admin')}
        style={styles.backBtn}
      >
        <Text style={styles.backBtnText}>← Dashboard</Text>
      </TouchableOpacity>
    </View>
  );
}

function LogoOnly() {
  return <Image source={require('../../assets/logo.png')} style={[styles.headerLogo, { marginLeft: 16 }]} />;
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
        headerLeft: () => <LogoOnly />,
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
        name="users"
        options={{
          title: '👥 All Users',
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
        name="restaurants"
        options={{
          title: '🍽️ Restaurants',
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
        name="tickets"
        options={{
          title: '🎫 Support Tickets',
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
        name="tickets/[id]"
        options={{
          title: 'Ticket Details',
          headerLeft: () => <BackButton />,
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
      <Stack.Screen
        name="config"
        options={{
          title: '⚙️ App Config',
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
    </Stack>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerLeftRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 16 },
  headerLogo: { width: 24, height: 24, borderRadius: 12 },
  backBtn: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 6 },
  backBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  logoutBtn: { marginRight: 16, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 6 },
  logoutText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
