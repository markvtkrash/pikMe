import { Text, View, StyleSheet, StyleProp, TextStyle } from 'react-native';
import {
  House, ClipboardList, MapPin, Utensils, Receipt, Ticket, Store, Users, Plus, ChartColumn, Hamburger, Link, Toolbox, Headphones,
  Timer, Megaphone, Tag, Settings, Wrench, ChartLine, Trophy, User, Pause, PartyPopper, Hourglass, Search, CircleX, TriangleAlert,
  MousePointerClick, Trash, Star, Heart, CircleCheck, Inbox, Pencil, Ban, Camera, BookOpen, PenLine, Salad, Bot, Eye, Lock,
  LockKeyhole, LockOpen, Dices, Calendar, Bell, MessageSquare, KeyRound, LogOut, RefreshCw, FileText, Repeat, Hand,
} from 'lucide-react-native';

// Lucide icons (lucide.dev) standing in for the emoji used as icons. An emoji with no Lucide icon is shown as the emoji itself.
// The emoji's invisible variation selector is ignored, so "🍽" and "🍽️" are the same.
type IconType = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
const ICONS: Record<string, IconType> = {
  '🏠': House, '📋': ClipboardList, '📍': MapPin, '🍽': Utensils, '🧾': Receipt, '🎟': Ticket, '🎫': Ticket, '🏪': Store, '👥': Users,
  '➕': Plus, '📊': ChartColumn, '🍔': Hamburger, '🔗': Link, '🧰': Toolbox, '🎧': Headphones, '⏱': Timer, '📢': Megaphone,
  '🏷': Tag, '⚙': Settings, '🛠': Wrench, '📈': ChartLine, '🏆': Trophy, '👤': User, '⏸': Pause, '🎉': PartyPopper, '⏳': Hourglass,
  '🔍': Search, '❌': CircleX, '⚠': TriangleAlert, '👆': MousePointerClick, '🗑': Trash, '⭐': Star, '❤': Heart, '🤍': Heart,
  '✅': CircleCheck, '📭': Inbox, '✏': Pencil, '🚫': Ban, '📷': Camera, '📖': BookOpen, '✍': PenLine, '🥗': Salad, '🤖': Bot,
  '👀': Eye, '👁': Eye, '🔒': Lock, '🔐': LockKeyhole, '🔓': LockOpen, '🎲': Dices, '📅': Calendar, '🔔': Bell, '💬': MessageSquare,
  '🔑': KeyRound, '🚪': LogOut, '🔄': RefreshCw, '📝': FileText, '🔁': Repeat, '🙋': Hand,
};

function key(emoji: string) {
  return emoji.replace(/️/g, '').trim();
}

// True when an emoji has a Lucide icon.
export function hasIcon(emoji: string): boolean {
  return !!ICONS[key(emoji)];
}

// Splits a label such as "🏠 Dashboard" into its leading emoji and the rest. No leading emoji gives emoji = null.
export function splitEmoji(label: string): { emoji: string | null; rest: string } {
  const m = /^((?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{23F1}-\u{23F3}])️?)\s*(.*)$/su.exec(label);
  return m && hasIcon(m[1]) ? { emoji: m[1], rest: m[2] } : { emoji: null, rest: label };
}

export function AppIcon({ emoji, size = 24, color = '#1565C0' }: { emoji: string; size?: number; color?: string }) {
  const Icon = ICONS[key(emoji)];
  if (!Icon) return <Text style={{ fontSize: size * 0.85 }}>{emoji}</Text>;
  return <Icon size={size} color={color} strokeWidth={1.9} />;
}

const LAYOUT_KEYS = ['flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf', 'width', 'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical', 'position', 'top', 'left', 'right', 'bottom'];

// An icon followed by text, in the text's own colour and size: <IconText emoji="🎟️" style={styles.title}>Coupons</IconText>.
// With no children it is the icon alone (sized from the style's fontSize). An emoji with no Lucide icon is shown as before.
export function IconText({ emoji, style, children, iconColor, numberOfLines }: {
  emoji: string; style?: StyleProp<TextStyle>; children?: React.ReactNode; iconColor?: string; numberOfLines?: number;
}) {
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, any>;
  if (!hasIcon(emoji)) {
    return <Text style={style} numberOfLines={numberOfLines}>{emoji}{children != null && children !== '' ? ' ' : ''}{children}</Text>;
  }
  const size = Math.round((flat.fontSize ?? 14) * 1.15);
  const outer: Record<string, any> = {};
  const inner: Record<string, any> = {};
  for (const k of Object.keys(flat)) (LAYOUT_KEYS.includes(k) ? outer : inner)[k] = flat[k];
  const center = flat.textAlign === 'center';
  const hasText = children != null && children !== '';
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: hasText ? 6 : 0, justifyContent: center ? 'center' : 'flex-start' }, outer]}>
      <AppIcon emoji={emoji} size={size} color={iconColor ?? (flat.color as string) ?? '#555'} />
      {hasText && <Text style={[inner, outer.flex != null && { flexShrink: 1 }]} numberOfLines={numberOfLines}>{children}</Text>}
    </View>
  );
}

// A label that may start with an emoji ("🏠 Dashboard"): the emoji becomes its Lucide icon, the rest stays text.
export function IconLabel({ label, style, iconColor, numberOfLines }: {
  label: string; style?: StyleProp<TextStyle>; iconColor?: string; numberOfLines?: number;
}) {
  const { emoji, rest } = splitEmoji(label);
  if (!emoji) return <Text style={style} numberOfLines={numberOfLines}>{label}</Text>;
  return <IconText emoji={emoji} style={style} iconColor={iconColor} numberOfLines={numberOfLines}>{rest}</IconText>;
}
