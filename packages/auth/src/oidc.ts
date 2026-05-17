import type { AuthSession } from './types.js';

export interface OidcConfig {
  issuer: string;
  client_id: string;
  client_secret_env: string;
  redirect_uri: string;
}

/**
 * OIDC adapter scaffold. v0.3 ships the typed surface and a refusal at run
 * time so operators do not silently fall back to "anonymous admin"; the real
 * Authorization Code + PKCE flow lands with the server extraction (Task 19).
 */
export class OidcAdapter {
  constructor(private readonly config: OidcConfig) {
    if (!config.issuer || !config.client_id) {
      throw new Error('[auth/oidc] issuer and client_id are required');
    }
  }

  authorizeUrl(_state: string): string {
    throw new Error(
      `[auth/oidc] authorizeUrl not implemented at v0.3; ships with Task 19. issuer=${this.config.issuer}`,
    );
  }

  async exchangeCode(_code: string): Promise<AuthSession> {
    throw new Error('[auth/oidc] exchangeCode not implemented at v0.3; ships with Task 19.');
  }
}
