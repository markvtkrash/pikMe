import { useChatStore } from './chatStore';

const initialState = useChatStore.getState();

beforeEach(() => {
  useChatStore.setState(initialState, true);
});

describe('chatStore', () => {
  it('starts with no messages and not loading', () => {
    const s = useChatStore.getState();
    expect(s.messages).toEqual([]);
    expect(s.isLoading).toBe(false);
  });

  it('addMessage appends messages in order', () => {
    const first = { id: '1', role: 'user' as const, content: 'hi', createdAt: new Date() };
    const second = { id: '2', role: 'assistant' as const, content: 'hello', createdAt: new Date() };

    useChatStore.getState().addMessage(first);
    useChatStore.getState().addMessage(second);

    expect(useChatStore.getState().messages).toEqual([first, second]);
  });

  it('setLoading toggles isLoading', () => {
    useChatStore.getState().setLoading(true);
    expect(useChatStore.getState().isLoading).toBe(true);

    useChatStore.getState().setLoading(false);
    expect(useChatStore.getState().isLoading).toBe(false);
  });

  it('clear resets messages and isLoading', () => {
    useChatStore.getState().addMessage({ id: '1', role: 'user', content: 'hi', createdAt: new Date() });
    useChatStore.getState().setLoading(true);

    useChatStore.getState().clear();

    const s = useChatStore.getState();
    expect(s.messages).toEqual([]);
    expect(s.isLoading).toBe(false);
  });
});
