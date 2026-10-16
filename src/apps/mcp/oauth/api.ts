import { WAHASelf } from '@waha/apps/app_sdk/waha/WAHASelf';

// Keep the service credential inside the local HTTP API, including on redirects
// and when a tool argument contains path traversal or a query string.
export function oauthApi(key: string): WAHASelf {
  const api = new WAHASelf(key);
  const base = new URL(api.client.defaults.baseURL);
  api.client.defaults.maxRedirects = 0;
  api.client.defaults.proxy = false;
  api.client.interceptors.request.use(function(config) {
    const target = new URL(config.url, base);
    let path: string;
    try {
      path = new URL(
        decodeURIComponent(target.pathname),
        base,
      ).pathname.toLowerCase();
    } catch {
      throw new Error('Invalid internal API path');
    }
    const serverPath = path.replace(/\/+$/, '');
    if (
      target.origin !== base.origin ||
      target.username ||
      target.password ||
      (!path.startsWith('/api/') && path !== '/-json') ||
      (path.startsWith('/api/server') &&
        ![
          '/api/server/version',
          '/api/server/status',
          '/api/server/stop',
        ].includes(serverPath))
    ) {
      throw new Error('This endpoint is unavailable through MCP OAuth');
    }
    config.baseURL = base.origin;
    config.maxRedirects = 0;
    config.proxy = false;
    return config;
  });
  return api;
}
