(function () {
  if (!/Android|iPhone|iPad/i.test(navigator.userAgent)) return;
  var theme = 'dark';
  try { if (localStorage.getItem('dmex_mobile_appearance') === 'light') theme = 'light'; } catch (_) {}
  document.documentElement.dataset.mobileLaunch = theme;
})();
