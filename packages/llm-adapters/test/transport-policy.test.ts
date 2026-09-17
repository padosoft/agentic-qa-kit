import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertEndpointAllowed } from '../dist/index.js';

describe('LLM endpoint transport policy', () => {
  it('rejects plain HTTP and literal private addresses by default', () => {
    assert.throws(() => assertEndpointAllowed('http://127.0.0.1:11434/v1'), /HTTPS/);
    assert.throws(() => assertEndpointAllowed('https://10.0.0.4/v1'), /private or local/);
    assert.throws(
      () => assertEndpointAllowed('https://metadata.google.internal/v1'),
      /private or local/,
    );
  });

  it('requires explicit opt-in for local HTTP and supports host allow-lists', () => {
    const url = assertEndpointAllowed('http://127.0.0.1:11434/v1', {
      allowPrivateNetwork: true,
      allowedHosts: ['127.0.0.1'],
    });
    assert.equal(url.hostname, '127.0.0.1');
    assert.throws(
      () =>
        assertEndpointAllowed('https://evil.example/v1', { allowedHosts: ['*.trusted.example'] }),
      /allow-list/,
    );
  });

  it('rejects credential-bearing, query-bearing and malformed endpoints', () => {
    assert.throws(() => assertEndpointAllowed('https://user:pass@example.test/v1'), /credentials/);
    assert.throws(() => assertEndpointAllowed('https://example.test/v1?token=secret'), /query/);
    assert.throws(() => assertEndpointAllowed('not-a-url'), /absolute URL/);
  });
});
