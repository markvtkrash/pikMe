import { useEffect, useState } from 'react';
import { ActivityIndicator, View, LogBox, Platform } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../src/api/supabase';
import { ErrorBoundary } from '../src/components/common/ErrorBoundary';
import { getSessionTimeoutMinutes } from '../src/constants/sessionTimeout';
import { loadAppConfig, isAppConfigLoaded } from '../src/constants/appConfig';
import { AlertModalHost } from '../src/components/common/AlertModalHost';
import { canShowAdminPage, resolveAdminRoute } from '../src/utils/adminRouting';

const IDLE_ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];

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

// This is the admin-only app — customer onboarding/profile logic and
// restaurant-owner logic now belong to the separate customer and owner apps.
function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [isAdmin, setIsAdmin] = useState(false);
  // the user id the admin check has finished for; the check counts as finished only for the session in hand, so a new sign-in is never
  // mistaken for an already-checked one
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const roleCheckComplete = !session || checkedFor === session.user.id;
  const [configLoaded, setConfigLoaded] = useState(isAppConfigLoaded());
  const router = useRouter();
  const segments = useSegments();

  // Load app config (DB or .env, per EXPO_PUBLIC_CONFIG_SOURCE) once at startup,
  // before anything else renders — every other tunable getter assumes this has
  // already resolved.
  useEffect(() => {
    if (isAppConfigLoaded()) return;
    loadAppConfig()
      .catch((err) => console.error('[AuthGate] loadAppConfig failed, falling back to .env defaults:', err))
      .finally(() => setConfigLoaded(true));
  }, []);

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
    });

    return () => subscription.unsubscribe();
  }, []);

  // Idle logout — resets on any mouse/keyboard/touch/scroll activity;
  // auto-signs-out after SESSION_TIMEOUT_MINUTES of none. Web only: a native
  // app isn't left open in a shared browser tab the same way, and there's no
  // single reliable cross-platform "user is idle" signal on native anyway.
  // Admin especially warrants this — higher-privilege session left open on
  // a shared/unattended machine is a bigger blast radius than a customer one.
  useEffect(() => {
    if (Platform.OS !== 'web' || !session || !configLoaded) return;

    let timer: ReturnType<typeof setTimeout>;
    function resetTimer() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        console.log('[AuthGate] Idle timeout reached, signing out');
        supabase.auth.signOut();
        router.replace('/admin/login');
      }, getSessionTimeoutMinutes() * 60 * 1000);
    }

    resetTimer();
    IDLE_ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, resetTimer));
    return () => {
      clearTimeout(timer);
      IDLE_ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [session, configLoaded]);

  // Check if the signed-in user is an admin
  useEffect(() => {
    if (!session) {
      setIsAdmin(false);
      setCheckedFor(null);
      return;
    }

    let cancelled = false;
    setCheckedFor(null);
    setIsAdmin(false);

    (async () => {
      try {
        const { data, error } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', session.user.id)
          .eq('role', 'admin');
        if (cancelled) return;
        if (error) {
          console.error('[AuthGate] Admin check error:', error);
          setIsAdmin(false);
        } else {
          setIsAdmin(!!data && data.length > 0);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('[AuthGate] Role check catch:', err);
        setIsAdmin(false);
      } finally {
        if (!cancelled) setCheckedFor(session.user.id);
      }
    })();

    return () => { cancelled = true; };
  }, [session]);

  // Routing guard — runs whenever session or role state or segment changes. Every admin page except the login page needs a signed-in admin
  // (the rules are in adminRouting.ts).
  useEffect(() => {
    if (session === undefined) return;
    const target = resolveAdminRoute({ hasSession: !!session, roleCheckComplete, isAdmin, segments: segments as string[] });
    if (target) {
      console.log('[AuthGate] redirecting to', target, '- segments:', segments, 'session:', !!session, 'isAdmin:', isAdmin);
      router.replace(target as any);
    }
  }, [session, isAdmin, roleCheckComplete, segments]);

  const allowed = canShowAdminPage({ hasSession: !!session, roleCheckComplete, isAdmin, segments: segments as string[] });

  if (!configLoaded || session === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  // The page stays mounted (the router needs it to be able to redirect) but is covered by a spinner until the visitor is allowed to see it:
  // a signed-out visitor, or someone whose admin check is still running, sees nothing of the page.
  return (
    <>
      {children}
      {!allowed && (
        <View
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}
          accessibilityLabel="Checking your sign-in"
        >
          <ActivityIndicator size="large" color="#1565C0" />
        </View>
      )}
    </>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <AuthGate>
          <Slot />
        </AuthGate>
        <AlertModalHost />
      </ErrorBoundary>
    </QueryClientProvider>
  );
}
