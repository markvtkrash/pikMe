/**
 * PikMe Brand Theme
 * Based on BRAND-GUIDELINES.md
 */

export const BRAND_COLORS = {
  // Primary
  primary: '#2e7d32', // PikMe Green
  primaryDark: '#1b4d1b', // Dark Green
  primaryLight: '#E8F5E9', // Light Green

  // Accents
  accent: '#FF6B6B', // Heart Red
  success: '#4CAF50', // Check Green
  warning: '#e65100', // Orange
  error: '#c62828', // Red

  // Neutral
  text: {
    primary: '#1a1a1a', // Black
    secondary: '#333333', // Dark Gray
    tertiary: '#888888', // Medium Gray
  },

  background: {
    default: '#ffffff', // White
    surface: '#F9F9F9', // Light Gray
    overlay: '#f0f0f0', // Dividers
  },
};

export const BRAND_SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const BRAND_RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 50,
};

export const BRAND_SHADOWS = {
  subtle: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 1,
  },
  medium: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  elevated: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 5,
  },
};

export const BRAND_TYPOGRAPHY = {
  h1: {
    fontSize: 24,
    fontWeight: '800' as const,
    lineHeight: 28,
  },
  h2: {
    fontSize: 18,
    fontWeight: '700' as const,
    lineHeight: 22,
  },
  h3: {
    fontSize: 16,
    fontWeight: '700' as const,
    lineHeight: 20,
  },
  body: {
    fontSize: 15,
    fontWeight: '400' as const,
    lineHeight: 22,
  },
  small: {
    fontSize: 13,
    fontWeight: '500' as const,
    lineHeight: 18,
  },
  tiny: {
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
  },
};
