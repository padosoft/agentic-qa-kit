import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';
import { verifyEventChainBrowser } from '../dist/audit-verify-browser.js';
import {
  CONTROL_MAPPINGS,
  controlsCoverage,
  createAuditCheckpoint,
  parseEventLines,
  verifyAuditCheckpoint,
  verifyEventChain,
} from '../dist/index.js';

const ZERO = '0'.repeat(64);

function canon(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canon(obj[k])}`)
    .join(',')}}`;
}

function makeEvent(prev: string, body: Record<string, unknown>, index: number) {
  const rest = { ...body };
  const hash = createHash('sha256').update(prev).update(canon(rest)).digest('hex');
  return { prev_hash: index === 0 ? null : prev, ...rest, hash };
}

function makeCheckpointChain() {
  const first = makeEvent(ZERO, { run_id: 'run-checkpoint', seq: 0, kind: 'run.start' }, 0);
  const second = makeEvent(first.hash, { run_id: 'run-checkpoint', seq: 1, kind: 'run.end' }, 1);
  return [first, second];
}

describe('controls catalog', () => {
  it('every mapping has at least one SOC2 OR ISO control', () => {
    for (const m of CONTROL_MAPPINGS) {
      assert.ok(m.soc2.length > 0 || m.iso27001.length > 0, `${m.feature} has no controls`);
    }
  });

  it('covers the high-value SOC2 controls', () => {
    const cov = controlsCoverage();
    for (const c of ['CC6.1', 'CC7.1', 'CC8.1'] as const) {
      assert.ok(cov.soc2_covered.includes(c), `missing ${c}`);
    }
  });

  it('covers logging (A.8.15) and access control (A.5.15)', () => {
    const cov = controlsCoverage();
    assert.ok(cov.iso27001_covered.includes('A.8.15'));
    assert.ok(cov.iso27001_covered.includes('A.5.15'));
  });
});

describe('verifyEventChain', () => {
  it('accepts a well-formed 3-event chain', () => {
    const e1 = makeEvent(ZERO, { kind: 'run.start', t: 1 }, 0);
    const e2 = makeEvent(e1.hash, { kind: 'scenario', t: 2 }, 1);
    const e3 = makeEvent(e2.hash, { kind: 'run.end', t: 3 }, 2);
    const result = verifyEventChain([e1, e2, e3]);
    assert.equal(result.ok, true);
    assert.equal(result.count, 3);
  });

  it('rejects a tampered body', () => {
    const e1 = makeEvent(ZERO, { kind: 'run.start', t: 1 }, 0);
    const e2 = makeEvent(e1.hash, { kind: 'scenario', t: 2 }, 1);
    // mutate body without recomputing hash
    const tampered = { ...e2, kind: 'scenario-evil' };
    const result = verifyEventChain([e1, tampered]);
    assert.equal(result.ok, false);
    assert.equal(result.bad_index, 1);
  });

  it('rejects a broken prev_hash link', () => {
    const e1 = makeEvent(ZERO, { kind: 'run.start', t: 1 }, 0);
    const e2 = makeEvent('a'.repeat(64), { kind: 'scenario', t: 2 }, 1);
    const result = verifyEventChain([e1, e2]);
    assert.equal(result.ok, false);
    assert.equal(result.bad_index, 1);
  });
});

describe('parseEventLines', () => {
  it('parses one event per non-empty line', () => {
    const lines = `${JSON.stringify({ prev_hash: null, hash: 'x', a: 1 })}\n\n${JSON.stringify({ prev_hash: 'x', hash: 'y', a: 2 })}\n`;
    const events = parseEventLines(lines);
    assert.equal(events.length, 2);
  });
});

describe('audit checkpoints', () => {
  it('binds the complete event set and rejects truncation or replacement', () => {
    const events = makeCheckpointChain();
    const checkpoint = createAuditCheckpoint(events);
    assert.equal(verifyAuditCheckpoint(events, checkpoint).ok, true);
    assert.equal(verifyAuditCheckpoint(events.slice(0, 1), checkpoint).ok, false);
    assert.equal(verifyAuditCheckpoint([{ ...events[1], seq: 0 }], checkpoint).ok, false);
  });

  it('signs and verifies the checkpoint with an explicit trusted key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const events = makeCheckpointChain();
    const checkpoint = createAuditCheckpoint(events, {
      key_id: 'audit-key-1',
      private_key_pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
    assert.equal(
      verifyAuditCheckpoint(
        events,
        checkpoint,
        publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      ).ok,
      true,
    );
    assert.equal(verifyAuditCheckpoint(events, checkpoint).ok, false);
  });
});

describe('verifyEventChainBrowser', () => {
  it('matches the node verifier and rejects partial or reordered chains', async () => {
    const e1 = makeEvent(ZERO, { kind: 'run.start', t: 1 }, 0);
    const e2 = makeEvent(e1.hash, { kind: 'scenario', t: 2 }, 1);
    const e3 = makeEvent(e2.hash, { kind: 'run.end', t: 3 }, 2);
    assert.equal((await verifyEventChainBrowser([e1, e2, e3])).ok, true);
    assert.equal((await verifyEventChainBrowser([e1, e2, e3], 2)).ok, true);
    assert.equal((await verifyEventChainBrowser([e2, e1])).ok, false);
    assert.equal((await verifyEventChainBrowser([e1, { ...e2, kind: 'altered' }])).bad_index, 1);
  });
});
