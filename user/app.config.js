// Expo's config loader can't resolve TS imports, so this is duplicated from
// (and must stay in sync with) BRAND_NAME in src/constants/brandTheme.ts —
// that file is the source of truth for every other UI string in this app.
const BRAND_NAME = 'VectraVibe';

export default {
  expo: {
    name: BRAND_NAME,
    slug: 'pikme',
    owner: 'venky735',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    scheme: 'pikme',
    userInterfaceStyle: 'automatic',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    assetBundlePatterns: ['**/*'],
    // Over-the-air updates (expo-updates): a JavaScript-only fix can reach phones without a store release, as long as the
    // phone's native build has the same runtime version (here: the same app version). Publish with
    // `eas update --channel production`; a store build is only needed when native code or the app version changes.
    // The app checks for an update each time it starts and applies it the next time it opens.
    runtimeVersion: { policy: 'appVersion' },
    updates: {
      url: 'https://u.expo.dev/5a1bbf4f-cdd8-4475-8651-278984841323',
      fallbackToCacheTimeout: 0,
      checkAutomatically: 'ON_LOAD',
    },
    ios: {
      bundleIdentifier: 'com.pikme.app',
      buildNumber: '1',
      supportsTablet: true,
      config: {
        usesNonExemptEncryption: false,
      },
      // ITMS-90683: the app has no photo-library feature itself, but a bundled native module
      // statically links a Photos API symbol Apple's binary scanner flags regardless of whether
      // it's actually called. Apple requires this string to exist even then.
      infoPlist: {
        NSPhotoLibraryUsageDescription: `${BRAND_NAME} may use your photo library if you choose to save or share an image from the app.`,
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
      // Voice search in the Explore search box. The phone's speech recognizer turns what is said into text; the text is only used as the search words.
      // (Apple's speech recognition may process the audio on Apple's servers.) A new native build is needed for this.
      [
        'expo-speech-recognition',
        {
          microphonePermission: `${BRAND_NAME} uses the microphone so you can say what restaurant or food you are looking for.`,
          speechRecognitionPermission: `${BRAND_NAME} uses speech recognition to turn what you say into a restaurant search. Nothing is recorded or kept by ${BRAND_NAME}.`,
        },
      ],
    ],
    extra: {
      // Owner-only settings (e.g. ownerSearchRadiusMeters) intentionally
      // dropped here — this app has no owner/admin surface anymore.
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      eas: {
        // TODO: this projectId is inherited from the original combined app.
        // Point this at a dedicated EAS project before the first real build
        // of the standalone customer app.
        projectId: '5a1bbf4f-cdd8-4475-8651-278984841323',
      },
    },
  },
};
