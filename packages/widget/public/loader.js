/**
 * CareMax embeddable chat loader.
 * Adds a chat icon in the bottom-right corner; tapping it opens the chat widget.
 * Mobile-friendly: on small screens the panel becomes a bottom sheet (full width, ~75% height).
 *
 * Usage (paste in your site's <body> or before </body>):
 *   <script src="https://your-widget-url/loader.js" data-tenant="YOUR_TENANT_ID" data-theme="light"></script>
 */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script || !script.parentNode) return;

  var tenant = script.getAttribute('data-tenant') || 'demo';
  var theme = script.getAttribute('data-theme') || 'light';
  var base = script.src.replace(/\/(loader\.js)?(\?.*)?$/, '');

  var iframeSrc = base + '/embed.html?tenant=' + encodeURIComponent(tenant) + '&theme=' + encodeURIComponent(theme);

  var BUTTON_SIZE = 56;
  var IFRAME_WIDTH = 360;
  var IFRAME_HEIGHT = 480;
  var OFFSET = 20;
  var Z = 2147483647;
  var MOBILE_BREAK = 480;

  var container = document.createElement('div');
  container.id = 'caremax-embed-root';
  container.style.cssText = 'position:fixed;bottom:0;right:0;width:0;height:0;z-index:' + Z + ';font-family:system-ui,-apple-system,sans-serif;';

  var button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', 'Open chat');
  button.title = 'Chat';
  button.style.cssText = 'width:' + BUTTON_SIZE + 'px;height:' + BUTTON_SIZE + 'px;border-radius:50%;border:none;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;background:#1976d2;color:#fff;transition:transform 0.2s, box-shadow 0.2s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;';
  button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
  button.addEventListener('mouseenter', function () {
    button.style.transform = 'scale(1.05)';
    button.style.boxShadow = '0 4px 16px rgba(0,0,0,0.25)';
  });
  button.addEventListener('mouseleave', function () {
    button.style.transform = 'scale(1)';
    button.style.boxShadow = '0 2px 12px rgba(0,0,0,0.2)';
  });

  var iframe = document.createElement('iframe');
  iframe.src = iframeSrc;
  iframe.title = 'CareMax Chat';

  function isMobile() {
    return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: ' + MOBILE_BREAK + 'px)').matches;
  }

  function applyIframeStyles() {
    var mobile = isMobile();
    var bottom = (OFFSET + BUTTON_SIZE + 2) + 'px';
    if (mobile) {
      iframe.style.left = '0';
      iframe.style.right = '0';
      iframe.style.top = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.maxHeight = '';
      iframe.style.borderRadius = '0';
    } else {
      iframe.style.top = '';
      iframe.style.left = '';
      iframe.style.right = OFFSET + 'px';
      iframe.style.bottom = bottom;
      iframe.style.width = IFRAME_WIDTH + 'px';
      iframe.style.height = IFRAME_HEIGHT + 'px';
      iframe.style.maxHeight = '';
      iframe.style.borderRadius = '12px';
    }
    iframe.style.position = 'fixed';
    iframe.style.border = 'none';
    iframe.style.boxShadow = mobile ? 'none' : '0 4px 24px rgba(0,0,0,0.2)';
    iframe.style.zIndex = Z;
    iframe.style.display = open ? 'block' : 'none';
  }

  var open = false;
  function setOpen(nextOpen) {
    open = nextOpen;
    iframe.style.display = open ? 'block' : 'none';
    applyIframeStyles();
    button.setAttribute('aria-label', open ? 'Close chat' : 'Open chat');
    button.title = open ? 'Close chat' : 'Chat';
  }

  function toggle() {
    setOpen(!open);
  }
  button.addEventListener('click', toggle);

  if (typeof window !== 'undefined') {
    window.addEventListener('message', function (event) {
      var data;
      if (typeof event.data === 'string') {
        try {
          data = JSON.parse(event.data);
        } catch (_err) {
          data = { type: event.data };
        }
      } else {
        data = event.data;
      }

      if (!data || data.type !== 'caremax:close-widget') return;
      setOpen(false);
    });
  }

  container.appendChild(button);
  container.appendChild(iframe);
  document.body.appendChild(container);

  button.style.position = 'fixed';
  button.style.bottom = OFFSET + 'px';
  button.style.right = OFFSET + 'px';
  button.style.zIndex = Z + 1;

  applyIframeStyles();
  iframe.style.display = 'none';

  if (typeof window !== 'undefined') {
    var mql = window.matchMedia && window.matchMedia('(max-width: ' + MOBILE_BREAK + 'px)');
    if (mql && mql.addListener) mql.addListener(applyIframeStyles);
    if (mql && mql.addEventListener) mql.addEventListener('change', applyIframeStyles);
    window.addEventListener('resize', applyIframeStyles);
  }
})();
