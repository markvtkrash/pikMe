import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, useWindowDimensions, Platform, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';

interface Tip {
  icon: string;
  title: string;
  body: string;
  href: string;
}

// Real, bundled food/restaurant photos — same placeholder set used elsewhere
// in this app — cycled independently of the tip rotation for visual variety
// underneath each tip card.
const FOOD_IMAGES = [
  require('../../../assets/placeholders/food-1.jpg'),
  require('../../../assets/placeholders/restaurant-1.jpg'),
  require('../../../assets/placeholders/restaurant-2.jpg'),
];

// One flat rotating list — left and right panels show two different tips at
// once (offset by half the list) so the two sides aren't just mirrors of
// each other. Each is tappable — takes the owner straight to that feature.
const TIPS: Tip[] = [
  { icon: '🤖', title: 'AI Assisted Menu Pull', body: "Automatically finds real items from your website when you've set one on your Profile — falls back to an AI guess only when it can't.", href: '/restaurant/menu-items' },
  { icon: '✍️', title: 'Manual Entry', body: 'No website? Type your real dish names directly — we only estimate nutrition, never invent the dish itself.', href: '/restaurant/manual-menu' },
  { icon: '📷', title: 'Add Menu Items Using a Photo', body: 'Snap a photo of your printed menu and we read the real dish names straight from it — adds to your menu without replacing anything.', href: '/restaurant/menu-photo' },
  { icon: '📋', title: 'Add Menu Items From Text', body: 'Paste menu text copied from a PDF, email, or site — one dish per line works great, even a single short name.', href: '/restaurant/menu-text' },
  { icon: '✓', title: 'Verify Items', body: "Tapping Verify opens an editable popup so you can fix a slightly-wrong AI-guessed name at the same time you confirm it's real.", href: '/restaurant/menu-items' },
  { icon: '🎟️', title: 'Manage Coupons', body: 'Filter by Active, Inactive, Expired, or Orphaned — select more than one checkbox at once to see them together.', href: '/restaurant/coupon-status' },
  { icon: '↻', title: 'Reassign Orphaned Coupons', body: 'If a coupon\'s menu item gets removed, reassign it to a current item instead of losing the coupon entirely.', href: '/restaurant/coupon-status' },
  { icon: '🏪', title: 'Restaurant Profile', body: 'Set your real website and menu page URL here — it powers AI Assisted Menu Pull and keeps your menu-sourcing tools pointed at the right pages.', href: '/restaurant/profile' },
  { icon: '👤', title: 'Usage Limit per Consumer', body: 'Set how many times the SAME customer can redeem a coupon, separate from the total redemption cap across everyone.', href: '/restaurant/menu' },
  { icon: '💬', title: 'Support', body: "Something not working right? Reach out from the Support tab — we'll follow up directly.", href: '/restaurant/support' },
];

const ROTATE_MS = 7000;
// Only render once there's genuinely enough room for the 900px page content
// plus two side panels without cramping anything.
const MIN_WIDTH_FOR_SIDEBARS = 1400;
const PANEL_WIDTH = 220;

function TipCard({ tip, imageIndex }: { tip: Tip; imageIndex: number }) {
  const router = useRouter();
  return (
    <TouchableOpacity style={styles.card} onPress={() => router.push(tip.href as any)} activeOpacity={0.8}>
      <Text style={styles.icon}>{tip.icon}</Text>
      <Text style={styles.title}>{tip.title}</Text>
      <Text style={styles.body}>{tip.body}</Text>
      <Image source={FOOD_IMAGES[imageIndex]} style={styles.image} contentFit="cover" />
      <Text style={styles.linkHint}>Tap to open →</Text>
    </TouchableOpacity>
  );
}

export function OwnerTipsSidebar() {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % TIPS.length);
    }, ROTATE_MS);
    return () => clearInterval(interval);
  }, []);

  // Deliberately web/wide-desktop only — this app runs primarily on web, and
  // native screens never reach MIN_WIDTH_FOR_SIDEBARS anyway, but the
  // explicit check keeps that intent clear.
  if (Platform.OS !== 'web' || width < MIN_WIDTH_FOR_SIDEBARS) return null;

  const leftTip = TIPS[index];
  const rightTip = TIPS[(index + Math.floor(TIPS.length / 2)) % TIPS.length];

  return (
    <>
      <View style={[styles.panel, styles.panelLeft]}>
        <TipCard tip={leftTip} imageIndex={index % FOOD_IMAGES.length} />
      </View>
      <View style={[styles.panel, styles.panelRight]}>
        <TipCard tip={rightTip} imageIndex={(index + 1) % FOOD_IMAGES.length} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  panel: {
    // Anchored to the content container (below the header) rather than the
    // full viewport — see _layout.tsx's `content` style — so it never needs
    // to guess the header's height to avoid overlapping it.
    position: 'absolute',
    top: 16,
    width: PANEL_WIDTH,
    alignItems: 'center',
    zIndex: 1,
  },
  panelLeft: { left: 16 },
  panelRight: { right: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    width: '100%',
    borderWidth: 1,
    borderColor: '#eee',
    elevation: 1,
  },
  icon: { fontSize: 26, marginBottom: 8 },
  title: { fontSize: 13.5, fontWeight: '800', color: '#222', marginBottom: 6 },
  body: { fontSize: 12, color: '#777', lineHeight: 17, marginBottom: 12 },
  image: { width: '100%', height: 110, borderRadius: 10, backgroundColor: '#f0f0f0' },
  linkHint: { fontSize: 11, fontWeight: '700', color: '#4CAF50', marginTop: 8, alignSelf: 'flex-end' },
});
