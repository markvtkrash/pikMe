import { Component } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { ReactNode } from 'react';
import { useThemedStyles } from '../../theme/useTheme';

interface Props { children: ReactNode }
interface State { hasError: boolean; message: string }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error) {
    console.error('[PikMe] Unhandled error:', error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return <ErrorFallback message={this.state.message} onRetry={() => this.setState({ hasError: false, message: '' })} />;
  }
}

// A function component, so the fallback can use the themed styles (a class component cannot call hooks).
function ErrorFallback({ message, onRetry }: { message: string; onRetry: () => void }) {
  const styles = useThemedStyles(baseStyles);
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>⚠️</Text>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.body}>
        The app hit an unexpected error. Please restart and try again.
      </Text>
      {message ? <Text style={styles.detail}>{message}</Text> : null}
      <TouchableOpacity style={styles.btn} onPress={onRetry}>
        <Text style={styles.btnText}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
}

const baseStyles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#fff' },
  icon: { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '700', color: '#333', marginBottom: 8 },
  body: { fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 22, marginBottom: 12 },
  detail: { fontSize: 11, color: '#c62828', textAlign: 'center', lineHeight: 16, marginBottom: 16, fontFamily: 'monospace' },
  btn: { backgroundColor: '#1565C0', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 32 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
