/* Trust Return Preparer – UI, chat flow and session state.
 *
 * Milestone 1: interface shell. Everything lives in memory for this tab only.
 * The only thing written to localStorage is the theme; the API key is in
 * sessionStorage (see ai.js).
 */
(function () {
  'use strict';
  var TRP = (window.TRP = window.TRP || {});

  /* ---------- Small DOM helpers ---------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /** el('button', { class: 'btn', onclick: fn }, 'Text', childNode) – text is never parsed as HTML. */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var kid = arguments[i];
      if (kid == null) continue;
      node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    }
    return node;
  }

  /* ---------- Static content ---------- */

  var STEPS = [
    { id: 'documents', label: 'Documents read', hint: 'Upload year-end documents', view: 'chat' },
    { id: 'profile', label: 'Trust profile', hint: 'Answer what the documents cannot', view: 'chat' },
    { id: 'review', label: 'Resolve low-confidence items', hint: 'Confirm, correct or escalate', view: 'review' },
    { id: 'generate', label: 'Generate & sign off', hint: 'Download the draft and record review', view: 'complete' }
  ];

  var CONFIDENCE = [
    { id: 'high', label: 'High', symbol: '●' },
    { id: 'medium', label: 'Medium', symbol: '◐' },
    { id: 'low', label: 'Low', symbol: '○' }
  ];

  var SOURCES = [
    { label: 'Form 1041 (2025), fillable PDF', state: 'In /sources' },
    { label: 'Instructions for Form 1041 (2025)', state: 'In /sources' },
    { label: 'Schedule K-1 (Form 1041) and instructions', state: 'In /sources' },
    { label: 'Schedule D (Form 1041) and instructions', state: 'In /sources' },
    { label: 'Instructions for Forms 1099-INT, 1099-DIV and 1099-B', state: 'In /sources' }
  ];

  var BOUNDARY = [
    'File anything with the IRS.',
    'Send K-1s to beneficiaries.',
    'Interpret the trust instrument on its own.',
    'Make tax elections, such as the 65-day election or the Section 645 election.',
    'Prepare returns for estates, grantor trusts, ESBTs, qualified disability trusts, foreign trusts, or trusts with business or rental income.',
    'Show full SSNs or EINs.',
    'Answer tax questions from anything other than the bundled IRS excerpts.'
  ];

  /* ---------- Session state (memory only) ---------- */

  var state = {
    returns: [],
    activeId: null,
    view: 'first-run',
    pending: [],       // files chosen but not yet sent
    sessionLog: [],    // events that happen outside a return (for example, connecting a key)
    seq: 0,
    msgSeq: 0
  };
  TRP.state = state;

  function active() {
    for (var i = 0; i < state.returns.length; i++) {
      if (state.returns[i].id === state.activeId) return state.returns[i];
    }
    return null;
  }

  /* ---------- Review log ---------- */

  function redactDeep(value) {
    if (typeof value === 'string') return TRP.ai.redact(value);
    if (typeof value === 'number') {
      var s = TRP.ai.redact(String(value));
      return s === String(value) ? value : s;
    }
    if (Array.isArray(value)) return value.map(redactDeep);
    if (value && typeof value === 'object') {
      var out = {};
      Object.keys(value).forEach(function (k) { out[k] = redactDeep(value[k]); });
      return out;
    }
    return value;
  }

  /** Records an event. SSN/EIN patterns are masked before anything is stored. */
  function log(type, detail) {
    var entry = { at: new Date().toISOString(), type: type, detail: redactDeep(detail || {}) };
    var r = active();
    (r ? r.log : state.sessionLog).push(entry);
    renderLogCount();
    return entry;
  }
  TRP.log = log;

  function currentLog() {
    var r = active();
    return state.sessionLog.concat(r ? r.log : []).sort(function (a, b) {
      return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
    });
  }

  /* ---------- Returns ---------- */

  function newReturn() {
    var n = ++state.seq;
    var r = {
      id: 'r' + n,
      name: 'Untitled trust return ' + n,
      step: 'documents',
      messages: [],
      files: [],
      items: [],
      counts: { high: 0, medium: 0, low: 0 },
      log: [],
      status: 'Simple or complex: pending your answers',
      dirty: false,
      blocked: false
    };
    state.returns.unshift(r);
    state.activeId = r.id;
    state.pending = [];
    var ai = TRP.ai.getStatus();
    log('return.created', { name: r.name, mode: ai.connected ? 'AI-assisted (' + ai.model + ')' : 'manual entry' });
    seedWelcome(r, ai);
    setView('chat');
    renderAll();
    $('#composer-input').focus();
  }

  function seedWelcome(r, ai) {
    say(r, [
      { type: 'p', text: "I'll help you prepare a draft Form 1041 for a simple or complex trust, tax year 2025. Here's how it works:" },
      { type: 'ol', items: [
        "Documents: you upload the 1099s, the distribution and expense summary and, if there is one, last year's return.",
        "Trust profile: I ask what the documents can't tell me, one question at a time.",
        'Review: you confirm, correct or escalate every low-confidence item.',
        'Generate: you download the completed IRS forms and a review log for sign-off.'
      ] },
      { type: 'p', text: ai.connected
        ? 'AI is connected. It reads documents and asks questions. Rule-based code does all the tax math.'
        : "No AI key is connected, so you'll enter values yourself. You can connect a key at any time in Settings." },
      { type: 'question', q: {
        id: 'synthetic-ack',
        count: 'Before we start',
        text: 'Will you use synthetic (made-up) data only for this return?',
        why: 'This is a course prototype. It must not hold real taxpayer names, SSNs, EINs or documents.',
        source: 'App boundary: synthetic data only',
        options: [ { value: 'yes', label: 'Yes, synthetic data only' }, { value: 'no', label: 'No' } ],
        answer: null
      } }
    ]);
  }

  /* ---------- Messages ---------- */

  function say(r, blocks) {
    if (typeof blocks === 'string') blocks = [{ type: 'p', text: blocks }];
    r.messages.push({ id: 'm' + (++state.msgSeq), role: 'assistant', blocks: blocks });
  }

  /** SSN/EIN patterns typed into the chat are masked before they are stored or shown. */
  function userSays(r, text, fileNames) {
    r.messages.push({ id: 'm' + (++state.msgSeq), role: 'user', text: TRP.ai.redact(text || ''), files: fileNames || [] });
    r.dirty = true;
  }

  var QUESTION_HANDLERS = {
    'synthetic-ack': function (r, value) {
      if (value === 'yes') {
        say(r, [
          { type: 'p', text: 'Thanks. That is recorded in the session log.' },
          { type: 'p', text: "Start by dropping the trustee's year-end documents here, or use the paperclip. Reading them is built in the next milestone, so this is as far as the conversation goes in this build." }
        ]);
      } else {
        r.blocked = true;
        say(r, [
          { type: 'p', text: "Then let's stop here. This prototype is for synthetic data only, so I can't take this return any further." },
          { type: 'p', text: 'When you have a made-up case to work with, choose New return to start again.' }
        ]);
      }
    }
  };

  function answerQuestion(r, q, option) {
    if (q.answer != null) return;
    q.answer = option.value;
    userSays(r, option.label);
    log('answer', { question: q.id, text: q.text, answer: option.label });
    var handler = QUESTION_HANDLERS[q.id];
    if (handler) handler(r, option.value);
    renderAll();
    var input = $('#composer-input');
    if (!input.disabled) input.focus();
  }

  function renderQuestion(r, q) {
    var options = el('div', { class: 'question-options', role: 'group', 'aria-label': 'Answers' });
    q.options.forEach(function (opt) {
      options.appendChild(el('button', {
        type: 'button', class: 'btn btn-outline',
        disabled: q.answer != null,
        'aria-pressed': q.answer === opt.value ? 'true' : null,
        onclick: function () { answerQuestion(r, q, opt); }
      }, opt.label));
    });
    return el('div', { class: 'question' },
      el('span', { class: 'question-count' }, q.count),
      el('p', { class: 'question-text' }, q.text),
      options,
      el('div', { class: 'question-meta' },
        el('p', {}, el('strong', {}, "Why I'm asking: "), q.why),
        el('span', { class: 'source-tag' }, 'Source: ' + q.source))
    );
  }

  function renderChips(names) {
    var list = el('ul', { class: 'chips', 'aria-label': 'Attached files' });
    names.forEach(function (name) {
      list.appendChild(el('li', { class: 'chip' }, el('span', { class: 'chip-name' }, name)));
    });
    return list;
  }

  function renderMessages() {
    var r = active();
    var box = $('#messages');
    box.textContent = '';
    if (!r) return;
    r.messages.forEach(function (m) {
      var node;
      if (m.role === 'user') {
        node = el('div', { class: 'msg msg-user' }, el('span', { class: 'sr-only' }, 'You: '), m.text);
        if (m.files.length) node.appendChild(renderChips(m.files));
      } else {
        node = el('div', { class: 'msg msg-assistant' }, el('span', { class: 'sr-only' }, 'Trust Return Preparer: '));
        m.blocks.forEach(function (b) {
          if (b.type === 'p') node.appendChild(el('p', {}, b.text));
          else if (b.type === 'ol' || b.type === 'ul') {
            var list = el(b.type, {});
            b.items.forEach(function (t) { list.appendChild(el('li', {}, t)); });
            node.appendChild(list);
          } else if (b.type === 'question') node.appendChild(renderQuestion(r, b.q));
        });
      }
      box.appendChild(node);
    });
    var scroller = $('#chat-scroll');
    scroller.scrollTop = scroller.scrollHeight;
  }

  /* ---------- Composer and files ---------- */

  function addFiles(fileList) {
    var r = active();
    if (!r || r.blocked) return;
    var rejected = [];
    Array.prototype.forEach.call(fileList || [], function (f) {
      if (TRP.extract.isAccepted(f)) state.pending.push(f);
      else rejected.push(f.name);
    });
    if (rejected.length) {
      say(r, "I can't take " + rejected.join(', ') + '. Upload PDF, PNG or JPG files.');
      renderMessages();
    }
    renderComposer();
  }

  function renderComposer() {
    var r = active();
    var input = $('#composer-input');
    var blocked = !r || r.blocked;
    var chips = $('#pending-files');
    chips.textContent = '';
    state.pending.forEach(function (f, i) {
      chips.appendChild(el('li', { class: 'chip' },
        el('span', { class: 'chip-name' }, f.name),
        el('button', {
          type: 'button', class: 'chip-remove', 'aria-label': 'Remove ' + f.name,
          onclick: function () { state.pending.splice(i, 1); renderComposer(); }
        }, '✕')));
    });
    input.disabled = blocked;
    $('#file-input').disabled = !!r && r.blocked;
    input.placeholder = blocked ? 'Return closed. Start a new one.' : 'Type an answer or drop documents here';
    $('#send-btn').disabled = blocked || (!input.value.trim() && !state.pending.length);
  }

  function autoGrow(input) {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
  }

  function submitComposer() {
    var r = active();
    var input = $('#composer-input');
    var text = input.value.trim();
    var files = state.pending.slice();
    if (!r || r.blocked || (!text && !files.length)) return;

    userSays(r, text, files.map(function (f) { return f.name; }));
    if (files.length) {
      files.forEach(function (f) { r.files.push(f); });
      log('documents.uploaded', { files: files.map(function (f) { return { name: f.name, bytes: f.size, type: f.type || 'unknown' }; }) });
      say(r, 'Received ' + files.length + (files.length === 1 ? ' file' : ' files') +
        ". They are held in this tab's memory only. Classification and extraction are built in a later milestone, so nothing has been read yet.");
    }
    if (text) {
      log('message', { text: text });
      if (!files.length) {
        say(r, 'This build is the interface shell. Document reading and the trust questions that will respond here are built next. Nothing you typed was sent to an AI model.');
      }
    }
    state.pending = [];
    input.value = '';
    autoGrow(input);
    renderAll();
    input.focus();
  }

  /* ---------- Sidebar, progress panel, log ---------- */

  function stepLabel(id) {
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === id) return STEPS[i].label;
    return '';
  }

  function renderSidebar() {
    var list = $('#return-list');
    list.textContent = '';
    state.returns.forEach(function (r) {
      list.appendChild(el('li', {},
        el('button', {
          type: 'button', class: 'return-item',
          'aria-current': r.id === state.activeId && state.view !== 'first-run' ? 'true' : null,
          onclick: function () {
            state.activeId = r.id;
            state.pending = [];
            setView('chat');
            closeDrawers();
            renderAll();
          }
        }, r.name, el('small', {}, r.blocked ? 'Closed' : stepLabel(r.step)))));
    });
    $('#return-empty').hidden = state.returns.length > 0;
  }

  function renderProgress() {
    var r = active();
    var steps = $('#steps');
    steps.textContent = '';
    var currentIndex = r ? STEPS.map(function (s) { return s.id; }).indexOf(r.step) : 0;
    STEPS.forEach(function (s, i) {
      var st = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'upcoming';
      steps.appendChild(el('li', { class: 'step', 'data-state': st },
        el('button', {
          type: 'button', class: 'step-btn',
          'aria-current': st === 'current' ? 'step' : null,
          onclick: function () { setView(s.view); closeDrawers(); }
        },
          el('span', { class: 'step-num', 'aria-hidden': 'true' }, st === 'done' ? '✓' : ''),
          el('span', { class: 'step-body' },
            el('span', { class: 'step-label' }, (i + 1) + ' · ' + s.label, st === 'done' ? el('span', { class: 'sr-only' }, ' (done)') : null)))));
    });

    var counts = $('#counts');
    counts.textContent = '';
    CONFIDENCE.forEach(function (c) {
      counts.appendChild(el('li', {},
        el('span', { class: 'badge badge-' + c.id }, el('span', { 'aria-hidden': 'true' }, c.symbol), ' ' + c.label),
        el('span', { class: 'count-num' }, String(r ? r.counts[c.id] : 0))));
    });
  }

  function renderLogCount() {
    var node = $('#log-count');
    if (node) node.textContent = String(currentLog().length);
  }

  function openLog() {
    var list = $('#log-list');
    list.textContent = '';
    var entries = currentLog();
    if (!entries.length) list.appendChild(el('li', {}, 'No events yet.'));
    entries.forEach(function (e) {
      list.appendChild(el('li', {},
        el('span', { class: 'log-time' }, new Date(e.at).toLocaleTimeString()),
        el('span', { class: 'log-type' }, e.type),
        JSON.stringify(e.detail)));
    });
    $('#log-dialog').showModal();
  }

  /* ---------- Views ---------- */

  var VIEW_IDS = { 'first-run': 'view-first-run', chat: 'view-chat', review: 'view-review', complete: 'view-complete' };

  function setView(view) {
    if (view !== 'first-run' && !active()) view = 'first-run';
    state.view = view;
    Object.keys(VIEW_IDS).forEach(function (v) { $('#' + VIEW_IDS[v]).hidden = v !== view; });
    var inReturn = view !== 'first-run';
    var r = active();
    // As in the mockup, the progress panel sits beside the conversation only.
    $('#progress').hidden = view !== 'chat';
    $('#open-progress-btn').hidden = view !== 'chat';
    $('#topbar-status').hidden = !inReturn;
    $('#topbar-status').textContent = r ? (r.blocked ? 'Closed' : r.status) : '';
    $('#topbar-title').textContent = inReturn && r ? r.name : 'Trust Return Preparer';
    renderSidebar();
  }

  function renderAll() {
    renderSidebar();
    renderProgress();
    renderMessages();
    renderComposer();
    renderLogCount();
  }

  /* ---------- API key UI (first-run card, settings, sidebar) ---------- */

  function renderKey(status) {
    var modelLabel = '';
    status.models.forEach(function (m) { if (m.id === status.model) modelLabel = m.label; });
    var message = status.connected && modelLabel ? status.message + ' · ' + modelLabel : status.message;

    $$('[data-key-form]').forEach(function (form) {
      $('[data-key-dot]', form).setAttribute('data-state', status.state);
      $('[data-key-message]', form).textContent = message;
      var btn = $('[data-key-submit]', form);
      btn.disabled = status.state === 'connecting';
      btn.textContent = status.state === 'connecting' ? 'Checking…' : status.connected ? 'Replace key' : 'Connect';
      var input = $('[data-key-input]', form);
      input.placeholder = status.connected ? 'Key connected (hidden)' : 'Paste your key';
      if (status.connected) input.value = '';
    });

    $('#key-status-btn').setAttribute('data-state', status.state);
    $('#key-status-text').textContent = 'API key · ' + (status.connected ? 'Connected'
      : status.state === 'connecting' ? 'Checking…' : 'Not connected');

    var select = $('#model-select');
    select.textContent = '';
    status.models.forEach(function (m) {
      select.appendChild(el('option', { value: m.id, selected: m.id === status.model }, m.label));
    });
    $('#model-row').hidden = !status.connected;
    $('#disconnect-btn').hidden = !status.connected;
  }

  function bindKeyForms() {
    $$('[data-key-form]').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        TRP.ai.connect($('[data-key-input]', form).value);
      });
    });
    $('#disconnect-btn').addEventListener('click', function () { TRP.ai.disconnect(); });
    $('#model-select').addEventListener('change', function (e) { TRP.ai.setModel(e.target.value); });
    TRP.ai.onStatus(renderKey);
    renderKey(TRP.ai.getStatus());
  }

  /* ---------- Theme (the only thing kept in localStorage) ---------- */

  function setTheme(theme) {
    theme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('trp-theme', theme); } catch (e) { /* storage blocked: theme lasts for this page only */ }
    $$('input[name="theme"]').forEach(function (radio) { radio.checked = radio.value === theme; });
  }
  TRP.setTheme = setTheme;

  /* ---------- Drawers (narrow screens) and dialogs ---------- */

  function openDrawer(id, opener) {
    closeDrawers();
    $('#' + id).classList.add('is-open');
    $('#backdrop').hidden = false;
    if (opener) opener.setAttribute('aria-expanded', 'true');
    var first = $('button, a, input', $('#' + id));
    if (first) first.focus();
  }

  function closeDrawers() {
    $('#sidebar').classList.remove('is-open');
    $('#progress').classList.remove('is-open');
    $('#backdrop').hidden = true;
    $('#open-sidebar-btn').setAttribute('aria-expanded', 'false');
    $('#open-progress-btn').setAttribute('aria-expanded', 'false');
  }

  function bindDialogs() {
    $$('dialog').forEach(function (dialog) {
      $$('[data-close-dialog]', dialog).forEach(function (btn) {
        btn.addEventListener('click', function () { dialog.close(); });
      });
      dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
    });
  }

  function openSettings(focusKey) {
    closeDrawers();
    $('#settings-dialog').showModal();
    if (focusKey) $('#settings-key-input').focus();
  }

  /* ---------- Drag and drop ---------- */

  function hasFiles(e) {
    var types = e.dataTransfer && e.dataTransfer.types;
    return !!types && Array.prototype.indexOf.call(types, 'Files') !== -1;
  }

  function bindDrop() {
    var view = $('#view-chat');
    var overlay = $('#drop-overlay');
    var depth = 0;
    view.addEventListener('dragenter', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      overlay.hidden = false;
    });
    view.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
    view.addEventListener('dragleave', function (e) {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) overlay.hidden = true;
    });
    view.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      overlay.hidden = true;
      addFiles(e.dataTransfer.files);
    });
    // A file dropped anywhere else must not make the browser navigate away and lose the session.
    window.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', function (e) { if (hasFiles(e)) e.preventDefault(); });
  }

  /* ---------- Start-up ---------- */

  function init() {
    SOURCES.forEach(function (s) {
      $('#source-list').appendChild(el('li', {}, el('span', {}, s.label), el('span', { class: 'source-state' }, s.state)));
    });
    BOUNDARY.forEach(function (b) { $('#boundary-list').appendChild(el('li', {}, b)); });

    setTheme(document.documentElement.getAttribute('data-theme'));
    $$('input[name="theme"]').forEach(function (radio) {
      radio.addEventListener('change', function () { if (radio.checked) setTheme(radio.value); });
    });

    bindKeyForms();
    bindDialogs();
    bindDrop();

    // First screen: the arrow, a typed message or dropped files all start a return.
    var firstInput = $('#first-input');
    function startFromFirstScreen() {
      var text = firstInput.value.trim();
      firstInput.value = '';
      newReturn();
      if (text) { $('#composer-input').value = text; submitComposer(); }
    }
    $('#first-composer').addEventListener('submit', function (e) { e.preventDefault(); startFromFirstScreen(); });
    firstInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); startFromFirstScreen(); }
    });
    var zone = $('#first-dropzone');
    zone.addEventListener('click', function () { $('#file-input').click(); });
    zone.addEventListener('dragover', function (e) { if (hasFiles(e)) { e.preventDefault(); zone.classList.add('is-over'); } });
    zone.addEventListener('dragleave', function () { zone.classList.remove('is-over'); });
    zone.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      zone.classList.remove('is-over');
      var files = Array.prototype.slice.call(e.dataTransfer.files);
      newReturn();
      addFiles(files);
    });
    $('#review-btn').addEventListener('click', function () { closeDrawers(); setView('review'); });
    $('#new-return-btn').addEventListener('click', function () { closeDrawers(); newReturn(); });
    $('#settings-btn').addEventListener('click', function () { openSettings(false); });
    $('#key-status-btn').addEventListener('click', function () { openSettings(true); });
    $('#open-log-btn').addEventListener('click', function () { closeDrawers(); openLog(); });
    $('#open-sidebar-btn').addEventListener('click', function (e) { openDrawer('sidebar', e.currentTarget); });
    $('#open-progress-btn').addEventListener('click', function (e) { openDrawer('progress', e.currentTarget); });
    $('#close-progress-btn').addEventListener('click', closeDrawers);
    $('#backdrop').addEventListener('click', closeDrawers);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawers(); });
    $$('[data-goto]').forEach(function (btn) {
      btn.addEventListener('click', function () { setView(btn.getAttribute('data-goto')); });
    });

    var input = $('#composer-input');
    input.addEventListener('input', function () { autoGrow(input); renderComposer(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submitComposer(); }
    });
    $('#composer').addEventListener('submit', function (e) { e.preventDefault(); submitComposer(); });
    $('#file-input').addEventListener('change', function (e) {
      var files = Array.prototype.slice.call(e.target.files);
      e.target.value = '';
      if (!files.length) return;
      if (!active()) newReturn();
      addFiles(files);
    });

    // Nothing persists, so warn before a close or reload throws work away.
    window.addEventListener('beforeunload', function (e) {
      var hasWork = state.returns.some(function (r) { return r.dirty; });
      if (!hasWork) return;
      e.preventDefault();
      e.returnValue = '';
    });

    setView('first-run');
    renderAll();
    TRP.ai.restore();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
