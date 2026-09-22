/* FrontDesk AI website chat - drop-in.
 *
 *   <script src="https://frontdeskai.company/widget.js" data-client="YOUR-CLIENT-ID" async></script>
 *
 * Optional: data-accent="#hex" to match the site. Everything renders inside a
 * shadow root so the host page's CSS can't reach in and ours can't leak out.
 * No cookies, no storage; the transcript lives in memory for the page's life.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) return;
  var clientId = script.getAttribute("data-client");
  if (!clientId) return;
  var origin = new URL(script.src).origin;
  var endpoint = origin + "/api/chat";
  var accent = script.getAttribute("data-accent") || "#4f46e5";

  var host = document.createElement("div");
  host.id = "frontdesk-chat";
  host.style.cssText = "position:fixed;z-index:2147483000;bottom:0;right:0;";
  var root = host.attachShadow({ mode: "open" });

  var style = document.createElement("style");
  style.textContent =
    ":host{--fd-accent:" + accent + ";--fd-ink:#171a1f;--fd-muted:#6b7280;--fd-line:#e5e7eb;--fd-bg:#ffffff;--fd-bubble:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45;color:var(--fd-ink)}" +
    "*{box-sizing:border-box}" +
    ".launch{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;border:0;background:var(--fd-accent);color:#fff;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;transition:transform .15s ease}" +
    ".launch:hover{transform:translateY(-1px)}.launch:focus-visible{outline:3px solid #fff;outline-offset:2px;box-shadow:0 0 0 5px var(--fd-accent)}" +
    ".launch svg{width:26px;height:26px}" +
    ".panel{position:fixed;right:20px;bottom:88px;width:min(380px,calc(100vw - 24px));height:min(560px,calc(100vh - 110px));background:var(--fd-bg);border:1px solid var(--fd-line);border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.2);display:none;flex-direction:column;overflow:hidden}" +
    ".panel.open{display:flex}" +
    "@media (max-width:480px){.panel{right:0;bottom:0;width:100vw;height:100vh;border-radius:0;border:0}.launch.hidden{display:none}}" +
    ".head{display:flex;align-items:center;gap:10px;padding:14px 14px 12px;border-bottom:1px solid var(--fd-line)}" +
    ".dot{width:10px;height:10px;border-radius:50%;background:#10b981;flex:none}" +
    ".title{font-weight:600;font-size:15px}.sub{font-size:12px;color:var(--fd-muted)}" +
    ".close{margin-left:auto;border:0;background:transparent;color:var(--fd-muted);cursor:pointer;font-size:22px;line-height:1;padding:4px 8px;border-radius:8px}.close:hover{background:var(--fd-bubble)}.close:focus-visible{outline:2px solid var(--fd-accent)}" +
    ".log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px}" +
    ".msg{max-width:85%;padding:9px 12px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}" +
    ".ai{align-self:flex-start;background:var(--fd-bubble);border-bottom-left-radius:4px}" +
    ".me{align-self:flex-end;background:var(--fd-accent);color:#fff;border-bottom-right-radius:4px}" +
    ".typing{align-self:flex-start;color:var(--fd-muted);font-size:13px;padding:4px 12px}" +
    ".err{align-self:center;color:#b91c1c;font-size:13px;text-align:center}" +
    "form{display:flex;gap:8px;padding:10px;border-top:1px solid var(--fd-line)}" +
    "textarea{flex:1;resize:none;border:1px solid var(--fd-line);border-radius:10px;padding:10px 12px;font:inherit;color:inherit;max-height:120px;background:var(--fd-bg)}textarea:focus{outline:2px solid var(--fd-accent);border-color:transparent}" +
    ".send{border:0;background:var(--fd-accent);color:#fff;border-radius:10px;padding:0 14px;font:inherit;font-weight:600;cursor:pointer}.send:disabled{opacity:.5;cursor:default}.send:focus-visible{outline:2px solid var(--fd-ink)}" +
    ".foot{font-size:11px;color:var(--fd-muted);text-align:center;padding:0 0 8px}.foot a{color:inherit}" +
    "@media (prefers-reduced-motion:reduce){.launch{transition:none}}";
  root.appendChild(style);

  var panel = document.createElement("div");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Chat with us");
  panel.innerHTML =
    '<div class="head"><span class="dot" aria-hidden="true"></span><div><div class="title">Chat with us</div><div class="sub">Usually replies in seconds</div></div><button class="close" type="button" aria-label="Close chat">&times;</button></div>' +
    '<div class="log" aria-live="polite"></div>' +
    '<form><textarea rows="1" placeholder="Type a message\u2026" aria-label="Your message"></textarea><button class="send" type="submit">Send</button></form>' +
    '<div class="foot">Powered by <a href="' + origin + '" target="_blank" rel="noopener">FrontDesk AI</a></div>';
  root.appendChild(panel);

  var launch = document.createElement("button");
  launch.className = "launch";
  launch.type = "button";
  launch.setAttribute("aria-label", "Open chat");
  launch.setAttribute("aria-expanded", "false");
  launch.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12z"/></svg>';
  root.appendChild(launch);
  document.body.appendChild(host);

  var log = panel.querySelector(".log");
  var form = panel.querySelector("form");
  var input = panel.querySelector("textarea");
  var send = panel.querySelector(".send");
  var title = panel.querySelector(".title");
  var sub = panel.querySelector(".sub");
  var messages = [];
  var greeted = false;
  var busy = false;

  function add(role, text) {
    var el = document.createElement("div");
    el.className = "msg " + (role === "user" ? "me" : "ai");
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function note(cls, text) {
    var el = document.createElement("div");
    el.className = cls;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function post(payload) {
    return fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j && j.error ? j.error : "Something went wrong.");
        return j;
      });
    });
  }

  function greet() {
    if (greeted) return;
    greeted = true;
    var t = note("typing", "\u2026");
    post({ clientId: clientId, messages: [] })
      .then(function (j) {
        t.remove();
        if (j.business) {
          title.textContent = j.business.name;
          sub.textContent = j.business.agent + " \u00b7 AI receptionist";
        }
        add("assistant", j.reply);
      })
      .catch(function (e) {
        t.remove();
        note("err", e.message || "Chat isn't available right now.");
        greeted = false;
      });
  }

  function open() {
    panel.classList.add("open");
    launch.classList.add("hidden");
    launch.setAttribute("aria-expanded", "true");
    greet();
    setTimeout(function () { input.focus(); }, 30);
  }
  function close() {
    panel.classList.remove("open");
    launch.classList.remove("hidden");
    launch.setAttribute("aria-expanded", "false");
    launch.focus();
  }

  launch.addEventListener("click", function () {
    if (panel.classList.contains("open")) close();
    else open();
  });
  panel.querySelector(".close").addEventListener("click", close);
  panel.addEventListener("keydown", function (e) {
    if (e.key === "Escape") close();
  });

  input.addEventListener("input", function () {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy) return;
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    input.style.height = "auto";
    add("user", text);
    messages.push({ role: "user", content: text });
    busy = true;
    send.disabled = true;
    var t = note("typing", "Typing\u2026");
    post({ clientId: clientId, messages: messages })
      .then(function (j) {
        t.remove();
        messages = j.messages || messages.concat([{ role: "assistant", content: j.reply }]);
        add("assistant", j.reply);
      })
      .catch(function (err) {
        t.remove();
        note("err", err.message || "Something went wrong. Try again.");
        // Keep their message in the transcript so a retry resends it.
      })
      .then(function () {
        busy = false;
        send.disabled = false;
        input.focus();
      });
  });
})();
