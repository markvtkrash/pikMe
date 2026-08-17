import Constants from 'expo-constants';

// Fetch/cache is always done at the max radius once; the options below are a
// pure client-side filter on that already-fetched data, not separate fetches.
export const RADIUS_OPTIONS_KM = [2, 3, 4, 5];
export const MAX_FETCH_RADIUS_METERS = Math.max(...RADIUS_OPTIONS_KM) * 1000;

// Distance used by the restaurant-owner claim screen when searching by zip
// code or current location — independent of the customer-facing picker
// above. Configurable via EXPO_PUBLIC_OWNER_SEARCH_RADIUS_METERS; defaults
// to 5km if that env var is unset or invalid.
export const OWNER_SEARCH_RADIUS_METERS =
  Number(Constants.expoConfig?.extra?.ownerSearchRadiusMeters) || 5000;
