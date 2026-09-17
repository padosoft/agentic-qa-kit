import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { BudgetDispatchBlockedError, PostgresBudgetLedger } from '../dist/index.js';

describe('PostgresBudgetLedger', () => {
  it('shares an emergency halt across ledger instances', async () => {
    const dsn = process.env.AQA_TEST_POSTGRES_DSN;
    if (!dsn) {
      console.warn('SKIP: AQA_TEST_POSTGRES_DSN is required for the live PostgreSQL contract');
      return;
    }
    const first = new PostgresBudgetLedger(dsn);
    const second = new PostgresBudgetLedger(dsn);
    const key = `integration-halt-${randomUUID()}`;
    try {
      await first.halt(key, 'provider incident');
      assert.equal(await second.getHaltReason(key), 'provider incident');
      await assert.rejects(
        () => second.reserve(key, 10, 0.01),
        (error: unknown) =>
          error instanceof BudgetDispatchBlockedError &&
          /halted: provider incident/.test(error.message),
      );
    } finally {
      await first.close?.();
      await second.close?.();
    }
  });
});
