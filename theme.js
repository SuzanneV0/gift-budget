// Runs before the page is drawn: applies a saved light/dark choice (no flash)
// and marks the page as JS-enabled so the static crawlable intro can be hidden.
(function () {
  var root = document.documentElement;
  root.classList.add('js');
  try {
    var theme = localStorage.getItem('giftbudget-theme');
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  } catch (e) {
    /* storage blocked: follow the system setting */
  }
})();
