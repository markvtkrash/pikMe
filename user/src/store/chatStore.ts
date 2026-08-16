import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

interface ChatStore {
  messages: ChatMessage[];
  isLoading: boolean;
  addMessage: (msg: ChatMessage) => void;
  setLoading: (v: boolean) => void;
  clear: () => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  isLoading: false,
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setLoading: (v) => set({ isLoading: v }),
  clear: () => set({ messages: [], isLoading: false }),
}));
