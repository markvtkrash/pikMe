import { useRef } from 'react';
import type { TextInput } from 'react-native';

// Makes Enter move to the next field of a form. Give the fields in order to chain(0), chain(1), ... and spread the result on each
// TextInput: <TextInput {...chain(0)} />. Enter on a field focuses the next one that is on screen; Enter on the last field calls
// onLast (usually the form's submit), if given. On a phone the return key says "Next" and, on the last field, "Done".
// Use it for forms; leave search boxes alone, where Enter runs the search.
export function useEnterChain(count: number, onLast?: () => void) {
  const refs = useRef<(TextInput | null)[]>([]);

  function focusAfter(index: number): boolean {
    for (let j = index + 1; j < count; j++) {
      const el = refs.current[j];
      if (el && typeof el.focus === 'function') {
        el.focus();
        return true;
      }
    }
    return false;
  }

  return (index: number) => {
    const last = index >= count - 1;
    return {
      ref: (el: TextInput | null) => { refs.current[index] = el; },
      returnKeyType: (last ? 'done' : 'next') as 'done' | 'next',
      blurOnSubmit: last,
      onSubmitEditing: () => { if (!focusAfter(index)) onLast?.(); },
    };
  };
}
