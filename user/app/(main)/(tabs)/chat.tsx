import { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, ScrollView,
  StyleSheet, ActivityIndicator, Dimensions,
} from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { BRAND_COLORS } from '../../../src/constants/brandTheme';
import { useUserProfile } from '../../../src/hooks/useUserProfile';
import { useRestaurantStore } from '../../../src/store/restaurantStore';
import { sendChatMessage } from '../../../src/api/functions';

const SCREEN_HEIGHT = Dimensions.get('window').height;

function parseResponse(text: string): (string | { type: 'bullet'; text: string })[] {
  const lines = text.split('\n').filter(l => l.trim());
  return lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*')) {
      return { type: 'bullet', text: trimmed.replace(/^[•\-*]\s*/, '') };
    }
    return trimmed;
  });
}

function FormattedResponse({ text }: { text: string }) {
  const parsed = parseResponse(text);

  return (
    <View>
      {parsed.map((item, idx) => (
        <Animated.View
          key={idx}
          entering={FadeInUp.delay(idx * 50).duration(400)}
        >
          {typeof item === 'string' ? (
            <Text style={styles.responseText}>{item}</Text>
          ) : (
            <View style={styles.bulletRow}>
              <Text style={styles.bulletIcon}>•</Text>
              <Text style={styles.bulletText}>{item.text}</Text>
            </View>
          )}
        </Animated.View>
      ))}
    </View>
  );
}

function getSuggestions(profile: any): string[] {
  const questions: string[] = [];

  // 1. Based on dietary restrictions
  if (profile?.dietaryRestrictions && profile.dietaryRestrictions.length > 0 &&
      !profile.dietaryRestrictions.every((r: string) => r === 'none')) {
    questions.push('Show me options for my dietary preferences');
  }

  // 2. Based on health goals
  if (profile?.healthGoals && profile.healthGoals.length > 0) {
    questions.push('What options support my health goals?');
  }

  // 3. Based on allergens
  if (profile?.allergens && profile.allergens.length > 0) {
    questions.push('What meals are safe for me?');
  }

  // 4. Based on cuisine preferences
  if (profile?.cuisinePreferences && profile.cuisinePreferences.length > 0) {
    questions.push('Show me my favorite cuisines nearby');
  }

  // Fallback questions if profile is incomplete
  if (questions.length < 4) {
    const fallbacks = [
      'What should I eat for lunch?',
      'Find me something healthy nearby',
      "What's the best option for me?",
      'Show me top-rated restaurants',
    ];
    while (questions.length < 4) {
      const fallback = fallbacks[questions.length];
      if (!questions.includes(fallback)) {
        questions.push(fallback);
      }
    }
  }

  return questions.slice(0, 4);
}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const { data: profile } = useUserProfile();
  const restaurants = useRestaurantStore((s) => s.restaurants);
  const [modalVisible, setModalVisible] = useState(false);
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestedFollowUp, setSuggestedFollowUp] = useState<string | null>(null);

  const suggestions = getSuggestions(profile);

  async function handleSendSuggestion(text: string) {
    if (!profile || loading) return;

    setLoading(true);
    try {
      const nearbyNames = restaurants.slice(0, 15).map((r) => r.name);
      const response = await sendChatMessage(text, profile, nearbyNames);
      setAnswer(response);
      setModalVisible(true);
    } catch (error) {
      console.error('[PikMe] Menu Mentor chat failed:', error);
      setAnswer("Sorry, I couldn't respond right now. Please try again.");
      setModalVisible(true);
    } finally {
      setLoading(false);
    }
  }

  function closeModal() {
    setModalVisible(false);
    setAnswer('');
  }

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Menu Mentor</Text>
        <Text style={styles.headerSub}>Your personal menu guide</Text>
      </View>

      {/* Suggestions */}
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>🍽️</Text>
        <Text style={styles.emptyTitle}>Find meals made for you</Text>
        <Text style={styles.emptySub}>
          Personalized recommendations based on your preferences
        </Text>
        <View style={styles.suggestions}>
          {suggestions.map((s, idx) => (
            <Animated.View
              key={s}
              entering={FadeInDown.delay(idx * 100).duration(400)}
              style={{ opacity: loading ? 0.5 : 1 }}
            >
              <TouchableOpacity
                style={styles.chip}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  handleSendSuggestion(s);
                }}
                disabled={loading}
                activeOpacity={0.7}
              >
                <Text style={styles.chipText}>{s}</Text>
              </TouchableOpacity>
            </Animated.View>
          ))}
        </View>
      </View>

      {/* Answer Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="none"
        onRequestClose={closeModal}
      >
        <Animated.View
          style={styles.modalOverlay}
          entering={FadeInUp.duration(300)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={closeModal}
          />
          <Animated.View
            style={[styles.modalContent, { paddingTop: insets.top + 20 }]}
            entering={FadeInUp.delay(100).duration(400)}
          >
            <ScrollView
              style={styles.answerScroll}
              contentContainerStyle={styles.answerContainer}
              showsVerticalScrollIndicator={false}
            >
              {loading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={BRAND_COLORS.primary} />
                  <Text style={styles.loadingText}>Finding recommendations...</Text>
                </View>
              ) : (
                <FormattedResponse text={answer} />
              )}
            </ScrollView>

            {!loading && suggestedFollowUp && (
              <Animated.View entering={FadeInUp.delay(500).duration(400)}>
                <View style={styles.followUpContainer}>
                  <Text style={styles.followUpLabel}>Next question:</Text>
                  <TouchableOpacity
                    style={styles.followUpChip}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      handleSendSuggestion(suggestedFollowUp);
                    }}
                  >
                    <Text style={styles.followUpText}>{suggestedFollowUp}</Text>
                  </TouchableOpacity>
                </View>
              </Animated.View>
            )}

            <TouchableOpacity
              style={styles.closeButton}
              onPress={closeModal}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a1a' },
  headerSub: { fontSize: 12, color: '#aaa', marginTop: 1 },

  empty: { alignItems: 'center', paddingTop: 40, paddingHorizontal: 32 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#222', marginBottom: 6 },
  emptySub: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 24 },
  suggestions: { gap: 10, width: '100%' },
  chip: {
    backgroundColor: BRAND_COLORS.primaryLight,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: BRAND_COLORS.primaryLight,
  },
  chipText: { fontSize: 14, color: BRAND_COLORS.primary, textAlign: 'center' },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  answerScroll: { maxHeight: SCREEN_HEIGHT * 0.5 },
  answerContainer: { paddingVertical: 12, gap: 8 },
  responseText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#333',
    marginBottom: 8,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  bulletIcon: {
    fontSize: 16,
    color: '#2e7d32',
    fontWeight: '600',
    marginTop: 2,
  },
  bulletText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: '#333',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#888',
  },
  followUpContainer: {
    backgroundColor: '#F9F9F9',
    borderTopWidth: 1,
    borderTopColor: '#EEE',
    paddingVertical: 12,
    marginHorizontal: -20,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  followUpLabel: {
    fontSize: 12,
    color: '#999',
    fontWeight: '600',
    marginBottom: 8,
  },
  followUpChip: {
    backgroundColor: '#E8F5E9',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  followUpText: {
    fontSize: 13,
    color: '#2e7d32',
    fontWeight: '600',
    textAlign: 'center',
  },
  closeButton: {
    backgroundColor: BRAND_COLORS.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
