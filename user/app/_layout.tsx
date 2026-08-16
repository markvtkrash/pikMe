import { useEffect, useState } from 'react';
import { ActivityIndicator, View, Text, TouchableOpacity, StyleSheet, LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as LocalAuthentication from 'expo-local-authentication';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../src/api/supabase';
import { getUserProfile, getSavedItems } from '../src/api/functions';
import { useUserProfileStore } from '../src/store/userProfileStore';
import { useSavedStore } from '../src/store/savedStore';
import { useFaceIdStore } from '../src/store/faceIdStore';
import { ErrorBoundary } from '../src/components/common/ErrorBoundary';

// Suppress harmless deprecation warnings
LogBox.ignoreLogs([
  'shadow', // Shadow props deprecation (works fine with elevation)
  'boxShadow', // Shadow alternative
  'pointerEvents', // Deprecated prop (works fine)
  'useNativeDriver', // Reanimated falls back to JS animation (works fine)
  'RCTAnimation', // Native animation module warning
]);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 2,
    },
  },
});

// This is the customer-only app — restaurant-owner and admin role checks
// that used to live here now belong to the separate adminowner app.
function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const { onboardingComplete, setOnboardingComplete } = useUserProfileStore();
  const setSavedAll = useSavedStore((s) => s.setAll);
  const requireFaceIdPref = useFaceIdStore((s) => s.requireFaceId);
  const [faceIdStatus, setFaceIdStatus] = useState<'checking' | 'locked' | 'unlocked' | 'skip'>('checking');
  const router = useRouter();
  const segments = useSegments();
  const hasSession = !!session;

  // Face ID gate — evaluated once per sign-in (not on every token refresh,
  // hence keying off the boolean hasSession rather than the session object
  // itself, and not re-running mid-session if the user flips the Profile
  // toggle — that should only take effect on the next app launch).
  useEffect(() => {
    if (!hasSession) {
      setFaceIdStatus('skip');
      return;
    }
    let cancelled = false;
    (async () => {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      const wantsFaceId = requireFaceIdPref ?? true;
      if (cancelled) return;
      setFaceIdStatus(hasHardware && isEnrolled && wantsFaceId ? 'locked' : 'skip');
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSession]);

  async function unlockWithFaceId() {
    try {
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock PikMe' });
      if (result.success) setFaceIdStatus('unlocked');
    } catch (err) {
      console.error('[AuthGate] Face ID authentication error:', err);
    }
  }

  useEffect(() => {
    if (faceIdStatus === 'locked') unlockWithFaceId();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceIdStatus]);

  // Auth subscription
  useEffect(() => {
    console.log('[AuthGate] Setting up auth subscription');
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('[AuthGate] Initial session from getSession:', !!session, session?.user?.email);
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      console.log('[AuthGate] onAuthStateChange event:', _event, '- session:', !!newSession, newSession?.user?.email);
      setSession(newSession);
      if (!newSession) setOnboardingComplete(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch profile + saved items once per session
  useEffect(() => {
    if (!session) return;
    if (onboardingComplete !== null) return;

    console.log('[AuthGate] Loading customer profile and saved items...');

    getUserProfile()
      .then((profile) => {
        console.log('[AuthGate] Profile loaded:', !!profile, 'onboardingComplete:', profile?.onboardingComplete);
        setOnboardingComplete(profile?.onboardingComplete ?? false);
      })
      .catch((err) => {
        console.error('[AuthGate] getUserProfile error:', err);
        console.log('[AuthGate] Setting onboarding to false due to error');
        setOnboardingComplete(false);
      });

    getSavedItems()
      .then((data) => {
        console.log('[AuthGate] Saved items loaded:', { restaurants: data.restaurants.length, menuItems: data.menuItems.length });
        setSavedAll(data.restaurants, data.menuItems);
      })
      .catch((err: any) => {
        console.error('[AuthGate] getSavedItems error:', err);
        // fail silently — saved state stays empty
      });
  }, [session]);

  // Routing guard — runs whenever session or onboarding state or segment changes
  useEffect(() => {
    if (session === undefined) return;

    console.log('[AuthGate] segments:', segments, 'session:', !!session);

    // Allow unauthenticated access to auth pages
    const isCustomerAuthPage = segments.includes('sign-in') || segments.includes('sign-up');

    if (!session && !isCustomerAuthPage) {
      console.log('[AuthGate] No session and not on auth page, redirecting to /(auth)/sign-in');
      router.replace('/(auth)/sign-in');
      return;
    }

    if (onboardingComplete === null) {
      console.log('[AuthGate] onboardingComplete is null, waiting for profile to load...');
      return; // profile still loading
    }

    console.log('[AuthGate] onboardingComplete:', onboardingComplete, 'segments:', segments);

    // Any screen in the (onboarding) group counts as onboarding — otherwise the
    // AuthGate bounces the user back to welcome the moment they advance a step.
    const inOnboarding = segments.includes('(onboarding)');
    const inAuth = segments.includes('sign-in') || segments.includes('sign-up');

    console.log('[AuthGate] Routing decision - inOnboarding:', inOnboarding, 'inAuth:', inAuth);

    if (!onboardingComplete && !inOnboarding) {
      console.log('[AuthGate] Not onboarded and not on onboarding page, redirecting to welcome');
      router.replace('/(onboarding)/welcome');
    } else if (onboardingComplete && (inOnboarding || inAuth)) {
      console.log('[AuthGate] Onboarded but on onboarding/auth page, redirecting to tabs');
      router.replace('/(main)/(tabs)');
    } else if (onboardingComplete && !inOnboarding && !inAuth) {
      console.log('[AuthGate] Onboarded and on correct page, no redirect needed');
    } else if (!onboardingComplete && inOnboarding) {
      console.log('[AuthGate] Not onboarded but on onboarding page, no redirect needed');
    } else {
      console.log('[AuthGate] No routing action taken. State:', { onboardingComplete, inOnboarding, inAuth, currentRoute: segments[0] });
    }
  }, [session, onboardingComplete, segments]);

  if (session === undefined || (hasSession && faceIdStatus === 'checking')) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  if (hasSession && faceIdStatus === 'locked') {
    return <FaceIdLockScreen onRetry={unlockWithFaceId} />;
  }

  return <>{children}</>;
}

function FaceIdLockScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={lockStyles.container}>
      <Text style={lockStyles.icon}>🔒</Text>
      <Text style={lockStyles.title}>PikMe is Locked</Text>
      <Text style={lockStyles.body}>Use Face ID to continue</Text>
      <TouchableOpacity style={lockStyles.button} onPress={onRetry}>
        <Text style={lockStyles.buttonText}>Unlock with Face ID</Text>
      </TouchableOpacity>
    </View>
  );
}

const lockStyles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#fff' },
  icon: { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '700', color: '#333', marginBottom: 8 },
  body: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 28 },
  button: { backgroundColor: '#4CAF50', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <AuthGate>
            <Slot />
          </AuthGate>
        </ErrorBoundary>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
