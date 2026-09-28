/*!
 * Ascend Chat Widget — floating support chat backed by DeepSeek AI + RAG.
 *
 * Embed on any page with a single script tag:
 *   <script src="https://ai.ascendplatform.site/widget.js"></script>
 *
 * Optional attribute to override the API origin (defaults to the script's origin):
 *   <script src="..." data-chat-url="https://ai.ascendplatform.site"></script>
 */
(function () {
  'use strict';

  if (window.AscendChatLoaded) return;
  window.AscendChatLoaded = true;

  var script = document.currentScript;

  function apiBase() {
    var explicit = script && script.getAttribute('data-chat-url');
    if (explicit) return explicit.replace(/\/+$/, '');
    if (script && script.src) {
      try { return new URL(script.src).origin; } catch (e) { /* ignore */ }
    }
    return window.location.origin;
  }

  var API_BASE = apiBase();
  var history = []; // role/content pairs, sent for multi-turn context

  var CSS = [
    '.ascend-chat { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }',
    '.ascend-chat * { box-sizing: border-box; margin: 0; padding: 0; }',
    '.ascend-chat .ac-launcher {',
    '  position: fixed; right: 24px; bottom: 24px; z-index: 2147483000;',
    '  width: 60px; height: 60px; border-radius: 50%; border: none; cursor: pointer;',
    '  background: #4f46e5; color: #fff; box-shadow: 0 8px 24px rgba(79, 70, 229, 0.4);',
    '  display: flex; align-items: center; justify-content: center;',
    '  transition: transform .15s ease, background .15s ease;',
    '}',
    '.ascend-chat .ac-launcher:hover { background: #4338ca; transform: translateY(-2px); }',
    '.ascend-chat .ac-launcher svg { width: 28px; height: 28px; }',
    '.ascend-chat .ac-panel {',
    '  position: fixed; right: 24px; bottom: 96px; z-index: 2147483000;',
    '  width: 360px; max-width: calc(100vw - 32px); height: 520px; max-height: calc(100vh - 120px);',
    '  display: flex; flex-direction: column; background: #fff;',
    '  border-radius: 16px; overflow: hidden;',
    '  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);',
    '}',
    '.ascend-chat .ac-header {',
    '  background: #4f46e5; color: #fff; padding: 16px 18px;',
    '  display: flex; align-items: center; justify-content: space-between;',
    '}',
    '.ascend-chat .ac-header .ac-title { font-weight: 600; font-size: 15px; }',
    '.ascend-chat .ac-header .ac-sub { font-size: 12px; opacity: .85; margin-top: 2px; }',
    '.ascend-chat .ac-close { background: transparent; border: none; color: #fff; cursor: pointer; font-size: 22px; line-height: 1; }',
    '.ascend-chat .ac-messages { flex: 1; overflow-y: auto; padding: 16px; background: #f8fafc; }',
    '.ascend-chat .ac-msg { max-width: 82%; padding: 10px 14px; border-radius: 14px; margin-bottom: 10px; font-size: 14px; line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; }',
    '.ascend-chat .ac-msg.ac-bot { background: #fff; border: 1px solid #e5e7eb; border-bottom-left-radius: 4px; color: #1f2937; }',
    '.ascend-chat .ac-msg.ac-user { background: #4f46e5; color: #fff; margin-left: auto; border-bottom-right-radius: 4px; }',
    '.ascend-chat .ac-msg.ac-error { background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; }',
    '.ascend-chat .ac-typing { display: flex; gap: 4px; padding: 12px 14px; width: fit-content; background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; margin-bottom: 10px; }',
    '.ascend-chat .ac-typing span { width: 7px; height: 7px; background: #9ca3af; border-radius: 50%; animation: acBounce 1.2s infinite; }',
    '.ascend-chat .ac-typing span:nth-child(2) { animation-delay: .15s; }',
    '.ascend-chat .ac-typing span:nth-child(3) { animation-delay: .3s; }',
    '@keyframes acBounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-4px); } }',
    '.ascend-chat .ac-input { display: flex; border-top: 1px solid #e5e7eb; padding: 10px; background: #fff; }',
    '.ascend-chat .ac-input textarea { flex: 1; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 12px; font-size: 14px; font-family: inherit; resize: none; height: 44px; outline: none; }',
    '.ascend-chat .ac-input textarea:focus { border-color: #4f46e5; }',
    '.ascend-chat .ac-send { margin-left: 8px; background: #4f46e5; color: #fff; border: none; border-radius: 10px; padding: 0 16px; cursor: pointer; font-weight: 600; }',
    '.ascend-chat .ac-send:disabled { opacity: .5; cursor: not-allowed; }',
    '.ascend-chat[hidden] { display: none !important; }'
  ].join('\n');

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function build() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var root = el('div', 'ascend-chat');

    var launcher = el('button', 'ac-launcher');
    launcher.setAttribute('aria-label', 'Open chat');
    launcher.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>';

    var panel = el('div', 'ac-panel');
    panel.hidden = true;

    var header = el('div', 'ac-header');
    var titleWrap = el('div');
    titleWrap.appendChild(el('div', 'ac-title', 'Ascend Support'));
    titleWrap.appendChild(el('div', 'ac-sub', 'Online • AI assistant'));
    var close = el('button', 'ac-close', '\u00d7');
    close.setAttribute('aria-label', 'Close chat');
    header.appendChild(titleWrap);
    header.appendChild(close);

    var messages = el('div', 'ac-messages');
    var inputRow = el('div', 'ac-input');
    var textarea = el('textarea');
    textarea.placeholder = 'Type your message…';
    textarea.rows = 1;
    var send = el('button', 'ac-send', 'Send');

    inputRow.appendChild(textarea);
    inputRow.appendChild(send);

    panel.appendChild(header);
    panel.appendChild(messages);
    panel.appendChild(inputRow);

    root.appendChild(launcher);
    root.appendChild(panel);
    document.body.appendChild(root);

    return { root: root, launcher: launcher, panel: panel, messages: messages, textarea: textarea, send: send };
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

  function sendMessage(ui, text) {
    var clean = text.trim();
    if (!clean) return;

    appendMessage(ui.messages, 'user', clean);
    ui.textarea.value = '';
    ui.textarea.style.height = 'auto';
    history.push({ role: 'user', content: clean });
    if (history.length > 20) history = history.slice(-20);

    ui.send.disabled = true;
    setTyping(ui.messages, true);

    fetch(API_BASE + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: clean, history: history.slice(0, -1) })
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

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }

    var ui = build();

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

    window.AscendChat = {
      open: function () { ui.panel.hidden = false; ui.textarea.focus(); },
      close: function () { ui.panel.hidden = true; }
    };
  }

  init();
})();
