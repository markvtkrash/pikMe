const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Suppress harmless deprecation warnings
if (!console.__originalWarn) {
  console.__originalWarn = console.warn;
}

console.warn = (...args) => {
  const message = String(args[0] || '');

  // Suppress shadow props deprecation warning
  if (message.includes('shadow') || message.includes('boxShadow')) {
    return;
  }

  // Suppress pointerEvents deprecation
  if (message.includes('pointerEvents')) {
    return;
  }

  // Suppress useNativeDriver warning (Reanimated handles this internally)
  if (message.includes('useNativeDriver') || message.includes('RCTAnimation')) {
    return;
  }

  console.__originalWarn(...args);
};

module.exports = config;
