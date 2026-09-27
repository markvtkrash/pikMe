import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function err(message: string, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Cached per warm isolate (not per-request) so switching APP_CONFIG_SOURCE=db
// on doesn't add a DB round-trip to every single invocation — refreshed only
// on the next cold start, same "load once" model used by the client apps.
let cachedDbConfig: Record<string, string> | null = null;
async function loadDbConfig(keys: string[]): Promise<Record<string, string>> {
  if (Deno.env.get('APP_CONFIG_SOURCE') !== 'db') return {};
  if (cachedDbConfig) return cachedDbConfig;
  try {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await client.from('app_config').select('key, value').in('key', keys);
    if (error) throw error;
    cachedDbConfig = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    return cachedDbConfig;
  } catch (loadErr) {
    console.error('[match-menu-item-names] Failed to load DB config, falling back to env/defaults:', loadErr);
    return {};
  }
}

// Second-tier matcher for the "Add Nutrition Info" bulk paste flow — only
// called for names that DIDN'T resolve via exact or algorithmic-fuzzy
// matching client-side (see stringSimilarity.ts). An AI suggestion here is
// never applied automatically; the owner app shows it as an explicit
// confirm/reject per item before including it in the actual update, so a
// wrong guess here costs nothing worse than one skipped row — never a
// silent update to the wrong dish's nutrition.
interface MatchResult {
  input: string;
  suggestion: string | null;
}

async function getSuggestions(
  unmatchedNames: string[],
  candidateNames: string[]
): Promise<MatchResult[]> {
  const dbConfig = await loadDbConfig(['aiProvider', 'claudeModel', 'quicksilverModel']);
  const AI_PROVIDER = dbConfig.aiProvider ?? Deno.env.get('AI_PROVIDER') ?? 'claude';
  const CLAUDE_MODEL = dbConfig.claudeModel ?? Deno.env.get('CLAUDE_MODEL') ?? 'claude-haiku-4-5-20251001';
  const QUICKSILVER_MODEL = dbConfig.quicksilverModel ?? Deno.env.get('QUICKSILVER_MODEL') ?? 'deepseek-v4-flash';

  const prompt = `A restaurant owner pasted dish names to attach real nutrition data to, but these names didn't exactly match any existing menu item. Your job is ONLY to match each typed name to the closest ACTUAL menu item name below, if one plausibly refers to the same dish (e.g. abbreviation, typo, reordered words, minor rewording). Do NOT invent a match if none plausibly refers to the same dish — return null for that one instead. Never match two typed names to different actual items just to fill in an answer.

Typed names:
${unmatchedNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}

Actual menu item names:
${candidateNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}

Return ONLY a JSON array, no markdown or explanation, one entry per typed name in the same order, each with these exact fields:
- input (string, copied exactly from the typed names list)
- suggestion (string, copied EXACTLY from the actual menu item names list — never a paraphrase — or null if nothing plausibly matches)`;

  let apiKey: string;
  if (AI_PROVIDER === 'quicksilver') {
    apiKey = Deno.env.get('QUICKSILVER_API_KEY') || '';
    if (!apiKey) throw new Error('QUICKSILVER_API_KEY secret not configured');
  } else {
    apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY secret not configured');
  }

  let rawText: string;
  if (AI_PROVIDER === 'quicksilver') {
    const res = await fetch('https://api.quicksilverpro.io/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: QUICKSILVER_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024,
      }),
    });
    if (!res.ok) throw new Error(`Quicksilver API error ${res.status}`);
    const data = await res.json();
    rawText = data.choices?.[0]?.message?.content ?? '';
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
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[match-menu-item-names] Claude error:', res.status, body);
      throw new Error(`Claude API returned ${res.status}`);
    }
    const claudeData = await res.json();
    rawText = claudeData.content?.[0]?.text ?? '';
  }

  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    parsed = match ? JSON.parse(match[0]) : [];
  }

  if (!Array.isArray(parsed)) return unmatchedNames.map((input) => ({ input, suggestion: null }));

  const candidateSet = new Set(candidateNames);
  return (parsed as Record<string, unknown>[]).map((r, i) => {
    const suggestion = typeof r.suggestion === 'string' && candidateSet.has(r.suggestion) ? r.suggestion : null;
    return { input: typeof r.input === 'string' ? r.input : (unmatchedNames[i] ?? ''), suggestion };
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return err('Unauthorized', 401);

    const { restaurantId, unmatchedNames, candidateNames } = await req.json();
    if (!restaurantId || !Array.isArray(unmatchedNames) || !Array.isArray(candidateNames)) {
      return err('restaurantId, unmatchedNames[], and candidateNames[] are required', 400);
    }
    if (unmatchedNames.length === 0 || candidateNames.length === 0) {
      return ok({ matches: unmatchedNames.map((input: string) => ({ input, suggestion: null })) });
    }

    // Verify the caller owns this restaurant, or is an admin — same pattern
    // as extract-menu-from-image/text.
    const token = authHeader.replace('Bearer ', '');
    const authedSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await authedSupabase.auth.getUser(token);
    if (userError || !userData.user) return err('Unauthorized', 401);

    const serviceSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: restaurant, error: restaurantError } = await serviceSupabase
      .from('restaurants')
      .select('owner_id')
      .eq('id', restaurantId)
      .single();
    if (restaurantError || !restaurant) return err('Restaurant not found', 404);

    if (restaurant.owner_id !== userData.user.id) {
      const { data: adminRole } = await serviceSupabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userData.user.id)
        .eq('role', 'admin')
        .maybeSingle();
      if (!adminRole) return err('Forbidden', 403);
    }

    const matches = await getSuggestions(unmatchedNames, candidateNames);
    return ok({ matches });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    console.error('[match-menu-item-names] Unhandled error:', e);
    return err(message);
  }
});
