import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  addressInCity, buildQuery, CUISINES, describeGoogleError, nextPosition, PAGE_SIZE, parseCityRequest, parsePlaces,
  stopReasonAfterPage,
} from './cityCrawlUtils.ts';

// The city import program's door into the server (crawler/crawl_cities.py, started by cron on the VPS). A city is searched
// through Google Places (New) text search ONE request at a time, so the search position and the request count are always
// exact and a stopped search continues where it left off.
//
//   { action: 'work' }                  -> { job: { id, name, region, max } | null, callLimit }
//       hands out the next city to search (and takes it)
//   { action: 'discover', cityId }      -> { finished, stopReason, counted, calls }
//       makes ONE Google request for that city, records the restaurants it returned (migration 134 classifies them: queued
//       for the browser crawler, no website, closed, franchise, already has a menu) and the new search position.
//       finished is true once the target was reached, the searches ran out, or the city's request limit was reached.
//   { action: 'fail', cityId, detail }  -> { status }       the program could not continue (retried later)
//   { action: 'sync' }                  -> { updated }      moves cities whose restaurants have all been read to "done"
//   { action: 'preview', name, region } -> { query, places } one search, nothing recorded: to check the Google key
//
// Every call needs the worker's secret in the x-crawler-secret header (the same one the menu crawl uses). The program never
// holds the service key or the Google key.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_KEY = Deno.env.get('GOOGLE_PLACES_KEY');
const LOG = '[city-crawl]';

const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.websiteUri,places.businessStatus,nextPageToken';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-crawler-secret',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

class GoogleError extends Error {}

// The admin's configured search terms (app_config key cityCrawlSearchTerms, comma-separated), or the built-in
// default when the row is missing or empty -- same table/row the admin's Config page already edits generically.
async function searchTerms(supabase: ReturnType<typeof createClient>): Promise<string[]> {
  const { data } = await supabase.from('app_config').select('value').eq('key', 'cityCrawlSearchTerms').maybeSingle();
  const raw = (data?.value as string | undefined)?.trim();
  if (!raw) return CUISINES;
  const terms = raw.split(',').map((t) => t.trim()).filter(Boolean);
  return terms.length > 0 ? terms : CUISINES;
}

// One Google Places (New) text-search request. Throws GoogleError with a message that never includes the key.
async function searchText(textQuery: string, pageToken: string | null): Promise<{ places: ReturnType<typeof parsePlaces>; nextPageToken: unknown }> {
  if (!GOOGLE_KEY) throw new GoogleError('GOOGLE_PLACES_KEY secret is not set on this Edge Function');
  const body: Record<string, unknown> = { textQuery, pageSize: PAGE_SIZE, includedType: 'restaurant', strictTypeFiltering: true };
  if (pageToken) body.pageToken = pageToken;
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': FIELD_MASK },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  }).catch((e) => {
    throw new GoogleError(`Could not reach Google: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`);
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new GoogleError(describeGoogleError(res.status, data));
  return { places: parsePlaces(data), nextPageToken: (data as { nextPageToken?: unknown } | null)?.nextPageToken };
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

    const parsed = parseCityRequest(await req.json().catch(() => ({})));
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const request = parsed.value;

    // ── work ──
    if (request.action === 'work') {
      const { data, error } = await supabase.rpc('claim_crawl_city');
      if (error) throw error;
      const row = (data ?? [])[0] as { job_id: string; job_name: string; job_region: string; job_max: number } | undefined;
      const { data: callLimit } = await supabase.rpc('crawl_city_call_limit');
      return json({
        job: row ? { id: row.job_id, name: row.job_name, region: row.job_region, max: row.job_max } : null,
        callLimit: typeof callLimit === 'number' ? callLimit : null,
      });
    }

    // ── sync ──
    if (request.action === 'sync') {
      const { data, error } = await supabase.rpc('sync_crawl_city_statuses');
      if (error) throw error;
      return json({ updated: Number(data ?? 0) });
    }

    // ── fail ──
    if (request.action === 'fail') {
      const { data, error } = await supabase.rpc('fail_crawl_city', { p_city_id: request.cityId, p_detail: request.detail, p_calls: 0 });
      if (error) throw error;
      return json({ status: data });
    }

    // ── preview ──
    if (request.action === 'preview') {
      const query = buildQuery(0, request.name, request.region)!;
      try {
        const { places } = await searchText(query, null);
        return json({ query, places: places.map((p) => ({ name: p.name, address: p.address, website: p.website, open: p.is_open })) });
      } catch (e) {
        if (e instanceof GoogleError) return json({ error: e.message }, 502);
        throw e;
      }
    }

    // ── discover: ONE Google request for the city ──
    const { data: city, error: cityError } = await supabase
      .from('crawl_cities')
      .select('id, name, region, status, query_index, page_token, google_calls_last_run')
      .eq('id', request.cityId).maybeSingle();
    if (cityError) throw cityError;
    if (!city) return json({ error: 'Unknown city' }, 404);
    if (city.status !== 'discovering') return json({ finished: true, stopReason: null, counted: null, calls: city.google_calls_last_run });

    const { data: limitData } = await supabase.rpc('crawl_city_call_limit');
    const callLimit = typeof limitData === 'number' ? limitData : 60;
    const terms = await searchTerms(supabase);
    const here = { queryIndex: Number(city.query_index) || 0, pageToken: (city.page_token as string | null) ?? null };
    const record = async (places: unknown[], calls: number, next: typeof here, stop: string | null) => {
      const { data, error } = await supabase.rpc('record_city_discovery', {
        p_city_id: city.id, p_places: places, p_calls: calls,
        p_next_query: next.queryIndex, p_next_token: next.pageToken, p_this_query: here.queryIndex, p_this_token: here.pageToken, p_stop: stop,
      });
      if (error) throw error;
      return data as { finished: boolean; stop_reason: string | null; counted: number };
    };

    // already at its request limit, or every search is used up: finish without another Google request
    const query = buildQuery(here.queryIndex, city.name, city.region, terms);
    if (Number(city.google_calls_last_run) >= callLimit || (query === null && !here.pageToken)) {
      const stop = query === null && !here.pageToken ? 'ran_out_of_results' : 'call_limit';
      const r = await record([], 0, here, stop);
      return json({ finished: r.finished, stopReason: r.stop_reason, counted: r.counted, calls: city.google_calls_last_run });
    }

    let page;
    try {
      page = await searchText(query as string, here.pageToken);
    } catch (e) {
      if (!(e instanceof GoogleError)) throw e;
      console.warn(`${LOG} ${city.name}: ${e.message}`);
      // the failed request may still be billed, so it is counted
      await supabase.rpc('fail_crawl_city', { p_city_id: city.id, p_detail: e.message, p_calls: 1 });
      return json({ finished: true, stopReason: null, counted: null, calls: Number(city.google_calls_last_run) + 1, error: e.message });
    }

    const next = nextPosition(here.queryIndex, page.nextPageToken);
    const callsAfter = Number(city.google_calls_last_run) + 1;
    const stop = stopReasonAfterPage(next, callsAfter, callLimit, 1 + terms.length);
    const inCity = page.places.filter((p) => addressInCity(p.address, city.name));
    const r = await record(inCity, 1, next, stop);
    console.log(`${LOG} ${city.name}: search ${here.queryIndex}, ${page.places.length} places (${inCity.length} in the city), counted ${r.counted}${r.finished ? `, finished (${r.stop_reason})` : ''}`);
    return json({ finished: r.finished, stopReason: r.stop_reason, counted: r.counted, calls: callsAfter });
  } catch (e) {
    console.error(`${LOG} failed:`, e instanceof Error ? e.message : e);
    return json({ error: 'Server error' }, 500);
  }
});
