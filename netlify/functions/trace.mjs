// lilTrace redirect tracer.
// Follows a URL's redirect chain server-side (browsers can't read cross-origin
// redirects) and returns every hop, the final destination, and timing.

const MAX_HOPS = 20;
const TIMEOUT_MS = 10000;

// Block local / private / link-local targets so the tracer can't be pointed at
// internal infrastructure (basic SSRF guard). Checked on every hop, since a
// public URL can redirect to a private one.
function isBlockedHost(hostname) {
  const h = (hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  return false;
}

function normalizeInput(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : 'https://' + s;
}

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(obj),
});

export const handler = async (event) => {
  const raw = event.queryStringParameters && event.queryStringParameters.url;
  const start = normalizeInput(raw);
  if (!start) return json(400, { error: 'Enter a URL to trace.' });

  let startUrl;
  try { startUrl = new URL(start); } catch { return json(400, { error: 'That does not look like a valid URL.' }); }
  if (!/^https?:$/.test(startUrl.protocol)) return json(400, { error: 'Only http and https links can be traced.' });

  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const hops = [];
  const seen = new Set();
  let current = startUrl.toString();
  let error = null;
  let looped = false;
  let timedOut = false;

  try {
    for (let i = 0; i < MAX_HOPS; i++) {
      const host = (() => { try { return new URL(current).hostname; } catch { return ''; } })();
      if (isBlockedHost(host)) { error = 'For safety, this tracer will not follow links to local or private addresses.'; break; }
      if (seen.has(current)) { looped = true; break; }
      seen.add(current);

      let resp;
      try {
        resp = await fetch(current, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'user-agent': 'lilTrace/1.0 (+https://liltrace.netlify.app)', accept: '*/*' },
        });
      } catch (e) {
        if (e && e.name === 'AbortError') { timedOut = true; }
        else { error = i === 0 ? 'Could not reach that URL. Check the link and try again.' : 'A redirect target could not be reached.'; }
        break;
      }

      const status = resp.status;
      const loc = resp.headers.get('location');
      const ctype = resp.headers.get('content-type') || '';
      const isRedirect = status >= 300 && status < 400 && !!loc;
      let nextAbs = null;
      if (isRedirect) { try { nextAbs = new URL(loc, current).toString(); } catch { nextAbs = loc; } }

      hops.push({ url: current, status, statusText: resp.statusText || '', contentType: ctype.split(';')[0] || '', location: isRedirect ? nextAbs : null });

      if (!isRedirect) break;
      current = nextAbs;
      if (i === MAX_HOPS - 1) error = 'Stopped after ' + MAX_HOPS + ' redirects. The chain may be longer or looping.';
    }
  } finally {
    clearTimeout(timer);
  }

  if (controller.signal.aborted) timedOut = true;
  if (timedOut && !error) error = 'The trace timed out after ' + (TIMEOUT_MS / 1000) + ' seconds.';

  const last = hops.length ? hops[hops.length - 1] : null;
  const settled = last && !last.location;

  return json(200, {
    start: startUrl.toString(),
    hops,
    redirectCount: hops.filter((h) => h.location).length,
    finalUrl: looped ? current : settled ? last.url : last ? last.location : null,
    finalStatus: settled ? last.status : null,
    finalContentType: settled ? last.contentType : null,
    totalMs: Date.now() - t0,
    looped,
    error,
  });
};
