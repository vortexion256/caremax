/**
 * CareMax embeddable chat loader.
 * Usage: <script src="https://your-widget-url/loader.js" data-tenant="YOUR_TENANT_ID" data-theme="light"></script>
 */
(function () {
  const script = document.currentScript as HTMLScriptElement | null;
  if (!script) return;
  const tenant = script.getAttribute('data-tenant') || 'demo';
  const theme = script.getAttribute('data-theme') || 'light';
  const base = script.src.replace(/\/loader\.js.*$/, '');
  const iframe = document.createElement('iframe');
  iframe.src = base + '/embed.html?tenant=' + encodeURIComponent(tenant) + '&theme=' + encodeURIComponent(theme);
  iframe.title = 'CareMax Chat';
  iframe.style.cssText =
    'position:fixed;bottom:20px;right:20px;width:360px;height:400px;border:none;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.2);z-index:999999;';
  document.body.appendChild(iframe);
})();
