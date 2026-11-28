/* FrontDesk AI website chat: the app inside the iframe (/widget/frame).
 * Talks only to /api/chat on this same origin. No cookies, no storage: the
 * transcript lives in memory for the page's life. */
(function () {
  "use strict";
  var root = document.documentElement;
  var app = document.getElementById("app");
  var ds = root.dataset;

  // The page embedding us. ancestorOrigins is set by the browser (Chrome,
  // Safari); elsewhere fall back to the referrer's origin. The server checks
  // it against the owner's allowed domains; frame-ancestors already did.
  var parentOrigin = "";
  try {
    if (location.ancestorOrigins && location.ancestorOrigins.length) parentOrigin = location.ancestorOrigins[0];
    else if (document.referrer) parentOrigin = new URL(document.referrer).origin;
  } catch (_e) {}
  if (window.parent === window) parentOrigin = location.origin;

  function tell(msg) {
    try { window.parent.postMessage(msg, parentOrigin || "*"); } catch (_e) {}
  }

  if (ds.available !== "1") {
    tell({ type: "fd:unavailable" });
    return;
  }
  if (/^#[0-9a-f]{6}$/i.test(ds.accent || "")) root.style.setProperty("--fd-accent", ds.accent);

  var T = {
    en: {
      open: "Chat with us", close: "Close chat", online: "AI receptionist · replies right away",
      label: "Type your message", ph: "Type a message…", send: "Send", typing: "Typing…",
      lead: "Sent. The team has your details and will reach out.",
      booked: "Booked. Check your phone for the confirmation if you asked for one.",
      err: "Couldn't reach the chat. Try again in a moment.",
      foot: "AI receptionist. Don't share card numbers or medical details here.",
      log: "Conversation"
    },
    es: {
      open: "Chatee con nosotros", close: "Cerrar chat", online: "Recepcionista virtual · responde al instante",
      label: "Escriba su mensaje", ph: "Escriba un mensaje…", send: "Enviar", typing: "Escribiendo…",
      lead: "Enviado. El equipo tiene sus datos y se comunicará con usted.",
      booked: "Cita agendada. Revise su teléfono si pidió la confirmación.",
      err: "No se pudo conectar con el chat. Intente de nuevo en un momento.",
      foot: "Recepcionista virtual. No comparta números de tarjeta ni datos médicos aquí.",
      log: "Conversación"
    }
  };
  var lang = ds.lang === "es" ? "es" : "en";
  var t = T[lang];
  var name = ds.name || "";
  var agent = ds.agent || "";
  var preview = ds.preview === "1";
  var convo = randomId();
  var history = [];
  var busy = false;
  var started = false;

  function randomId() {
    var a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var launch = el("button", "launch");
  launch.type = "button";
  launch.setAttribute("aria-label", t.open + (name ? " — " + name : ""));
  launch.setAttribute("aria-expanded", "false");
  launch.setAttribute("aria-controls", "fd-panel");
  launch.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  var panel = el("section", "panel");
  panel.id = "fd-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", name ? "Chat — " + name : "Chat");

  var head = el("div", "head");
  head.appendChild(el("span", "dot"));
  var titles = el("div");
  titles.appendChild(el("p", "title", name || "Chat"));
  titles.appendChild(el("p", "sub", (agent ? agent + " · " : "") + t.online));
  head.appendChild(titles);
  var closeBtn = el("button", "close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", t.close);
  if (!preview) head.appendChild(closeBtn);

  var log = el("ol", "log");
  log.setAttribute("aria-live", "polite");
  log.setAttribute("aria-label", t.log);

  var form = el("form");
  var lbl = el("label", "sr", t.label);
  lbl.htmlFor = "fd-input";
  var input = el("textarea");
  input.id = "fd-input";
  input.rows = 1;
  input.maxLength = 1000;
  input.placeholder = t.ph;
  input.autocomplete = "off";
  var send = el("button", "send", t.send);
  send.type = "submit";
  form.appendChild(lbl);
  form.appendChild(input);
  form.appendChild(send);

  panel.appendChild(head);
  panel.appendChild(log);
  panel.appendChild(form);
  panel.appendChild(el("p", "foot", t.foot));
  app.appendChild(launch);
  app.appendChild(panel);
  if (preview) root.classList.add("preview");

  function add(cls, text) {
    var li = el("li", "msg " + cls, text);
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
    return li;
  }
  function note(text) {
    var li = el("li", "note");
    li.appendChild(el("span", null, "✓"));
    li.appendChild(el("span", null, text));
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
  }
  function error(text) {
    var li = el("li", "err", text);
    li.setAttribute("role", "alert");
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
  }

  function call(messages) {
    return fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ key: ds.key, messages: messages, parent: parentOrigin, lang: lang, conversationId: convo })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (!r.ok) throw new Error((b && b.error) || t.err);
        return b;
      });
    });
  }

  function setBusy(v) {
    busy = v;
    send.disabled = v;
  }

  function start() {
    if (started) return;
    started = true;
    setBusy(true);
    var typing = el("li", "typing", t.typing);
    log.appendChild(typing);
    call(null).then(function (b) {
      typing.remove();
      if (b.reply) {
        add("ai", b.reply);
        history.push({ role: "assistant", content: b.reply });
      }
    }).catch(function (e) {
      typing.remove();
      started = false;
      error(e.message || t.err);
    }).then(function () { setBusy(false); });
  }

  function open() {
    root.classList.add("open");
    launch.setAttribute("aria-expanded", "true");
    tell({ type: "fd:state", open: true });
    start();
    setTimeout(function () { input.focus(); }, 30);
  }
  function close() {
    root.classList.remove("open");
    launch.setAttribute("aria-expanded", "false");
    tell({ type: "fd:state", open: false });
    setTimeout(function () { launch.focus(); }, 30);
  }

  launch.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && root.classList.contains("open") && !preview) close();
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  });
  input.addEventListener("input", function () {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim().slice(0, 1000);
    if (!text || busy) return;
    input.value = "";
    input.style.height = "auto";
    add("me", text);
    history.push({ role: "user", content: text });
    setBusy(true);
    var typing = el("li", "typing", t.typing);
    log.appendChild(typing);
    log.scrollTop = log.scrollHeight;
    call(history.slice(-30)).then(function (b) {
      typing.remove();
      add("ai", b.reply || "");
      history.push({ role: "assistant", content: b.reply || "" });
      if (b.events && b.events.booking) note(t.booked);
      else if (b.events && b.events.lead) note(t.lead);
    }).catch(function (err) {
      typing.remove();
      history.pop();
      error(err.message || t.err);
    }).then(function () {
      setBusy(false);
      input.focus();
    });
  });

  if (preview) open();
  tell({ type: "fd:ready" });
})();
