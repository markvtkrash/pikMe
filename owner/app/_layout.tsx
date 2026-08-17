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

// This is the owner-only app — customer onboarding/profile logic and admin
// logic now belong to the separate customer and admin apps.
function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [isRestaurantOwner, setIsRestaurantOwner] = useState(false);
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

  // Check if the signed-in user is a restaurant owner
  useEffect(() => {
    if (!session) {
      setIsRestaurantOwner(false);
      setRoleCheckComplete(true);
      return;
    }

    setRoleCheckComplete(false);

    (async () => {
      try {
        const { data, error } = await supabase
          .from('restaurant_owners')
          .select('id')
          .eq('id', session.user.id);
        if (error) {
          console.log('[AuthGate] Restaurant owner check error:', error.message);
          setIsRestaurantOwner(false);
        } else {
          setIsRestaurantOwner(!!data && data.length > 0);
        }
      } catch (err) {
        console.error('[AuthGate] Role check catch:', err);
        setIsRestaurantOwner(false);
      } finally {
        setRoleCheckComplete(true);
      }
    })();
  }, [session]);

  // Routing guard — runs whenever session or role state or segment changes
  useEffect(() => {
    if (session === undefined) return;

    // Allow entry point pages (and the bare root route) to handle their own redirects
    const isEntryPoint = segments[0] === 'owner' || segments[0] === undefined;
    if (isEntryPoint) {
      console.log('[AuthGate] On entry point page, skipping guards');
      return;
    }

    console.log('[AuthGate] segments:', segments, 'session:', !!session, 'isRestaurantOwner:', isRestaurantOwner);

    const segmentList: string[] = segments;
    const isRestaurantAuthPage = segmentList[0] === 'restaurant' && segmentList[1] === 'auth';

    if (!session && !isRestaurantAuthPage) {
      console.log('[AuthGate] No session and not on an auth page, redirecting to owner login');
      router.replace('/restaurant/auth/login');
      return;
    }

    // Role check is still in flight — wait rather than guessing.
    if (!roleCheckComplete) {
      console.log('[AuthGate] Role check still in flight, waiting...');
      return;
    }

    if (isRestaurantOwner) {
      const inRestaurant = segments[0] === 'restaurant';
      if (!inRestaurant) {
        console.log('[AuthGate] Owner not in restaurant section, redirecting to /restaurant/dashboard');
        router.replace('/restaurant/dashboard');
      }
      return;
    }

    // Signed in, but not an owner — this account has no business being in
    // this app (e.g. a customer/admin credential used by mistake). There's
    // no other flow to fall back to here, so send them back to the owner
    // login rather than showing a stranded blank screen.
    if (!isRestaurantAuthPage) {
      console.log('[AuthGate] Session has no owner role, redirecting to owner login');
      router.replace('/restaurant/auth/login');
    }
  }, [session, isRestaurantOwner, roleCheckComplete, segments]);

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
