import { supabase } from './supabase';
import type { CityInput, CityPlaceRow, CrawlCityRow } from '../utils/crawlCities';

// Every city, newest first, with its counts (migration 134).
export async function listCrawlCities(): Promise<CrawlCityRow[]> {
  const { data, error } = await supabase.rpc('admin_list_crawl_cities');
  if (error) throw error;
  return (data ?? []) as CrawlCityRow[];
}

// Adds a city (id null) or updates one. Resolves to its id.
export async function saveCrawlCity(id: string | null, input: CityInput): Promise<string> {
  const { data, error } = await supabase.rpc('admin_save_crawl_city', {
    p_id: id,
    p_name: input.name,
    p_region: input.region,
    p_max: input.max,
    p_enabled: input.enabled,
  });
  if (error) throw error;
  return String(data);
}

// Puts a city back in line for the next run.
export async function runCrawlCityAgain(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_run_crawl_city_again', { p_id: id });
  if (error) throw error;
}

export async function deleteCrawlCity(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_crawl_city', { p_id: id });
  if (error) throw error;
}

// The restaurants a city's search returned, with how each was read and how many dishes are stored (migration 135).
export async function listCrawlCityPlaces(cityId: string): Promise<CityPlaceRow[]> {
  const { data, error } = await supabase.rpc('admin_list_crawl_city_places', { p_city_id: cityId });
  if (error) throw error;
  return (data ?? []) as CityPlaceRow[];
}
