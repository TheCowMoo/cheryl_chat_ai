/* Chatbot Manager — admin single-page app (no build step). */
(function () {
  'use strict';

  var state = { user: null };

  function api(method, url, body) {
    var opts = { method: method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) { var e = new Error(data.error || ('HTTP ' + res.status)); e.status = res.status; throw e; }
        return data;
      });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function toast(msg, ok) {
    var t = el('div', 'toast ' + (ok ? 'toast-success' : 'toast-error'), msg);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3000);
  }

  function initials(name) {
    var parts = (name || '?').trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  function avatarHTML(bot) {
    if (bot.logo_url) return '<img src="' + esc(bot.logo_url) + '" alt="">';
    return esc(initials(bot.name));
  }

  // ---------- Topbar ----------
  function topbar() {
    var bar = el('div', 'topbar');
    var inner = el('div', 'topbar-inner');
    var brand = el('div', 'brand');
    brand.innerHTML = '<span class="dot"></span>Chatbot Manager';
    inner.appendChild(brand);
    inner.appendChild(el('div', 'spacer'));
    if (state.user) {
      if (state.user.role === 'admin') {
        var usersBtn = el('button', 'btn btn-ghost btn-sm', 'Users');
        usersBtn.onclick = function () { location.hash = '#/users'; };
        inner.appendChild(usersBtn);
      }
      var chip = el('div', 'user-chip');
      chip.innerHTML = '<span class="avatar">' + esc(initials(state.user.name)) + '</span>';
      chip.appendChild(document.createTextNode(state.user.name));
      inner.appendChild(chip);
      var logout = el('button', 'btn btn-ghost btn-sm', 'Log out');
      logout.onclick = function () {
        api('POST', '/api/auth/logout').then(function () { location.reload(); });
      };
      inner.appendChild(logout);
    }
    bar.appendChild(inner);
    return bar;
  }

  // ---------- Login ----------
  function viewLogin() {
    var wrap = el('div', 'auth-wrap');
    var card = el('div', 'auth-card');
    card.innerHTML = '<h1>Chatbot Manager</h1><p class="sub">Sign in to manage your chatbots</p>';
    var err = el('div', 'error');
    var emailField = el('div', 'field');
    emailField.innerHTML = '<label>Email</label>';
    var email = el('input'); email.type = 'email'; email.placeholder = 'you@example.com';
    emailField.appendChild(email);
    var pwField = el('div', 'field');
    pwField.innerHTML = '<label>Password</label>';
    var pw = el('input'); pw.type = 'password';
    pwField.appendChild(pw);
    var btn = el('button', 'btn btn-primary', 'Sign in');
    btn.style.width = '100%';
    btn.onclick = submit;
    function submit() {
      err.textContent = '';
      btn.disabled = true;
      api('POST', '/api/auth/login', { email: email.value, password: pw.value })
        .then(function (d) { state.user = d.user; render(); })
        .catch(function (e) { err.textContent = e.message; })
        .finally(function () { btn.disabled = false; });
    }
    card.appendChild(err);
    card.appendChild(emailField);
    card.appendChild(pwField);
    card.appendChild(btn);
    wrap.appendChild(card);
    return wrap;
  }

  // ---------- Embed modal ----------
  function showEmbed(bot) {
    var snippet = '<script src="' + location.origin + '/widget.js" data-bot="' + bot.id + '"><\/script>';
    var backdrop = el('div', 'modal-backdrop');
    var modal = el('div', 'modal');
    modal.innerHTML = '<h3>Embed widget</h3><p class="muted">Paste this into the client\'s website, before <code>&lt;/body&gt;</code>:</p>';
    modal.appendChild(el('code', null, snippet));
    var actions = el('div', 'modal-actions');
    var close = el('button', 'btn btn-ghost', 'Close');
    close.onclick = function () { backdrop.remove(); };
    var copy = el('button', 'btn btn-primary', 'Copy');
    copy.onclick = function () {
      navigator.clipboard.writeText(snippet).then(function () { toast('Copied', true); }).catch(function () { toast('Copy failed', false); });
    };
    actions.appendChild(close);
    actions.appendChild(copy);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };
    document.body.appendChild(backdrop);
  }

  // ---------- Dashboard ----------
  function viewDashboard() {
    var container = el('div', 'container');
    var head = el('div', 'page-head');
    var hwrap = el('div');
    hwrap.innerHTML = '<h2>Your chatbots</h2><p>Create and manage chatbots for your clients.</p>';
    head.appendChild(hwrap);
    var newBtn = el('button', 'btn btn-primary', '+ New Chatbot');
    newBtn.onclick = function () { location.hash = '#/bot/new'; };
    head.appendChild(newBtn);
    container.appendChild(head);

    var grid = el('div', 'grid');
    container.appendChild(grid);

    api('GET', '/api/bots').then(function (d) {
      var bots = d.bots || [];
      if (!bots.length) {
        grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="big">🤖</div>No chatbots yet. Click <b>+ New Chatbot</b> to create your first one.</div>';
        return;
      }
      bots.forEach(function (bot) {
        var card = el('div', 'bot-card');
        var top = el('div', 'bot-card-top');
        var av = el('div', 'bot-avatar');
        av.style.background = bot.brand_color || '#4f46e5';
        av.innerHTML = avatarHTML(bot);
        top.appendChild(av);
        var names = el('div');
        names.innerHTML = '<div class="bot-card-name">' + esc(bot.name) + '</div><div class="bot-card-assistant">' + esc(bot.assistant_name) + '</div>';
        top.appendChild(names);
        card.appendChild(top);
        var meta = el('div', 'bot-card-meta');
        meta.innerHTML = '<span>' + (bot.message_count || 0) + ' msgs</span><span>ID ' + esc(bot.id.slice(0, 10)) + '</span>';
        card.appendChild(meta);
        var actions = el('div', 'card-actions');
        var embed = el('button', 'btn btn-ghost btn-sm', 'Embed');
        embed.onclick = function () { showEmbed(bot); };
        var edit = el('button', 'btn btn-ghost btn-sm', 'Edit');
        edit.onclick = function () { location.hash = '#/bot/' + bot.id; };
        var stats = el('button', 'btn btn-ghost btn-sm', 'Stats');
        stats.onclick = function () { location.hash = '#/bot/' + bot.id + '/stats'; };
        var conv = el('button', 'btn btn-ghost btn-sm', 'Chats');
        conv.onclick = function () { location.hash = '#/bot/' + bot.id + '/conversations'; };
        var del = el('button', 'btn btn-danger btn-sm', 'Delete');
        del.onclick = function () {
          if (confirm('Delete "' + bot.name + '" and all its messages?')) {
            api('DELETE', '/api/bots/' + bot.id).then(function () { toast('Deleted', true); render(); }).catch(function (e) { toast(e.message, false); });
          }
        };
        actions.appendChild(embed);
        actions.appendChild(edit);
        actions.appendChild(stats);
        actions.appendChild(conv);
        actions.appendChild(del);
        card.appendChild(actions);
        grid.appendChild(card);
      });
    }).catch(function (e) { toast(e.message, false); });

    return container;
  }

  // ---------- Editor ----------
  function viewEditor(botId) {
    var isNew = !botId;
    var container = el('div', 'container');
    var head = el('div', 'page-head');
    var hwrap = el('div');
    hwrap.innerHTML = '<h2>' + (isNew ? 'New Chatbot' : 'Edit Chatbot') + '</h2>';
    head.appendChild(hwrap);
    var back = el('button', 'btn btn-ghost', '← Back');
    back.onclick = function () { location.hash = '#/'; };
    head.appendChild(back);
    container.appendChild(head);

    var layout = el('div', 'editor-layout');
    var form = el('div', 'form-card');
    form.innerHTML = '<h3>Settings</h3>';

    function field(labelText, inputEl, hint) {
      var f = el('div', 'field');
      f.innerHTML = '<label>' + esc(labelText) + '</label>';
      f.appendChild(inputEl);
      if (hint) f.appendChild(el('div', 'hint', hint));
      return f;
    }

    var name = el('input'); name.placeholder = 'Client / business name';
    var assistant = el('input'); assistant.placeholder = 'e.g. Cheryl';
    var brandRow = el('div', 'color-row');
    var color = el('input'); color.type = 'color'; color.value = '#4f46e5';
    var colorText = el('input'); colorText.placeholder = '#4f46e5'; colorText.style.maxWidth = '130px';
    color.oninput = function () { colorText.value = color.value; syncPreview(); };
    colorText.oninput = function () { if (/^#[0-9a-fA-F]{6}$/.test(colorText.value)) { color.value = colorText.value; syncPreview(); } };
    brandRow.appendChild(color); brandRow.appendChild(colorText);
    var logo = el('input'); logo.type = 'url'; logo.placeholder = 'https://… (optional)';
    var welcome = el('textarea'); welcome.placeholder = 'Hi! How can I help you today?'; welcome.style.minHeight = '64px';
    var kb = el('textarea'); kb.placeholder = 'Paste the knowledge base here…'; kb.style.minHeight = '200px';
    var prompt = el('textarea'); prompt.placeholder = 'Optional: custom AI instructions (leave blank for default)'; prompt.style.minHeight = '80px';
    var webhook = el('input'); webhook.type = 'url'; webhook.placeholder = 'https://hooks.zapier.com/… (optional)';

    var quickReplies = [];
    var chipList = el('div', 'chip-list');
    var chipInput = el('div', 'chip-input');
    var chipText = el('input'); chipText.placeholder = 'Add a suggested question and press Enter';
    var chipAdd = el('button', 'btn btn-ghost btn-sm', 'Add');
    function renderChips() {
      chipList.innerHTML = '';
      quickReplies.forEach(function (q, i) {
        var c = el('div', 'chip');
        c.appendChild(document.createTextNode(q));
        var x = el('button', null, '×');
        x.onclick = function () { quickReplies.splice(i, 1); renderChips(); };
        c.appendChild(x);
        chipList.appendChild(c);
      });
    }
    function addChip(text) {
      var t = (text || '').trim();
      if (!t) return;
      quickReplies.push(t);
      renderChips();
      syncPreview();
    }
    chipAdd.onclick = function () { addChip(chipText.value); chipText.value = ''; };
    chipText.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); addChip(chipText.value); chipText.value = ''; } };
    chipInput.appendChild(chipText); chipInput.appendChild(chipAdd);

    form.appendChild(field('Name', name));
    form.appendChild(field('Assistant name', assistant));
    form.appendChild(field('Brand color', brandRow));
    form.appendChild(field('Logo URL', logo, 'Optional — otherwise initials are shown'));
    form.appendChild(field('Welcome message', welcome));
    form.appendChild(field('Suggested questions', chipList));
    form.appendChild(chipInput);
    form.appendChild(field('Knowledge base', kb, 'The AI answers ONLY from this text.'));
    form.appendChild(field('AI personality (optional)', prompt));
    form.appendChild(field('Webhook URL', webhook, 'Optional — the AI posts its WEBHOOK_PAYLOAD here (instruct it via the knowledge base)'));

    var save = el('button', 'btn btn-primary', isNew ? 'Create Chatbot' : 'Save Changes');
    save.onclick = saveFn;
    form.appendChild(save);
    layout.appendChild(form);

    var pane = el('div', 'preview-pane');
    var frame = el('div', 'preview-frame');
    pane.appendChild(frame);
    pane.appendChild(el('div', 'preview-note', 'Live widget preview'));
    layout.appendChild(pane);
    container.appendChild(layout);

    var currentBot = { name: '', assistant_name: 'Assistant', brand_color: '#4f46e5', logo_url: '', welcome_message: '', quick_replies: [], knowledge_base: '', system_prompt: '' };

    function syncPreview() {
      currentBot.name = name.value;
      currentBot.assistant_name = assistant.value;
      currentBot.brand_color = color.value;
      currentBot.logo_url = logo.value;
      currentBot.welcome_message = welcome.value;
      currentBot.quick_replies = quickReplies;
      renderPreview();
    }

    function renderPreview() {
      var b = currentBot;
      var c = b.brand_color || '#4f46e5';
      frame.innerHTML =
        '<div style="position:absolute;right:16px;bottom:16px;width:60px;height:60px;border-radius:50%;background:' + esc(c) + ';box-shadow:0 8px 24px rgba(0,0,0,.25)"></div>' +
        '<div style="position:absolute;right:16px;bottom:92px;width:320px;max-width:calc(100% - 32px);background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.25);font-size:13px">' +
          '<div style="background:' + esc(c) + ';color:#fff;padding:12px 14px;font-weight:600">' + esc(b.assistant_name || 'Assistant') + '</div>' +
          '<div style="padding:14px;background:#f8fafc;min-height:120px">' +
            '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:8px 10px;max-width:88%">' + esc(b.welcome_message || 'Hi! How can I help you?') + '</div>' +
            (b.quick_replies && b.quick_replies.length ? '<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">' + b.quick_replies.map(function (q) { return '<span style="background:#eef2ff;color:#4338ca;padding:4px 9px;border-radius:999px;font-size:11px">' + esc(q) + '</span>'; }).join('') + '</div>' : '') +
          '</div>' +
          '<div style="padding:10px;border-top:1px solid #e5e7eb"><div style="border:1px solid #e5e7eb;border-radius:8px;padding:8px 10px;color:#9ca3af">Type your message…</div></div>' +
        '</div>';
    }

    if (isNew) {
      renderPreview();
    } else {
      api('GET', '/api/bots/' + botId).then(function (d) {
        var b = d.bot;
        name.value = b.name; assistant.value = b.assistant_name; color.value = b.brand_color; colorText.value = b.brand_color;
        logo.value = b.logo_url; welcome.value = b.welcome_message; kb.value = b.knowledge_base; prompt.value = b.system_prompt;
        webhook.value = b.webhook_url || '';
        quickReplies = (b.quick_replies || []).slice(); renderChips();
        currentBot = b; renderPreview();
      }).catch(function (e) { toast(e.message, false); location.hash = '#/'; });
    }

    [name, assistant, logo, welcome, kb, prompt].forEach(function (i) { i.oninput = syncPreview; });

    function saveFn() {
      var payload = {
        name: name.value.trim(),
        assistant_name: assistant.value.trim(),
        brand_color: color.value,
        logo_url: logo.value.trim(),
        welcome_message: welcome.value.trim(),
        quick_replies: quickReplies,
        knowledge_base: kb.value,
        system_prompt: prompt.value.trim(),
        webhook_url: webhook.value.trim()
      };
      if (!payload.name) { toast('Name is required', false); return; }
      save.disabled = true;
      var req = isNew ? api('POST', '/api/bots', payload) : api('PUT', '/api/bots/' + botId, payload);
      req.then(function (d) {
        toast(isNew ? 'Chatbot created' : 'Saved', true);
        if (isNew) location.hash = '#/bot/' + d.bot.id;
        else render();
      }).catch(function (e) { toast(e.message, false); }).finally(function () { save.disabled = false; });
    }

    return container;
  }

  // ---------- Stats ----------
  function viewStats(botId) {
    var container = el('div', 'container');
    var head = el('div', 'page-head');
    head.innerHTML = '<div><h2>Bot stats</h2></div>';
    var back = el('button', 'btn btn-ghost', '← Back');
    back.onclick = function () { location.hash = '#/bot/' + botId; };
    head.appendChild(back);
    container.appendChild(head);

    var loading = el('div', 'empty-state', 'Loading…');
    container.appendChild(loading);

    api('GET', '/api/bots/' + botId + '/stats').then(function (d) {
      loading.remove();
      var grid = el('div', 'stats-grid');
      grid.innerHTML =
        '<div class="stat-card"><div class="stat-value">' + d.total_messages + '</div><div class="stat-label">Total messages</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + d.total_conversations + '</div><div class="stat-label">Conversations</div></div>';
      container.appendChild(grid);

      var chartCard = el('div', 'panel-card');
      chartCard.appendChild(el('h3', null, 'Messages — last 14 days'));
      var bars = el('div', 'bars');
      if (!d.messages_per_day.length) {
        chartCard.appendChild(el('div', 'muted', 'No messages yet.'));
      } else {
        var max = 1;
        d.messages_per_day.forEach(function (r) { if (r.count > max) max = r.count; });
        d.messages_per_day.forEach(function (r) {
          var bar = el('div', 'bar');
          bar.style.height = Math.max(2, Math.round((r.count / max) * 100)) + '%';
          bar.title = r.date + ': ' + r.count;
          bar.appendChild(el('span', null, (r.date || '').slice(5)));
          bars.appendChild(bar);
        });
        chartCard.appendChild(bars);
      }
      container.appendChild(chartCard);

      var topCard = el('div', 'panel-card');
      topCard.appendChild(el('h3', null, 'Most-asked questions'));
      if (!d.top_questions.length) {
        topCard.appendChild(el('div', 'muted', 'No questions recorded yet.'));
      } else {
        d.top_questions.forEach(function (q) {
          var row = el('div', 'top-item');
          row.innerHTML = '<span>' + esc(q.question) + '</span><span class="count">' + q.count + '×</span>';
          topCard.appendChild(row);
        });
      }
      container.appendChild(topCard);
    }).catch(function (e) { loading.textContent = e.message; });

    return container;
  }

  // ---------- Users ----------
  function viewUsers() {
    var container = el('div', 'container');
    var head = el('div', 'page-head');
    head.innerHTML = '<div><h2>Users</h2><p>Team accounts (admin only).</p></div>';
    container.appendChild(head);

    var form = el('div', 'form-card');
    form.innerHTML = '<h3>Add user</h3>';
    function f(label, input) { var d = el('div', 'field'); d.innerHTML = '<label>' + label + '</label>'; d.appendChild(input); return d; }
    var name = el('input'); name.placeholder = 'Name';
    var email = el('input'); email.type = 'email'; email.placeholder = 'Email';
    var pw = el('input'); pw.type = 'password'; pw.placeholder = 'Password';
    var role = el('select'); role.innerHTML = '<option value="member">Member</option><option value="admin">Admin</option>';
    form.appendChild(f('Name', name));
    form.appendChild(f('Email', email));
    form.appendChild(f('Password', pw));
    form.appendChild(f('Role', role));
    var addBtn = el('button', 'btn btn-primary', 'Add User');
    addBtn.onclick = function () {
      api('POST', '/api/users', { name: name.value, email: email.value, password: pw.value, role: role.value })
        .then(function () { toast('User added', true); render(); })
        .catch(function (e) { toast(e.message, false); });
    };
    form.appendChild(addBtn);
    container.appendChild(form);

    var tableWrap = el('div', 'mt');
    container.appendChild(tableWrap);

    api('GET', '/api/users').then(function (d) {
      var users = d.users || [];
      var table = el('table', 'table');
      table.innerHTML = '<thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>';
      var tbody = el('tbody');
      users.forEach(function (u) {
        var tr = el('tr');
        tr.innerHTML = '<td>' + esc(u.name) + '</td><td>' + esc(u.email) + '</td><td><span class="badge ' + (u.role === 'admin' ? 'badge-admin' : 'badge-member') + '">' + esc(u.role) + '</span></td>';
        var td = el('td');
        if (u.id !== state.user.id) {
          var del = el('button', 'btn btn-danger btn-sm', 'Remove');
          del.onclick = function () {
            if (confirm('Remove ' + u.email + '?')) {
              api('DELETE', '/api/users/' + u.id).then(function () { toast('Removed', true); render(); }).catch(function (e) { toast(e.message, false); });
            }
          };
          td.appendChild(del);
        }
        tr.appendChild(td);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      tableWrap.innerHTML = '';
      tableWrap.appendChild(table);
    }).catch(function (e) { toast(e.message, false); });

    return container;
  }

  // ---------- Conversations ----------
  function fmtDate(s) {
    if (!s) return '';
    var d = new Date(s.replace(' ', 'T') + 'Z');
    return isNaN(d.getTime()) ? s : d.toLocaleString();
  }

  function viewConversations(botId) {
    var container = el('div', 'container');
    var head = el('div', 'page-head');
    head.innerHTML = '<div><h2>Conversations</h2><p>Visitor chats and captured leads.</p></div>';
    var back = el('button', 'btn btn-ghost', '← Back');
    back.onclick = function () { location.hash = '#/'; };
    head.appendChild(back);
    container.appendChild(head);

    var allBtn = el('button', 'btn btn-primary btn-sm', 'All');
    var leadsBtn = el('button', 'btn btn-ghost btn-sm', 'Leads only');
    var showLeadsOnly = false;
    var filterBar = el('div');
    filterBar.style.cssText = 'display:flex;gap:8px;margin-bottom:16px;';
    function setFilter(leads) {
      showLeadsOnly = leads;
      allBtn.className = 'btn ' + (leads ? 'btn-ghost' : 'btn-primary') + ' btn-sm';
      leadsBtn.className = 'btn ' + (leads ? 'btn-primary' : 'btn-ghost') + ' btn-sm';
      renderList();
    }
    allBtn.onclick = function () { setFilter(false); };
    leadsBtn.onclick = function () { setFilter(true); };
    filterBar.appendChild(allBtn);
    filterBar.appendChild(leadsBtn);
    container.appendChild(filterBar);

    var listEl = el('div');
    container.appendChild(listEl);
    var conversations = [];

    function renderList() {
      listEl.innerHTML = '';
      var shown = showLeadsOnly ? conversations.filter(function (c) { return c.lead; }) : conversations;
      if (!shown.length) {
        listEl.appendChild(el('div', 'empty-state', showLeadsOnly ? 'No leads captured yet.' : 'No conversations yet.'));
        return;
      }
      shown.forEach(function (c) {
        var card = el('div', 'bot-card');
        var meta = el('div', 'bot-card-meta');
        meta.innerHTML = '<span>' + fmtDate(c.last_at) + '</span><span>' + c.message_count + ' msgs</span>';
        card.appendChild(meta);
        if (c.lead) {
          var lead = el('div', 'bot-card-assistant');
          lead.innerHTML = '<b>Lead:</b> ' + esc(c.lead.name || '(no name)') + ' &middot; ' + esc(c.lead.email);
          card.appendChild(lead);
        }
        var preview = el('div', 'muted');
        preview.textContent = c.preview || '(no message)';
        preview.style.fontSize = '13px';
        card.appendChild(preview);
        var actions = el('div', 'card-actions');
        var view = el('button', 'btn btn-ghost btn-sm', 'View transcript');
        view.onclick = function () { showTranscript(botId, c.conversation_id); };
        actions.appendChild(view);
        card.appendChild(actions);
        listEl.appendChild(card);
      });
    }

    api('GET', '/api/bots/' + botId + '/conversations').then(function (d) {
      conversations = d.conversations || [];
      renderList();
    }).catch(function (e) { toast(e.message, false); });

    return container;
  }

  function showTranscript(botId, convId) {
    var backdrop = el('div', 'modal-backdrop');
    var modal = el('div', 'modal');
    modal.style.maxWidth = '640px';
    modal.appendChild(el('h3', null, 'Conversation'));
    var body = el('div');
    body.style.cssText = 'max-height:60vh;overflow-y:auto;padding:8px 0;';
    body.appendChild(el('div', 'muted', 'Loading…'));
    modal.appendChild(body);
    var actions = el('div', 'modal-actions');
    var close = el('button', 'btn btn-ghost', 'Close');
    close.onclick = function () { backdrop.remove(); };
    actions.appendChild(close);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };
    document.body.appendChild(backdrop);

    api('GET', '/api/bots/' + botId + '/conversations/' + convId).then(function (d) {
      body.innerHTML = '';
      (d.messages || []).forEach(function (m) {
        var row = el('div');
        row.style.marginBottom = '10px';
        var label = el('div', 'bot-card-assistant', (m.role === 'user' ? 'Visitor' : 'Bot') + ' · ' + fmtDate(m.created_at));
        label.style.fontSize = '11px';
        var content = el('div');
        content.textContent = m.content;
        content.style.cssText = 'margin-top:3px;padding:8px 11px;border-radius:10px;font-size:14px;line-height:1.45;white-space:pre-wrap;' + (m.role === 'user' ? 'background:#eef2ff;color:#3730a3;' : 'background:#f3f4f6;color:#1f2937;');
        row.appendChild(label);
        row.appendChild(content);
        body.appendChild(row);
      });
    }).catch(function (e) {
      body.innerHTML = '';
      body.appendChild(el('div', 'muted', e.message));
    });
  }

  // ---------- Router ----------
  function render() {
    var app = document.getElementById('app');
    app.innerHTML = '';
    var parts = (location.hash || '#/').replace(/^#/, '').split('/').filter(Boolean);

    if (!state.user) { app.appendChild(viewLogin()); return; }
    app.appendChild(topbar());

    if (parts[0] === 'bot' && parts[1] === 'new') app.appendChild(viewEditor(null));
    else if (parts[0] === 'bot' && parts[2] === 'stats') app.appendChild(viewStats(parts[1]));
    else if (parts[0] === 'bot' && parts[2] === 'conversations') app.appendChild(viewConversations(parts[1]));
    else if (parts[0] === 'bot' && parts[1]) app.appendChild(viewEditor(parts[1]));
    else if (parts[0] === 'users') app.appendChild(viewUsers());
    else app.appendChild(viewDashboard());
  }

  window.addEventListener('hashchange', render);

  api('GET', '/api/auth/me').then(function (d) {
    state.user = d.user;
    render();
  }).catch(function () {
    state.user = null;
    render();
  });
})();
