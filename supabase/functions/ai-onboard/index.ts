import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Cached per warm isolate (not per-request) so switching APP_CONFIG_SOURCE=db
// on doesn't add a DB round-trip to every single invocation — refreshed only
// on the next cold start, same "load once" model used by the client apps.
let cachedDbConfig: Record<string, string> | null = null;
// The config is kept for a few minutes, then read again, so a changed setting applies without a redeploy. The cache is for
// one list of keys: a call with a different list reads again.
let cachedDbConfigAt = 0;
let cachedDbConfigSig = '';
const DB_CONFIG_TTL_MS = 5 * 60 * 1000;
async function loadDbConfig(keys: string[]): Promise<Record<string, string>> {
  if (Deno.env.get('APP_CONFIG_SOURCE') !== 'db') return {};
  const sig = [...keys].sort().join(',');
  if (cachedDbConfig && cachedDbConfigSig === sig && Date.now() - cachedDbConfigAt < DB_CONFIG_TTL_MS) return cachedDbConfig;
  try {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
    const { data, error } = await client.from('app_config').select('key, value').in('key', keys);
    if (error) throw error;
    cachedDbConfig = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    cachedDbConfigAt = Date.now();
    cachedDbConfigSig = sig;
    return cachedDbConfig;
  } catch (err) {
    console.error('[ai-onboard] Failed to load DB config, falling back to env/defaults:', err);
    return {};
  }
}

// PikMe does not collect or use religious preference data. Strips any such
// dietary value (Halal, Kosher, Hindu Meal, ...) — keep in sync with
// user/src/utils/religiousData.ts and public.is_religious_dietary_value.
const RELIGIOUS_VALUE_PATTERN =
  /halal|kosher|hindu|jain|buddh|muslim|islam|jewish|christian|sikh|religio|ramadan|sabbath/i;
function stripReligiousDietary(values: unknown): string[] {
  return Array.isArray(values)
    ? values.filter((v): v is string => typeof v === 'string' && !RELIGIOUS_VALUE_PATTERN.test(v))
    : [];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { freeText } = await req.json();
    if (!freeText?.trim()) {
      return new Response(JSON.stringify({ error: 'freeText is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const dbConfig = await loadDbConfig(['aiProvider', 'quicksilverModel', 'claudeModel']);
    const AI_PROVIDER = dbConfig.aiProvider ?? Deno.env.get('AI_PROVIDER') ?? 'claude';
    const QUICKSILVER_MODEL = dbConfig.quicksilverModel ?? Deno.env.get('QUICKSILVER_MODEL') ?? 'deepseek-v4-flash';
    const CLAUDE_MODEL = dbConfig.claudeModel ?? Deno.env.get('CLAUDE_MODEL') ?? 'claude-haiku-4-5-20251001';
    let apiKey: string;

    if (AI_PROVIDER === 'quicksilver') {
      apiKey = Deno.env.get('QUICKSILVER_API_KEY') || '';
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'QUICKSILVER_API_KEY not configured' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const prompt = `Extract health and food preference information from the user's description below.
Return ONLY valid JSON with these exact fields (omit any field not mentioned in the text):
{
  "dietaryRestrictions": [],   // only values from: vegetarian, vegan, gluten_free, none
  "healthGoals": [],           // only values from: weight_loss, low_carb, low_sodium, high_protein, diabetic_friendly, heart_healthy, balanced
  "allergens": [],             // free-text allergens (e.g. "peanuts", "shellfish", "dairy")
  "cuisinePreferences": []     // only values from: american, italian, mexican, chinese, japanese, indian, mediterranean, thai, korean, middle_eastern
}

User description: "${freeText.replace(/"/g, '\\"')}"

Never record or infer religion, ethnicity, or beliefs, even if the description mentions them — ignore that part.
Return only the JSON object. No explanation, no markdown, no code fences.`;

    console.log('[ai-onboard] User input:', freeText.slice(0, 200));
    console.log('[ai-onboard] Sending extraction prompt');

    let rawText: string;

    if (AI_PROVIDER === 'quicksilver') {
      const res = await fetch('https://api.quicksilverpro.io/v1/chat/completions', {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: QUICKSILVER_MODEL,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 256,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        console.error('[ai-onboard] Quicksilver error:', res.status, body);
        return new Response(JSON.stringify({ error: `Quicksilver API error ${res.status}` }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const data = await res.json();
      rawText = data.choices?.[0]?.message?.content ?? '{}';
    } else {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 256,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        console.error('[ai-onboard] Claude error:', res.status, body);
        return new Response(JSON.stringify({ error: `Claude API error ${res.status}` }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const claudeData = await res.json();
      rawText = claudeData.content?.[0]?.text ?? '{}';
    }

    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    let extracted: Record<string, unknown> = {};
    try {
      extracted = JSON.parse(cleaned);
    } catch {
      console.warn('[ai-onboard] JSON parse failed, returning empty extraction');
    }

    // Whatever the model returned, never pass a religious value back.
    if ('dietaryRestrictions' in extracted) {
      extracted.dietaryRestrictions = stripReligiousDietary(extracted.dietaryRestrictions);
    }

    return new Response(JSON.stringify(extracted), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
