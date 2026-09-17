import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';
import { BudgetDispatchBlockedError, BudgetTracker } from '../dist/budget.js';
import {
  parsePricingCatalog,
  signPricingCatalog,
  verifySignedPricingCatalog,
} from '../dist/catalog.js';
import { MemoryBudgetLedger } from '../dist/ledger.js';
import { BudgetReaper } from '../dist/reaper.js';

describe('BudgetTracker', () => {
  it('charges per-call cost based on input + output tokens', () => {
    const t = new BudgetTracker({ budget_usd: 100 });
    const s = t.charge({ model: 'claude-sonnet-4-6', tokens_in: 1_000_000, tokens_out: 1_000_000 });
    // input 1M * $3 + output 1M * $15 = $18
    assert.equal(Math.round(s.spent_usd * 100) / 100, 18);
    assert.equal(s.calls, 1);
    assert.equal(s.exhausted, false);
  });

  it('flips exhausted=true when the spend would reach the budget', () => {
    const t = new BudgetTracker({ budget_usd: 1 });
    const s = t.charge({ model: 'claude-sonnet-4-6', tokens_in: 100_000, tokens_out: 100_000 });
    // 100k in * $3/Mtok + 100k out * $15/Mtok = 0.3 + 1.5 = 1.8 → exhausted
    assert.equal(s.exhausted, true);
  });

  it('unlimited budget (null) never exhausts', () => {
    const t = new BudgetTracker({ budget_usd: null });
    const s = t.charge({ model: 'claude-opus-4-7', tokens_in: 10_000_000, tokens_out: 10_000_000 });
    assert.equal(s.exhausted, false);
  });

  it('wouldExhaust answers a hypothetical without mutating', () => {
    const t = new BudgetTracker({ budget_usd: 1 });
    assert.equal(
      t.wouldExhaust({ model: 'claude-sonnet-4-6', tokens_in: 100_000, tokens_out: 100_000 }),
      true,
    );
    assert.equal(t.snapshot().calls, 0);
  });

  it('unknown model fails closed instead of silently contributing zero cost', () => {
    const t = new BudgetTracker({ budget_usd: 100 });
    const s = t.charge({ model: 'unknown-llm', tokens_in: 1000, tokens_out: 1000 });
    assert.equal(s.spent_usd, 0);
    assert.equal(s.tokens_in, 1000);
    assert.equal(s.exhausted, true);
    assert.match(s.pricing_error ?? '', /no pricing configured/);
    assert.equal(t.wouldExhaust({ model: 'unknown-llm', tokens_in: 1, tokens_out: 1 }), true);
  });

  it('blocks dispatch before a call would cross the budget', () => {
    const t = new BudgetTracker({ budget_usd: 1 });
    assert.throws(
      () =>
        t.assertCanDispatch({
          model: 'claude-sonnet-4-6',
          tokens_in: 100_000,
          tokens_out: 100_000,
        }),
      BudgetDispatchBlockedError,
    );
    assert.equal(t.snapshot().calls, 0);
  });

  it('supports an explicit fail-closed kill switch', () => {
    const t = new BudgetTracker({ budget_usd: null });
    const state = t.halt('operator emergency stop');
    assert.equal(state.halted_reason, 'operator emergency stop');
    assert.throws(
      () => t.assertCanDispatch({ model: 'claude-sonnet-4-6', tokens_in: 1, tokens_out: 1 }),
      /operator emergency stop/,
    );
  });

  it('rejects invalid budgets and token counts', () => {
    assert.throws(() => new BudgetTracker({ budget_usd: -1 }), /budget_usd/);
    const t = new BudgetTracker({ budget_usd: 10 });
    assert.throws(
      () => t.charge({ model: 'claude-sonnet-4-6', tokens_in: -1, tokens_out: 0 }),
      /token counts/,
    );
  });

  it('pins a versioned pricing catalog digest into tracker state', () => {
    const catalog = parsePricingCatalog({
      schema_version: '1',
      version: '2026-q3',
      effective_at: '2026-07-01T00:00:00Z',
      models: { 'test-model': { input_per_mtok: 1, output_per_mtok: 2 } },
    });
    const tracker = new BudgetTracker({ budget_usd: 1, pricing_catalog: catalog });
    assert.equal(tracker.snapshot().pricing_version, '2026-q3');
    assert.equal(tracker.snapshot().pricing_sha256, catalog.sha256);
    assert.throws(() => parsePricingCatalog({ ...catalog, sha256: 'bad' }), /sha256 mismatch/);
    assert.throws(
      () => parsePricingCatalog({ ...catalog, effective_at: '2026-07-01' }),
      /ISO UTC timestamp/,
    );
  });

  it('requires a trusted Ed25519 signature for operator pricing provenance', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const publicPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
    const catalog = parsePricingCatalog({
      schema_version: '1',
      version: '2026-q4',
      effective_at: '2026-10-01T00:00:00Z',
      models: { 'test-model': { input_per_mtok: 1, output_per_mtok: 2 } },
    });
    const signed = signPricingCatalog(catalog, privatePem, 'pricing-key-1');
    assert.equal(
      verifySignedPricingCatalog(signed, { 'pricing-key-1': publicPem }).signing.key_id,
      'pricing-key-1',
    );
    assert.throws(
      () =>
        verifySignedPricingCatalog(
          { ...signed, version: 'tampered' },
          { 'pricing-key-1': publicPem },
        ),
      /signature mismatch|sha256 mismatch/,
    );
    assert.throws(() => verifySignedPricingCatalog(signed, {}), /not trusted/);
  });
});

describe('MemoryBudgetLedger', () => {
  it('reserves atomically and releases the estimate on settlement', async () => {
    const ledger = new MemoryBudgetLedger();
    const first = await ledger.reserve('org/project', 1, 0.6);
    await assert.rejects(
      () => ledger.reserve('org/project', 1, 0.5),
      /distributed budget exhausted/,
    );
    await ledger.settle(first, 0.2, {
      model: 'test-model',
      tokens_in: 10,
      tokens_out: 4,
      pricing_version: '2026-q3',
      pricing_sha256: 'a'.repeat(64),
    });
    const second = await ledger.reserve('org/project', 1, 0.7);
    await ledger.settle(second, 0.7);
    await ledger.settle(second, 0.7);
  });

  it('reaps an orphaned reservation after its TTL', async () => {
    const ledger = new MemoryBudgetLedger();
    await ledger.reserve('org/reaper', 1, 0.8, 10);
    assert.equal(await ledger.reapExpired(new Date(Date.now() + 11)), 1);
    const next = await ledger.reserve('org/reaper', 1, 0.8, 10);
    assert.ok(next);
  });

  it('persists an irreversible halt across future admissions', async () => {
    const ledger = new MemoryBudgetLedger();
    await ledger.halt('org/halted', 'operator emergency stop');
    assert.equal(await ledger.getHaltReason('org/halted'), 'operator emergency stop');
    await assert.rejects(
      () => ledger.reserve('org/halted', 10, 0.01),
      /distributed budget exhausted|halted: operator emergency stop/,
    );
  });

  it('runs a bounded reaper tick and tolerates repeated start/stop', async () => {
    const ledger = new MemoryBudgetLedger();
    await ledger.reserve('org/scheduled', 1, 0.8, 10);
    const reaper = new BudgetReaper(ledger, { interval_ms: 100 });
    assert.equal(await reaper.runOnce(new Date(Date.now() + 11)), 1);
    reaper.start();
    reaper.start();
    reaper.stop();
    reaper.stop();
    assert.equal(await ledger.reapExpired(new Date(Date.now() + 12)), 0);
  });
});
