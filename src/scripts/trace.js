// lilTrace: follow a link's redirect chain via the /trace Netlify function.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- theme (OS-aware, matches the family) ---------- */
const MOON_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
const SUN_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4l1.4-1.4M18 6l1.4-1.4"/></g></svg>';

function setThemeIcon(btn, theme) {
  if (theme === 'dark') { btn.innerHTML = SUN_SVG; btn.setAttribute('aria-label', 'Switch to light mode'); }
  else { btn.innerHTML = MOON_SVG; btn.setAttribute('aria-label', 'Switch to dark mode'); }
}
function initTheme() {
  const btn = $('#ui-theme-btn');
  const current = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  setThemeIcon(btn, current());
  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('liltrace-theme', next); } catch (e) { /* storage may be unavailable; safe to ignore */ }
    setThemeIcon(btn, next);
  });
}

/* ---------- helpers ---------- */
const escHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escHtml(s).replace(/"/g, '&quot;');

function badgeClass(status) {
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 300 && status < 400) return 'redir';
  if (status >= 400) return 'err';
  return 'neutral';
}

/* ---------- render ---------- */
function summaryLine(d) {
  const n = d.redirectCount || 0;
  const word = n === 0 ? 'No redirects' : n === 1 ? '1 redirect' : `${n} redirects`;
  if (d.finalStatus) return `${word}, landed on <strong>${d.finalStatus} ${d.finalContentType ? escHtml(d.finalContentType) : 'OK'}</strong> in ${d.totalMs} ms.`;
  if (d.looped) return `${word}, then looped, in ${d.totalMs} ms.`;
  return `${word} in ${d.totalMs} ms.`;
}

function hopRow(h, i, total) {
  const cls = badgeClass(h.status);
  const isLast = i === total - 1;
  const settled = isLast && !h.location;
  const to = h.location
    ? `<div class="hop-to"><span class="hop-arrow" aria-hidden="true">&#8595;</span> <a href="${escAttr(h.location)}" target="_blank" rel="noopener">${escHtml(h.location)}</a></div>`
    : '';
  const finalTag = settled
    ? `<div class="hop-final">Final destination${h.contentType ? ' &middot; ' + escHtml(h.contentType) : ''}</div>`
    : '';
  return `<div class="hop${settled ? ' hop--final' : ''}">
    <div class="hop-rail"><span class="hop-n">${i + 1}</span></div>
    <div class="hop-body">
      <div class="hop-line">
        <span class="badge badge--${cls}">${h.status || '?'}</span>
        <a class="hop-url" href="${escAttr(h.url)}" target="_blank" rel="noopener">${escHtml(h.url)}</a>
      </div>
      ${to}
      ${finalTag}
    </div>
  </div>`;
}

function note(kind, msg) {
  return `<div class="t-note t-note--${kind}">${escHtml(msg)}</div>`;
}

function renderResult(d) {
  const r = $('#results');
  const hops = d.hops || [];
  if (d.error && !hops.length) { r.innerHTML = note('err', d.error); return; }

  const rows = hops.map((h, i) => hopRow(h, i, hops.length)).join('');
  const loopNote = d.looped ? note('warn', 'Redirect loop: the chain returns to a URL it already visited.') : '';
  const errNote = d.error ? note('warn', d.error) : '';

  r.innerHTML =
    `<div class="t-head"><div class="t-summary">${summaryLine(d)}</div>` +
    `<button class="btn btn--ghost" id="copy-chain" type="button">Copy chain</button></div>` +
    `<div class="chain">${rows}</div>${loopNote}${errNote}`;

  const cc = $('#copy-chain');
  if (cc) cc.addEventListener('click', (e) => copyChain(e.currentTarget, hops));
}

function setLoading() {
  $('#results').innerHTML = '<div class="t-loading"><span class="spin" aria-hidden="true"></span> Following redirects&hellip;</div>';
}

/* ---------- copy ---------- */
function copyChain(btn, hops) {
  const text = hops
    .map((h, i) => `${i + 1}. [${h.status}] ${h.url}${h.location ? '\n   -> ' + h.location : ''}`)
    .join('\n');
  const done = () => { const p = btn.textContent; btn.textContent = 'Copied'; btn.classList.add('btn--done'); setTimeout(() => { btn.textContent = p; btn.classList.remove('btn--done'); }, 1100); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch (e) { /* storage may be unavailable; safe to ignore */ }
  document.body.removeChild(ta); done();
}

/* ---------- run ---------- */
async function run() {
  const raw = $('#f-url').value.trim();
  if (!raw) { $('#f-url').focus(); return; }
  setLoading();
  try {
    const res = await fetch('/.netlify/functions/trace?url=' + encodeURIComponent(raw), { headers: { accept: 'application/json' } });
    const data = await res.json();
    renderResult(data);
  } catch (e) {
    $('#results').innerHTML = note('err', 'Could not reach the tracer service. Please try again in a moment.');
  }
}

function initTrace() {
  initTheme();
  $('#trace-form').addEventListener('submit', (e) => { e.preventDefault(); run(); });
  $$('.ex').forEach((b) =>
    b.addEventListener('click', () => { $('#f-url').value = b.dataset.ex; run(); }));
}

export { initTrace };
