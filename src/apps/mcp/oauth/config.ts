export interface McpOAuthConfig {
  issuer: string;
  resourceUrl: string;
  scopes: string[];
  allowInsecureHttp: boolean;
  allowedOrigins: string[];
}

export function oauthEnabled(env = process.env): boolean {
  const value = env.WAHA_MCP_OAUTH_ENABLED ?? 'false';
  if (!['true', 'false'].includes(value)) {
    throw new Error('WAHA_MCP_OAUTH_ENABLED must be true or false');
  }
  return value === 'true';
}

export function oauthUrl(value: string, name: string, allowHttp: boolean): URL {
  try {
    const url = new URL(value);
    if (
      !value ||
      value.trim() !== value ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:'))
    ) {
      throw new Error();
    }
    return url;
  } catch {
    throw new Error(
      `${name} must be an absolute HTTPS URL without credentials, query or fragment`,
    );
  }
}

export function readOAuthConfig(env = process.env): McpOAuthConfig | null {
  if (!oauthEnabled(env)) {
    if (env.WAHA_MCP_OAUTH_ISSUER || env.WAHA_MCP_OAUTH_RESOURCE_URL) {
      throw new Error('Set WAHA_MCP_OAUTH_ENABLED=true to use OAuth settings');
    }
    return null;
  }
  const insecure = env.WAHA_MCP_OAUTH_ALLOW_INSECURE_HTTP ?? 'false';
  if (!['true', 'false'].includes(insecure)) {
    throw new Error('WAHA_MCP_OAUTH_ALLOW_INSECURE_HTTP must be true or false');
  }
  const allowHttp = insecure === 'true';
  const issuer = oauthUrl(
    env.WAHA_MCP_OAUTH_ISSUER,
    'WAHA_MCP_OAUTH_ISSUER',
    allowHttp,
  );
  const resource = oauthUrl(
    env.WAHA_MCP_OAUTH_RESOURCE_URL,
    'WAHA_MCP_OAUTH_RESOURCE_URL',
    allowHttp,
  );
  if (
    issuer.href !== env.WAHA_MCP_OAUTH_ISSUER ||
    issuer.pathname.endsWith('/')
  ) {
    throw new Error(
      'WAHA_MCP_OAUTH_ISSUER must be canonical, without a trailing slash',
    );
  }
  if (
    resource.href !== env.WAHA_MCP_OAUTH_RESOURCE_URL ||
    !resource.pathname.endsWith('/mcp')
  ) {
    throw new Error(
      'WAHA_MCP_OAUTH_RESOURCE_URL must be canonical and end in /mcp',
    );
  }
  const scopes = [
    ...new Set(
      (env.WAHA_MCP_OAUTH_SCOPES ?? 'waha:access').split(/\s+/).filter(Boolean),
    ),
  ];
  if (
    !scopes.length ||
    scopes.some(function(scope) {
      return !/^[\x21\x23-\x5B\x5D-\x7E]+$/.test(scope);
    })
  ) {
    throw new Error(
      'WAHA_MCP_OAUTH_SCOPES must contain space-separated OAuth scopes',
    );
  }
  const origins = (env.WAHA_MCP_OAUTH_ALLOWED_ORIGINS ?? resource.origin)
    .split(/\s+/)
    .filter(Boolean);
  for (const origin of origins) {
    if (
      oauthUrl(origin, 'WAHA_MCP_OAUTH_ALLOWED_ORIGINS', allowHttp).origin !==
      origin
    ) {
      throw new Error(
        'WAHA_MCP_OAUTH_ALLOWED_ORIGINS must contain exact origins',
      );
    }
  }
  return {
    issuer: issuer.href,
    resourceUrl: resource.href,
    scopes: scopes,
    allowInsecureHttp: allowHttp,
    allowedOrigins: origins,
  };
}

export function resourceMetadataUrl(config: McpOAuthConfig): string {
  const resource = new URL(config.resourceUrl);
  return new URL(
    `/.well-known/oauth-protected-resource${resource.pathname}`,
    resource,
  ).href;
}
