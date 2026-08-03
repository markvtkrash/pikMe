import { useEffect, useState } from 'react';
import { ActivityIndicator, View, LogBox } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../src/api/supabase';
import { getUserProfile, getSavedItems } from '../src/api/functions';
import { useUserProfileStore } from '../src/store/userProfileStore';
import { useSavedStore } from '../src/store/savedStore';
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

function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [isRestaurantOwner, setIsRestaurantOwner] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const { onboardingComplete, setOnboardingComplete } = useUserProfileStore();
  const setSavedAll = useSavedStore((s) => s.setAll);
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
      if (!newSession) setOnboardingComplete(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Check if user is restaurant owner or admin
  useEffect(() => {
    if (!session) {
      setIsRestaurantOwner(false);
      setIsAdmin(false);
      return;
    }

    // Check if restaurant owner
    supabase
      .from('restaurant_owners')
      .select('id')
      .eq('id', session.user.id)
      .then(({ data, error }) => {
        if (error) {
          console.log('[AuthGate] Restaurant owner check error (expected for customers):', error.message);
          setIsRestaurantOwner(false);
        } else {
          setIsRestaurantOwner(!!data && data.length > 0);
        }
      })
      .catch((err) => {
        console.log('[AuthGate] Restaurant owner check catch:', err);
        setIsRestaurantOwner(false);
      });

    // Check if admin
    supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', session.user.id)
      .eq('role', 'admin')
      .then(({ data, error }) => {
        if (error) {
          console.error('[auth] Admin check error:', error);
          setIsAdmin(false);
        } else {
          setIsAdmin(data && data.length > 0);
        }
      })
      .catch((err) => {
        console.error('[auth] Admin check catch:', err);
        setIsAdmin(false);
      });
  }, [session]);

  // Fetch profile + saved items once per session (customer only)
  useEffect(() => {
    if (!session || isRestaurantOwner) return;
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
        // Silently fail for restaurant owners or if RLS denies access
        if (err?.code === '42703' || err?.code === '42501' || err?.message?.includes('permission')) {
          console.log('[AuthGate] getSavedItems skipped (likely restaurant owner or RLS)');
        } else {
          console.error('[AuthGate] getSavedItems error:', err);
        }
        // fail silently — saved state stays empty
      });
  }, [session, isRestaurantOwner]);

  // Routing guard — runs whenever session or onboarding state or segment changes
  useEffect(() => {
    if (session === undefined) return;

    // Allow entry point pages to handle their own redirects
    const isEntryPoint = segments[0] === 'user' || segments[0] === 'owner';
    if (isEntryPoint) {
      console.log('[AuthGate] On entry point page, skipping guards');
      return;
    }

    console.log('[AuthGate] segments:', segments, 'session:', !!session, 'isRestaurantOwner:', isRestaurantOwner, 'isAdmin:', isAdmin);

    // Allow unauthenticated access to auth pages
    // Check if any segment is 'sign-in' or 'sign-up' (route groups like (auth) can be first)
    const isCustomerAuthPage = segments.includes('sign-in') || segments.includes('sign-up');
    const isRestaurantAuthPage = segments[0] === 'restaurant' && segments[1] === 'auth';
    const isAdminPage = segments[0] === 'admin';

    console.log('[AuthGate] isCustomerAuthPage:', isCustomerAuthPage, 'isRestaurantAuthPage:', isRestaurantAuthPage, 'isAdminPage:', isAdminPage);

    if (!session && !isCustomerAuthPage && !isRestaurantAuthPage && !isAdminPage) {
      console.log('[AuthGate] No session and not on auth page, redirecting to /(auth)/sign-in');
      router.replace('/(auth)/sign-in');
      return;
    }

    // Admins go to admin dashboard
    if (isAdmin) {
      const inAdmin = segments[0] === 'admin';
      if (!inAdmin) {
        router.replace('/admin/claims');
      }
      return;
    }

    // Restaurant owners skip customer onboarding
    if (isRestaurantOwner) {
      const inRestaurant = segments[0] === 'restaurant';
      console.log('[AuthGate] User is restaurant owner, inRestaurant:', inRestaurant);
      if (!inRestaurant) {
        console.log('[AuthGate] Restaurant owner not in restaurant section, redirecting to /restaurant/dashboard');
        router.replace('/restaurant/dashboard');
      }
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
  }, [session, onboardingComplete, isRestaurantOwner, isAdmin, segments]);

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
