// Expo's config loader can't resolve TS imports, so this is duplicated from
// (and must stay in sync with) BRAND_NAME in src/constants/brand.ts — that
// file is the source of truth for every other UI string in this app.
const BRAND_NAME = 'Vectr Vibe';

export default {
  expo: {
    name: `${BRAND_NAME} Admin`,
    slug: 'pikme-admin',
    owner: 'venky735',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    scheme: 'pikmeadmin',
    userInterfaceStyle: 'light',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      bundleIdentifier: 'com.pikme.admin',
      buildNumber: '1',
      supportsTablet: true,
      config: {
        usesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
    },
    web: {
      favicon: './assets/favicon.png',
      output: 'single',
    },
    plugins: ['expo-router'],
    extra: {
      // googleMapsApiKey intentionally dropped here — this app has no map
      // surface. ownerSearchRadiusMeters IS wired below: the Create Owner
      // screen searches nearby restaurants the same way the owner app's
      // claim/relocate flows do, and shares that DB key/env var with them.
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      ownerSearchRadiusMeters: process.env.EXPO_PUBLIC_OWNER_SEARCH_RADIUS_METERS,
      sessionTimeoutMinutes: process.env.EXPO_PUBLIC_SESSION_TIMEOUT_MINUTES,
      eas: {
        // TODO: this projectId is inherited from the original combined app.
        // Point this at a dedicated EAS project before the first real build
        // of the standalone admin app.
        projectId: '5a1bbf4f-cdd8-4475-8651-278984841323',
      },
    },
  },
};
