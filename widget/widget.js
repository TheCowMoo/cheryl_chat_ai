/*!
 * Ascend Chat Widget — embeddable per-bot chat.
 * Embed: <script src="https://host/widget.js" data-bot="BOT_ID"></script>
 */
(function () {
  'use strict';

  if (window.AscendChatLoaded) return;
  window.AscendChatLoaded = true;

  var script = document.currentScript;
  var BOT_ID = script && script.getAttribute('data-bot');

  function apiBase() {
    if (script && script.src) { try { return new URL(script.src).origin; } catch (e) { /* ignore */ } }
    return window.location.origin;
  }
  var API_BASE = apiBase();

  if (!BOT_ID) { console.warn('[AscendChat] Missing data-bot attribute.'); return; }

  var CSS = [
    '.ascend-chat { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }',
    '.ascend-chat * { box-sizing: border-box; margin: 0; padding: 0; }',
    '.ascend-chat .ac-launcher { position: fixed; right: 24px; bottom: 24px; z-index: 2147483000; width: 60px; height: 60px; border-radius: 50%; border: none; cursor: pointer; background: var(--ac, #4f46e5); color: #fff; box-shadow: 0 8px 24px rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; transition: transform .15s ease; }',
    '.ascend-chat .ac-launcher:hover { transform: translateY(-2px); }',
    '.ascend-chat .ac-launcher svg { width: 28px; height: 28px; }',
    '.ascend-chat .ac-panel { position: fixed; right: 24px; bottom: 96px; z-index: 2147483000; width: 370px; max-width: calc(100vw - 32px); height: 560px; max-height: calc(100vh - 120px); display: flex; flex-direction: column; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,.3); }',
    '.ascend-chat .ac-header { background: var(--ac, #4f46e5); color: #fff; padding: 16px 18px; display: flex; align-items: center; gap: 12px; }',
    '.ascend-chat .ac-header .ac-avatar { width: 38px; height: 38px; border-radius: 50%; background: rgba(255,255,255,.2); display: flex; align-items: center; justify-content: center; font-weight: 700; overflow: hidden; flex-shrink: 0; }',
    '.ascend-chat .ac-header .ac-avatar img { width: 100%; height: 100%; object-fit: cover; }',
    '.ascend-chat .ac-header .ac-title { font-weight: 600; font-size: 15px; }',
    '.ascend-chat .ac-header .ac-sub { font-size: 12px; opacity: .85; margin-top: 2px; }',
    '.ascend-chat .ac-close { margin-left: auto; background: transparent; border: none; color: #fff; cursor: pointer; font-size: 24px; line-height: 1; }',
    '.ascend-chat .ac-messages { flex: 1; overflow-y: auto; padding: 16px; background: #f8fafc; }',
    '.ascend-chat .ac-msg { max-width: 84%; padding: 10px 14px; border-radius: 14px; margin-bottom: 10px; font-size: 14px; line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; }',
    '.ascend-chat .ac-msg.ac-bot { background: #fff; border: 1px solid #e5e7eb; border-bottom-left-radius: 4px; color: #1f2937; }',
    '.ascend-chat .ac-msg.ac-user { background: var(--ac, #4f46e5); color: #fff; margin-left: auto; border-bottom-right-radius: 4px; }',
    '.ascend-chat .ac-msg.ac-error { background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; }',
    '.ascend-chat .ac-quick { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 16px 12px; background: #f8fafc; }',
    '.ascend-chat .ac-quick button { background: #eef2ff; color: #4338ca; border: none; border-radius: 999px; padding: 7px 12px; font-size: 12.5px; font-weight: 500; cursor: pointer; }',
    '.ascend-chat .ac-typing { display: flex; gap: 4px; padding: 12px 14px; width: fit-content; background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; margin-bottom: 10px; }',
    '.ascend-chat .ac-typing span { width: 7px; height: 7px; background: #9ca3af; border-radius: 50%; animation: acBounce 1.2s infinite; }',
    '.ascend-chat .ac-typing span:nth-child(2) { animation-delay: .15s; }',
    '.ascend-chat .ac-typing span:nth-child(3) { animation-delay: .3s; }',
    '@keyframes acBounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-4px); } }',
    '.ascend-chat .ac-input { display: flex; border-top: 1px solid #e5e7eb; padding: 10px; background: #fff; }',
    '.ascend-chat .ac-input textarea { flex: 1; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 12px; font-size: 14px; font-family: inherit; resize: none; height: 44px; outline: none; }',
    '.ascend-chat .ac-input textarea:focus { border-color: var(--ac, #4f46e5); }',
    '.ascend-chat .ac-send { margin-left: 8px; background: var(--ac, #4f46e5); color: #fff; border: none; border-radius: 10px; padding: 0 16px; cursor: pointer; font-weight: 600; }',
    '.ascend-chat .ac-send:disabled { opacity: .5; cursor: not-allowed; }',
    '.ascend-chat[hidden] { display: none !important; }'
  ].join('\n');

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function initials(name) {
    var parts = (name || '?').trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  function build(config) {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var root = el('div', 'ascend-chat');
    root.style.setProperty('--ac', config.brand_color || '#4f46e5');

    var launcher = el('button', 'ac-launcher');
    launcher.setAttribute('aria-label', 'Open chat');
    launcher.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>';

    var panel = el('div', 'ac-panel');
    panel.hidden = true;

    var header = el('div', 'ac-header');
    var av = el('div', 'ac-avatar');
    if (config.logo_url) { av.innerHTML = '<img src="' + config.logo_url + '" alt="">'; }
    else { av.textContent = initials(config.name); }
    var titleWrap = el('div');
    titleWrap.appendChild(el('div', 'ac-title', config.assistant_name || 'Assistant'));
    titleWrap.appendChild(el('div', 'ac-sub', 'Online'));
    var close = el('button', 'ac-close', '\u00d7');
    close.setAttribute('aria-label', 'Close chat');
    header.appendChild(av);
    header.appendChild(titleWrap);
    header.appendChild(close);

    var messages = el('div', 'ac-messages');
    var quick = el('div', 'ac-quick');
    var inputRow = el('div', 'ac-input');
    var textarea = el('textarea');
    textarea.placeholder = 'Type your message…';
    textarea.rows = 1;
    var send = el('button', 'ac-send', 'Send');
    inputRow.appendChild(textarea);
    inputRow.appendChild(send);

    panel.appendChild(header);
    panel.appendChild(messages);
    panel.appendChild(quick);
    panel.appendChild(inputRow);
    root.appendChild(launcher);
    root.appendChild(panel);
    document.body.appendChild(root);

    return { launcher: launcher, panel: panel, messages: messages, quick: quick, textarea: textarea, send: send };
  }

  function appendMessage(messagesEl, role, text) {
    var cls = role === 'user' ? 'ac-msg ac-user' : (role === 'error' ? 'ac-msg ac-error' : 'ac-msg ac-bot');
    messagesEl.appendChild(el('div', cls, text));
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setTyping(messagesEl, on) {
    var existing = messagesEl.querySelector('.ac-typing');
    if (on && !existing) {
      var typing = el('div', 'ac-typing');
      typing.appendChild(el('span'));
      typing.appendChild(el('span'));
      typing.appendChild(el('span'));
      messagesEl.appendChild(typing);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } else if (!on && existing) {
      existing.remove();
    }
  }

  function init(config) {
    var ui = build(config);
    var conversationId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    var history = [];

    if (config.welcome_message) appendMessage(ui.messages, 'bot', config.welcome_message);

    if (config.quick_replies && config.quick_replies.length) {
      config.quick_replies.forEach(function (q) {
        var b = el('button', null, q);
        b.onclick = function () { sendMessage(ui, q); };
        ui.quick.appendChild(b);
      });
    }

    ui.launcher.addEventListener('click', function () {
      ui.panel.hidden = !ui.panel.hidden;
      if (!ui.panel.hidden) ui.textarea.focus();
    });

    ui.panel.querySelector('.ac-close').addEventListener('click', function () {
      ui.panel.hidden = true;
    });

    ui.send.addEventListener('click', function () { sendMessage(ui, ui.textarea.value); });

    ui.textarea.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(ui, ui.textarea.value);
      }
    });

    function sendMessage(ui, text) {
      var clean = (text || '').trim();
      if (!clean) return;

      appendMessage(ui.messages, 'user', clean);
      ui.textarea.value = '';
      history.push({ role: 'user', content: clean });
      if (history.length > 20) history = history.slice(-20);

      ui.send.disabled = true;
      setTyping(ui.messages, true);

      fetch(API_BASE + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_id: BOT_ID, conversation_id: conversationId, message: clean, history: history.slice(0, -1) })
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var reply = (data && data.reply) || 'Sorry, I received an empty reply.';
          history.push({ role: 'assistant', content: reply });
          if (history.length > 20) history = history.slice(-20);
          appendMessage(ui.messages, 'bot', reply);
        })
        .catch(function () {
          appendMessage(ui.messages, 'error', 'Network error — please try again in a moment.');
        })
        .finally(function () {
          setTyping(ui.messages, false);
          ui.send.disabled = false;
          ui.textarea.focus();
        });
    }

    window.AscendChat = {
      open: function () { ui.panel.hidden = false; ui.textarea.focus(); },
      close: function () { ui.panel.hidden = true; }
    };
  }

  // Boot: fetch the bot's public config, then render.
  fetch(API_BASE + '/api/bots/' + encodeURIComponent(BOT_ID) + '/public')
    .then(function (r) { return r.json(); })
    .then(function (config) {
      if (config && config.id) init(config);
      else console.warn('[AscendChat] Bot not found:', BOT_ID);
    })
    .catch(function () { console.warn('[AscendChat] Could not load bot config.'); });
})();
