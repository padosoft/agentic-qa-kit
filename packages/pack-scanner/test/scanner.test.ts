import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  manifestDigest,
  packContentDigest,
  scanPack,
  verifyManifestDigest,
  verifyPackContentDigest,
  verifySignature,
  verifySigstoreBundle,
  verifyTrustedManifestSignature,
} from '../dist/index.js';

const BASE = {
  schema_version: '1' as const,
  name: 'pack-x',
  version: '0.1.0',
  description: 'demo',
  author: 'a',
  license: 'Apache-2.0' as const,
  applies_when: {},
  templates: [],
  scenarios: [],
  risks: ['risks/r.yaml'],
  oracles: [],
  probes: [],
};

describe('scanPack', () => {
  it('clean pack returns ok=true and zero non-low issues', () => {
    const r = scanPack(BASE);
    assert.ok(r.issues.every((i) => i.severity === 'low'));
  });

  it('flags unsigned shell-kind probe', () => {
    const r = scanPack({ ...BASE, probes: ['probes/shell.yaml'] });
    assert.ok(r.issues.some((i) => i.rule === 'unsigned-shell-pack'));
    assert.equal(r.ok, false);
  });

  it('flags always-on + shell as high-severity', () => {
    const r = scanPack({ ...BASE, probes: ['probes/shell.yaml'], applies_when: {} });
    assert.ok(r.issues.some((i) => i.rule === 'always-on-shell-pack'));
  });

  it('flags templates without risks (low severity)', () => {
    const r = scanPack({ ...BASE, templates: ['t.tpl'], risks: [] });
    assert.ok(r.issues.some((i) => i.rule === 'templates-without-risks'));
    assert.equal(r.ok, true); // low-only issues do not fail ok
  });
});

describe('verifySignature', () => {
  it('passes when sha256 matches the canonical body', () => {
    const body = 'name: pack-x';
    const digest = createHash('sha256').update(body).digest('hex');
    const r = verifySignature({ ...BASE, signing: { sha256: digest } }, body);
    assert.equal(r.ok, true);
  });
  it('fails on mismatch', () => {
    const r = verifySignature({ ...BASE, signing: { sha256: 'a'.repeat(64) } }, 'different body');
    assert.equal(r.ok, false);
    assert.match(r.reason, /digest mismatch/);
  });
  it('fails when manifest does not declare a signature', () => {
    const r = verifySignature(BASE, 'whatever');
    assert.equal(r.ok, false);
    assert.match(r.reason, /does not declare/);
  });
});

describe('verifyManifestDigest', () => {
  it('verifies the parsed JSON representation without signing recursion', () => {
    const digest = manifestDigest(BASE);
    const signed = { ...BASE, signing: { sha256: digest } };
    assert.equal(verifyManifestDigest(signed).ok, true);
    assert.equal(verifyManifestDigest({ ...signed, description: 'tampered' }).ok, false);
  });
});

describe('verifyTrustedManifestSignature', () => {
  it('verifies an Ed25519 signature against an operator trust root', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const keyId = 'release-key-1';
    const signature = sign(null, Buffer.from(manifestDigest(BASE), 'utf8'), privateKey).toString(
      'base64url',
    );
    const signed = {
      ...BASE,
      signing: { sha256: 'a'.repeat(64), key_id: keyId, ed25519_signature: signature },
    };
    assert.equal(
      verifyTrustedManifestSignature(signed, {
        [keyId]: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      }).ok,
      true,
    );
    assert.equal(verifyTrustedManifestSignature(signed, {}).ok, false);
    assert.equal(
      verifyTrustedManifestSignature(
        { ...signed, description: 'tampered' },
        {
          [keyId]: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        },
      ).ok,
      false,
    );
  });
});

describe('packContentDigest', () => {
  it('detects tampering in a scenario file, not only the manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-pack-digest-'));
    mkdirSync(join(root, 'scenarios'));
    writeFileSync(join(root, 'pack.yaml'), 'presentation', 'utf8');
    writeFileSync(join(root, 'scenarios', 'one.yaml'), 'expected: 200\n', 'utf8');
    const digest = packContentDigest(root, BASE);
    const signed = { ...BASE, signing: { sha256: 'a'.repeat(64), content_sha256: digest } };
    assert.equal(verifyPackContentDigest(root, signed).ok, true);
    writeFileSync(join(root, 'scenarios', 'one.yaml'), 'expected: 500\n', 'utf8');
    assert.equal(verifyPackContentDigest(root, signed).ok, false);
  });
});

describe('verifySigstoreBundle', () => {
  it('requires an explicit identity policy and fails closed on malformed bundles', async () => {
    const missingPolicy = await verifySigstoreBundle(
      { ...BASE, signing: { sha256: 'a'.repeat(64), sigstore_bundle: '{}' } },
      {},
    );
    assert.equal(missingPolicy.ok, false);
    assert.match(missingPolicy.reason, /policy requires/i);
    const malformed = await verifySigstoreBundle(
      { ...BASE, signing: { sha256: 'a'.repeat(64), sigstore_bundle: '{}' } },
      {
        certificate_identity: 'release@example.test',
        certificate_oidc_issuer: 'https://issuer.test',
      },
    );
    assert.equal(malformed.ok, false);
    assert.match(malformed.reason, /Sigstore verification failed/i);
  });
});
