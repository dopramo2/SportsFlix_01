// DevTools / debugger blocking removed so developers can inspect the page.
(function () {
  const ua = navigator.userAgent.toLowerCase();
  const blockedAgents = ["1dm", "1dm+", "idm", "adm", "advanced download manager"];

  // Best-effort: log suspicious user-agents but do not block or close the page.
  if (blockedAgents.some(tag => ua.includes(tag))) {
    try { console.warn("Blocked agent UA:", ua); } catch (e) {}
  }

  // Intentionally do NOT prevent contextmenu/selectstart/dragstart or block keys.
  // All debugger/devtools detection and page-closing code removed.
})();

