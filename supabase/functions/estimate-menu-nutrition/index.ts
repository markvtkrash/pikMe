import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import {
  buildNutritionPrompt, chunk, describeReply, failureMessage, isUnsupportedFieldError, MAX_NAMES, maxTokensFor,
  parseBatchSize, parseEstimateReply, parseModelParams, parseTimeoutMs, retryCutoffMs, stripThinking, toNutrition,
  withNoThink, isValidPlaceId, planEstimates, savedAsVerified, outOfStockNames,
} from './nutritionUtils.ts';
import type { ExistingRow } from './nutritionUtils.ts';

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
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await client.from('app_config').select('key, value').in('key', keys);
    if (error) throw error;
    cachedDbConfig = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    cachedDbConfigAt = Date.now();
    cachedDbConfigSig = sig;
    return cachedDbConfig;
  } catch (loadErr) {
    console.error('[estimate-menu-nutrition] Failed to load DB config, falling back to env/defaults:', loadErr);
    return {};
  }
}

async function deterministicId(restaurantName: string, itemName: string): Promise<string> {
  const text = `${restaurantName}::${itemName}::manual`.toLowerCase();
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return 'manual_' + hex.slice(0, 24);
}


// Owner-typed item names come in already real — this function never invents
// or drops dish names, it only asks the LLM to estimate nutrition for the
// exact names given. The prompt is explicit that the item list is fixed.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return err('Unauthorized', 401);

    const { restaurantId, restaurantName, itemNames, force } = await req.json();
    if (!restaurantId || !restaurantName?.trim() || !Array.isArray(itemNames)) {
      return err('restaurantId, restaurantName, and itemNames[] are required', 400);
    }

    // Verify the caller actually owns this restaurant before touching its
    // menu — restaurantId comes straight from the client request body, so
    // without this check any authenticated owner could overwrite any other
    // restaurant's menu just by passing a different id.
    const token = authHeader.replace('Bearer ', '');
    const authedSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await authedSupabase.auth.getUser(token);
    if (userError || !userData.user) return err('Unauthorized', 401);

    const serviceSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: restaurant, error: restaurantError } = await serviceSupabase
      .from('restaurants')
      .select('owner_id, google_place_id')
      .eq('id', restaurantId)
      .single();
    if (restaurantError || !restaurant || restaurant.owner_id !== userData.user.id) {
      return err('Forbidden', 403);
    }

    const names = Array.from(
      new Set(
        (itemNames as unknown[])
          .map((n) => String(n ?? '').trim())
          .filter(Boolean)
      )
    ).slice(0, MAX_NAMES);

    // An empty list is allowed: it clears the menu (no AI call is made; the replace step asks for confirmation when
    // verified items or coupons would be affected).
    // What the restaurant already has. A name that is already on its menu keeps the nutrition it has (no AI call), so
    // deleting an item, or saving unchanged ones, does not re-estimate everything. A renamed item is a different name,
    // so it counts as new. If the current menu cannot be read, every name is estimated, as before.
    let existing: ExistingRow[] = [];
    let menuPlaceId: string | null = null;      // the restaurant's own place when its menu is kept per place
    try {
      const { data: isChain, error: chainError } = await serviceSupabase.rpc('is_franchise_chain', { p_name: restaurantName });
      if (chainError) throw chainError;
      const placeId = isChain !== true && isValidPlaceId(restaurant.google_place_id) ? restaurant.google_place_id : null;
      menuPlaceId = placeId;
      const columns = 'name, calories, protein_g, total_carbs_g, total_fat_g, saturated_fat_g, sodium_mg, dietary_fiber_g, sugars_g, serving_weight_grams, is_verified, is_out_of_stock';
      const base = serviceSupabase.from('menu_items').select(columns);
      const { data: rows, error: rowsError } = placeId
        ? await base.eq('place_id', placeId)
        : await base.ilike('restaurant_name', restaurantName.trim()).is('place_id', null);
      if (rowsError) throw rowsError;
      existing = (rows ?? []) as ExistingRow[];
    } catch (e) {
      console.warn('[estimate-menu-nutrition] could not read the current menu; every name will be estimated:',
        e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'error');
    }
    const plan = planEstimates(names, existing);
    const needAi = plan.toEstimate.length > 0;
    console.log(`[estimate-menu-nutrition] ${names.length - plan.toEstimate.length} of ${names.length} names kept from the current menu, ${plan.toEstimate.length} new to estimate`);

    const dbConfig = await loadDbConfig([
      'aiProvider', 'claudeModel', 'quicksilverModel', 'chainMenuAiProvider', 'chainMenuModel', 'chainMenuModelParams',
      'menuNutritionBatchSize', 'menuAiTimeoutSeconds',
    ]);
    // The same fast-model setup as the menu builds (get-chain-menu): the chain-menu provider, model and extra model
    // parameters, each falling back to the app-wide setting when blank.
    const AI_PROVIDER = dbConfig.chainMenuAiProvider || Deno.env.get('CHAIN_MENU_AI_PROVIDER') ||
      dbConfig.aiProvider || Deno.env.get('AI_PROVIDER') || 'claude';
    const CHAIN_MODEL = dbConfig.chainMenuModel || Deno.env.get('CHAIN_MENU_MODEL') || '';
    const CLAUDE_MODEL = CHAIN_MODEL || dbConfig.claudeModel || Deno.env.get('CLAUDE_MODEL') || 'claude-haiku-4-5-20251001';
    const QUICKSILVER_MODEL = CHAIN_MODEL || dbConfig.quicksilverModel || Deno.env.get('QUICKSILVER_MODEL') || 'deepseek-v4-flash';
    const EXTRA_BODY = parseModelParams(dbConfig.chainMenuModelParams || Deno.env.get('CHAIN_MENU_MODEL_PARAMS'));
    const BATCH_SIZE = parseBatchSize(dbConfig.menuNutritionBatchSize, Deno.env.get('MENU_NUTRITION_BATCH_SIZE'));
    const TIMEOUT_MS = parseTimeoutMs(dbConfig.menuAiTimeoutSeconds, Deno.env.get('MENU_AI_TIMEOUT_SECONDS'));

    let apiKey = '';
    if (needAi) {
      if (AI_PROVIDER === 'quicksilver') {
        apiKey = Deno.env.get('QUICKSILVER_API_KEY') || '';
        if (!apiKey) return err('QUICKSILVER_API_KEY secret not configured', 500);
      } else {
        apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
        if (!apiKey) return err('ANTHROPIC_API_KEY secret not configured', 500);
      }
    }
    if (needAi) console.log(
      `[estimate-menu-nutrition] ${plan.toEstimate.length} names in batches of ${BATCH_SIZE}; provider ${AI_PROVIDER}, model ` +
        `${AI_PROVIDER === 'quicksilver' ? QUICKSILVER_MODEL : CLAUDE_MODEL}` +
        (AI_PROVIDER === 'quicksilver' ? `, extra params: ${Object.keys(EXTRA_BODY).join(', ') || 'none'}` : '') +
        `, timeout ${TIMEOUT_MS}ms`,
    );

    // One AI call for one batch of names; throws if the call fails or times out. Any reasoning text the model
    // returns inline (<think>...</think>) is removed.
    async function callAi(prompt: string, maxTokens: number): Promise<string> {
      if (AI_PROVIDER === 'quicksilver') {
        const post = (extra: Record<string, unknown>) =>
          fetch('https://api.quicksilverpro.io/v1/chat/completions', {
            method: 'POST',
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              // Admin-supplied extra fields go first so they can never replace the fields below.
              ...extra,
              model: QUICKSILVER_MODEL,
              // Qwen 3 models reason before answering unless told not to; withNoThink asks them to skip it.
              messages: [{ role: 'user', content: withNoThink(prompt, QUICKSILVER_MODEL) }],
              max_tokens: maxTokens,
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
        let res = await post(EXTRA_BODY);
        // A wrong chainMenuModelParams must never stop this working: if the provider says a field is not
        // supported, say so in the log and retry once without the extra fields.
        if (res.status === 400 && Object.keys(EXTRA_BODY).length > 0) {
          const detail = (await res.text()).replace(/\s+/g, ' ').trim().slice(0, 200);
          if (isUnsupportedFieldError(detail)) {
            console.warn(`[estimate-menu-nutrition] Quicksilver rejected the chainMenuModelParams setting: ${detail}. Retrying without it; fix or clear the setting.`);
            res = await post({});
          } else {
            throw new Error(`Quicksilver API error 400: ${detail}`);
          }
        }
        if (!res.ok) throw new Error(`Quicksilver API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data = await res.json();
        return stripThinking(data.choices?.[0]?.message?.content ?? '');
      }
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        console.error('[estimate-menu-nutrition] Claude error:', res.status, await res.text());
        throw new Error(`Claude API returned ${res.status}`);
      }
      const claudeData = await res.json();
      return stripThinking(claudeData.content?.[0]?.text ?? '');
    }

    // The estimate for each name of one batch, in order (null = none). A batch is tried a second time if the first
    // try failed, timed out or came back incomplete, as long as the retry could still finish inside the request.
    const startedAt = Date.now();
    async function estimateBatch(batch: string[]): Promise<(Record<string, unknown> | null)[]> {
      const prompt = buildNutritionPrompt(restaurantName, batch);
      let best: (Record<string, unknown> | null)[] = [];
      const countGood = (list: (Record<string, unknown> | null)[]) => list.filter(Boolean).length;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const callStartedAt = Date.now();
          const raw = await callAi(prompt, maxTokensFor(batch.length));
          // only real objects count as an estimate (a reply such as [1, null, 3] is valid JSON but not an answer)
          const entries = (parseEstimateReply(raw) ?? [])
            .slice(0, batch.length)
            .map((e) => (e && typeof e === 'object' && !Array.isArray(e) ? e : null));
          if (entries.length === batch.length && countGood(entries) === batch.length) return entries;
          if (countGood(entries) > countGood(best)) best = entries;
          console.warn(
            `[estimate-menu-nutrition] batch of ${batch.length}: reply had ${countGood(entries)} usable entries ` +
              `(try ${attempt}, ${Date.now() - callStartedAt}ms). Start of the reply: ${describeReply(raw)}`,
          );
        } catch (e) {
          console.warn(`[estimate-menu-nutrition] batch of ${batch.length} failed (try ${attempt}):`, e instanceof Error ? e.message : 'error');
        }
        if (Date.now() - startedAt > retryCutoffMs(TIMEOUT_MS)) break;
      }
      return batch.map((_, i) => best[i] ?? null);
    }

    // All batches at once (a few at most), one result per name in the owner's order.
    const newNames = plan.toEstimate.map((x) => x.name);
    const batchResults = needAi ? await Promise.all(chunk(newNames, BATCH_SIZE).map((batch) => estimateBatch(batch))) : [];
    const estimates: (Record<string, unknown> | null)[] = batchResults.flat();
    const failed = estimates.filter((e) => e === null).length;
    if (failed > 0) {
      // The menu is replaced as a whole below, so a partial result is never saved.
      console.error(`[estimate-menu-nutrition] ${failed} of ${newNames.length} new items could not be estimated; nothing saved`);
      return err(failureMessage(failed, newNames.length), 502);
    }
    // the estimate for each position in the owner's list (null where the name kept its existing nutrition)
    const estimateAt: (Record<string, unknown> | null)[] = names.map(() => null);
    plan.toEstimate.forEach((x, i) => { estimateAt[x.index] = estimates[i]; });

    // The owner's typed names are the source of truth for identity — fall
    // back to them by position rather than trusting whatever name the LLM
    // echoed back, in case it reworded one despite the instruction not to.
    const items = await Promise.all(
      names.map(async (name, idx) => ({
        itemId: await deterministicId(restaurantName, name),
        restaurantName,
        name,
        imageUrl: null,
        // a NEW name is confirmed (the owner typed it as a real dish); a name already on the menu keeps its state, so an
        // item the owner unconfirmed on this screen stays unconfirmed
        isVerified: savedAsVerified(plan.state[idx]),
        nutrition: plan.kept[idx] ?? toNutrition(estimateAt[idx] as Record<string, unknown>),
      }))
    );

    // ── Hand off to the shared replace function — same coupon-safety check
    // and delete-then-upsert used by every other menu-replacing path. No
    // menuUrl here, since manual entry has no link to save. ────────────────
    const replaceRes = await fetch(`${Deno.env.get('SUPABASE_URL')!}/functions/v1/replace-restaurant-menu-items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`,
      },
      body: JSON.stringify({ restaurantId, restaurantName, items, force: !!force }),
    });
    const replaceData = await replaceRes.json();
    if (!replaceRes.ok) {
      return err(replaceData.error || 'Failed to save the menu items', replaceRes.status);
    }

    // The rewrite starts every item in stock. Put the out-of-stock mark back on the items that had it, so saving the list
    // does not undo it. Best effort: a failure here must not fail a save that worked. Skipped when the replace only asked
    // for confirmation (nothing was written yet).
    const outNames = outOfStockNames(names, plan.state);
    if (outNames.length > 0 && !replaceData.requiresConfirmation) {
      try {
        const update = serviceSupabase.from('menu_items').update({ is_out_of_stock: true }).in('name', outNames);
        const { error: stockError } = menuPlaceId
          ? await update.eq('place_id', menuPlaceId)
          : await update.ilike('restaurant_name', restaurantName.trim()).is('place_id', null);
        if (stockError) throw stockError;
      } catch (e) {
        console.warn('[estimate-menu-nutrition] could not restore the out-of-stock marks:',
          e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'error');
      }
    }

    console.log('[estimate-menu-nutrition] Estimated nutrition for', items.length, 'manual items for', restaurantName);
    return ok(replaceData);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    console.error('[estimate-menu-nutrition] Unhandled error:', e);
    return err(message);
  }
});
