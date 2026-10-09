import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { clampLimit, clampTaken, crawlStatusFromBuild, parseCrawlResult } from './crawlUtils.ts';

// The browser crawl worker's door into the server (crawler/crawl_places.py, started by cron on the VPS).
//
//   { action: 'work', limit, taken }                            -> { jobs: [{ placeId, name, link }], maxPerRun }
//       hands out the next restaurants whose menu link needs reading (and takes them), up to menuCrawlMaxPerRun in
//       one run (taken = how many this run already has)
//   { action: 'result', placeId, link, status, names, detail }  -> { recorded, status, itemCount }
//       the worker read the page: for status 'ok' the menu TEXT (and the dish names the worker parsed, as a fallback)
//       are sent to the place build (get-chain-menu, place mode). The AI reads the dishes out of the text, with any
//       calories the page states; nutrition is estimated and the dishes are ADDED to that restaurant's menu
//       (verified; nothing is replaced). 'no_items' and 'error' are only recorded.
//
// Every call needs the worker's secret in the x-crawler-secret header (stored in internal_settings, checked in the
// database). The worker never holds the service key or any AI key.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOG = '[menu-crawl]';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-crawler-secret',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const secret = req.headers.get('x-crawler-secret') ?? '';
    const { data: secretOk, error: secretError } = await supabase.rpc('crawler_secret_ok', { p_secret: secret });
    if (secretError) {
      console.error(`${LOG} secret check failed:`, secretError.message);
      return json({ error: 'Server error' }, 500);
    }
    if (secretOk !== true) return json({ error: 'Unauthorized' }, 401);

    const body = (await req.json().catch(() => ({}))) ?? {};

    // ── work ──
    if (body.action === 'work') {
      // `taken` is how many restaurants this run has already been given; nothing more is handed out once the run
      // reaches menuCrawlMaxPerRun (app_config). maxPerRun is returned so the worker can say why it stopped.
      const { data, error } = await supabase.rpc('claim_place_crawls', {
        p_limit: clampLimit(body.limit), p_taken: clampTaken(body.taken),
      });
      if (error) throw error;
      const jobs = (data ?? []).map((r: { job_place_id: string; job_name: string; job_link: string }) => ({
        placeId: r.job_place_id, name: r.job_name, link: r.job_link,
      }));
      const { data: maxPerRun } = await supabase.rpc('crawl_run_limit');
      return json({ jobs, maxPerRun: typeof maxPerRun === 'number' ? maxPerRun : null });
    }

    // ── result ──
    if (body.action === 'result') {
      const parsed = parseCrawlResult(body);
      if (!parsed.ok) return json({ error: parsed.error }, 400);
      const { placeId, link, status, detail, names, text } = parsed.value;

      // The restaurant and link we handed out; a result for anything else is not trusted.
      const { data: row, error: rowError } = await supabase
        .from('place_menu_crawl').select('restaurant_name, link').eq('place_id', placeId).maybeSingle();
      if (rowError) throw rowError;
      if (!row) return json({ error: 'Unknown restaurant' }, 404);
      if (row.link !== link) {
        // the link was changed while the worker was reading the old one: the newer link is still queued
        return json({ recorded: 'link_changed', status: 'ignored', itemCount: 0 });
      }

      let finalStatus = status;
      let finalDetail = detail;
      let itemCount = 0;

      if (status === 'ok') {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/get-chain-menu`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ mode: 'place', placeId, restaurantName: row.restaurant_name, names, text }),
          signal: AbortSignal.timeout(120_000),
        }).catch((e) => {
          console.warn(`${LOG} place build call failed:`, e instanceof Error ? e.message : 'error');
          return null;
        });
        const result = res && res.ok ? await res.json().catch(() => null) : null;
        finalStatus = result ? crawlStatusFromBuild(result.status) : 'error';
        itemCount = Number(result?.itemCount ?? 0);
        finalDetail = result
          ? `${text ? `${text.length} characters of menu text` : `${names.length} dish names`} read; build ${String(result.status)}${itemCount ? `, ${itemCount} added or confirmed` : ''}`
          : 'The menu build did not answer; will retry';
      }

      const { data: recorded, error: finishError } = await supabase.rpc('finish_place_crawl', {
        p_place_id: placeId, p_link: link, p_status: finalStatus, p_detail: finalDetail, p_items: itemCount,
      });
      if (finishError) throw finishError;
      console.log(`${LOG} ${row.restaurant_name}: ${finalStatus}, ${itemCount} items`);
      return json({ recorded, status: finalStatus, itemCount });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error(`${LOG} failed:`, e instanceof Error ? e.message : e);
    return json({ error: 'Server error' }, 500);
  }
});
