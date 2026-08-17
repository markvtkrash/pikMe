import { useEffect, useState } from 'react';
import { ActivityIndicator, View, LogBox } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../src/api/supabase';
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

// This is the admin-only app — customer onboarding/profile logic and
// restaurant-owner logic now belong to the separate customer and owner apps.
function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [isAdmin, setIsAdmin] = useState(false);
  const [roleCheckComplete, setRoleCheckComplete] = useState(false);
  const router = useRouter();
  const segments = useSegments();

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

  // Check if the signed-in user is an admin
  useEffect(() => {
    if (!session) {
      setIsAdmin(false);
      setRoleCheckComplete(true);
      return;
    }

    setRoleCheckComplete(false);

    (async () => {
      try {
        const { data, error } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', session.user.id)
          .eq('role', 'admin');
        if (error) {
          console.error('[AuthGate] Admin check error:', error);
          setIsAdmin(false);
        } else {
          setIsAdmin(!!data && data.length > 0);
        }
      } catch (err) {
        console.error('[AuthGate] Role check catch:', err);
        setIsAdmin(false);
      } finally {
        setRoleCheckComplete(true);
      }
    })();
  }, [session]);

  // Routing guard — runs whenever session or role state or segment changes
  useEffect(() => {
    if (session === undefined) return;

    // Allow the bare root route to handle its own redirect
    if (segments[0] === undefined) {
      console.log('[AuthGate] On entry point page, skipping guards');
      return;
    }

    console.log('[AuthGate] segments:', segments, 'session:', !!session, 'isAdmin:', isAdmin);

    const isAdminPage = segments[0] === 'admin';

    if (!session && !isAdminPage) {
      console.log('[AuthGate] No session and not on an auth page, redirecting to admin login');
      router.replace('/admin/login');
      return;
    }

    // Role check is still in flight — wait rather than guessing.
    if (!roleCheckComplete) {
      console.log('[AuthGate] Role check still in flight, waiting...');
      return;
    }

    if (isAdmin) {
      if (!isAdminPage) {
        console.log('[AuthGate] Admin not on an admin page, redirecting to /admin/claims');
        router.replace('/admin/claims');
      }
      return;
    }

    // Signed in, but not an admin — this account has no business being in
    // this app (e.g. an owner/customer credential used by mistake).
    if (!isAdminPage) {
      console.log('[AuthGate] Session has no admin role, redirecting to admin login');
      router.replace('/admin/login');
    }
  }, [session, isAdmin, roleCheckComplete, segments]);

  if (session === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <AuthGate>
          <Slot />
        </AuthGate>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}
