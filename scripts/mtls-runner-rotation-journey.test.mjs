import assert from 'node:assert/strict';
import test from 'node:test';
import { runMtlsRunnerRotationJourney } from './mtls-runner-rotation-journey.mjs';

test('mTLS journey fails before writing credentials when configuration is incomplete', async () => {
  await assert.rejects(runMtlsRunnerRotationJourney({}), /AQA_TEST_MTLS_HEALTH_URL is required/);
});
