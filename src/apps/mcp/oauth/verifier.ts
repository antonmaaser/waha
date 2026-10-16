import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { McpOAuthConfig, oauthUrl } from './config';
import { loadJose } from './jose';

export interface AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<AuthInfo>;
}

async function readMetadata(url: URL): Promise<any> {
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok || !response.body) {
    throw new Error('OAuth discovery failed');
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      size += result.value.byteLength;
      if (size > 1024 * 1024) {
        throw new Error('OAuth metadata is too large');
      }
      chunks.push(Buffer.from(result.value));
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function createOAuthVerifier(
  config: McpOAuthConfig,
): Promise<AccessTokenVerifier> {
  const issuer = new URL(config.issuer);
  const oauthDiscovery = new URL(
    `/.well-known/oauth-authorization-server${issuer.pathname}`,
    issuer,
  );
  const oidcDiscovery = new URL(
    `${config.issuer}/.well-known/openid-configuration`,
  );
  let metadata;
  for (const url of [oauthDiscovery, oidcDiscovery]) {
    try {
      const candidate = await readMetadata(url);
      if (
        candidate.issuer !== config.issuer ||
        !candidate.response_types_supported?.includes('code') ||
        !candidate.code_challenge_methods_supported?.includes('S256')
      ) {
        throw new Error('Invalid OAuth issuer metadata');
      }
      oauthUrl(
        candidate.authorization_endpoint,
        'authorization_endpoint',
        config.allowInsecureHttp,
      );
      oauthUrl(
        candidate.token_endpoint,
        'token_endpoint',
        config.allowInsecureHttp,
      );
      const jwks = oauthUrl(
        candidate.jwks_uri,
        'jwks_uri',
        config.allowInsecureHttp,
      );
      if (jwks.origin !== issuer.origin) {
        throw new Error('JWKS must share issuer origin');
      }
      metadata = candidate;
      break;
    } catch {
      // Try OIDC discovery for providers such as Keycloak.
    }
  }
  if (!metadata) {
    throw new Error('Cannot discover WAHA MCP OAuth issuer/JWKS');
  }
  const jose = await loadJose();
  const keys = jose.createRemoteJWKSet(new URL(metadata.jwks_uri), {
    timeoutDuration: 5000,
    cacheMaxAge: 300_000,
    cooldownDuration: 30_000,
    [jose.customFetch]: function(url, options) {
      return fetch(url, { ...options, redirect: 'error' });
    },
  });
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      try {
        const result = await jose.jwtVerify(token, keys, {
          issuer: config.issuer,
          audience: config.resourceUrl,
          algorithms: ['RS256'],
          requiredClaims: ['exp', 'iat', 'sub'],
          clockTolerance: 0,
        });
        const payload = result.payload;
        const rfc9068 = ['at+jwt', 'application/at+jwt'].includes(
          result.protectedHeader.typ?.toLowerCase(),
        );
        let clientId: unknown;
        if (rfc9068) {
          clientId = payload.client_id;
        } else if (payload.typ === 'Bearer') {
          clientId = payload.azp;
        } else {
          throw new Error();
        }
        if (
          typeof clientId !== 'string' ||
          !clientId ||
          typeof payload.sub !== 'string' ||
          !payload.sub ||
          typeof payload.iat !== 'number' ||
          payload.iat > Date.now() / 1000 ||
          payload.exp <= payload.iat ||
          (payload.scope !== undefined && typeof payload.scope !== 'string')
        ) {
          throw new Error();
        }
        return {
          token: token,
          clientId: clientId,
          scopes: ((payload.scope as string) ?? '').split(' ').filter(Boolean),
          expiresAt: payload.exp,
          resource: new URL(config.resourceUrl),
          extra: { sub: payload.sub },
        };
      } catch {
        throw new InvalidTokenError('Invalid or expired access token');
      }
    },
  };
}
