import { useCallback } from 'react';
import { useChatStore } from '../store/chatStore';
import { useUserProfile } from './useUserProfile';
import { useRestaurantStore } from '../store/restaurantStore';
import { sendChatMessage } from '../api/functions';

export function useChat() {
  const { messages, isLoading, addMessage, setLoading, clear } = useChatStore();
  const { data: profile } = useUserProfile();
  const restaurants = useRestaurantStore((s) => s.restaurants);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading || !profile) return;

    addMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
      createdAt: new Date(),
    });
    setLoading(true);

    try {
      const nearbyNames = restaurants.slice(0, 15).map((r) => r.name);
      const response = await sendChatMessage(text.trim(), profile, nearbyNames);
      addMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response,
        createdAt: new Date(),
      });
    } catch {
      addMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: "Sorry, I couldn't respond right now. Please try again.",
        createdAt: new Date(),
      });
    } finally {
      setLoading(false);
    }
  }, [isLoading, profile, restaurants, addMessage, setLoading]);

  return { messages, isLoading, sendMessage, clear, hasProfile: !!profile };
}
