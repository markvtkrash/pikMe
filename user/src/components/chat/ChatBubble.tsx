import { View, Text, StyleSheet } from 'react-native';
import type { ChatMessage } from '../../store/chatStore';

export function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      {!isUser && <Text style={styles.avatar}>🤖</Text>}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        <Text style={[styles.text, isUser ? styles.textUser : styles.textAssistant]}>
          {message.content}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginHorizontal: 16, marginVertical: 4, alignItems: 'flex-end', gap: 8 },
  rowUser: { justifyContent: 'flex-end' },
  rowAssistant: { justifyContent: 'flex-start' },
  avatar: { fontSize: 22, marginBottom: 2 },
  bubble: { maxWidth: '78%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { backgroundColor: '#4CAF50', borderBottomRightRadius: 4 },
  bubbleAssistant: { backgroundColor: '#f0f0f0', borderBottomLeftRadius: 4 },
  text: { fontSize: 15, lineHeight: 21 },
  textUser: { color: '#fff' },
  textAssistant: { color: '#1a1a1a' },
});
