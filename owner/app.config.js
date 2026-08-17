export default {
  expo: {
    name: 'PikMe Owner',
    slug: 'pikme-owner',
    owner: 'venky735',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    scheme: 'pikmeowner',
    userInterfaceStyle: 'light',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      bundleIdentifier: 'com.pikme.owner',
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
    plugins: [
      'expo-router',
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'PikMe Owner uses your location to find your restaurant among nearby search results when you claim it.',
        },
      ],
    ],
    extra: {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
      ownerSearchRadiusMeters: process.env.EXPO_PUBLIC_OWNER_SEARCH_RADIUS_METERS,
      eas: {
        // TODO: this projectId is inherited from the original combined app.
        // Point this at a dedicated EAS project before the first real build
        // of the standalone owner/admin app.
        projectId: '5a1bbf4f-cdd8-4475-8651-278984841323',
      },
    },
  },
};
