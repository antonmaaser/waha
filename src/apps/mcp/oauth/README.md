# MCP OAuth

This optional resource-server integration stays inside `src/apps/mcp`. It uses
WAHA's existing HTTP-path and bootstrap hooks, without changing global REST,
dashboard, or engine authentication. With OAuth disabled, MCP keeps its existing
API-key authentication.

Enable the MCP app and configure an external authorization server:

```dotenv
WAHA_APPS_ENABLED=true
WAHA_APPS_ON=mcp
WAHA_MCP_OAUTH_ENABLED=true
WAHA_MCP_OAUTH_ISSUER=https://auth.example.com/issuer
WAHA_MCP_OAUTH_RESOURCE_URL=https://waha.example.com/mcp
WAHA_MCP_OAUTH_SCOPES=waha:access
```

Keep the existing WAHA API key configured. When `WAHA_API_KEY` is a `sha512:`
hash, also supply the matching `WAHA_API_KEY_PLAIN` on the server. OAuth clients
send only `Authorization: Bearer <access-token>`. Their tokens are never forwarded
to the internal API, and their API-key headers cannot override its credential.

The configured scope grants access to this WAHA instance's MCP tools and
WhatsApp sessions using the server's API permissions. It does not implement
per-user/session tenancy. Only grant it to users trusted with that access.
In OAuth mode, `api-call` and `server-environment` are excluded; internal requests
also block environment/debug endpoints, external destinations, and redirects to
protect the service credential.

The issuer must advertise authorization-code flow with S256 PKCE and a
same-origin JWKS URL. Discovery uses RFC 8414 with OIDC fallback. Verification
accepts RS256 RFC 9068 access tokens (`at+jwt` and `client_id`) or Keycloak
access tokens (`typ: Bearer` and `azp`), and checks issuer, exact resource audience,
expiry, issued-at, subject, and required scopes. Login, consent, refresh, client
registration/CIMD, and token issuance remain the external server's responsibility.
No OAuth client secret or client registration is configured in WAHA.

The reverse proxy must preserve `Host` and `Authorization`, forward `/mcp`,
`/.well-known/oauth-protected-resource/mcp`, and
`/.well-known/oauth-protected-resource`. For a resource such as
`https://waha.example.com/prefix/mcp`, forward
`/.well-known/oauth-protected-resource/prefix/mcp` as well and rewrite the public
`/prefix/mcp` route to WAHA's local `/mcp`. Preserve the public host, including
its port when nonstandard. Missing/invalid tokens receive a bearer challenge;
missing scopes receive HTTP 403. GET and DELETE return HTTP 405 after authentication
because the transport is stateless and does not provide a standalone SSE stream.

Requests without `Origin` are accepted. Browser origins default to the public
resource origin; add exact space-separated origins with
`WAHA_MCP_OAUTH_ALLOWED_ORIGINS` when needed. HTTPS is required for configured URLs;
`WAHA_MCP_OAUTH_ALLOW_INSECURE_HTTP=true` is a local-development override.

The existing Compose service loads these settings from `.env`; no additional
service or deployment layout is required. Public TLS, reverse-proxy behavior,
and an actual client's login/refresh flow still require deployment validation.

References: [MCP authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization),
[RFC 9728](https://www.rfc-editor.org/rfc/rfc9728),
[RFC 9068](https://www.rfc-editor.org/rfc/rfc9068).
