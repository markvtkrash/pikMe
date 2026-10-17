import { supabase } from './supabase';
import { AnalyticsSummary, parseSummary } from '../utils/analytics';

// The customer app's anonymous usage numbers (migration 147). Admin only.
export async function getAnalyticsSummary(days: number): Promise<AnalyticsSummary> {
  const { data, error } = await supabase.rpc('admin_analytics_summary', { p_days: days });
  if (error) throw error;
  return parseSummary(data);
}
