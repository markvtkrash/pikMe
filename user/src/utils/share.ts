// Sharing a piece of text: the phone's share sheet on iPhone and Android; on the web the browser's share sheet when there is one, else the text is
// copied to the clipboard. The environment is passed in so each branch can be tested without a phone.

export type ShareOutcome = 'shared' | 'copied' | 'dismissed' | 'failed';

export interface ShareEnv {
  os: string;
  // react-native's Share.share and its dismissed marker
  nativeShare?: (content: { message: string }) => Promise<{ action: string }>;
  nativeDismissedAction?: string;
  // the browser's navigator.share and navigator.clipboard.writeText
  webShare?: (data: { text: string }) => Promise<void>;
  writeClipboard?: (text: string) => Promise<void>;
}

const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === 'AbortError';

export async function shareText(message: string, env: ShareEnv): Promise<ShareOutcome> {
  const text = message.trim();
  if (!text) return 'failed';
  try {
    if (env.os !== 'web') {
      if (!env.nativeShare) return 'failed';
      const result = await env.nativeShare({ message: text });
      return result.action === env.nativeDismissedAction ? 'dismissed' : 'shared';
    }
    if (env.webShare) {
      try {
        await env.webShare({ text });
        return 'shared';
      } catch (e) {
        if (isAbort(e)) return 'dismissed';   // the person closed the sheet
        // some other failure: fall through to the clipboard
      }
    }
    if (env.writeClipboard) {
      await env.writeClipboard(text);
      return 'copied';
    }
    return 'failed';
  } catch {
    return 'failed';
  }
}
