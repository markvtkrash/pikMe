import { useEffect, useState } from 'react';
import { ActivityIndicator, View, LogBox } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../src/api/supabase';
import { ErrorBoundary } from '../src/components/common/ErrorBoundary';
import { useRestaurantOwnerStore } from '../src/store/restaurantOwnerStore';
import { getRestaurantForOwner } from '../src/api/restaurantAuth';

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
  const storeOwner = useRestaurantOwnerStore((s) => s.owner);
  const setStoreOwner = useRestaurantOwnerStore((s) => s.setOwner);
  const setStoreRestaurant = useRestaurantOwnerStore((s) => s.setRestaurant);
  const setStoreSession = useRestaurantOwnerStore((s) => s.setSession);
  // Tracks whether a rehydration attempt has finished (success or failure) —
  // distinct from storeOwner being set, so a failed fetch doesn't leave the
  // gate below stuck showing a spinner forever.
  const [hydrationAttempted, setHydrationAttempted] = useState(false);

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

  // Rehydrate the Zustand store (owner/restaurant/session) whenever a valid
  // session is confirmed but the store is empty — that's the reload case:
  // Supabase's own session persists across a page refresh, but this store
  // doesn't, and it's only otherwise populated by the login form submission
  // itself. Without this, every restaurant/* screen's own "if (!owner ||
  // !restaurant) redirect to login" guard fires right after a valid reload.
  useEffect(() => {
    if (!session || !roleCheckComplete) return;
    if (!isRestaurantOwner || storeOwner) {
      // Nothing to hydrate (not an owner) or already hydrated (login form
      // already populated the store this session) — don't block on it.
      setHydrationAttempted(true);
      return;
    }

    (async () => {
      try {
        const { data: ownerRow, error: ownerError } = await supabase
          .from('restaurant_owners')
          .select('id, email, business_name')
          .eq('id', session.user.id)
          .single();
        if (ownerError || !ownerRow) {
          console.error('[AuthGate] Rehydration: failed to load owner profile:', ownerError);
          return;
        }
        setStoreOwner({ id: ownerRow.id, email: ownerRow.email, businessName: ownerRow.business_name });
        setStoreSession({ access_token: session.access_token, refresh_token: session.refresh_token });

        const restaurant = await getRestaurantForOwner();
        if (restaurant) setStoreRestaurant(restaurant);
      } catch (err) {
        console.error('[AuthGate] Rehydration failed:', err);
      } finally {
        setHydrationAttempted(true);
      }
    })();
  }, [session, isRestaurantOwner, roleCheckComplete, storeOwner]);

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
      // Only force an authenticated owner off the login/signup/change-
      // password pages once rehydration has actually confirmed a usable
      // owner in the store (storeOwner). Gating on isRestaurantOwner alone
      // caused a loop: if rehydration ever fails to populate storeOwner,
      // dashboard.tsx's own "if (!owner) redirect to login" guard would send
      // them back here, and this would immediately bounce them to the
      // dashboard again — forever. Requiring storeOwner breaks that cycle:
      // a failed hydration just leaves them on the current page instead of
      // fighting another redirect over it.
      if (!inRestaurant || (isRestaurantAuthPage && storeOwner)) {
        console.log('[AuthGate] Owner already authenticated, redirecting to /restaurant/dashboard');
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
  }, [session, isRestaurantOwner, roleCheckComplete, segments, storeOwner]);

  // Block on the initial session check, and — when signed in — on the
  // rehydration attempt above, so pages never render with a signed-in
  // session but an empty store (which would trip their own "no owner,
  // redirect to login" guards on a plain page reload).
  if (session === undefined || (session && !hydrationAttempted)) {
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
