// Website snippet, loaded on the customer's site:
//   <script async src="https://APP/api/track/script" data-key="BRAND_TRACKING_KEY"></script>
// It stores the click id (sos_cid) from tracked links in a first-party cookie and exposes
// window.socialos.track('signup', { value, currency, id }) to report conversions.
const SCRIPT = `(function () {
  var s = document.currentScript;
  if (!s) return;
  var key = s.getAttribute('data-key');
  var api = new URL(s.src).origin + '/api/track';
  var K = 'sos_cid';
  function readCookie() {
    var m = document.cookie.match(/(?:^|; )sos_cid=([0-9a-f-]{36})/i);
    return m ? m[1] : null;
  }
  function stored() {
    try { return readCookie() || localStorage.getItem(K); } catch (e) { return readCookie(); }
  }
  var params = new URLSearchParams(location.search);
  var cid = params.get(K);
  if (cid && /^[0-9a-f-]{36}$/i.test(cid)) {
    document.cookie = K + '=' + cid + '; path=/; max-age=' + 90 * 86400 + '; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
    try { localStorage.setItem(K, cid); } catch (e) {}
    params.delete(K);
    var q = params.toString();
    history.replaceState(history.state, '', location.pathname + (q ? '?' + q : '') + location.hash);
  }
  function track(event, opts) {
    opts = opts || {};
    var clickId = stored();
    if (!clickId || !key) return false;
    var body = JSON.stringify({ key: key, cid: clickId, event: event, value: opts.value, currency: opts.currency, id: opts.id });
    if (navigator.sendBeacon && navigator.sendBeacon(api, new Blob([body], { type: 'text/plain' }))) return true;
    fetch(api, { method: 'POST', body: body, keepalive: true, mode: 'no-cors' });
    return true;
  }
  var queued = (window.socialos && window.socialos.q) || [];
  window.socialos = { track: track, clickId: stored };
  queued.forEach(function (a) { track(a[0], a[1]); });
})();
`;

export function GET() {
  return new Response(SCRIPT, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
