// Google Analytics (GA4), loaded only after a visitor accepts the cookie
// banner, and only on the live site. Before consent nothing is sent to Google
// and no cookies are set. Kept in a file (not inline) because the site's
// Content Security Policy blocks inline scripts.
(function () {
  var GA_ID = 'G-78CTEE5H2K';
  var CONSENT_KEY = 'giftbudget-analytics-consent'; // 'granted' | 'denied'
  var LIVE = location.hostname === 'giftingsmart.shop';
  var loaded = false;

  function getConsent() {
    try {
      return localStorage.getItem(CONSENT_KEY);
    } catch (e) {
      return null;
    }
  }

  function saveConsent(value) {
    try {
      localStorage.setItem(CONSENT_KEY, value);
    } catch (e) {
      /* storage blocked: the banner will simply show again next time */
    }
  }

  // Event pages carry IDs; report them generically. Titles are passed in by
  // the app and never include event, gift or people names.
  function normalise(path) {
    return path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
  }

  function pageview(path, title) {
    if (!loaded) return;
    var page = { page_location: location.origin + normalise(path), page_title: title || 'GiftingSmart' };
    // Set as defaults so Google's automatic events (scrolls, clicks) also use
    // the anonymised values instead of document.title, which can contain an
    // event's name.
    window.gtag('set', page);
    window.gtag('event', 'page_view', page);
  }

  function load() {
    if (loaded || !LIVE) return;
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    window.gtag('js', new Date());
    // Page views are sent manually (below) so they can be anonymised.
    // No advertising features: Google signals and ad personalisation are off.
    window.gtag('config', GA_ID, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    var r = api.route;
    pageview(r ? r.path : location.pathname, r ? r.title : document.title);
  }

  // Remove Google Analytics cookies when consent is withdrawn.
  function removeCookies() {
    var host = location.hostname;
    document.cookie.split(';').forEach(function (c) {
      var name = c.split('=')[0].trim();
      if (!/^_ga/.test(name)) return;
      ['', host, '.' + host].forEach(function (domain) {
        document.cookie = name + '=; Max-Age=0; path=/' + (domain ? '; domain=' + domain : '');
      });
    });
  }

  function hideBanner() {
    var el = document.getElementById('consent');
    if (el) el.remove();
  }

  function showBanner() {
    if (document.getElementById('consent')) return;
    var el = document.createElement('section');
    el.id = 'consent';
    el.className = 'consent';
    el.setAttribute('aria-label', 'Cookie consent');
    el.innerHTML =
      '<p>May we use Google Analytics cookies to see how GiftingSmart is used? They’re optional, and nothing is ' +
      'sent to Google unless you accept. <a href="/cookies">Cookie policy</a></p>' +
      '<div class="consent-actions">' +
      '<button type="button" class="btn ghost sm" data-consent="denied">Decline</button>' +
      '<button type="button" class="btn primary sm" data-consent="granted">Accept</button>' +
      '</div>';
    document.body.appendChild(el);
  }

  document.addEventListener('click', function (e) {
    var target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    var choice = target.closest('[data-consent]');
    if (choice) {
      var value = choice.getAttribute('data-consent');
      saveConsent(value);
      hideBanner();
      if (value === 'granted') {
        load();
      } else {
        removeCookies();
        if (loaded) location.reload(); // unload Google's script
      }
      return;
    }
    if (target.closest('[data-cookie-settings]')) {
      e.preventDefault();
      showBanner();
    }
  });

  // Called by the app on every page change.
  var api = (window.giftAnalytics = {
    route: null,
    trackRoute: function (path, title) {
      api.route = { path: path, title: title };
      pageview(path, title);
    },
  });

  function init() {
    if (!LIVE) return;
    var consent = getConsent();
    if (consent === 'granted') load();
    else if (consent !== 'denied') showBanner();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
