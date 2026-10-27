// The AI call of the menu-agent edge function: one text prompt in, text and token counts out.
// Provider and model come from app_config (menuAgentAiProvider / menuAgentModel, falling back to the app-wide
// settings the other menu functions use). The API keys are edge-function secrets and never leave this function.

export interface AiAnswer { text: string; inputTokens: number; outputTokens: number; model: string }

export interface AiSettings { provider: string; model: string }

export function pickAiSettings(cfg: Record<string, string>, env: (k: string) => string | undefined): AiSettings {
  const provider = (cfg.menuAgentAiProvider || env('MENU_AGENT_AI_PROVIDER') || cfg.aiProvider || env('AI_PROVIDER') || 'quicksilver')
    .trim().toLowerCase();
  const own = (cfg.menuAgentModel || '').trim();
  if (provider === 'claude') {
    return { provider, model: own || cfg.claudeModel || env('CLAUDE_MODEL') || 'claude-haiku-4-5-20251001' };
  }
  return { provider: 'quicksilver', model: own || cfg.quicksilverModel || env('QUICKSILVER_MODEL') || 'deepseek-v4-flash' };
}

export async function callAi(prompt: string, maxTokens: number, settings: AiSettings, timeoutMs = 45000): Promise<AiAnswer> {
  if (settings.provider === 'claude') {
    const key = Deno.env.get('ANTHROPIC_API_KEY') || '';
    if (!key) throw new Error('ANTHROPIC_API_KEY secret not configured');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: settings.model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Claude API error ${res.status}`);
    const d = await res.json();
    return {
      text: d.content?.[0]?.text ?? '', model: settings.model,
      inputTokens: Number(d.usage?.input_tokens ?? 0), outputTokens: Number(d.usage?.output_tokens ?? 0),
    };
  }
  const key = Deno.env.get('QUICKSILVER_API_KEY') || '';
  if (!key) throw new Error('QUICKSILVER_API_KEY secret not configured');
  const res = await fetch('https://api.quicksilverpro.io/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: settings.model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Quicksilver API error ${res.status}`);
  const d = await res.json();
  return {
    text: d.choices?.[0]?.message?.content ?? '', model: settings.model,
    inputTokens: Number(d.usage?.prompt_tokens ?? 0), outputTokens: Number(d.usage?.completion_tokens ?? 0),
  };
}
