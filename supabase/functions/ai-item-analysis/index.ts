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
async function loadDbConfig(keys: string[]): Promise<Record<string, string>> {
  if (Deno.env.get('APP_CONFIG_SOURCE') !== 'db') return {};
  if (cachedDbConfig) return cachedDbConfig;
  try {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
    const { data, error } = await client.from('app_config').select('key, value').in('key', keys);
    if (error) throw error;
    cachedDbConfig = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    return cachedDbConfig;
  } catch (err) {
    console.error('[ai-item-analysis] Failed to load DB config, falling back to env/defaults:', err);
    return {};
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { menuItem, profile } = await req.json();
    if (!menuItem || !profile) {
      return new Response(JSON.stringify({ error: 'menuItem and profile are required' }), {
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

    const n = menuItem.nutrition;
    const goals = (profile.healthGoals ?? []).join(', ') || 'balanced diet';
    const restrictions = (profile.dietaryRestrictions ?? []).join(', ') || 'none';
    const allergens = (profile.allergens ?? []).join(', ') || 'none';

    const prompt = `You are a concise nutrition advisor. Answer in exactly 2 sentences.

User health profile:
- Goals: ${goals}
- Dietary restrictions: ${restrictions}
- Allergens to avoid: ${allergens}

Menu item: "${menuItem.name}"
Nutrition per serving: ${n.calories} calories, ${n.protein_g}g protein, ${n.totalCarbs_g}g carbs, ${n.totalFat_g}g fat (${n.saturatedFat_g}g saturated), ${n.sodium_mg}mg sodium

Start your first sentence with either "Yes," or "No," to answer whether this is a good choice for this user. Then give one specific reason why.`;

    console.log('[ai-item-analysis] ========== START ==========');
    console.log('[ai-item-analysis] Analyzing:', menuItem.name);
    console.log('[ai-item-analysis] User goals:', goals);
    console.log('[ai-item-analysis] Dietary restrictions:', restrictions);
    console.log('[ai-item-analysis] Allergens:', allergens);
    console.log('[ai-item-analysis] [ai-request]', prompt);

    let analysis: string;

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
          max_tokens: 100,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        console.error('[ai-item-analysis] Quicksilver error:', res.status, body);
        return new Response(JSON.stringify({ error: `Quicksilver API error ${res.status}` }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const data = await res.json();
      analysis = data.choices?.[0]?.message?.content?.trim() ?? 'Unable to analyse this item.';
      console.log('[ai-item-analysis] Quicksilver response:', analysis);
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
          max_tokens: 100,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        console.error('[ai-item-analysis] Claude error:', res.status, body);
        return new Response(JSON.stringify({ error: `Claude API error ${res.status}` }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const claudeData = await res.json();
      analysis = claudeData.content?.[0]?.text?.trim() ?? 'Unable to analyse this item.';
      console.log('[ai-item-analysis] Claude response:', analysis);
      console.log('[ai-item-analysis] Claude usage - input:', claudeData.usage?.input_tokens, 'output:', claudeData.usage?.output_tokens);
    }

    // Cache in DB (best-effort, use service key to bypass RLS)
    try {
      const serviceClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      await serviceClient.rpc('set_item_analysis', {
        p_item_id: menuItem.itemId,
        p_summary: analysis,
      });
    } catch (cacheErr) {
      console.warn('[ai-item-analysis] Cache write failed:', cacheErr);
    }

    console.log('[ai-item-analysis] ========== END ==========');
    return new Response(JSON.stringify({ analysis }), {
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
