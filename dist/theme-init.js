/* Apply the saved theme before first paint so a dark-theme open never flashes white.
   Kept as an external file (not inline) because the MV3 popup CSP forbids inline scripts. */
try {
  var t = localStorage.getItem('fw_theme')
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t
} catch (e) { /* ignore */ }
