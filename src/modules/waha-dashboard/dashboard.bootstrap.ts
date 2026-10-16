// This function is served as a classic script before the Nuxt application runs.
// It contains no credentials; authentication remains in an HttpOnly cookie.
export function dashboardBootstrap(
  marker: string,
  refreshInterval: number,
): void {
  const origin = window.location.origin;
  let servers;
  try {
    servers = JSON.parse(localStorage.getItem('servers') || '[]');
  } catch {
    servers = [];
  }
  if (!Array.isArray(servers)) {
    servers = [];
  }
  let found = false;
  for (const server of servers) {
    if (!server || !server.connection) {
      continue;
    }
    try {
      const url = new URL(server.connection.url);
      if (url.origin !== origin || url.pathname !== '/') {
        continue;
      }
      server.connection.key = marker;
      found = true;
    } catch {
      continue;
    }
  }
  if (!found) {
    const id = servers.some(function(server) {
      return server?.id === 'waha_000000000000000001';
    })
      ? 'waha_dashboard_local'
      : 'waha_000000000000000001';
    servers.push({
      id: id,
      name: 'WAHA',
      connection: { url: origin, key: marker },
    });
  }
  localStorage.setItem('servers', JSON.stringify(servers));

  function refresh(): void {
    if (document.visibilityState === 'hidden') {
      return;
    }
    // Fetching refreshes Set-Cookie; do not evaluate or persist the response.
    fetch('/dashboard/bootstrap.js', {
      credentials: 'same-origin',
      cache: 'no-store',
    }).catch(function() {
      /* Retry on the next timer or focus event. */
    });
  }
  window.setInterval(refresh, refreshInterval);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
}
