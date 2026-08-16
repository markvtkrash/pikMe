import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { message, history, profile, nearbyRestaurantNames } = await req.json();
    if (!message?.trim()) {
      return new Response(JSON.stringify({ error: 'message is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const AI_PROVIDER = Deno.env.get('AI_PROVIDER') ?? 'claude';
    const QUICKSILVER_MODEL = Deno.env.get('QUICKSILVER_MODEL') ?? 'deepseek-v4-flash';
    const CLAUDE_MODEL = Deno.env.get('CLAUDE_MODEL') ?? 'claude-haiku-4-5-20251001';
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

    // Save user message + get history via authenticated client
    const authHeader = req.headers.get('Authorization');
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader! } } },
    );
    const { data: dbHistory } = await userClient.rpc('append_chat_message', {
      p_role: 'user',
      p_content: message,
    });

    // Build conversation history for Claude
    const chatHistory: { role: string; content: string }[] = [];
    if (Array.isArray(dbHistory)) {
      for (const msg of dbHistory) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          chatHistory.push({ role: msg.role, content: msg.content });
        }
      }
    }
    // If history is empty or last message isn't the current one, add it
    if (chatHistory.length === 0 || chatHistory[chatHistory.length - 1]?.content !== message) {
      chatHistory.push({ role: 'user', content: message });
    }

    const goals = (profile?.healthGoals ?? []).join(', ') || 'balanced diet';
    const restrictions = (profile?.dietaryRestrictions ?? []).join(', ') || 'none';
    const allergens = (profile?.allergens ?? []).join(', ') || 'none';
    const cuisines = (profile?.cuisinePreferences ?? []).join(', ') || 'any';
    const restaurants = (nearbyRestaurantNames ?? []).slice(0, 15).join(', ') || 'none known';

    const systemPrompt = `You are PikMe, a food recommendation assistant. Respond ONLY with bullet points.

User profile: ${profile?.displayName ?? 'user'} | Goals: ${goals} | Restrictions: ${restrictions} | Allergens: ${allergens}
Restaurants: ${restaurants}

OUTPUT FORMAT - DO NOT DEVIATE:
Start every response with a bullet point. Use ONLY this format:
• [1-2 words max]: [1 short sentence]
• [1-2 words max]: [1 short sentence]
• [1-2 words max]: [1 short sentence]

EXAMPLES of CORRECT format:
• Best choice: Grilled chicken at Subway (36g protein)
• Watch out: High sodium content (1340mg)
• Alternative: Salad with dressing on side

NEVER write:
- Paragraphs
- Multiple sentences in one bullet
- "Yes, this is..." or explanations
- Anything except bullets

Maximum 3 bullets per response.`;

    console.log('[ai-chat] Prompt:', systemPrompt.slice(0, 300));
    console.log('[ai-chat] User message:', message);

    let response: string;

    if (AI_PROVIDER === 'quicksilver') {
      const res = await fetch('https://api.quicksilverpro.io/v1/chat/completions', {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: QUICKSILVER_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            ...chatHistory,
          ],
          max_tokens: 150,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        console.error('[ai-chat] Quicksilver error:', res.status, body);
        return new Response(JSON.stringify({ error: `Quicksilver API error ${res.status}` }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const data = await res.json();
      response = data.choices?.[0]?.message?.content?.trim() || 'Sorry, I could not generate a response.';
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
          max_tokens: 150,
          system: systemPrompt,
          messages: chatHistory,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        console.error('[ai-chat] Claude error:', res.status, body);
        return new Response(JSON.stringify({ error: `Claude API error ${res.status}` }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const claudeData = await res.json();
      response = claudeData.content?.[0]?.text?.trim() || 'Sorry, I could not generate a response.';
    }

    console.log('[ai-chat] AI response:', JSON.stringify(response));

    // Save assistant response to DB
    await userClient.rpc('append_chat_message', {
      p_role: 'assistant',
      p_content: response,
    });

    return new Response(JSON.stringify({ response }), {
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
