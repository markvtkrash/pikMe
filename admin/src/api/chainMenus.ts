import { supabase } from './supabase';
import { fetchAllPages } from './reports';
import type { ChainBuildLogRow, ChainBuildStatus, ChainLinkSuggestion, ChainMenuSource, MenuQueueRun } from '../utils/chainMenuSources';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
// The server stops a request after about a minute; wait a little longer than that.
const PULL_TIMEOUT_MS = 90000;

// Every active chain with the outcome of its last menu lookup (migration 078).
export function getChainMenuSources(): Promise<ChainMenuSource[]> {
  return fetchAllPages<ChainMenuSource>('admin_list_chain_menu_sources');
}

// Enter a chain's official menu link by hand. It is then read as is and SerpApi
// is never called for that chain. storeRef is the optional store parameter some
// sites need, e.g. "store=034416".
export async function setChainMenuLink(chainId: string, menuLink: string, storeRef?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_set_chain_menu_link', {
    p_chain_id: chainId,
    p_menu_link: menuLink.trim(),
    p_store_ref: storeRef?.trim() ? storeRef.trim() : null,
  });
  if (error) throw error;
}

// Remove the manual link: the chain goes back to using SerpApi.
export function clearChainMenuLink(chainId: string): Promise<void> {
  return setChainMenuLink(chainId, '', undefined);
}

// Ask for a fresh lookup the next time a customer opens this chain. Resolves to
// false when the chain has no lookup yet (it is already due).
export async function markChainMenuStale(chainId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('admin_mark_chain_menu_stale', { p_chain_id: chainId });
  if (error) throw error;
  return data === true;
}

export interface PullChainMenuResult {
  status: string;          // ok | no_menu_link | unreadable | error | in_progress | no_place_id | not_a_chain
  itemCount?: number;
  refreshed?: boolean;
  chain?: string;
  message?: string;
}

// Builds the chain's menu now, ignoring the refresh period ("Pull menu now" on
// the Franchise Menu Management page). Needs the signed-in admin's access token: the function
// checks the admin role itself. Can take up to about a minute.
export async function pullChainMenuNow(chainId: string, accessToken: string): Promise<PullChainMenuResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PULL_TIMEOUT_MS);
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/get-chain-menu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ chainId, force: true }),
      signal: controller.signal,
    });

    let data: any = null;
    try {
      data = await response.json();
    } catch {
      // not JSON (for example the server cancelled a slow request)
    }
    if (!response.ok) {
      throw new Error(data?.error || `The pull did not finish (HTTP ${response.status}). It may have taken too long.`);
    }
    return data as PullChainMenuResult;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error("The pull is taking longer than expected. It may still finish: check this chain's status in a minute.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Set (or, with a blank value, clear) the chain's built-in menu page: the fallback used only
// when Google gives no menu link and no link is saved. Does not mark the chain due for a lookup.
export async function setChainBuiltInMenuUrl(chainId: string, url: string): Promise<void> {
  const { error } = await supabase.rpc('admin_set_chain_menu_url', { p_chain_id: chainId, p_url: url.trim() });
  if (error) throw error;
}

// ── Scheduled builds (migrations 087-089) ───────────────────────────────────
export async function getChainBuildStatus(): Promise<ChainBuildStatus> {
  const { data, error } = await supabase.rpc('admin_chain_build_status');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('No status returned');
  return {
    ...row,
    queued_count: Number(row.queued_count ?? 0),
    queued_names: row.queued_names ?? [],
    places_waiting: Number(row.places_waiting ?? 0),
    places_attention: Number(row.places_attention ?? 0),
  };
}

// 0 pauses the scheduled builds.
export async function setChainBuildsPerRun(perRun: number): Promise<void> {
  const { error } = await supabase.rpc('admin_set_chain_builds_per_run', { p_per_run: perRun });
  if (error) throw error;
}

// Starts a batch now (same as the hourly run). Resolves to how many chains were started.
export async function runChainBuildsNow(): Promise<number> {
  const { data, error } = await supabase.rpc('admin_run_chain_builds_now');
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

// Adds a chain to the franchise list (migration 092). Aliases are other names the app should treat as
// this chain. Resolves to the new chain's id; throws the database's message when the name or an alias
// is already on the list.
export async function addFranchiseChain(input: {
  name: string; category?: string; aliases?: string[]; menuUrl?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('admin_add_franchise_chain', {
    p_name: input.name.trim(),
    p_category: input.category?.trim() ? input.category.trim() : null,
    p_aliases: input.aliases ?? [],
    p_menu_url: input.menuUrl?.trim() ? input.menuUrl.trim() : null,
  });
  if (error) throw error;
  return data as string;
}

// ── Menu page suggestions from owners (migration 093) ───────────────────────
// Links owners of a chain's locations saved on their Restaurant Profile, for chains that have no
// built-in menu page yet. Nothing here changes a chain until an admin approves it.
export async function getChainLinkSuggestions(): Promise<ChainLinkSuggestion[]> {
  const { data, error } = await supabase.rpc('admin_list_chain_link_suggestions');
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, owner_count: Number(r.owner_count ?? 0) }));
}

// Fills the chain's built-in menu page with the suggested link (only while it is still empty).
export async function approveChainLinkSuggestion(chainId: string, link: string): Promise<void> {
  const { error } = await supabase.rpc('admin_approve_chain_link_suggestion', { p_chain_id: chainId, p_link: link });
  if (error) throw error;
}

// Hides this link for this chain from the review list.
export async function dismissChainLinkSuggestion(chainId: string, link: string): Promise<void> {
  const { error } = await supabase.rpc('admin_dismiss_chain_link_suggestion', { p_chain_id: chainId, p_link: link });
  if (error) throw error;
}

// Saves the store (Google place ID) the chain's lookup asks Google about, or removes it when placeId is blank
// (migration 096). Saving marks the chain due for a fresh lookup. storeName is the name of the store picked from a
// search, so the server can warn when it does not match this chain; the save still happens.
export async function setChainPlaceId(
  chainId: string, placeId: string, storeName?: string,
): Promise<{ saved: boolean; removed: boolean; warning: string | null }> {
  const { data, error } = await supabase.rpc('admin_set_chain_place_id', {
    p_chain_id: chainId,
    p_place_id: placeId.trim(),
    p_store_name: storeName?.trim() ? storeName.trim() : null,
  });
  if (error) throw error;
  return { saved: data?.saved === true, removed: data?.removed === true, warning: data?.warning ?? null };
}

// Replaces the chain's existing built-in menu page with the suggested link (migration 094). expectedCurrent
// is the page the admin saw; the server refuses if it has changed since, so a stale list can never overwrite.
export async function replaceChainLinkSuggestion(chainId: string, link: string, expectedCurrent: string | null): Promise<void> {
  const { error } = await supabase.rpc('admin_replace_chain_link_suggestion', {
    p_chain_id: chainId,
    p_link: link,
    p_expected_current: expectedCurrent,
  });
  if (error) throw error;
}

// Chains the scheduled job (or "Run a batch now") started in the last `hours` hours, newest first, with
// each chain's outcome (migration 097).
export async function getChainBuildLog(hours: number): Promise<ChainBuildLogRow[]> {
  const { data, error } = await supabase.rpc('admin_list_chain_build_log', { p_hours: hours });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, item_count: Number(r.item_count ?? 0) }));
}

// Starts the menu queue now (migration 102): the busiest few waiting restaurants and chains. Resolves to how many of
// each were started.
export async function runMenuQueueNow(): Promise<MenuQueueRun> {
  const { data, error } = await supabase.rpc('admin_run_menu_queue_now');
  if (error) throw error;
  return { chains: Number(data?.chains ?? 0), places: Number(data?.places ?? 0) };
}

// How many independent restaurants each scheduled run may start (0 pauses them), and the most in any 24 hours
// (a spending cap). Migration 105.
export async function setPlaceBuildsPerRun(perRun: number): Promise<void> {
  const { error } = await supabase.rpc('admin_set_place_builds_per_run', { p_per_run: perRun });
  if (error) throw error;
}

export async function setPlaceBuildsPerDay(perDay: number): Promise<void> {
  const { error } = await supabase.rpc('admin_set_place_builds_per_day', { p_per_day: perDay });
  if (error) throw error;
}

// "Run queue now" for independent restaurants only (migration 106): starts the busiest waiting restaurants, up to
// the per-run limit (not held back by the daily cap), and resolves to how many were started. Franchises are started
// by runChainBuildsNow and the schedule.
export async function runPlaceQueueNow(): Promise<number> {
  const { data, error } = await supabase.rpc('admin_run_place_queue_now');
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}
