export function parseRemoteOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('OMP_BACKLOG_ORIGIN must be an HTTPS origin without a port, credentials, path, query, or fragment');
  }
  return url.origin;
}

export function requestOrigin(host: string, remoteOrigin?: string): string | undefined {
  if (/^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/.test(host)) return `http://${host}`;
  if (remoteOrigin === `https://${host}`) return remoteOrigin;
  return undefined;
}
