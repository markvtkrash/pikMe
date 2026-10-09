// Tests for the AI-call settings read by get-chain-menu: nutrition batch size and the per-call time limit.
import {
  aiRetryCutoffMs, DEFAULT_AI_TIMEOUT_SECONDS, DEFAULT_NUTRITION_BATCH_SIZE, MAX_AI_TIMEOUT_SECONDS,
  MAX_NUTRITION_BATCH_SIZE, MIN_AI_TIMEOUT_SECONDS, MIN_NUTRITION_BATCH_SIZE, parseAiTimeoutMs,
  parseNutritionBatchSize, REQUEST_BUDGET_MS,
} from '../../../supabase/functions/get-chain-menu/chainMenuUtils';

describe('parseNutritionBatchSize', () => {
  it('defaults to 10, smaller than the old fixed 20 that timed out with a slower model', () => {
    expect(DEFAULT_NUTRITION_BATCH_SIZE).toBe(10);
    expect(parseNutritionBatchSize()).toBe(10);
    expect(parseNutritionBatchSize(undefined, null, '')).toBe(10);
  });

  it('uses the first valid value, trimmed, between 1 and 50', () => {
    expect(parseNutritionBatchSize(' 8 ')).toBe(8);
    expect(parseNutritionBatchSize(String(MIN_NUTRITION_BATCH_SIZE))).toBe(1);
    expect(parseNutritionBatchSize(String(MAX_NUTRITION_BATCH_SIZE))).toBe(50);
    expect(parseNutritionBatchSize(15)).toBe(15);
  });

  it('skips blank, non-numeric and out-of-range values, so a bad setting never stops a build', () => {
    for (const bad of ['', 'abc', '0', '51', '-5', '2.5', '1e1', '999999999']) {
      expect(parseNutritionBatchSize(bad)).toBe(10);
    }
    expect(parseNutritionBatchSize('banana', '12')).toBe(12);   // falls through to the env var
    expect(parseNutritionBatchSize('0', 'x')).toBe(10);
  });
});

describe('parseAiTimeoutMs', () => {
  it('defaults to 30 seconds, returned in milliseconds', () => {
    expect(DEFAULT_AI_TIMEOUT_SECONDS).toBe(30);
    expect(parseAiTimeoutMs()).toBe(30000);
    expect(parseAiTimeoutMs(undefined, '')).toBe(30000);
  });

  it('reads seconds from 5 to 120', () => {
    expect(parseAiTimeoutMs('45')).toBe(45000);
    expect(parseAiTimeoutMs(String(MIN_AI_TIMEOUT_SECONDS))).toBe(5000);
    expect(parseAiTimeoutMs(String(MAX_AI_TIMEOUT_SECONDS))).toBe(120000);
    expect(parseAiTimeoutMs(20)).toBe(20000);
  });

  it('skips blank, non-numeric and out-of-range values', () => {
    for (const bad of ['', 'x', '4', '121', '-1', '15.5']) expect(parseAiTimeoutMs(bad)).toBe(30000);
    expect(parseAiTimeoutMs('oops', '60')).toBe(60000);
  });
});

describe('aiRetryCutoffMs', () => {
  it('leaves room for a retry only while it could still finish inside the request budget', () => {
    expect(REQUEST_BUDGET_MS).toBe(55000);
    expect(aiRetryCutoffMs(30000)).toBe(25000);
    expect(aiRetryCutoffMs(15000)).toBe(40000);
    expect(aiRetryCutoffMs(45000)).toBe(10000);
  });

  it('is zero (no retry) when the timeout alone uses up the budget', () => {
    expect(aiRetryCutoffMs(55000)).toBe(0);
    expect(aiRetryCutoffMs(120000)).toBe(0);
  });

  it('works with a different budget', () => {
    expect(aiRetryCutoffMs(30000, 100000)).toBe(70000);
  });
});
