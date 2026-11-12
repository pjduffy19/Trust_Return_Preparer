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
  function log(type, detail, target) {
    var entry = { at: new Date().toISOString(), type: type, detail: redactDeep(detail || {}) };
    var r = target || active();
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
      docs: [],
      items: [],
      docSeq: 0,
      itemSeq: 0,
      acked: false,
      busy: false,
      answers: {},          // trust profile answers: id -> { value, label, confidence, reason }
      pii: {},              // full SSNs and EINs: memory only, never logged, never sent to the AI
      profileStarted: false,
      profileDone: false,
      flagState: {},        // profile flag id -> 'confirmed' | 'escalated'
      result: null,         // the engine's output once the return is generated
      escalated: 0,
      counts: { high: 0, medium: 0, low: 0 },
      log: [],
      status: 'Simple or complex: pending your answers',
      dirty: false,
      blocked: false
    };
    state.returns.unshift(r);
    state.activeId = r.id;
    state.pending = [];
    state.panel = null;
    var ai = TRP.ai.getStatus();
    log('return.created', { name: r.name, mode: ai.connected ? 'AI-assisted (' + ai.model + ')' : 'manual entry' });
    seedWelcome(r, ai);
    setView('chat');
    renderAll();
    $('#composer-input').focus();
  }

  /** Renames a return. Names are shown everywhere, so they may not contain an SSN or EIN. */
  function renameReturn(r, raw) {
    var name = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!name) return 'Enter a name.';
    if (TRP.ai.findTins(name).length) return 'A name cannot contain an SSN or EIN.';
    if (name === r.name) return '';
    log('return.renamed', { from: r.name, to: name }, r);
    r.name = name;
    r.named = true;
    return '';
  }
  TRP.renameReturn = renameReturn;

  function startRename() {
    var r = active();
    if (!r) return;
    var title = $('#topbar-title');
    var input = el('input', { class: 'input rename-input', id: 'rename-input', type: 'text', maxlength: '80', autocomplete: 'off', value: r.name, 'aria-describedby': 'rename-error' });
    var error = el('span', { class: 'form-error', id: 'rename-error', role: 'alert' });
    var form = el('form', { class: 'rename-form', novalidate: true },
      el('label', { class: 'sr-only', for: 'rename-input' }, 'Trust name'), input,
      el('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, 'Save'),
      el('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: finish }, 'Cancel'), error);
    function finish() { form.remove(); title.hidden = false; $('#rename-btn').hidden = false; setView(state.view); $('#rename-btn').focus(); }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var problem = renameReturn(r, input.value);
      if (problem) { error.textContent = problem; input.focus(); return; }
      finish();
      renderAll();
    });
    input.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); finish(); } });
    title.hidden = true;
    $('#rename-btn').hidden = true;
    title.parentNode.insertBefore(form, title.nextSibling);
    input.focus();
    input.select();
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
        r.acked = true;
        say(r, [
          { type: 'p', text: 'Thanks. That is recorded in the session log.' },
          { type: 'p', text: "Start by dropping the trustee's year-end documents here, or use the paperclip: 1099-INT, 1099-DIV, 1099-B and the distribution and expense summary." }
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

  /* ---------- Question cards (the synthetic-data check and the trust profile) ---------- */

  function sourceNode(q) {
    var cite = q.sourceId ? TRP.knowledge.byId[q.sourceId] : null;
    if (!q.pid) return el('span', { class: 'source-tag' }, 'Source: ' + q.source);
    if (!cite) return el('span', { class: 'source-tag' }, q.sourceId ? 'Source: IRS excerpt not loaded' : 'Source: app boundary, not an IRS rule');
    var wrap = el('div', { class: 'source-wrap' },
      el('button', { type: 'button', class: 'source-tag source-btn', 'aria-expanded': q.showSource ? 'true' : 'false',
        onclick: function () { q.showSource = !q.showSource; renderMessages(); } },
        'Source: ' + cite.source + ' · ' + cite.section));
    if (q.showSource) wrap.appendChild(el('blockquote', { class: 'excerpt' }, cite.text));
    return wrap;
  }

  /** An input whose typed value survives re-renders, by living in q.draft. */
  function draftInput(q, key, attrs) {
    attrs.class = 'input';
    attrs.autocomplete = 'off';
    if (q.draft[key] != null && attrs.type !== 'checkbox') attrs.value = q.draft[key];
    var input = el('input', attrs);
    if (attrs.type === 'checkbox') input.checked = !!q.draft[key];
    input.addEventListener(attrs.type === 'checkbox' ? 'change' : 'input', function () {
      q.draft[key] = attrs.type === 'checkbox' ? input.checked : input.value;
    });
    return input;
  }

  function labelled(text, input, cls) {
    return el('label', { class: 'q-field' + (cls ? ' ' + cls : '') }, el('span', { class: 'q-label' }, text), input);
  }

  function nineDigits(text) {
    var d = String(text || '').replace(/[\s-]/g, '');
    return /^\d{9}$/.test(d) ? d : null;
  }

  /** Builds the answer form for one profile question. submit(value, label) records the answer. */
  function answerForm(r, q, submit) {
    var def = q.def, error = el('p', { class: 'form-error', role: 'alert' }, q.error || '');
    function fail(msg, focusEl) { q.error = msg; error.textContent = msg; if (focusEl) focusEl.focus(); }
    var body = [], onSave, extra = null;

    if (def.type === 'text') {
      var t = draftInput(q, 'v', { type: 'text', maxlength: '120', placeholder: def.hint || '', 'aria-label': q.text });
      body.push(t);
      onSave = function () {
        var v = t.value.replace(/\s+/g, ' ').trim();
        if (!v) return fail('Enter an answer.', t);
        if (TRP.ai.findTins(v).length) return fail('Do not type an SSN or EIN here.', t);
        submit(v, v);
      };
    } else if (def.type === 'date') {
      var d = draftInput(q, 'v', { type: 'date', max: TRP.profile.YEAR + '-12-31', 'aria-label': q.text });
      body.push(d);
      onSave = function () {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d.value)) return fail('Choose a date.', d);
        if (d.value > TRP.profile.YEAR + '-12-31') return fail('The date cannot be after ' + TRP.profile.YEAR + '.', d);
        var p = d.value.split('-');
        submit(d.value, p[1] + '/' + p[2] + '/' + p[0]);
      };
    } else if (def.type === 'tin') {
      var n = draftInput(q, 'v', { type: 'password', inputmode: 'numeric', maxlength: '11', placeholder: '00-0000000', 'aria-label': q.text });
      body.push(n, el('p', { class: 'fine' }, def.hint || ''));
      onSave = function () {
        var digits = nineDigits(n.value);
        if (!digits) return fail('Enter nine digits.', n);
        r.pii[def.id] = digits;
        q.draft = {};
        var masked = TRP.ai.maskTin(digits, def.kind);
        submit(masked, masked);
      };
    } else if (def.type === 'address') {
      var street = draftInput(q, 'street', { type: 'text', maxlength: '80' }), city = draftInput(q, 'city', { type: 'text', maxlength: '40' });
      var st = draftInput(q, 'state', { type: 'text', maxlength: '2' }), zip = draftInput(q, 'zip', { type: 'text', inputmode: 'numeric', maxlength: '10' });
      body.push(el('div', { class: 'q-grid' }, labelled('Number and street', street, 'wide'), labelled('City or town', city), labelled('State', st, 'narrow'), labelled('ZIP code', zip, 'narrow')));
      onSave = function () {
        var v = { street: street.value.trim(), city: city.value.trim(), state: st.value.trim().toUpperCase(), zip: zip.value.trim() };
        if (!v.street) return fail('Enter the street address.', street);
        if (!v.city) return fail('Enter the city or town.', city);
        if (!/^[A-Z]{2}$/.test(v.state)) return fail('Enter the two-letter state.', st);
        if (!/^\d{5}(-\d{4})?$/.test(v.zip)) return fail('Enter a 5-digit ZIP code.', zip);
        submit(v, v.street + ', ' + v.city + ', ' + v.state + ' ' + v.zip);
      };
    } else if (def.type === 'multi') {
      var boxes = q.options.map(function (o) {
        var c = draftInput(q, 'c_' + o.value, { type: 'checkbox' });
        c.className = '';
        return { o: o, c: c, node: el('label', { class: 'q-check' }, c, el('span', {}, o.label)) };
      });
      body.push(el('div', { class: 'q-checks' }, boxes.map(function (b) { return b.node; }).reduce(function (wrap, node) { wrap.appendChild(node); return wrap; }, el('div', {}))));
      extra = el('button', { type: 'button', class: 'btn btn-outline', onclick: function () { submit([], def.noneLabel); } }, def.noneLabel);
      onSave = function () {
        var picked = boxes.filter(function (b) { return b.c.checked; });
        if (!picked.length) return fail('Tick at least one, or choose "' + def.noneLabel + '".');
        submit(picked.map(function (b) { return b.o.value; }), picked.map(function (b) { return b.o.label; }).join(', '));
      };
    } else if (def.type === 'amounts') {
      var ins = def.fields.map(function (f) {
        var i = draftInput(q, f.key, { type: 'text', inputmode: 'decimal', placeholder: '0.00' });
        return { f: f, i: i };
      });
      body.push(el('div', { class: 'q-grid' }, ins.map(function (x) { return labelled(x.f.label, x.i); }).reduce(function (w, nd) { w.appendChild(nd); return w; }, el('div', { class: 'q-grid-inner' }))));
      extra = el('button', { type: 'button', class: 'btn btn-outline', onclick: function () { submit({ skipped: true }, def.skipLabel); } }, def.skipLabel);
      onSave = function () {
        var v = {}, bad = null;
        ins.forEach(function (x) {
          var raw = x.i.value.trim() === '' ? '0' : x.i.value, amt = readAmount(raw);
          if (amt === null || amt < 0) bad = bad || x; else v[x.f.key] = amt;
        });
        if (bad) return fail('Enter an amount such as 3,000.00, or 0.', bad.i);
        submit(v, ins.map(function (x) { return x.f.label + ' ' + TRP.extract.formatMoney(v[x.f.key]); }).join('; '));
      };
    } else if (def.type === 'beneficiaries') {
      if (!q.draft.rows) q.draft.rows = [{}, {}];
      var rows = q.draft.rows, list = el('div', { class: 'ben-list' });
      rows.forEach(function (row, i) {
        function inp(key, attrs) {
          if (row[key] != null) attrs.value = row[key];
          attrs.class = 'input'; attrs.autocomplete = 'off';
          var e = el('input', attrs);
          e.addEventListener('input', function () { row[key] = e.value; });
          row['_' + key] = e;
          return e;
        }
        list.appendChild(el('fieldset', { class: 'ben' },
          el('legend', {}, 'Beneficiary ' + (i + 1)),
          el('div', { class: 'q-grid' },
            labelled('Name', inp('name', { type: 'text', maxlength: '80' })),
            labelled('Share of income (%)', inp('share', { type: 'text', inputmode: 'decimal', maxlength: '6' }), 'narrow'),
            labelled('Address', inp('address', { type: 'text', maxlength: '120' }), 'wide'),
            labelled('SSN or other identifying number', inp('tin', { type: 'password', inputmode: 'numeric', maxlength: '11', placeholder: '000-00-0000' }))),
          rows.length > 1 ? el('button', { type: 'button', class: 'link-btn', onclick: function () { rows.splice(i, 1); renderMessages(); } }, 'Remove beneficiary ' + (i + 1)) : null));
      });
      body.push(list, el('button', { type: 'button', class: 'btn btn-outline', onclick: function () { rows.push({}); renderMessages(); } }, '+ Add a beneficiary'),
        el('p', { class: 'fine' }, 'Use made-up names and numbers. Shares must add up to 100%.'));
      onSave = function () {
        var out = [], tins = [], total = 0, seen = {};
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i], name = String(row.name || '').replace(/\s+/g, ' ').trim(), share = parseFloat(row.share), tin = nineDigits(row.tin);
          if (!name) return fail('Enter a name for beneficiary ' + (i + 1) + '.', row._name);
          if (TRP.ai.findTins(name + ' ' + (row.address || '')).length) return fail('Do not type an identifying number in the name or address.', row._name);
          if (seen[name.toLowerCase()]) return fail('Two beneficiaries have the same name.', row._name);
          if (!isFinite(share) || share <= 0 || share > 100) return fail('Enter a share between 0 and 100 for ' + name + '.', row._share);
          if (!String(row.address || '').trim()) return fail('Enter an address for ' + name + '.', row._address);
          if (!tin) return fail('Enter nine digits for ' + name + "'s identifying number.", row._tin);
          seen[name.toLowerCase()] = true;
          total += share;
          tins.push(tin);
          out.push({ name: name, address: String(row.address).trim(), share: share, tin: TRP.ai.maskTin(tin, 'ssn') });
        }
        if (Math.abs(total - 100) > 0.01) return fail('The shares add up to ' + Math.round(total * 100) / 100 + '%. They must add up to 100%.');
        r.pii.beneficiaries = tins;
        q.draft = {};
        submit(out, out.map(function (b) { return b.name + ' ' + b.share + '%'; }).join(', '));
      };
    }

    var form = el('form', { class: 'q-form', novalidate: true });
    body.forEach(function (node) { form.appendChild(node); });
    form.appendChild(error);
    form.appendChild(el('div', { class: 'btn-row' }, el('button', { type: 'submit', class: 'btn btn-primary' }, 'Save answer'), extra));
    form.addEventListener('submit', function (e) { e.preventDefault(); q.error = ''; onSave(); });
    return form;
  }

  function renderQuestion(r, q) {
    var card = el('div', { class: 'question' + (q.superseded ? ' is-superseded' : '') },
      el('span', { class: 'question-count' }, q.count),
      el('p', { class: 'question-text' }, q.text));

    if (q.superseded) {
      card.appendChild(el('p', { class: 'fine' }, q.answerLabel ? 'Earlier answer: ' + q.answerLabel + '. Changed since.' : 'No longer needed.'));
      return card;
    }
    if (q.answer != null && q.pid) {
      card.appendChild(el('div', { class: 'q-answer' },
        el('span', {}, el('strong', {}, 'Your answer: '), q.answerLabel),
        el('button', { type: 'button', class: 'link-btn', onclick: function () { changeAnswer(r, q); } }, 'Change')));
    } else if (!q.pid || q.type === 'choice') {
      var options = el('div', { class: 'question-options', role: 'group', 'aria-label': 'Answers' });
      q.options.forEach(function (opt) {
        options.appendChild(el('button', {
          type: 'button', class: 'btn btn-outline',
          disabled: q.answer != null,
          'aria-pressed': q.answer === opt.value ? 'true' : null,
          onclick: function () { q.pid ? answerProfile(r, q, opt.value, opt.label) : answerQuestion(r, q, opt); }
        }, opt.label));
      });
      card.appendChild(options);
    } else {
      card.appendChild(answerForm(r, q, function (value, label) { answerProfile(r, q, value, label); }));
    }
    card.appendChild(el('div', { class: 'question-meta' },
      el('p', {}, el('strong', {}, "Why I'm asking: "), q.why), sourceNode(q)));
    return card;
  }

  /* ---------- Trust profile flow ---------- */

  /** What the documents say that the profile rules need. */
  function docFacts(r) {
    var f = { principalDist: null, taxExempt: 0, hasPrior: false, prior: { type: null, name: null, ein: null, st: null, lt: null, bens: null, year: null } };
    var map = { prior_type: 'type', prior_name: 'name', prior_ein: 'ein', prior_stcl: 'st', prior_ltcl: 'lt', prior_bens: 'bens', prior_year: 'year' };
    r.items.forEach(function (it) {
      if (it.value === null) return;
      if (it.fieldId === 'sum_principal_dist') f.principalDist = (f.principalDist || 0) + it.value;
      else if (it.fieldId === 'int_8' || it.fieldId === 'div_12') f.taxExempt += it.value;
      else if (map[it.fieldId]) f.prior[map[it.fieldId]] = it.value;
    });
    f.hasPrior = r.docs.some(function (d) { return d.forms && d.forms.indexOf('PRIOR') !== -1; });
    return f;
  }

  function ctxOf(r) {
    var a = {};
    Object.keys(r.answers).forEach(function (k) { a[k] = r.answers[k].value; });
    return { a: a, facts: docFacts(r), pii: r.pii };
  }
  TRP.ctxOf = ctxOf;
  /** The engine input for a return, built from its items and answers. */
  TRP.engineInput = function (r) { var ctx = ctxOf(r); return TRP.engine.inputFrom(r.items, ctx.a, ctx.facts); };
  TRP.pendingQuestion = function () { var r = active(); return r ? pendingQuestion(r) : null; };

  function pendingQuestion(r) {
    for (var i = r.messages.length - 1; i >= 0; i--) {
      var blocks = r.messages[i].blocks || [];
      for (var j = 0; j < blocks.length; j++) {
        var q = blocks[j].q;
        if (blocks[j].type === 'question' && q.pid && q.answer == null && !q.superseded) return q;
      }
    }
    return null;
  }

  function profileStatus(r) {
    var ctx = ctxOf(r), c = TRP.profile.classify(ctx.a);
    if (TRP.profile.stop(ctx)) return ctx.a.entity === 'unsure' || ctx.a.domestic === 'unsure' || ctx.a.business === 'unsure' ? 'Paused: needs the reviewer' : 'Out of scope';
    if (ctx.a.classification) return (ctx.a.classification === 'simple' ? 'Simple trust' : 'Complex trust') + ' · confirmed by you';
    if (!c.pending && !c.decided) return 'Simple or complex: undecided';
    return 'Simple or complex: pending your answers';
  }

  function startProfile(r) {
    if (r.profileStarted || r.blocked || !r.acked) return;
    r.profileStarted = true;
    say(r, "Now the questions the documents can't answer. I'll ask them one at a time, and you can change any answer later.");
    log('profile.started', {}, r);
    askNext(r);
  }

  function askNext(r) {
    if (!r.profileStarted || r.blocked) return;
    var ctx = ctxOf(r), P = TRP.profile;
    var stop = P.stop(ctx);
    var pending = pendingQuestion(r);
    if (pending) {
      var still = !stop && P.applicable(ctx).some(function (d) { return d.id === pending.pid; });
      if (still) {                      // facts may have changed since it was asked (a new document, say)
        var fresh = P.resolve(pending.def, ctx);
        pending.text = fresh.text; pending.options = fresh.options;
        return;
      }
      pending.superseded = true;
    }
    r.status = profileStatus(r);
    if (stop) {
      if (r.stopShown !== stop.text) {
        r.stopShown = stop.text;
        var cite = stop.source ? TRP.knowledge.byId[stop.source] : null;
        say(r, [{ type: 'p', text: stop.text },
          { type: 'p', small: true, text: cite ? 'Source: ' + cite.source + ' · ' + cite.section : 'Source: app boundary, not an IRS rule' },
          { type: 'p', small: true, text: 'If that answer was a mistake, use Change on it above.' }]);
        log('profile.stopped', { reason: stop.text }, r);
      }
      return;
    }
    r.stopShown = null;
    if (r.awaitingChange) return;
    var def = P.next(ctx);
    if (!def) { finishProfile(r, ctx); return; }
    r.profileDone = false;
    var all = P.applicable(ctx), done = all.filter(function (d) { return d.id in ctx.a; }).length;
    var res = P.resolve(def, ctx);
    say(r, [{ type: 'question', q: {
      id: 'p' + (++state.msgSeq), pid: def.id, def: def, type: def.type, sourceId: def.source,
      // The total is only known once the scope and classification questions are behind us.
      count: 'Question ' + (done + 1) + (all.length > 8 ? ' of ' + all.length : '') + ' · ' + def.section,
      text: res.text, options: res.options, why: def.why, answer: null, answerLabel: '', draft: {}, error: ''
    } }]);
  }

  function answerProfile(r, q, value, label) {
    if (q.answer != null || q.superseded) return;
    var def = q.def;
    if (def.id === 'classification' && value === 'redo') {
      q.superseded = true; q.answerLabel = '';
      r.awaitingChange = true;
      userSays(r, label);
      say(r, 'No problem. Use Change on the answer you want to correct, and I will work it out again.');
      log('profile.answer', { question: def.id, answer: label }, r);
      renderAll();
      return;
    }
    q.answer = value; q.answerLabel = label;
    invalidate(r);
    var unsure = value === 'unsure' || (value && value.skipped);
    r.answers[def.id] = { value: value, label: label, confidence: unsure ? 'low' : 'high', reason: unsure ? 'You answered Not sure' : 'You answered this directly' };
    r.dirty = true;
    userSays(r, label);
    log('profile.answer', { question: def.id, text: q.text, answer: label, confidence: unsure ? 'low' : 'high' }, r);

    if (def.id === 'classification') {
      var c = TRP.profile.classify(ctxOf(r).a);
      log('classification.decided', { result: value, rule: 'Simple trust test, Instructions for Form 1041 (i1041-simple-trust)', failed: c.reasons, confirmedBy: 'user' }, r);
    }
    if (def.id === 'trust_name' && !r.named) r.name = value;
    if (def.id === 'ein_conflict' && value === 'reenter') {
      ['ein', 'ein_conflict'].forEach(function (id) { supersede(r, id); delete r.answers[id]; });
      delete r.pii.ein;
    }
    recount(r);
    askNext(r);
    renderAll();
  }

  /** Marks the answered card for a question as replaced, so a new one can be asked. */
  function supersede(r, pid) {
    r.messages.forEach(function (m) {
      (m.blocks || []).forEach(function (b) {
        if (b.type === 'question' && b.q.pid === pid && !b.q.superseded) b.q.superseded = true;
      });
    });
  }

  function changeAnswer(r, q) {
    if (r.busy) return;
    var def = q.def;
    log('profile.changed', { question: def.id, was: q.answerLabel }, r);
    TRP.profile.flags(ctxOf(r)).forEach(function (f) { if (f.pid === def.id) delete r.flagState[f.id]; });
    invalidate(r);
    r.profileDone = false;
    q.superseded = true;
    delete r.answers[def.id];
    if (def.type === 'tin') delete r.pii[def.id];
    if (def.type === 'beneficiaries') delete r.pii.beneficiaries;
    (def.clears || []).forEach(function (id) { if (id in r.answers) { supersede(r, id); delete r.answers[id]; } });
    r.awaitingChange = false;
    recount(r);
    askNext(r);
    renderAll();
  }

  function finishProfile(r, ctx) {
    r.status = profileStatus(r);
    if (r.profileDone) return;
    r.profileDone = true;
    if (r.step === 'documents' || r.step === 'profile') r.step = 'review';
    var flags = TRP.profile.flags(ctx);
    var blocks = [{ type: 'p', text: "That's everything I need for the trust profile." },
      { type: 'ul', items: TRP.profile.summary(ctx).map(function (row) { return row[0] + ': ' + row[1]; }) }];
    var low = flags.filter(function (f) { return f.level === 'low'; }), esc = flags.filter(function (f) { return f.level === 'escalate'; });
    if (low.length) {
      blocks.push({ type: 'p', text: 'Low confidence, to resolve before the return can be generated:' });
      blocks.push({ type: 'ul', items: low.map(function (f) { return f.text + '.'; }) });
    }
    if (esc.length) {
      blocks.push({ type: 'p', text: 'For the reviewer, outside what this tool computes:' });
      blocks.push({ type: 'ul', items: esc.map(function (f) { return f.text + '.'; }) });
    }
    var g = gate(r);
    blocks.push({ type: 'p', text: g.canGenerate ? 'Nothing is blocking the return. Open the review screen to look over the Medium items and generate it.'
      : 'Next, open the review screen: ' + g.why.replace(/ first$/, '') + ', then generate the return.' });
    blocks.push({ type: 'actions', actions: [{ label: 'Open the review screen', run: function () { setView('review'); } }] });
    say(r, blocks);
    log('profile.complete', { summary: TRP.profile.summary(ctx), flags: flags }, r);
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
          if (b.type === 'p') node.appendChild(el('p', { class: b.small ? 'fine' : null }, b.text));
          else if (b.type === 'ol' || b.type === 'ul') {
            var list = el(b.type, {});
            b.items.forEach(function (t) { list.appendChild(el('li', {}, t)); });
            node.appendChild(list);
          } else if (b.type === 'question') node.appendChild(renderQuestion(r, b.q));
          else if (b.type === 'table') node.appendChild(renderTable(r, b.itemIds));
          else if (b.type === 'status') node.appendChild(el('p', { class: 'status-line', role: 'status' }, b.text));
          else if (b.type === 'actions') {
            var row = el('div', { class: 'btn-row' });
            b.actions.forEach(function (a) {
              row.appendChild(el('button', { type: 'button', class: 'btn btn-outline', onclick: a.run }, a.label));
            });
            node.appendChild(row);
          }
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
    var blocked = !r || r.blocked || r.busy;
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
    input.placeholder = r && r.busy ? 'Reading documents…' : blocked ? 'Return closed. Start a new one.' : 'Type an answer or drop documents here';
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
    if (!r || r.blocked || r.busy || (!text && !files.length)) return;
    if (!r.acked) {
      say(r, 'Please answer the question above first. This tool is for synthetic data only.');
      renderAll();
      return;
    }

    var known = {};
    r.docs.forEach(function (d) { known[d.name + '|' + d.size] = true; });
    var fresh = files.filter(function (f) { return !known[f.name + '|' + f.size]; });
    var skipped = files.filter(function (f) { return known[f.name + '|' + f.size]; });

    userSays(r, text, files.map(function (f) { return f.name; }));
    if (text) log('message', { text: text });
    if (skipped.length) {
      say(r, skipped.map(function (f) { return f.name; }).join(', ') + (skipped.length === 1 ? ' is' : ' are') + ' already in this return, so I skipped ' + (skipped.length === 1 ? 'it.' : 'them.'));
    }
    if (fresh.length) {
      log('documents.uploaded', { files: fresh.map(function (f) { return { name: f.name, bytes: f.size, type: f.type || 'unknown' }; }) });
      processFiles(r, fresh);
    } else if (text && !skipped.length) {
      say(r, pendingQuestion(r) ? 'Please use the question card above to answer. Nothing you typed was sent to an AI model.'
        : 'Questions about the return are answered in a later milestone. Nothing you typed was sent to an AI model.');
    }
    state.pending = [];
    input.value = '';
    autoGrow(input);
    renderAll();
    input.focus();
  }

  /* ---------- IRS excerpts: the only text the app may cite ---------- */

  TRP.knowledge = { byId: {}, loaded: false };

  function loadKnowledge() {
    return fetch('knowledge/irs_excerpts.json').then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      data.excerpts.forEach(function (e) { TRP.knowledge.byId[e.id] = e; });
      TRP.knowledge.loaded = true;
      // Every source id used in code must exist in the excerpts file.
      var missing = [];
      Object.keys(TRP.extract.FORMS).forEach(function (formId) {
        TRP.extract.FORMS[formId].fields.forEach(function (f) {
          if (f.source && !TRP.knowledge.byId[f.source]) missing.push(f.id + ' -> ' + f.source);
        });
      });
      log('knowledge.check', { excerpts: data.excerpts.length, missing: missing, result: missing.length ? 'fail' : 'pass' });
    }).catch(function (err) {
      log('knowledge.check', { result: 'fail', reason: 'Could not load the IRS excerpts: ' + err.message });
    });
  }

  /** The excerpt behind a field, or null. A source id that is not in the file is never shown. */
  function citation(fieldId) {
    var f = TRP.extract.field(fieldId);
    return f && f.source ? TRP.knowledge.byId[f.source] || null : null;
  }

  /* ---------- Documents, items and confidence ---------- */

  function findItem(r, id) { return r.items.filter(function (i) { return i.id === id; })[0] || null; }
  function findDoc(r, id) { return r.docs.filter(function (d) { return d.id === id; })[0] || null; }

  function badge(level) {
    var c = CONFIDENCE.filter(function (x) { return x.id === level; })[0];
    return el('span', { class: 'badge badge-' + level }, el('span', { 'aria-hidden': 'true' }, c.symbol), ' ' + c.label);
  }

  function itemLabel(item) {
    var f = TRP.extract.field(item.fieldId);
    return (f.box ? 'Box ' + f.box + ' · ' : '') + f.label;
  }
  function itemAmount(item) { return TRP.extract.show(TRP.extract.field(item.fieldId), item.value); }

  function recount(r) {
    r.counts = { high: 0, medium: 0, low: 0 };
    r.items.forEach(function (i) { r.counts[i.confidence]++; });
    // Profile answers given directly are High. Not-sure answers and failed cross-checks are Low.
    Object.keys(r.answers).forEach(function (k) { if (r.answers[k].confidence === 'high') r.counts.high++; });
    var flags = TRP.profile.flags(ctxOf(r));
    r.counts.low += flags.filter(function (f) { return f.level === 'low'; }).length;
    r.escalated = escalations(r, null).length;
  }

  function addItems(r, doc, items) {
    return items.map(function (it) {
      it.id = 'i' + (++r.itemSeq);
      it.docId = doc.id;
      it.status = it.status || 'open';
      it.startedLow = it.confidence === 'low';
      r.items.push(it);
      log('item.read', {
        document: doc.name, item: itemLabel(it), value: itemAmount(it), confidence: it.confidence, reason: it.reason,
        parser: it.parser ? it.parser.value : null, ai: it.ai ? it.ai.value : null, escalate: it.escalate || undefined
      }, r);
      return it.id;
    });
  }

  async function processFiles(r, files) {
    r.busy = true;
    var status = { type: 'status', text: 'Reading documents…' };
    var statusMsg = { id: 'm' + (++state.msgSeq), role: 'assistant', blocks: [status] };
    r.messages.push(statusMsg);
    var useAi = TRP.ai.getStatus().connected;
    var docs = [], itemIds = [];

    // Read up to three files at once. Results are added in upload order once all are back.
    var results = new Array(files.length), done = 0, next = 0, started = Date.now();
    var logStart = r.log.length;
    function showProgress() {
      var secs = Math.round((Date.now() - started) / 1000);
      status.text = 'Reading ' + plural(files.length, 'document') + (useAi ? ' with the AI' : '') + ': ' +
        done + ' of ' + files.length + ' done' + (secs >= 3 ? ' (' + secs + ' s)' : '') + '…';
      var node = $('#messages .status-line');
      if (node) node.textContent = status.text; else renderAll();
    }
    var ticker = setInterval(showProgress, 1000);
    showProgress();
    renderAll();
    async function worker() {
      while (next < files.length) {
        var i = next++, file = files[i];
        try { results[i] = await TRP.extract.processFile(file, { useAi: useAi }); }
        catch (err) {
          results[i] = { status: 'manual', reason: 'Something went wrong while reading this file', forms: [], typeLabel: 'Not read', pages: [], pdf: null, items: [],
            events: [{ type: 'document.error', detail: { file: file.name, error: String(err && err.message || err) } }] };
        }
        done++;
        showProgress();
      }
    }
    var pool = [];
    for (var w = 0; w < Math.min(3, files.length); w++) pool.push(worker());
    await Promise.all(pool);
    clearInterval(ticker);

    files.forEach(function (file, i) {
      var res = results[i];
      var doc = {
        id: 'd' + (++r.docSeq), name: file.name, size: file.size, file: file, status: res.status, reason: res.reason,
        typeLabel: res.typeLabel, forms: res.forms, pdf: res.pdf, pages: res.pages
      };
      r.docs.push(doc);
      r.files.push(file);
      docs.push(doc);
      res.events.forEach(function (e) { log(e.type, e.detail, r); });
      itemIds = itemIds.concat(addItems(r, doc, res.items));
      log('document.result', { file: doc.name, status: doc.status, type: doc.typeLabel, reason: doc.reason || undefined, items: res.items.length }, r);
    });

    r.messages.splice(r.messages.indexOf(statusMsg), 1);
    var blocks = resultBlocks(r, docs, itemIds, useAi);
    blocks.push({ type: 'p', text: timingNote(r, logStart, started, useAi), small: true });
    say(r, blocks);
    invalidate(r);
    if (r.items.length) startProfile(r);
    askNext(r);                         // new documents can answer, or change, a pending question
    r.busy = false;
    if (r.items.length && r.step === 'documents') r.step = 'profile';
    r.dirty = true;
    recount(r);
    renderAll();
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  /** One line on where the time went, so slow reads can be diagnosed from the screen. */
  function timingNote(r, logStart, started, useAi) {
    var total = Math.round((Date.now() - started) / 100) / 10;
    var calls = r.log.slice(logStart).filter(function (e) { return e.type === 'ai.call'; });
    if (!useAi || !calls.length) return 'Read in ' + total + ' s' + (useAi ? '. No AI calls were made.' : ' without AI.');
    var secs = calls.map(function (e) { return e.detail.seconds || 0; });
    var failed = calls.filter(function (e) { return e.detail.result === 'fail'; });
    var reasons = {};
    failed.forEach(function (e) { reasons[e.detail.reason] = true; });
    var models = [];
    calls.forEach(function (e) { var m = String(e.detail.model).replace(/^models\//, ''); if (models.indexOf(m) === -1) models.push(m); });
    return 'Read in ' + total + ' s. AI: ' + models.join(', then ') + ', ' +
      plural(calls.length, 'call') + ', slowest ' + Math.round(Math.max.apply(null, secs) * 10) / 10 + ' s' +
      (failed.length ? '; ' + failed.length + ' failed (' + Object.keys(reasons).join('; ') + ')' : '') + '.';
  }

  function resultBlocks(r, docs, itemIds, useAi) {
    var read = docs.filter(function (d) { return d.status === 'read'; });
    var manual = docs.filter(function (d) { return d.status === 'manual'; });
    var held = docs.filter(function (d) { return d.status === 'held'; });
    var blocks = [];

    if (read.length) {
      blocks.push({ type: 'p', text: 'I read ' + plural(read.length, 'document') + ' and found ' + plural(itemIds.length, 'amount') +
        '. Each one shows where it came from and how sure I am. Select a row to see the source page.' });
      blocks.push({ type: 'table', itemIds: itemIds });
      if (!useAi) blocks.push({ type: 'p', text: 'No AI key is connected, so each value was read once, by the text parser. That is Medium at best. Confirm a value to raise it to High.' });
    }

    var escalated = itemIds.map(function (id) { return findItem(r, id); }).filter(function (it) { return it.escalate && it.value; });
    if (escalated.length) {
      blocks.push({ type: 'p', text: 'These are outside what this tool computes. They will go to the reviewer instead of onto the return:' });
      blocks.push({ type: 'ul', items: escalated.map(function (it) {
        return TRP.extract.FORMS[it.formId].short + ', ' + itemLabel(it) + ' (' + itemAmount(it) + '): ' + it.escalate + '.';
      }) });
    }

    held.forEach(function (d) {
      blocks.push({ type: 'p', text: d.name + ' looks like a ' + d.typeLabel + '. ' + d.reason + '.' });
    });

    if (manual.length) {
      blocks.push({ type: 'p', text: "I couldn't read " + (manual.length === 1 ? 'this one' : 'these') + '. You can enter the values by hand:' });
      blocks.push({ type: 'ul', items: manual.map(function (d) { return d.name + ': ' + d.reason + '.'; }) });
      blocks.push({ type: 'actions', actions: manual.map(function (d) {
        return { label: 'Enter values for ' + d.name, run: function () { openManual(d.id); } };
      }) });
    }

    return blocks;
  }

  function renderTable(r, itemIds) {
    var body = el('tbody', {});
    itemIds.forEach(function (id) {
      var item = findItem(r, id);
      if (!item) return;
      var doc = findDoc(r, item.docId);
      var open = function () { openSource(item.id); };
      body.appendChild(el('tr', { class: 'item-row', onclick: open },
        el('td', { title: doc ? doc.name : '' }, TRP.extract.FORMS[item.formId].short),
        el('td', {},
          el('button', { type: 'button', class: 'link-btn', onclick: function (e) { e.stopPropagation(); open(); } }, itemLabel(item)),
          item.escalate && item.value ? el('span', { class: 'flag' }, 'Escalate') : null),
        el('td', { class: 'num' }, itemAmount(item)),
        el('td', {}, badge(item.confidence), ' ', el('span', { class: 'reason' }, item.reason))));
    });
    return el('div', { class: 'table-wrap' },
      el('table', { class: 'items-table' },
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col' }, 'Document'), el('th', { scope: 'col' }, 'Item'),
          el('th', { scope: 'col', class: 'num' }, 'Value'), el('th', { scope: 'col' }, 'Confidence'))),
        body));
  }

  /* ---------- Review gate ---------- */

  var FEEDS = {
    int_1: 'Form 1041, line 1', int_3: 'Form 1041, line 1', int_8: 'Schedule B, line 2', div_12: 'Schedule B, line 2',
    div_1a: 'Form 1041, line 2a', div_1b: 'Form 1041, line 2b', div_2a: 'Schedule D, line 13',
    b_1d: 'Schedule D, Parts I and II', b_1e: 'Schedule D, Parts I and II', b_term: 'Schedule D, Parts I and II',
    sum_fees: 'Form 1041, line 12', sum_prof: 'Form 1041, line 14',
    sum_income_dist: 'Schedule B, line 10', sum_principal_dist: 'Schedule B, line 10',
    prior_stcl: 'Schedule D, line 6', prior_ltcl: 'Schedule D, line 15'
  };
  function feeds(item) {
    var f = TRP.extract.field(item.fieldId);
    return FEEDS[item.fieldId] || (f.use === 'escalate' ? 'Not used in the calculation' : f.use === 'prior' ? 'Prior-year check' : 'Supporting detail');
  }

  /**
   * Everything that decides whether the return can be generated.
   * Low entries are document values that started Low and profile flags at Low. Each must be
   * confirmed, corrected or escalated. Escalating does not make an undecided fact decided:
   * the engine must also be able to compute, or Generate stays locked.
   */
  function gate(r) {
    var ctx = ctxOf(r), entries = [];
    r.items.forEach(function (it) {
      if (it.startedLow) entries.push({ kind: 'item', item: it, resolved: it.status !== 'open' });
    });
    TRP.profile.flags(ctx).forEach(function (f) {
      if (f.level === 'low') entries.push({ kind: 'flag', flag: f, state: r.flagState[f.id] || '', resolved: !!r.flagState[f.id] });
    });
    var done = entries.filter(function (e) { return e.resolved; }).length;
    var stop = TRP.profile.stop(ctx);
    var engine = r.profileDone && !stop ? TRP.engine.compute(TRP.engine.inputFrom(r.items, ctx.a, ctx.facts)) : null;
    var why = stop ? 'this return is outside the tool\'s scope'
      : !r.items.length ? 'add the documents first'
      : !r.profileDone ? 'finish the trust questions first'
      : done < entries.length ? 'resolve ' + plural(entries.length - done, 'item') + ' first'
      : !engine.ok ? 'it cannot be calculated yet' : '';
    return { entries: entries, done: done, total: entries.length, engine: engine, canGenerate: !why, why: why };
  }
  TRP.gate = function () { var r = active(); return r ? gate(r) : null; };

  /** Any change to an input makes an earlier result stale. */
  function invalidate(r) {
    if (r.result) { r.result = null; log('return.stale', { reason: 'An input changed after the return was generated' }, r); }
    if (r.step === 'generate') r.step = 'review';
  }

  function escalateItem(r, item) {
    item.status = 'escalated';
    log('item.escalated', { document: findDoc(r, item.docId).name, item: itemLabel(item), value: itemAmount(item), reason: item.reason }, r);
    invalidate(r); recount(r); renderAll();
  }

  function setFlag(r, flag, value) {
    r.flagState[flag.id] = value;
    log(value === 'escalated' ? 'flag.escalated' : 'flag.confirmed', { flag: flag.id, text: flag.text }, r);
    invalidate(r); recount(r); renderAll();
  }

  function findAnswered(r, pid) {
    for (var i = r.messages.length - 1; i >= 0; i--) {
      var blocks = r.messages[i].blocks || [];
      for (var j = 0; j < blocks.length; j++) {
        var q = blocks[j].q;
        if (blocks[j].type === 'question' && q.pid === pid && q.answer != null && !q.superseded) return q;
      }
    }
    return null;
  }

  function reviewButton(label, run, primary, disabled) {
    return el('button', { type: 'button', class: 'btn ' + (primary ? 'btn-primary' : 'btn-outline'), disabled: disabled, onclick: run }, label);
  }

  function itemCard(r, item, level) {
    var doc = findDoc(r, item.docId), open = item.status === 'open';
    var state = item.status === 'escalated' ? 'Escalated to reviewer' : item.status === 'confirmed' ? 'Confirmed by you' : item.status === 'edited' ? 'Corrected by you' : '';
    return el('div', { class: 'review-card' + (level === 'medium' ? ' is-medium' : '') + (item.status === 'escalated' ? ' is-escalated' : !open ? ' is-resolved' : '') },
      el('div', { class: 'review-head' },
        el('span', { class: 'review-title' }, TRP.extract.FORMS[item.formId].short + ' · ' + itemLabel(item)),
        el('span', { class: 'review-amount' }, itemAmount(item))),
      el('span', { class: 'review-line' }, feeds(item) + ' · ' + (doc ? doc.name : '')),
      el('p', {}, badge(item.confidence), ' ', el('span', { class: 'reason' }, item.reason)),
      state ? el('span', { class: 'review-state' + (item.status === 'escalated' ? ' esc' : '') }, state) : null,
      el('div', { class: 'btn-row' },
        open && item.value !== null ? reviewButton('Confirm', function () { confirmItem(r, item); }, true) : null,
        reviewButton(item.value === null ? 'Enter value' : 'Edit', function () { state_openEdit(item.id); }),
        reviewButton('View source', function () { openSource(item.id); }),
        open && level === 'low' ? reviewButton('Escalate', function () { escalateItem(r, item); }) : null));
  }

  function state_openEdit(itemId) {
    state.panel = { mode: 'source', itemId: itemId, editing: true };
    renderPanel();
  }

  function flagCard(r, entry) {
    var f = entry.flag;
    var change = f.pid && findAnswered(r, f.pid);
    return el('div', { class: 'review-card' + (entry.state === 'escalated' ? ' is-escalated' : entry.resolved ? ' is-resolved' : '') },
      el('div', { class: 'review-head' }, el('span', { class: 'review-title' }, f.text)),
      el('span', { class: 'review-line' }, 'Trust profile'),
      el('p', {}, badge('low'), ' ', el('span', { class: 'reason' }, f.confirmable ? 'Your answer disagrees with another source' : 'This rests on an answer that is not decided')),
      entry.state ? el('span', { class: 'review-state' + (entry.state === 'escalated' ? ' esc' : '') }, entry.state === 'escalated' ? 'Escalated to reviewer' : 'Checked and kept by you') : null,
      el('div', { class: 'btn-row' },
        !entry.resolved && f.confirmable ? reviewButton("I've checked. Keep my answer", function () { setFlag(r, f, 'confirmed'); }, true) : null,
        change ? reviewButton('Change answer', function () { setView('chat'); changeAnswer(r, change); }) : null,
        !entry.resolved ? reviewButton('Escalate', function () { setFlag(r, f, 'escalated'); }) : null));
  }

  /** Items that go to the reviewer instead of onto the return. */
  function escalations(r, g) {
    var list = [];
    r.items.forEach(function (it) {
      if (it.escalate && it.value) list.push(TRP.extract.FORMS[it.formId].short + ', ' + itemLabel(it) + ' (' + itemAmount(it) + '): ' + it.escalate);
      else if (it.status === 'escalated') list.push(TRP.extract.FORMS[it.formId].short + ', ' + itemLabel(it) + ' (' + itemAmount(it) + '): escalated by the preparer. ' + it.reason);
    });
    TRP.profile.flags(ctxOf(r)).forEach(function (f) {
      if (f.level === 'escalate') list.push(f.text);
      else if (r.flagState[f.id] === 'escalated') list.push(f.text + ' (escalated by the preparer)');
    });
    var result = r.result || (g && g.engine);
    if (result && result.ok) result.notes.forEach(function (n) { list.push(n.text); });
    return list;
  }

  function renderGate() {
    var r = active();
    if (!r) return;
    var g = gate(r);
    $('#gate-label').textContent = g.done + ' of ' + g.total + ' low-confidence items resolved';
    $('#gate-fill').style.width = (g.total ? Math.round(100 * g.done / g.total) : 0) + '%';
    var bar = $('#view-review .progress-bar');
    bar.setAttribute('aria-valuemax', String(g.total));
    bar.setAttribute('aria-valuenow', String(g.done));

    var low = $('#low-list'), med = $('#medium-list'), esc = $('#escalated-list'), blockers = $('#gate-blockers');
    low.textContent = ''; med.textContent = ''; esc.textContent = ''; blockers.textContent = '';
    g.entries.forEach(function (e) { low.appendChild(e.kind === 'item' ? itemCard(r, e.item, 'low') : flagCard(r, e)); });
    r.items.forEach(function (it) { if (it.confidence === 'medium' && it.status === 'open') med.appendChild(itemCard(r, it, 'medium')); });
    escalations(r, g).forEach(function (text) {
      esc.appendChild(el('div', { class: 'review-card is-escalated' }, el('span', {}, text + '.')));
    });
    if (g.engine && !g.engine.ok) {
      var ul = el('ul', {});
      g.engine.unsupported.forEach(function (u) { ul.appendChild(el('li', {}, u + '.')); });
      blockers.appendChild(el('div', { class: 'blockers', role: 'status' },
        el('strong', {}, 'The return cannot be calculated yet. Escalating these does not unlock it; they must be decided:'), ul));
    }
    var btn = $('#generate-btn');
    btn.disabled = !g.canGenerate;
    btn.textContent = g.canGenerate ? 'Generate Form 1041' : 'Generate Form 1041 · ' + g.why;
  }

  /* ---------- Calculation and the result screen ---------- */

  var RANK = { high: 3, medium: 2, low: 1 };
  var LINE_INPUTS = {
    '1': ['int_1', 'int_3'], '2a': ['div_1a'], '2b': ['div_1b', 'div_1a'],
    '4': ['b_1d', 'b_1e', 'b_term', 'div_2a', 'prior_stcl', 'prior_ltcl'],
    '12': ['sum_fees', 'int_8', 'div_12'], '14': ['sum_prof', 'int_8', 'div_12'],
    dist: ['sum_income_dist', 'sum_principal_dist', 'int_8', 'div_12']
  };

  /** A line's confidence is the lowest confidence among its inputs. */
  function lineConfidence(r, keys, withProfile) {
    var worst = { level: 'high', why: 'Every input is High' };
    function consider(level, why) { if (RANK[level] < RANK[worst.level]) worst = { level: level, why: why }; }
    r.items.forEach(function (it) {
      if (it.value === null) return;
      if (keys.some(function (k) { return LINE_INPUTS[k].indexOf(it.fieldId) !== -1; })) {
        consider(it.confidence, 'Lowest input: ' + TRP.extract.FORMS[it.formId].short + ' ' + itemLabel(it) + ' (' + it.reason + ')');
      }
    });
    if (withProfile) {
      TRP.profile.flags(ctxOf(r)).forEach(function (f) {
        if (f.level === 'low' && r.flagState[f.id] !== 'confirmed') consider('low', 'Rests on an escalated profile item: ' + f.text);
      });
    }
    return worst;
  }

  function generate(r) {
    var g = gate(r);
    if (!g.canGenerate) return;
    r.result = g.engine;
    r.step = 'generate';
    var F = r.result.form;
    log('return.generated', {
      classification: ctxOf(r).a.classification, taxMethod: r.result.taxMethod,
      lines: { totalIncome: F['9'], adjustedTotalIncome: F['17'], dni: r.result.schB['7'], distributionDeduction: F['18'], exemption: F['21'], taxableIncome: F['23'], totalTax: F['24'] },
      assumptions: r.result.assumptions, escalated: escalations(r, g), checks: r.result.checks
    }, r);
    say(r, [{ type: 'p', text: 'The return is calculated: taxable income ' + TRP.extract.formatMoney(F['23']) + ', total tax ' + TRP.extract.formatMoney(F['24']) + '. It is a draft for professional review.' },
      { type: 'actions', actions: [{ label: 'Open the result', run: function () { setView('complete'); } }] }]);
    setView('complete');
    renderAll();
  }

  function renderComplete() {
    var r = active(), box = $('#complete-result');
    if (!r) return;
    box.textContent = '';
    var res = r.result;
    if (!res) {
      box.appendChild(el('p', { class: 'muted' }, 'The key lines appear here once the return is generated from the review screen.'));
      box.appendChild(el('div', { class: 'btn-row' }, reviewButton('Go to the review screen', function () { setView('review'); }, true)));
      return;
    }
    var esc = escalations(r, null), F = res.form, B = res.schB, money = TRP.extract.formatMoney;
    if (esc.length) box.appendChild(el('p', {}, el('span', { class: 'esc-label' }, 'Contains ' + plural(esc.length, 'escalated item') + ' for the reviewer')));

    var rows = [
      ['Form 1041, line 1', 'Interest income', F['1'], ['1'], false, '1'],
      ['Form 1041, line 2a', 'Total ordinary dividends', F['2a'], ['2a'], false, '2a'],
      ['Form 1041, line 2b(1)', 'Qualified dividends, beneficiaries', F['2b1'], ['2b', 'dist'], true, '2b(1)'],
      ['Form 1041, line 2b(2)', 'Qualified dividends, trust', F['2b2'], ['2b', 'dist'], true, '2b(2)'],
      ['Form 1041, line 4', 'Capital gain or (loss)', F['4'], ['4'], false, '4'],
      ['Form 1041, line 9', 'Total income', F['9'], ['1', '2a', '4'], false, '9'],
      ['Form 1041, line 12', 'Fiduciary fees', F['12'], ['12'], false, '12'],
      ['Form 1041, line 14', 'Attorney, accountant and preparer fees', F['14'], ['14'], false, '14'],
      ['Form 1041, line 17', 'Adjusted total income', F['17'], ['1', '2a', '4', '12', '14'], false, '17'],
      ['Schedule B, line 7', 'Distributable net income', B['7'], ['1', '2a', '4', '12', '14'], true, '7'],
      ['Form 1041, line 18', 'Income distribution deduction', F['18'], ['1', '2a', '4', '12', '14', 'dist'], true, '15'],
      ['Form 1041, line 21', 'Exemption', F['21'], [], true, '21'],
      ['Form 1041, line 23', 'Taxable income', F['23'], ['1', '2a', '4', '12', '14', 'dist'], true, '23'],
      ['Form 1041, line 24', 'Total tax', F['24'], ['1', '2a', '2b', '4', '12', '14', 'dist'], true, '24']
    ].filter(function (row) { return row[2] !== 0 || /line (9|17|18|21|23|24|7)$/.test(row[0]); });

    var body = el('tbody', {});
    rows.forEach(function (row) {
      var conf = lineConfidence(r, row[3], row[4]);
      var step = res.trace.filter(function (s) { return s.line === row[5] && row[0].indexOf(s.form) === 0; })[0];
      var cite = step && TRP.knowledge.byId[step.source];
      body.appendChild(el('tr', {},
        el('td', {}, row[0], el('br', {}), el('span', { class: 'reason' }, row[1])),
        el('td', { class: 'num' }, money(row[2])),
        el('td', {}, badge(conf.level), ' ', el('span', { class: 'reason' }, conf.why)),
        el('td', { class: 'basis' }, step ? step.how : '', cite ? el('span', {}, el('br', {}), 'Source: ' + cite.source + ' · ' + cite.section) : null)));
    });
    box.appendChild(el('h3', {}, 'Key lines'));
    box.appendChild(el('p', { class: 'fine' }, 'Tax method: ' + res.taxMethod + '. Every figure was computed by rule-based code, not by the AI.'));
    box.appendChild(el('div', { class: 'table-wrap' }, el('table', { class: 'items-table' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Line'), el('th', { scope: 'col', class: 'num' }, 'Amount'), el('th', { scope: 'col' }, 'Confidence'), el('th', { scope: 'col' }, 'Basis'))), body)));

    box.appendChild(el('h3', {}, 'Schedule K-1 amounts'));
    var kBody = el('tbody', {}), kConf = lineConfidence(r, ['1', '2a', '2b', '4', '12', '14', 'dist'], true);
    res.k1.forEach(function (k) {
      kBody.appendChild(el('tr', {},
        el('td', {}, k.name, el('br', {}), el('span', { class: 'reason' }, Math.round(k.share * 10000) / 100 + '% share')),
        el('td', { class: 'num' }, money(k['1'])), el('td', { class: 'num' }, money(k['2a'])), el('td', { class: 'num' }, money(k['2b'])),
        el('td', { class: 'num' }, money(k['3'] + k['4a'])), el('td', { class: 'num' }, money(k['14A']))));
    });
    box.appendChild(el('div', { class: 'table-wrap' }, el('table', { class: 'items-table' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Beneficiary'), el('th', { scope: 'col', class: 'num' }, 'Box 1 interest'), el('th', { scope: 'col', class: 'num' }, 'Box 2a dividends'),
        el('th', { scope: 'col', class: 'num' }, 'Box 2b qualified'), el('th', { scope: 'col', class: 'num' }, 'Boxes 3 and 4a gains'), el('th', { scope: 'col', class: 'num' }, 'Box 14A tax-exempt'))), kBody)));
    box.appendChild(el('p', {}, badge(kConf.level), ' ', el('span', { class: 'reason' }, kConf.why)));

    function listSection(title, items) {
      if (!items.length) return;
      box.appendChild(el('h3', {}, title));
      var ul = el('ul', {});
      items.forEach(function (text) { ul.appendChild(el('li', {}, /[.?]$/.test(text) ? text : text + '.')); });
      box.appendChild(ul);
    }
    listSection('Method choices the reviewer should check', res.assumptions);
    listSection('Escalated to the reviewer', esc);
    box.appendChild(el('p', { class: 'fine' }, 'The filled IRS forms, the review log export and the reviewer sign-off are built in the next milestone.'));
  }

  /* ---------- Confirm and edit ---------- */

  function confirmItem(r, item) {
    if (item.value === null) return;
    log('item.confirmed', { document: findDoc(r, item.docId).name, item: itemLabel(item), value: itemAmount(item), was: item.confidence + ': ' + item.reason }, r);
    item.status = 'confirmed';
    item.confidence = 'high';
    item.reason = 'Confirmed by you';
    invalidate(r);
    recount(r);
    askNext(r);
    renderAll();
  }

  function editItem(r, item, value) {
    var before = itemAmount(item);
    item.value = value;
    item.status = 'edited';
    item.confidence = 'high';
    item.reason = 'Entered by you';
    log('item.override', { document: findDoc(r, item.docId).name, item: itemLabel(item), from: before, to: itemAmount(item) }, r);
    invalidate(r);
    recount(r);
    if (state.panel) state.panel.editing = false;
    askNext(r);
    recount(r);
    renderAll();
  }

  /** Reads a typed amount. Returns a number, or null if it is not a plain amount. */
  function readAmount(text) {
    var t = String(text).trim();
    if (!/^-?\$?\s?\d[\d,]*(\.\d{1,2})?$/.test(t)) return null;
    return parseFloat(t.replace(/[$,\s]/g, ''));
  }

  /* ---------- Source side panel ---------- */

  function openSource(itemId) {
    state.panel = { mode: 'source', itemId: itemId, editing: false };
    renderPanel();
    $('#source-close').focus();
  }

  function openManual(docId) {
    var r = active();
    if (!r || r.blocked) return;
    if (!r.acked) { say(r, 'Please answer the question above first. This tool is for synthetic data only.'); renderAll(); return; }
    state.panel = { mode: 'manual', docId: docId, formId: '1099-INT', error: '' };
    renderPanel();
    $('#source-close').focus();
  }

  function closePanel() { state.panel = null; renderPanel(); }

  var panelToken = 0;

  function renderPanel() {
    var r = active();
    var open = !!(state.panel && r && (state.view === 'chat' || state.view === 'review'));
    $('#source-panel').hidden = !open;
    $('#progress').hidden = state.view !== 'chat' || open;
    if (!open) return;
    var body = $('#source-body');
    body.textContent = '';
    panelToken++;
    if (state.panel.mode === 'manual') renderManual(r, body);
    else renderSource(r, body);
  }

  function renderSource(r, body) {
    var item = findItem(r, state.panel.itemId);
    if (!item) { closePanel(); return; }
    var doc = findDoc(r, item.docId);
    var f = TRP.extract.field(item.fieldId);
    var pageNum = item.parser ? item.parser.page : item.ai ? item.ai.page : 1;
    $('#source-title').textContent = doc.name;

    var reads = el('dl', { class: 'reads' });
    if (item.manual) {
      reads.appendChild(el('dt', {}, 'Entered by hand'));
      reads.appendChild(el('dd', {}, 'No document read'));
    } else {
      reads.appendChild(el('dt', {}, 'Text parser'));
      reads.appendChild(el('dd', {}, item.parser ? TRP.extract.show(f, item.parser.value) + ' on page ' + item.parser.page : 'Not found'));
      reads.appendChild(el('dt', {}, 'AI'));
      reads.appendChild(el('dd', {}, item.ai
        ? TRP.extract.show(f, item.ai.value) + ', quoting “' + item.ai.quote + '” (' + (item.ai.quoteOk ? 'found on page ' + item.ai.page : item.ai.quoteProblem) + ')'
        : 'No AI read'));
    }

    var cite = citation(item.fieldId);
    var info = el('div', { class: 'source-item' },
      el('p', { class: 'source-kicker' }, TRP.extract.FORMS[item.formId].title + (doc.pdf ? ' · page ' + pageNum : '')),
      el('h3', {}, itemLabel(item)),
      el('p', { class: 'source-amount' }, itemAmount(item)),
      el('p', {}, badge(item.confidence), ' ', el('span', { class: 'reason' }, item.reason)),
      reads,
      item.escalate && item.value ? el('p', { class: 'escalate-note' }, 'Escalate to reviewer: ' + item.escalate + '.') : null,
      cite
        ? el('blockquote', { class: 'excerpt' }, cite.text, el('cite', {}, cite.source + ' · ' + cite.section))
        : el('p', { class: 'fine' }, f.form === 'SUMMARY' ? "Source: the trustee's own summary. It is not an IRS document." : 'No IRS excerpt is bundled for this box.'));
    body.appendChild(info);

    // Confirm / Edit
    if (state.panel.editing) {
      var input, error = el('p', { class: 'form-error', role: 'alert' });
      if (f.kind === 'term') {
        input = el('select', { class: 'input', id: 'edit-value' },
          el('option', { value: 'long', selected: item.value === 'long' }, 'Long-term'),
          el('option', { value: 'short', selected: item.value === 'short' }, 'Short-term'));
      } else if (f.kind === 'choice') {
        input = el('select', { class: 'input', id: 'edit-value' });
        Object.keys(f.choices).forEach(function (k) { input.appendChild(el('option', { value: k, selected: item.value === k }, f.choices[k])); });
      } else if (f.kind === 'tin') {
        input = el('input', { class: 'input', id: 'edit-value', type: 'password', inputmode: 'numeric', maxlength: '11', autocomplete: 'off', placeholder: '00-0000000' });
      } else if (f.kind === 'text' || f.kind === 'list') {
        input = el('input', { class: 'input', id: 'edit-value', type: 'text', autocomplete: 'off',
          value: item.value === null ? '' : f.kind === 'list' ? item.value.join(', ') : String(item.value) });
      } else {
        input = el('input', { class: 'input', id: 'edit-value', type: 'text', inputmode: 'decimal', autocomplete: 'off',
          value: item.value === null ? '' : String(item.value) });
      }
      var form = el('form', { class: 'edit-form', novalidate: true },
        el('label', { class: 'field-label', for: 'edit-value' }, f.kind === 'term' ? 'Holding period' : f.kind === 'amount' ? 'Correct amount'
          : f.kind === 'list' ? 'Correct names, separated by commas' : f.kind === 'tin' ? 'Correct number (nine digits)' : 'Correct value'),
        input, error,
        el('div', { class: 'btn-row' },
          el('button', { type: 'submit', class: 'btn btn-primary' }, 'Save'),
          el('button', { type: 'button', class: 'btn btn-outline', onclick: function () { state.panel.editing = false; renderPanel(); } }, 'Cancel')));
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var value = f.kind === 'term' || f.kind === 'choice' ? input.value
          : f.kind === 'tin' ? nineDigits(input.value)
          : f.kind === 'text' ? (input.value.trim() && !TRP.ai.findTins(input.value).length ? input.value.trim() : null)
          : f.kind === 'list' ? (input.value.trim() ? input.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean) : null)
          : readAmount(input.value);
        if (value === null) {
          error.textContent = f.kind === 'amount' ? 'Enter an amount such as 1,200.00.' : f.kind === 'tin' ? 'Enter nine digits.' : 'Enter a value, without any SSN or EIN.';
          input.focus(); return;
        }
        editItem(r, item, value);
      });
      body.appendChild(form);
      input.focus();
    } else {
      body.appendChild(el('div', { class: 'btn-row' },
        el('button', { type: 'button', class: 'btn btn-primary', disabled: item.value === null || item.status !== 'open',
          onclick: function () { confirmItem(r, item); } },
          item.status === 'open' ? (item.value === null ? 'Nothing to confirm' : 'Confirm ' + itemAmount(item)) : 'Confirmed'),
        el('button', { type: 'button', class: 'btn btn-outline', onclick: function () { state.panel.editing = true; renderPanel(); } },
          item.value === null ? 'Enter value' : 'Edit')));
    }

    var rect = item.parser ? item.parser.rect : null;
    var note = !doc.pdf ? (item.manual ? '' : 'There is no page to show for this document.')
      : rect ? '' : 'No highlight is available for this value, because it was not located in the text layer.';
    if (note) body.appendChild(el('p', { class: 'fine' }, note));
    if (doc.pdf) drawPage(doc, pageNum, rect, body);
  }

  function drawPage(doc, pageNum, rect, body) {
    var box = el('div', { class: 'page-view', tabindex: '0', role: 'group', 'aria-label': 'Source page. Scroll to see the rest of the page.' }, el('p', { class: 'fine' }, 'Loading page…'));
    body.appendChild(box);
    var token = panelToken;
    doc.pdf.getPage(pageNum).then(function (page) {
      var cssWidth = Math.max(260, box.clientWidth);
      // Never smaller than about 115%, so the print stays readable; the box scrolls instead.
      var view = page.getViewport({ scale: Math.max(cssWidth / page.getViewport({ scale: 1 }).width, 1.15) });
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var canvas = el('canvas', { class: 'page-canvas', role: 'img', 'aria-label': 'Page ' + pageNum + ' of ' + doc.name });
      canvas.width = Math.floor(view.width * dpr);
      canvas.height = Math.floor(view.height * dpr);
      canvas.style.width = view.width + 'px';
      canvas.style.height = view.height + 'px';
      return page.render({
        canvas: canvas, canvasContext: canvas.getContext('2d'), viewport: view,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
      }).promise.then(function () {
        if (token !== panelToken) return;            // the panel moved on while this page was drawing
        // PDF points -> CSS pixels, using the viewport's own matrix (handles rotated pages too).
        var t = view.transform;
        var at = function (x, y) { return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]]; };
        var masked = maskTins(canvas, dpr, at, doc.pages[pageNum - 1]);
        box.textContent = '';
        box.appendChild(canvas);
        var hasText = doc.pages[pageNum - 1] && doc.pages[pageNum - 1].lines.length;
        var note = !hasText ? 'This page is an image, so SSNs and EINs on it cannot be found and masked. Use synthetic documents only.'
          : masked ? plural(masked, 'identifying number') + ' masked on this page. Only the last 4 digits are shown.' : '';
        if (note) box.parentNode.insertBefore(el('p', { class: hasText ? 'fine' : 'mask-warning' }, note), box);
        if (!rect) return;
        var p1 = at(rect.x - 3, rect.y - 3), p2 = at(rect.x + rect.w + 3, rect.y + rect.h + 1);
        var q = [p1[0], p1[1], p2[0], p2[1]];
        var mark = el('div', { class: 'highlight', 'aria-hidden': 'true' });
        mark.style.left = Math.min(q[0], q[2]) + 'px';
        mark.style.top = Math.min(q[1], q[3]) + 'px';
        mark.style.width = Math.abs(q[2] - q[0]) + 'px';
        mark.style.height = Math.abs(q[3] - q[1]) + 'px';
        box.appendChild(mark);
        box.scrollLeft = Math.min(q[0], q[2]) + Math.abs(q[2] - q[0]) / 2 - box.clientWidth / 2;
        box.scrollTop = Math.min(q[1], q[3]) + Math.abs(q[3] - q[1]) / 2 - box.clientHeight / 2;
      });
    }).catch(function (err) {
      console.warn('Page draw failed:', err);
      if (token === panelToken) { box.textContent = ''; box.appendChild(el('p', { class: 'fine' }, 'This page could not be drawn.')); }
    });
  }

  /**
   * Paints over every full SSN, ITIN or EIN found in the page's text layer, leaving the last
   * 4 digits, so the page shown on screen never displays a full identifying number.
   * Positions inside a text run are estimated from character counts.
   */
  function maskTins(canvas, dpr, at, page) {
    if (!page) return 0;
    var ctx = canvas.getContext('2d'), count = 0;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    page.lines.forEach(function (line) {
      line.items.forEach(function (it) {
        TRP.ai.findTins(it.str).forEach(function (hit) {
          var len = it.str.length || 1;
          var x0 = it.x + it.w * hit.index / len, x1 = it.x + it.w * (hit.index + hit.length) / len;
          var a = at(x0 - 1, line.y - 2), b = at(x1 + 1, line.y + it.h + 1);
          var left = Math.min(a[0], b[0]), top = Math.min(a[1], b[1]);
          var w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
          ctx.fillStyle = '#E3E3DF';
          ctx.fillRect(left, top, w, h);
          ctx.fillStyle = '#1A1A1A';
          ctx.font = Math.max(8, Math.round(h * 0.72)) + 'px Inter, system-ui, sans-serif';
          ctx.textBaseline = 'middle';
          ctx.fillText(TRP.ai.maskTin(hit.text, hit.kind), left + 2, top + h / 2, w - 4);
          count++;
        });
      });
    });
    ctx.restore();
    return count;
  }

  /* ---------- Manual entry (works with no AI and no readable document) ---------- */

  function renderManual(r, body) {
    var panel = state.panel;
    var doc = panel.docId ? findDoc(r, panel.docId) : null;
    var form = TRP.extract.FORMS[panel.formId];
    $('#source-title').textContent = doc ? doc.name : 'Add a document by hand';

    var typeSelect = el('select', { class: 'input', id: 'manual-type' });
    Object.keys(TRP.extract.FORMS).forEach(function (id) {
      if (TRP.extract.FORMS[id].noManual) return;
      typeSelect.appendChild(el('option', { value: id, selected: id === panel.formId }, TRP.extract.FORMS[id].title));
    });
    typeSelect.addEventListener('change', function () { panel.formId = typeSelect.value; panel.error = ''; renderPanel(); });

    var main = el('div', { class: 'manual-fields' });
    var other = el('div', { class: 'manual-fields' });
    var inputs = {};
    form.fields.forEach(function (f) {
      if (f.use === 'check') return;
      var id = 'manual-' + f.id, input;
      if (f.kind === 'term') {
        input = el('select', { class: 'input', id: id },
          el('option', { value: '' }, 'Choose…'), el('option', { value: 'long' }, 'Long-term'), el('option', { value: 'short' }, 'Short-term'));
      } else {
        input = el('input', { class: 'input', id: id, type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00' });
      }
      inputs[f.id] = input;
      (f.use === 'escalate' ? other : main).appendChild(
        el('div', {}, el('label', { class: 'field-label', for: id }, (f.box ? 'Box ' + f.box + ' · ' : '') + f.label), input));
    });

    var error = el('p', { class: 'form-error', role: 'alert' }, panel.error);
    var formEl = el('form', { class: 'manual-form', novalidate: true },
      el('p', { class: 'muted' }, doc ? doc.reason + '. Type the values from the document. Leave a box empty if it is blank.'
        : 'Type the values from the document. Leave a box empty if it is blank.'),
      el('label', { class: 'field-label', for: 'manual-type' }, 'Document type'), typeSelect,
      main,
      other.childNodes.length ? el('details', {}, el('summary', {}, 'Other boxes (sent to the reviewer if not zero)'), other) : null,
      error,
      el('div', { class: 'btn-row' },
        el('button', { type: 'submit', class: 'btn btn-primary' }, 'Save values'),
        el('button', { type: 'button', class: 'btn btn-outline', onclick: closePanel }, 'Cancel')));

    formEl.addEventListener('submit', function (e) {
      e.preventDefault();
      var values = {}, bad = null;
      form.fields.forEach(function (f) {
        var input = inputs[f.id];
        if (!input || bad || input.value.trim() === '') return;
        var v = f.kind === 'term' ? input.value : readAmount(input.value);
        if (v === null) bad = f; else values[f.id] = v;
      });
      if (bad) { error.textContent = 'Enter an amount such as 1,200.00 for ' + bad.label + '.'; inputs[bad.id].focus(); return; }
      var problems = TRP.extract._validate(panel.formId, values);
      if (problems.length) { error.textContent = 'Check failed: ' + problems[0].message + '. Correct the amounts and save again.'; return; }
      var kept = form.fields.filter(function (f) { return f.id in values && (values[f.id] !== 0 || f.keepZero); });
      if (!kept.length) { error.textContent = 'Enter at least one value.'; return; }

      if (!doc) {
        doc = { id: 'd' + (++r.docSeq), name: form.short + ' (entered by hand)', size: 0, file: null, pdf: null, pages: [], reason: '' };
        r.docs.push(doc);
      }
      doc.status = 'read'; doc.forms = [panel.formId]; doc.typeLabel = form.short;
      var ids = addItems(r, doc, kept.map(function (f) {
        return { fieldId: f.id, formId: panel.formId, value: values[f.id], parser: null, ai: null, manual: true,
          confidence: 'high', reason: 'Entered by you', status: 'edited', escalate: f.use === 'escalate' ? f.why : '' };
      }));
      log('document.manual', { document: doc.name, type: form.short, items: ids.length }, r);
      say(r, [
        { type: 'p', text: 'Added ' + plural(ids.length, 'value') + ' entered by hand from ' + doc.name + '.' },
        { type: 'table', itemIds: ids }
      ]);
      if (r.step === 'documents') r.step = 'profile';
      r.dirty = true;
      recount(r);
      state.panel = null;
      invalidate(r);
      startProfile(r);
      askNext(r);
      renderAll();
    });

    body.appendChild(formEl);
    if (doc && doc.pdf) drawPage(doc, 1, null, body);
  }

  /* ---------- Sample documents (synthetic) ---------- */

  var SAMPLE = ['1099-INT_HarborRidgeBank.pdf', '1099-DIV_NorthfieldFunds.pdf', '1099-B_CalderBrokerage.pdf', 'Trust_summary.pdf'];

  function loadSample() {
    var msg = $('#sample-msg');
    msg.textContent = 'Loading the sample documents…';
    Promise.all(SAMPLE.map(function (name) {
      return fetch('samples/case1/' + name).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      }).then(function (blob) { return new File([blob], name, { type: 'application/pdf' }); });
    })).then(function (files) {
      msg.textContent = '';
      newReturn();
      var r = active();
      var q = r.messages[0].blocks.filter(function (b) { return b.type === 'question'; })[0].q;
      answerQuestion(r, q, q.options[0]);            // the samples are synthetic by construction
      userSays(r, 'Here are the sample documents for the Maple Street Trust.', SAMPLE);
      log('documents.uploaded', { files: SAMPLE.map(function (n) { return { name: n, sample: true }; }) }, r);
      processFiles(r, files);
    }).catch(function () {
      msg.textContent = 'The sample documents could not be loaded. Open the app from its web address, not from a file on disk.';
    });
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
            state.panel = null;
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
          onclick: function () {
            setView(s.view); closeDrawers();
            if (s.id === 'profile' && r && !r.profileStarted) { startProfile(r); renderAll(); }
          }
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
    if (r && r.escalated) counts.appendChild(el('li', {}, el('span', { class: 'flag flag-count' }, 'For the reviewer'), el('span', { class: 'count-num' }, String(r.escalated))));
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
    $('#rename-btn').hidden = !inReturn || !!$('.rename-form');
    renderSidebar();
    renderPanel();
  }

  function renderAll() {
    var cur = active();
    if (cur && cur.profileStarted) { cur.status = profileStatus(cur); $('#topbar-status').textContent = cur.blocked ? 'Closed' : cur.status; }
    if (cur) $('#topbar-title').textContent = cur.name;
    renderSidebar();
    renderProgress();
    renderMessages();
    renderComposer();
    renderLogCount();
    renderGate();
    renderComplete();
    renderPanel();
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
    $('#rename-btn').addEventListener('click', startRename);
    $('#generate-btn').addEventListener('click', function () { var r = active(); if (r) generate(r); });
    $('#manual-btn').addEventListener('click', function () { closeDrawers(); openManual(null); });
    $('#source-close').addEventListener('click', closePanel);
    $('#sample-btn').addEventListener('click', loadSample);
    $('#new-return-btn').addEventListener('click', function () { closeDrawers(); newReturn(); });
    $('#settings-btn').addEventListener('click', function () { openSettings(false); });
    $('#key-status-btn').addEventListener('click', function () { openSettings(true); });
    $('#open-log-btn').addEventListener('click', function () { closeDrawers(); openLog(); });
    $('#open-sidebar-btn').addEventListener('click', function (e) { openDrawer('sidebar', e.currentTarget); });
    $('#open-progress-btn').addEventListener('click', function (e) { openDrawer('progress', e.currentTarget); });
    $('#close-progress-btn').addEventListener('click', closeDrawers);
    $('#backdrop').addEventListener('click', closeDrawers);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      if ($('#sidebar').classList.contains('is-open') || $('#progress').classList.contains('is-open')) closeDrawers();
      else if (state.panel) closePanel();
    });
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
    loadKnowledge();
    TRP.ai.restore();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
