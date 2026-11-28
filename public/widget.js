/* FrontDesk AI website chat (Pro). Paste once, just before </body>:
 *
 *   <script src="https://frontdeskai.company/widget.js" data-key="fdw_YOUR_KEY" async></script>
 *
 * Optional: data-accent="#4f46e5" to match the site, data-lang="es" for Spanish
 * (otherwise the page's <html lang> decides).
 *
 * This file only places an iframe from our domain in the corner of the page;
 * the chat itself runs inside that frame, isolated from the site's scripts
 * and styles. The frame only renders on the domains the owner allowed.
 * No cookies, no storage.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script || window.__frontdeskChat) return;
  var key = script.getAttribute("data-key");
  if (!key) {
    if (script.getAttribute("data-client")) {
      console.warn("FrontDesk chat: this snippet is out of date. Copy the new one from Settings → Follow-ups → For your website.");
    }
    return;
  }
  window.__frontdeskChat = true;
  var origin = new URL(script.src).origin;
  var lang = (script.getAttribute("data-lang") || document.documentElement.lang || navigator.language || "en").slice(0, 2);
  var accent = script.getAttribute("data-accent") || "";

  var CLOSED = { w: "96px", h: "96px" };
  var frame = document.createElement("iframe");
  frame.title = "Chat";
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
  frame.setAttribute("allow", "");
  frame.setAttribute("referrerpolicy", "origin");
  frame.src =
    origin + "/widget/frame?key=" + encodeURIComponent(key) +
    "&lang=" + encodeURIComponent(lang) +
    (/^#[0-9a-f]{6}$/i.test(accent) ? "&accent=" + encodeURIComponent(accent) : "");
  var s = frame.style;
  s.position = "fixed";
  s.right = "0";
  s.bottom = "0";
  s.width = "0";
  s.height = "0";
  s.border = "0";
  s.background = "transparent";
  s.colorScheme = "light";
  s.zIndex = "2147483000";
  s.maxWidth = "100vw";
  s.maxHeight = "100vh";

  function size(open) {
    if (!open) {
      s.width = CLOSED.w;
      s.height = CLOSED.h;
    } else if (window.innerWidth <= 480) {
      s.width = "100vw";
      s.height = "100vh";
    } else {
      s.width = "min(420px, 100vw)";
      s.height = "min(680px, calc(100vh - 16px))";
    }
  }

  window.addEventListener("message", function (e) {
    if (e.origin !== origin || e.source !== frame.contentWindow) return;
    var d = e.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "fd:ready") size(false);
    else if (d.type === "fd:state") size(Boolean(d.open));
    else if (d.type === "fd:unavailable") frame.remove();
  });

  function mount() {
    document.body.appendChild(frame);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
