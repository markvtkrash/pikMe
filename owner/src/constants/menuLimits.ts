import Constants from 'expo-constants';

// Edit Menu's "+ Add another item" cap — a plain client-side safety limit,
// not a database constraint. Configurable via EXPO_PUBLIC_MAX_MANUAL_MENU_ITEMS;
// defaults to 100 if that env var is unset or invalid.
export const MAX_MANUAL_MENU_ITEMS =
  Number(Constants.expoConfig?.extra?.maxManualMenuItems) || 100;
