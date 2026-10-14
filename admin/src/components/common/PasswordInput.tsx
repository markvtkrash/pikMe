import { forwardRef, useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet, type TextInputProps } from 'react-native';
import { splitInputStyle } from '../../utils/passwordInputStyle';

// A password box with a Show / Hide button inside its right edge. Use it wherever a password is typed, in place of <TextInput secureTextEntry>.
// It takes the same props as TextInput (and a ref, so the Enter-key chain still works). The text is hidden until the person taps Show.
export const PasswordInput = forwardRef<TextInput, TextInputProps>(function PasswordInput({ style, ...rest }, ref) {
  const [visible, setVisible] = useState(false);
  const { outer, inner } = splitInputStyle(style);

  return (
    <View style={[styles.wrap, outer]}>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        {...rest}
        ref={ref}
        secureTextEntry={!visible}
        style={[inner, styles.room]}
      />
      <TouchableOpacity
        style={styles.toggle}
        onPress={() => setVisible((v) => !v)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
      >
        <Text style={styles.toggleText}>{visible ? 'Hide' : 'Show'}</Text>
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { position: 'relative', justifyContent: 'center' },
  // room for the button inside the box
  room: { paddingRight: 62 },
  toggle: { position: 'absolute', right: 0, top: 0, bottom: 0, paddingHorizontal: 14, justifyContent: 'center' },
  toggleText: { fontSize: 13, fontWeight: '800', color: '#1565C0' },
});
