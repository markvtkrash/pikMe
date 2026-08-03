-- Migration: 024_menu_nutrition_disclaimer_agreement
-- Purpose: Allow the restaurant-page nutrition disclaimer popup to record its
-- own acknowledgment via the existing record_user_agreement() infrastructure
-- (migration 005). record_user_agreement already upserts on
-- (user_id, agreement_type, version), so calling it every time the popup is
-- dismissed just keeps agreed_at updated to the most recent acknowledgment —
-- no duplicate rows, no new function needed, just a new allowed type value.
-- Date: 2026-07-26

ALTER TABLE public.user_agreements DROP CONSTRAINT IF EXISTS valid_agreement_type;

ALTER TABLE public.user_agreements
  ADD CONSTRAINT valid_agreement_type
  CHECK (agreement_type IN ('privacy_policy', 'terms_of_service', 'food_disclaimer', 'menu_nutrition_disclaimer'));
