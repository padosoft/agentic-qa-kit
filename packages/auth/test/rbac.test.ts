import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OidcAdapter, allows } from '../dist/index.js';

const viewer = { id: '1', email: 'v@x.test', display_name: 'V', roles: ['viewer' as const] };
const dev = { id: '2', email: 'd@x.test', display_name: 'D', roles: ['developer' as const] };
const admin = { id: '3', email: 'a@x.test', display_name: 'A', roles: ['admin' as const] };

describe('allows', () => {
  it('viewer can read runs but cannot create them', () => {
    assert.equal(allows(viewer, 'runs:read'), true);
    assert.equal(allows(viewer, 'runs:create'), false);
  });
  it('developer can create runs and edit findings', () => {
    assert.equal(allows(dev, 'runs:create'), true);
    assert.equal(allows(dev, 'findings:edit'), true);
    assert.equal(allows(dev, 'profiles:edit'), false);
  });
  it('admin holds every permission via admin:everything', () => {
    assert.equal(allows(admin, 'settings:edit'), true);
    assert.equal(allows(admin, 'packs:install'), true);
    assert.equal(allows(admin, 'audit:read'), true);
  });
});

describe('OidcAdapter (scaffold)', () => {
  it('refuses empty issuer / client_id at construction', () => {
    assert.throws(
      () =>
        new OidcAdapter({
          issuer: '',
          client_id: '',
          client_secret_env: '',
          redirect_uri: '',
        }),
    );
  });
  it('authorizeUrl throws "not implemented" until Task 19', () => {
    const a = new OidcAdapter({
      issuer: 'https://idp.example',
      client_id: 'aqa',
      client_secret_env: 'OIDC_SECRET',
      redirect_uri: 'https://aqa.example/callback',
    });
    assert.throws(() => a.authorizeUrl('state-x'), /not implemented/);
  });
});
