import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildNutritionPrompt, buildPrompt, chunkList, matchNutrition, mergeItems, parseDecision, parseStepResult, parseWorkBody,
  MAX_MERGE_DISHES, MERGE_BATCH,
} from './agentUtils.ts';
import type { ApprovedDish, Item } from './agentUtils.ts';
import { callAi, pickAiSettings } from './aiClient.ts';

// The menu agent's door into the server (crawler/crawl_agent.py, started by cron on the VPS).
//
//   { action: 'work' }
//       -> { job: null }                                          nothing to do (or the agent is off / a daily cap is reached)
//       -> { job: { id, name }, next: { do: 'open_page', url }, items: [] }
//   { action: 'step', jobId, url, result: { ok, reason, text, links, pdfs, images }, items }
//       the worker reports the page it opened; the AI reads it and the answer is the next instruction:
//       -> { next: { do: 'open_page' | 'read_pdf' | 'read_image', url } | { do: 'done' }, items }
//       'items' is the list of dishes found so far; the worker sends it back on the next step.
//       On 'done' the job is finished here: the dishes become PENDING proposals for an admin (menu_items is not touched).
//
// The worker never decides where to go and never holds an AI key. Every call needs x-crawler-secret.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOG = '[menu-agent]';
const CONFIG_KEYS = ['menuAgentAiProvider', 'menuAgentModel', 'menuAgentMaxSteps', 'aiProvider', 'claudeModel', 'quicksilverModel'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-crawler-secret',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// deno-lint-ignore no-explicit-any
type Db = any;

async function loadConfig(db: Db): Promise<Record<string, string>> {
  const { data, error } = await db.from('app_config').select('key, value').in('key', CONFIG_KEYS);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value ?? '']));
}

// Ends a job: the dishes found become pending proposals, or the job is recorded as having none (or as an error).
async function finish(db: Db, jobId: number, status: 'ok' | 'no_items' | 'error', detail: string, items: Item[]) {
  const { data, error } = await db.rpc('finish_menu_agent_job', {
    p_job_id: jobId, p_status: status, p_detail: detail.slice(0, 300), p_items: items,
  });
  if (error) throw error;
  console.log(`${LOG} job ${jobId}: ${status} -> ${data}, ${items.length} dishes`);
  return data;
}

async function handleWork(db: Db) {
  const { data, error } = await db.rpc('claim_menu_agent_job');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return json({ job: null });
  return json({ job: { id: row.job_id, name: row.job_name }, next: { do: 'open_page', url: row.job_url }, items: [] });
}

async function handleStep(db: Db, body: unknown) {
  const parsed = parseStepResult(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const page = parsed.value;

  const { data: job, error: jobError } = await db
    .from('menu_agent_jobs').select('id, restaurant_name, start_url, status, steps_taken').eq('id', page.jobId).maybeSingle();
  if (jobError) throw jobError;
  if (!job || job.status !== 'running') return json({ next: { do: 'done' }, items: [], note: 'no such running job' });

  const { data: prior, error: priorError } = await db.from('menu_agent_steps').select('url').eq('job_id', page.jobId);
  if (priorError) throw priorError;
  const visited: string[] = [...(prior ?? []).map((s: { url: string | null }) => s.url ?? ''), page.url];

  const cfg = await loadConfig(db);
  const settings = pickAiSettings(cfg, (k) => Deno.env.get(k));
  const maxSteps = Math.min(Math.max(Number.parseInt(cfg.menuAgentMaxSteps ?? '', 10) || 10, 1), 50);

  let found: Item[] = page.items;
  let next: { do: string; url?: string } = { do: 'done' };
  let model = settings.model;
  let inTok = 0;
  let outTok = 0;
  let detail = '';
  let aiFailed = false;

  try {
    const ai = await callAi(buildPrompt({
      restaurant: job.restaurant_name, startUrl: job.start_url, stepNo: job.steps_taken + 1, maxSteps, page, found, visited,
    }), 4096, settings);
    model = ai.model; inTok = ai.inputTokens; outTok = ai.outputTokens;
    const decision = parseDecision(ai.text, job.start_url, visited);
    found = mergeItems(found, decision.items);
    next = decision.instruction;
    detail = `${found.length} dishes so far`;
  } catch (e) {
    // The AI failed: stop here. What is already found is kept; with nothing found the job is an error, retried later.
    aiFailed = true;
    detail = `AI call failed: ${e instanceof Error ? e.message : 'error'}`;
    console.warn(`${LOG} job ${page.jobId}: ${detail}`);
  }

  const recorded = await db.rpc('record_menu_agent_step', {
    p_job_id: page.jobId, p_action: next.do, p_url: page.url, p_model: model,
    p_input_tokens: inTok, p_output_tokens: outTok, p_detail: detail,
  });
  if (recorded.error) throw recorded.error;
  const stepStatus = recorded.data as string;

  if (stepStatus === 'unknown') return json({ next: { do: 'done' }, items: [] });
  if (next.do !== 'done' && stepStatus === 'ok') return json({ next, items: found });

  const why = stepStatus === 'max_steps' ? 'step limit reached' : stepStatus === 'cap_reached' ? 'daily cap reached' : 'agent finished';
  if (found.length > 0) await finish(db, page.jobId, 'ok', `${why}; ${detail}`, found);
  else if (aiFailed) await finish(db, page.jobId, 'error', detail, []);
  else await finish(db, page.jobId, 'no_items', `${why}; no dishes found`, []);
  return json({ next: { do: 'done' }, items: found });
}

// An item id for an agent dish of one place: the same dish at another place gets a different id.
async function agentItemId(placeId: string, itemName: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${placeId}::${itemName}::agent`.toLowerCase()));
  return 'agent_' + Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

// Is the caller a signed-in admin? (the merge action is for the admin page, not for the worker)
async function callerIsAdmin(db: Db, req: Request): Promise<boolean> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return false;
  const { data: role } = await db.from('user_roles').select('role').eq('user_id', data.user.id).eq('role', 'admin').maybeSingle();
  return !!role;
}

// Adds one restaurant's APPROVED, not yet merged dishes to its menu. The AI estimates nutrition (a dish it cannot
// estimate stays approved and is tried again next time); merge_approved_menu_agent_proposals adds them the usual way.
async function handleMerge(db: Db, body: Record<string, unknown>) {
  const placeId = typeof body.placeId === 'string' ? body.placeId : '';
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(placeId)) return json({ error: 'placeId is not valid' }, 400);

  const { data: rows, error } = await db.from('menu_agent_proposals')
    .select('id, item_name, job_id').eq('place_id', placeId).eq('status', 'approved').is('merged_at', null)
    .order('id').limit(MAX_MERGE_DISHES);
  if (error) throw error;
  if (!rows || rows.length === 0) return json({ added: 0, confirmed: 0, skipped: 0, unestimated: 0 });

  const { data: job } = await db.from('menu_agent_jobs').select('restaurant_name').eq('id', rows[0].job_id).maybeSingle();
  const restaurant: string = job?.restaurant_name ?? 'Restaurant';
  const settings = pickAiSettings(await loadConfig(db), (k) => Deno.env.get(k));

  const dishes: ApprovedDish[] = rows.map((r: { id: number; item_name: string }) => ({ proposalId: r.id, name: r.item_name }));
  const items: Record<string, unknown>[] = [];
  for (const batch of chunkList(dishes, MERGE_BATCH)) {
    try {
      const names = batch.map((d) => d.name);
      const ai = await callAi(buildNutritionPrompt(restaurant, names), 4096, settings);
      const found = matchNutrition(names, ai.text);
      for (const d of batch) {
        const n = found.get(d.name);
        if (!n) continue;
        items.push({
          proposalId: d.proposalId, itemId: await agentItemId(placeId, d.name), name: d.name,
          servingWeightGrams: null, imageUrl: null, isVerified: true, ...n,
        });
      }
    } catch (e) {
      console.warn(`${LOG} nutrition batch failed:`, e instanceof Error ? e.message : 'error');
    }
  }
  const unestimated = dishes.length - items.length;
  if (items.length === 0) return json({ added: 0, confirmed: 0, skipped: 0, unestimated });

  const { data: merged, error: mergeError } = await db.rpc('merge_approved_menu_agent_proposals', {
    p_place_id: placeId, p_restaurant_name: restaurant, p_items: items,
  });
  if (mergeError) throw mergeError;
  console.log(`${LOG} merged for ${restaurant}:`, JSON.stringify(merged), `unestimated ${unestimated}`);
  return json({ added: Number(merged?.added ?? 0), confirmed: Number(merged?.confirmed ?? 0), skipped: Number(merged?.skipped ?? 0), unestimated });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // merge: an admin's call from the admin page (checked by the caller's login, not the worker secret)
    const peek = (await req.clone().json().catch(() => ({}))) ?? {};
    if (peek.action === 'merge') {
      if (!(await callerIsAdmin(db, req))) return json({ error: 'Unauthorized' }, 401);
      return await handleMerge(db, peek);
    }

    const { data: secretOk, error: secretError } = await db.rpc('crawler_secret_ok', { p_secret: req.headers.get('x-crawler-secret') ?? '' });
    if (secretError) {
      console.error(`${LOG} secret check failed:`, secretError.message);
      return json({ error: 'Server error' }, 500);
    }
    if (secretOk !== true) return json({ error: 'Unauthorized' }, 401);

    const body = (await req.json().catch(() => ({}))) ?? {};
    const { action } = parseWorkBody(body);
    if (action === 'work') return await handleWork(db);
    if (action === 'step') return await handleStep(db, body);
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error(`${LOG} failed:`, e instanceof Error ? e.message : e);
    return json({ error: 'Server error' }, 500);
  }
});
