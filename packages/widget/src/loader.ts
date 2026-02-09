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
  const script = document.currentScript as HTMLScriptElement | null;
  if (!script || !script.parentNode) return;

  const tenant = script.getAttribute('data-tenant') || 'demo';
  const theme = script.getAttribute('data-theme') || 'light';
  const base = script.src.replace(/\/(loader\.js)?(\?.*)?$/, '');

  const iframeSrc =
    base + '/embed.html?tenant=' + encodeURIComponent(tenant) + '&theme=' + encodeURIComponent(theme);

  const BUTTON_SIZE = 56; // Desktop fixed size
  const BUTTON_SIZE_MOBILE = '12vw'; // Mobile: 12% of viewport width
  const IFRAME_WIDTH = 360;
  const IFRAME_HEIGHT = 480;
  const OFFSET = 20; // Desktop fixed offset
  const OFFSET_MOBILE = '2vw'; // Mobile: 2% of viewport width
  const Z = 2147483647;
  const MOBILE_BREAK = 480;

  const container = document.createElement('div');
  container.id = 'caremax-embed-root';
  container.style.cssText =
    'position:fixed;bottom:0;right:0;width:0;height:0;z-index:' +
    Z +
    ';font-family:system-ui,-apple-system,sans-serif;';

  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', 'Open chat');
  button.title = 'Chat';
  
  function isMobile(): boolean {
    return typeof window !== 'undefined' && window.matchMedia?.('(max-width: ' + MOBILE_BREAK + 'px)').matches;
  }
  
  function applyButtonStyles(): void {
    const mobile = isMobile();
    const size = mobile ? BUTTON_SIZE_MOBILE : BUTTON_SIZE + 'px';
    const offset = mobile ? OFFSET_MOBILE : OFFSET + 'px';
    
    // Set base styles
    button.style.borderRadius = '50%';
    button.style.border = 'none';
    button.style.cursor = 'pointer';
    button.style.boxShadow = '0 2px 12px rgba(0,0,0,0.2)';
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.style.background = '#1976d2';
    button.style.color = '#fff';
    button.style.transition = 'transform 0.2s, box-shadow 0.2s';
    button.style.webkitTapHighlightColor = 'transparent';
    button.style.touchAction = 'manipulation';
    
    // Set dynamic size and position
    button.style.width = size;
    button.style.height = size;
    button.style.bottom = offset;
    button.style.right = offset;
    
    // Update SVG size based on mobile state
    const svgSize = mobile ? '60%' : '28';
    button.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${svgSize}" height="${svgSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
  }
  
  applyButtonStyles();
  button.addEventListener('mouseenter', function () {
    button.style.transform = 'scale(1.05)';
    button.style.boxShadow = '0 4px 16px rgba(0,0,0,0.25)';
  });
  button.addEventListener('mouseleave', function () {
    button.style.transform = 'scale(1)';
    button.style.boxShadow = '0 2px 12px rgba(0,0,0,0.2)';
  });

  const iframe = document.createElement('iframe');
  iframe.src = iframeSrc;
  iframe.title = 'CareMax Chat';

  let open = false;
  function applyIframeStyles(): void {
    const mobile = isMobile();
    const offset = mobile ? OFFSET_MOBILE : OFFSET + 'px';
    const buttonSize = mobile ? '12vw' : (BUTTON_SIZE + 2) + 'px';
    const bottom = mobile ? '0' : `calc(${offset} + ${buttonSize})`;
    
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
      iframe.style.right = offset;
      iframe.style.bottom = bottom;
      iframe.style.width = IFRAME_WIDTH + 'px';
      iframe.style.height = IFRAME_HEIGHT + 'px';
      iframe.style.maxHeight = '';
      iframe.style.borderRadius = '12px';
    }
    iframe.style.position = 'fixed';
    iframe.style.border = 'none';
    iframe.style.boxShadow = mobile ? 'none' : '0 4px 24px rgba(0,0,0,0.2)';
    iframe.style.zIndex = String(Z);
    iframe.style.display = open ? 'block' : 'none';
  }

  function toggle(): void {
    open = !open;
    iframe.style.display = open ? 'block' : 'none';
    applyIframeStyles();
    button.setAttribute('aria-label', open ? 'Close chat' : 'Open chat');
    button.title = open ? 'Close chat' : 'Chat';
  }
  button.addEventListener('click', toggle);

  container.appendChild(button);
  container.appendChild(iframe);
  document.body.appendChild(container);

  button.style.position = 'fixed';
  button.style.zIndex = String(Z + 1);
  applyButtonStyles(); // Apply initial button styles

  applyIframeStyles();
  iframe.style.display = 'none';

  if (typeof window !== 'undefined') {
    const mql = window.matchMedia?.('(max-width: ' + MOBILE_BREAK + 'px)');
    const handleResize = () => {
      applyButtonStyles();
      applyIframeStyles();
    };
    if (mql?.addListener) mql.addListener(handleResize);
    if (mql?.addEventListener) mql.addEventListener('change', handleResize);
    window.addEventListener('resize', handleResize);
  }
})();
