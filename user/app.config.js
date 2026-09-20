// Expo's config loader can't resolve TS imports, so this is duplicated from
// (and must stay in sync with) BRAND_NAME in src/constants/brandTheme.ts —
// that file is the source of truth for every other UI string in this app.
const BRAND_NAME = 'CraveID';

export default {
  expo: {
    name: BRAND_NAME,
    slug: 'pikme',
    owner: 'venky735',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    scheme: 'pikme',
    userInterfaceStyle: 'light',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      bundleIdentifier: 'com.pikme.app',
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
    },
    plugins: [
      'expo-router',
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            `${BRAND_NAME} uses your location to find restaurants near you and tailor food recommendations.`,
        },
      ],
      [
        'expo-local-authentication',
        {
          faceIDPermission: `${BRAND_NAME} uses Face ID to keep your account secure and locked between sessions.`,
        },
      ],
    ],
    extra: {
      // Owner-only settings (e.g. ownerSearchRadiusMeters) intentionally
      // dropped here — this app has no owner/admin surface anymore.
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
      eas: {
        // TODO: this projectId is inherited from the original combined app.
        // Point this at a dedicated EAS project before the first real build
        // of the standalone customer app.
        projectId: '5a1bbf4f-cdd8-4475-8651-278984841323',
      },
    },
  },
};
