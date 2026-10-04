import { useEffect, useState } from 'react';
import { ActivityIndicator, View, Text, TouchableOpacity, StyleSheet, LogBox, Image, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as LocalAuthentication from 'expo-local-authentication';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../src/api/supabase';
import { getUserProfile, getSavedItems } from '../src/api/functions';
import { useUserProfileStore } from '../src/store/userProfileStore';
import { useSavedStore } from '../src/store/savedStore';
import { useFaceIdStore } from '../src/store/faceIdStore';
import { ErrorBoundary } from '../src/components/common/ErrorBoundary';
import { AlertModalHost } from '../src/components/common/AlertModalHost';
import { Alert } from '../src/utils/alert';
import { BRAND_NAME } from '../src/constants/brandTheme';

// Fully suppressed rather than just filtering specific messages — LogBox's
// raw red error box is a developer tool (it never ships in a production
// build), but anyone testing this app in dev mode saw it as a jarring,
// technical-looking error straight at the bottom of the screen. Genuine
// errors are still logged to the console for debugging and, for anything
// truly uncaught, surfaced gracefully via the global handler below instead.
LogBox.ignoreAllLogs(true);

// Catches whatever the React render-tree ErrorBoundary can't — async/promise
// failures and other errors outside of a component's render — and shows the
// same graceful modal instead of a raw red error screen or silent failure.
// Native crash reporting (ErrorUtils) still gets the real error for
// debugging; only what the user sees is softened.
function setUpGlobalErrorHandling() {
  function showGenericErrorModal() {
    Alert.alert('Something went wrong', 'An unexpected error happened. Please try again.');
  }

  if (Platform.OS === 'web') {
    window.addEventListener('error', (event) => {
      console.error('[PikMe] Uncaught error:', event.error ?? event.message);
      showGenericErrorModal();
    });
    window.addEventListener('unhandledrejection', (event) => {
      console.error('[PikMe] Unhandled promise rejection:', event.reason);
      showGenericErrorModal();
    });
  } else {
    const prevHandler = ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler((error, isFatal) => {
      console.error('[PikMe] Uncaught error:', error);
      showGenericErrorModal();
      prevHandler(error, isFatal);
    });
  }
}

setUpGlobalErrorHandling();

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
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: `Unlock ${BRAND_NAME}` });
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

    // A stored session can outlive its refresh token (e.g. left signed in
    // and unused long enough that GoTrue won't refresh it anymore) — every
    // authenticated request then fails with PGRST303 forever, not just
    // once. Treating that as "onboarding not complete" would silently
    // misroute an expired-but-real account into the onboarding flow instead
    // of back to sign-in, so this clears the dead session instead and lets
    // the routing guard below redirect to sign-in once session becomes null.
    function isExpiredJwtError(err: any) {
      return err?.code === 'PGRST303';
    }

    getUserProfile()
      .then((profile) => {
        console.log('[AuthGate] Profile loaded:', !!profile, 'onboardingComplete:', profile?.onboardingComplete);
        setOnboardingComplete(profile?.onboardingComplete ?? false);
      })
      .catch((err) => {
        console.error('[AuthGate] getUserProfile error:', err);
        if (isExpiredJwtError(err)) {
          console.log('[AuthGate] Session expired, signing out');
          supabase.auth.signOut();
          return;
        }
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
        if (isExpiredJwtError(err)) {
          console.log('[AuthGate] Session expired, signing out');
          supabase.auth.signOut();
          return;
        }
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
        <ActivityIndicator size="large" color="#1565C0" />
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
      <Text style={lockStyles.title}>{BRAND_NAME} is Locked</Text>
      <Text style={lockStyles.body}>Use Face ID to continue</Text>
      <TouchableOpacity style={lockStyles.button} onPress={onRetry}>
        <Text style={lockStyles.buttonText}>Unlock with Face ID</Text>
      </TouchableOpacity>
    </View>
  );
}

const lockStyles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#fff' },
  icon: { fontSize: 32, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '700', color: '#333', marginBottom: 8 },
  body: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 28 },
  button: { backgroundColor: '#1565C0', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});

// Pinned top-left on every screen in the app (loading, lock, sign-in,
// onboarding, main tabs, restaurant detail — everything), rendered once
// here instead of per-screen so there's no risk of a page missing it.
// pointerEvents="none" so it never intercepts taps on whatever's underneath.
// A handful of screens position their own content flush against the
// safe-area top (explore/saved/chat/help tabs, the map view) — those add
// their own small top clearance to stay clear of this badge; see each
// screen's own insets.top usage.
function FloatingLogo() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[floatingLogoStyles.container, { top: insets.top + 8 }]} pointerEvents="none">
      <Image source={require('../assets/logo.png')} style={floatingLogoStyles.logo} />
    </View>
  );
}

const floatingLogoStyles = StyleSheet.create({
  container: { position: 'absolute', left: 16, zIndex: 999 },
  logo: { width: 28, height: 28, borderRadius: 14 },
});

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <AuthGate>
            {/* Stack (not Slot) so the restaurant detail can present as a
                transparent modal over the screen that opened it, keeping
                Explore/Saved mounted underneath instead of replacing them. */}
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen
                name="restaurant/[id]"
                options={{ presentation: 'transparentModal', animation: 'fade' }}
              />
            </Stack>
          </AuthGate>
          <FloatingLogo />
          <AlertModalHost />
        </ErrorBoundary>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
