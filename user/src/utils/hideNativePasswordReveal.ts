// Edge (and some other browsers) draw their own "reveal password" eye inside every password box. The apps have their own Show / Hide button, so the
// browser's would be a second, confusing eye. This hides it. Web only; does nothing anywhere else, and only adds the rule once.
const STYLE_ID = 'hide-native-password-reveal';

export const HIDE_NATIVE_REVEAL_CSS = [
  'input[type="password"]::-ms-reveal, input[type="password"]::-ms-clear { display: none !important; }',
  'input[type="password"]::-webkit-credentials-auto-fill-button, input[type="password"]::-webkit-contacts-auto-fill-button { visibility: hidden !important; display: none !important; pointer-events: none !important; }',
].join('\n');

export function hideNativePasswordReveal(): void {
  if (typeof document === 'undefined' || !document.head) return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = HIDE_NATIVE_REVEAL_CSS;
  document.head.appendChild(style);
}
