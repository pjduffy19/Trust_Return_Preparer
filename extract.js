/* Document reading.
 *
 * Two independent reads of every digital PDF:
 *   1. a deterministic parser that finds each box label in the pdf.js text layer
 *      and takes the amount printed beside or beneath it;
 *   2. the AI (if a key is connected), which must return an exact quote and page.
 * Code then compares the reads, checks the quote against the page, runs the
 * validation rules and assigns confidence. The AI never rates itself.
 *
 * Scans and images have no text layer. They are never sent to the AI, because an
 * image cannot be redacted for SSNs and EINs. They go to manual entry.
 */
(function () {
  'use strict';
  var TRP = (window.TRP = window.TRP || {});

  /* ---------- pdf.js (pinned, loaded from the CDN on first use) ---------- */

  var PDFJS_VERSION = '6.2.108';
  var PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VERSION + '/legacy/build/';
  var pdfjsPromise = null;

  function loadPdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import(PDFJS_BASE + 'pdf.min.mjs').then(function (lib) {
        lib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.mjs';
        return lib;
      }).catch(function (err) { pdfjsPromise = null; throw err; });
    }
    return pdfjsPromise;
  }

  /* ---------- Field definitions ----------
   * use: 'income' | 'deduction' | 'distribution' | 'basis'  -> feeds the rules engine
   *      'escalate' -> outside this tool's rules; goes to the reviewer if not zero
   * source: an id in knowledge/irs_excerpts.json (checked at start-up)
   */

  function box(n) { return '(?:^|\\s)' + n + '\\s+'; }
  function field(id, boxNo, label, pattern, use, extra) {
    var f = { id: id, box: boxNo, label: label, re: new RegExp(pattern, 'i'), use: use, kind: 'amount' };
    Object.keys(extra || {}).forEach(function (k) { f[k] = extra[k]; });
    return f;
  }
  var ESC = {
    withheld: 'Backup withholding is a payment this tool does not handle',
    foreign: 'Foreign tax paid is outside this tool',
    s199a: 'Section 199A dividends are outside this tool',
    wash: 'Wash sales are outside this tool',
    unusual: 'This box is outside this tool'
  };

  var FORMS = {
    '1099-INT': {
      title: 'Form 1099-INT', short: '1099-INT', detect: /1099[\s-]*INT\b/i,
      fields: [
        field('int_1', '1', 'Interest income', box('1') + 'Interest income', 'income', { source: 'int-box1', primary: true }),
        field('int_2', '2', 'Early withdrawal penalty', box('2') + 'Early withdrawal penalty', 'escalate', { why: ESC.unusual }),
        field('int_3', '3', 'Interest on U.S. Savings Bonds and Treasury obligations', box('3') + 'Interest on U\\.?\\s?S\\.? Savings Bonds', 'income', { source: 'int-box3' }),
        field('int_4', '4', 'Federal income tax withheld', box('4') + 'Federal income tax withheld', 'escalate', { source: 'int-box4', why: ESC.withheld }),
        field('int_5', '5', 'Investment expenses', box('5') + 'Investment expenses', 'escalate', { why: ESC.unusual }),
        field('int_6', '6', 'Foreign tax paid', box('6') + 'Foreign tax paid', 'escalate', { source: 'int-box6', why: ESC.foreign }),
        field('int_8', '8', 'Tax-exempt interest', box('8') + 'Tax-exempt interest', 'income', { source: 'int-box8' }),
        field('int_9', '9', 'Specified private activity bond interest', box('9') + 'Specified private activity bond interest', 'escalate', { source: 'int-box9', why: ESC.unusual }),
        field('int_10', '10', 'Market discount', box('10') + 'Market discount', 'escalate', { why: ESC.unusual }),
        field('int_11', '11', 'Bond premium', box('11') + 'Bond premium', 'escalate', { why: ESC.unusual })
      ]
    },
    '1099-DIV': {
      title: 'Form 1099-DIV', short: '1099-DIV', detect: /1099[\s-]*DIV\b/i,
      fields: [
        field('div_1a', '1a', 'Ordinary dividends', box('1a') + 'Total ordinary dividends', 'income', { source: 'div-box1a', primary: true }),
        field('div_1b', '1b', 'Qualified dividends', box('1b') + 'Qualified dividends', 'income', { source: 'div-box1b' }),
        field('div_2a', '2a', 'Total capital gain distributions', box('2a') + 'Total capital gain distr', 'income', { source: 'div-box2a' }),
        field('div_2b', '2b', 'Unrecaptured section 1250 gain', box('2b') + 'Unrecap', 'escalate', { why: ESC.unusual }),
        field('div_2c', '2c', 'Section 1202 gain', box('2c') + 'Section 1202 gain', 'escalate', { why: ESC.unusual }),
        field('div_2d', '2d', 'Collectibles (28%) gain', box('2d') + 'Collectibles', 'escalate', { why: ESC.unusual }),
        field('div_3', '3', 'Nondividend distributions', box('3') + 'Nondividend distributions', 'escalate', { why: ESC.unusual }),
        field('div_4', '4', 'Federal income tax withheld', box('4') + 'Federal income tax withheld', 'escalate', { source: 'div-box4', why: ESC.withheld }),
        field('div_5', '5', 'Section 199A dividends', box('5') + 'Section 199A dividends', 'escalate', { source: 'div-box5', why: ESC.s199a }),
        field('div_7', '7', 'Foreign tax paid', box('7') + 'Foreign tax paid', 'escalate', { source: 'div-box7', why: ESC.foreign }),
        field('div_9', '9', 'Cash liquidation distributions', box('9') + 'Cash liquidation', 'escalate', { why: ESC.unusual }),
        field('div_10', '10', 'Noncash liquidation distributions', box('10') + 'Noncash liquidation', 'escalate', { why: ESC.unusual }),
        field('div_12', '12', 'Exempt-interest dividends', box('12') + 'Exempt-interest dividends', 'income', { source: 'div-box12' })
      ]
    },
    '1099-B': {
      title: 'Form 1099-B', short: '1099-B', detect: /1099[\s-]*B\b/i,
      fields: [
        field('b_1d', '1d', 'Proceeds', box('1d') + 'Proceeds', 'basis', { source: 'b-box1d', primary: true }),
        field('b_1e', '1e', 'Cost or other basis', box('1e') + 'Cost or other basis', 'basis', { source: 'b-box1e', primary: true }),
        field('b_1f', '1f', 'Accrued market discount', box('1f') + 'Accrued market discount', 'escalate', { why: ESC.unusual }),
        field('b_1g', '1g', 'Wash sale loss disallowed', box('1g') + 'Wash sale loss disallowed', 'escalate', { source: 'b-box1g', why: ESC.wash }),
        field('b_4', '4', 'Federal income tax withheld', box('4') + 'Federal income tax withheld', 'escalate', { source: 'b-box4', why: ESC.withheld }),
        field('b_gain', '', 'Gain or loss shown on the statement', '(?:Realized|Net|Total) gain(?: or \\(?loss\\)?)?', 'check', { signed: true }),
        { id: 'b_term', box: '2', label: 'Short-term or long-term', kind: 'term', use: 'basis', source: 'b-box2', primary: true }
      ]
    },
    SUMMARY: {
      title: "Trustee's distribution and expense summary", short: 'Trust summary', nonStandard: true,
      fields: [
        field('sum_fees', '', 'Trustee fees', "(?:Trustee|Fiduciary)(?:'s)? fees?", 'deduction'),
        field('sum_prof', '', 'Attorney, accountant and preparer fees', '(?:Attorney|Accountant|Accounting|Legal|Tax preparation|Return preparer)[^$\\d]*fees?', 'deduction'),
        field('sum_income_dist', '', 'Total income distributions', 'Total income distributions?', 'distribution', { keepZero: true }),
        field('sum_principal_dist', '', 'Total principal distributions', 'Total (?:principal|corpus) distributions?', 'distribution', { keepZero: true })
      ]
    }
  };

  var FIELD_INDEX = {};
  Object.keys(FORMS).forEach(function (formId) {
    FORMS[formId].id = formId;
    FORMS[formId].fields.forEach(function (f) { f.form = formId; FIELD_INDEX[f.id] = f; });
  });

  /* ---------- Reading a file into pages of positioned text ---------- */

  var LINE_TOLERANCE = 2.5;   // points: items this close vertically are one line
  var CHAR_WIDTH = 4.6;       // points per character when laying text out in columns

  function buildLines(items) {
    var rows = [];
    items.slice().sort(function (a, b) { return b.y - a.y || a.x - b.x; }).forEach(function (it) {
      var row = rows.length ? rows[rows.length - 1] : null;
      if (row && Math.abs(row.y - it.y) <= LINE_TOLERANCE) row.items.push(it);
      else rows.push({ y: it.y, items: [it] });
    });
    rows.forEach(function (row) {
      row.items.sort(function (a, b) { return a.x - b.x; });
      var text = '', layout = '';
      row.items.forEach(function (it) {
        if (text) text += ' ';
        it.start = text.length;
        text += it.str;
        var col = Math.round(it.x / CHAR_WIDTH);
        layout += layout ? new Array(Math.max(2, col - layout.length + 1)).join(' ') : new Array(col + 1).join(' ');
        layout += it.str;
      });
      row.text = text;
      row.layout = layout;
    });
    return rows;
  }

  async function readPdf(file) {
    var lib = await loadPdfjs();
    var data = new Uint8Array(await file.arrayBuffer());
    var pdf = await lib.getDocument({ data: data }).promise;
    var pages = [], chars = 0;
    for (var n = 1; n <= pdf.numPages; n++) {
      var page = await pdf.getPage(n);
      var view = page.getViewport({ scale: 1 });
      var content = await page.getTextContent();
      var items = [];
      content.items.forEach(function (it) {
        var str = (it.str || '').replace(/\s+/g, ' ').trim();
        var t = it.transform;
        if (!str || !t || Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01) return; // skip empty and rotated text
        items.push({ str: str, x: t[4], y: t[5], w: it.width, h: it.height || Math.abs(t[3]) });
        chars += str.length;
      });
      var lines = buildLines(items);
      pages.push({
        num: n, width: view.width, height: view.height, lines: lines,
        text: lines.map(function (l) { return l.text; }).join('\n'),
        layout: lines.map(function (l) { return l.layout; }).join('\n')
      });
    }
    return { pdf: pdf, pages: pages, hasText: chars >= 20 };
  }

  /* ---------- Classification (rule-based) ---------- */

  function classify(pages) {
    var text = pages.map(function (p) { return p.text; }).join('\n');
    var forms = ['1099-INT', '1099-DIV', '1099-B'].filter(function (id) { return FORMS[id].detect.test(text); });
    if (forms.length) return { kind: 'forms', forms: forms };
    if (/Schedule K-1/i.test(text) && /1041/.test(text)) return { kind: 'prior', forms: [], label: 'Schedule K-1 (Form 1041)' };
    if (/Form\s+1041\b/i.test(text) && /Income Tax Return for Estates and Trusts/i.test(text)) return { kind: 'prior', forms: [], label: 'Form 1041' };
    if (/distribution/i.test(text) && /(expense|fees?)\b/i.test(text)) return { kind: 'forms', forms: ['SUMMARY'] };
    return { kind: 'unknown', forms: [] };
  }

  /* ---------- Read 1: the text-layer parser ---------- */

  var AMOUNT = /\(?-?\$?\s?\d{1,3}(?:,\d{3})+(?:\.\d{2})?\)?|\(?-?\$?\s?\d+\.\d{2}\)?|\$\s?\d+/g;

  function parseAmount(s) {
    var negative = /^\s*\(|-/.test(s);
    var n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
    if (!isFinite(n)) return null;
    return negative ? -n : n;
  }

  function amountsIn(line, fromIndex) {
    var out = [], m;
    AMOUNT.lastIndex = 0;
    while ((m = AMOUNT.exec(line.text))) {
      if (m.index < (fromIndex || 0)) continue;
      var start = m.index, end = m.index + m[0].length;
      var hit = line.items.filter(function (it) { return it.start < end && it.start + it.str.length > start; });
      if (!hit.length) continue;
      var x0 = Math.min.apply(null, hit.map(function (it) { return it.x; }));
      var x1 = Math.max.apply(null, hit.map(function (it) { return it.x + it.w; }));
      var h = Math.max.apply(null, hit.map(function (it) { return it.h; }));
      out.push({ value: parseAmount(m[0]), text: m[0].trim(), index: start, rect: { x: x0, y: line.y, w: x1 - x0, h: h } });
    }
    return out;
  }

  function itemAt(line, index) {
    var found = line.items[0];
    line.items.forEach(function (it) { if (it.start <= index) found = it; });
    return found;
  }

  /** Finds one amount field: the label, then the amount on the same line or in the column beneath it. */
  function findAmount(f, form, pages) {
    for (var p = 0; p < pages.length; p++) {
      var lines = pages[p].lines;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var m = f.re.exec(line.text);
        if (!m) continue;
        var labelStart = m.index + (m[0].length - m[0].replace(/^\s+/, '').length);
        var labelEnd = m.index + m[0].length;
        var labelItem = itemAt(line, labelStart);

        // Same line, as long as no other box label sits between the label and the amount.
        var same = amountsIn(line, labelEnd).filter(function (a) {
          var between = line.text.slice(labelEnd, a.index);
          return !form.fields.some(function (o) { return o.re && o !== f && o.re.test(between); });
        });
        if (same.length) return { value: same[0].value, text: same[0].text, page: pages[p].num, rect: same[0].rect };

        // Beneath the label: the nearest amount that starts inside this box's column.
        var next = line.items[line.items.indexOf(itemAt(line, labelEnd - 1)) + 1];
        var right = next ? next.x - 4 : Infinity;
        for (var j = i + 1; j < lines.length && line.y - lines[j].y <= 45; j++) {
          if (form.fields.some(function (o) { return o.re && o.re.test(lines[j].text); })) break; // reached the next row of labels
          var below = amountsIn(lines[j]).filter(function (a) { return a.rect.x >= labelItem.x - 12 && a.rect.x < right; });
          if (below.length) return { value: below[0].value, text: below[0].text, page: pages[p].num, rect: below[0].rect };
        }
      }
    }
    return null;
  }

  function findTerm(pages) {
    var longMark = /\[\s*[Xx✓✔]\s*\]\s*Long-term/, shortMark = /\[\s*[Xx✓✔]\s*\]\s*Short-term/;
    var found = null;
    pages.forEach(function (pg) {
      pg.lines.forEach(function (line) {
        var isLong = longMark.exec(line.text), isShort = shortMark.exec(line.text);
        if (!isLong && !isShort) return;
        if (isLong && isShort) { found = { conflict: true }; return; }
        var m = isLong || isShort, value = isLong ? 'long' : 'short';
        if (found && found.value !== value) { found = { conflict: true }; return; }
        var it = itemAt(line, m.index);
        found = { value: value, text: m[0], page: pg.num, rect: { x: it.x, y: line.y, w: it.w, h: it.h } };
      });
    });
    return found && !found.conflict ? found : null;
  }

  function parseForm(formId, pages) {
    var form = FORMS[formId], out = {};
    form.fields.forEach(function (f) {
      var hit = f.kind === 'term' ? findTerm(pages) : findAmount(f, form, pages);
      if (hit) out[f.id] = hit;
    });
    return out;
  }

  /* ---------- Read 2: the AI, with an evidence quote for every value ---------- */

  var AI_SCHEMA = {
    type: 'object', required: ['doc_type', 'fields'],
    properties: {
      doc_type: { type: 'string', enum: ['1099-INT', '1099-DIV', '1099-B', 'SUMMARY', 'PRIOR-1041', 'UNKNOWN'] },
      fields: {
        type: 'array',
        items: {
          type: 'object', required: ['id', 'value', 'quote', 'page'],
          properties: { id: { type: 'string' }, quote: { type: 'string' }, page: { type: 'integer' } }
        }
      }
    }
  };

  var AI_SYSTEM = [
    'You read one tax document for a deterministic program. Reply with JSON only.',
    'Copy only what is printed. Never calculate, total, round or infer a number.',
    'Leave out any field that is blank, zero or not on the document.',
    'Identifying numbers were replaced with [REDACTED-TIN]. Do not try to restore them.',
    'You do not decide how anything is taxed.'
  ].join(' ');

  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

  async function aiRead(pages, formIds) {
    var ids = formIds.length ? formIds : Object.keys(FORMS);
    var fieldList = [];
    ids.forEach(function (id) {
      FORMS[id].fields.forEach(function (f) {
        fieldList.push(f.id + ': ' + FORMS[id].short + (f.box ? ' box ' + f.box : '') + ', ' + f.label +
          (f.kind === 'term' ? ' (value must be "short" or "long", from the checked box)' : ''));
      });
    });
    var prompt = [
      'Document types: 1099-INT, 1099-DIV, 1099-B, SUMMARY (a trustee\'s distribution and expense summary), PRIOR-1041 (a prior-year Form 1041 or Schedule K-1), UNKNOWN.',
      'Fields you may return, as id: meaning',
      fieldList.join('\n'),
      'Reply in this shape: {"doc_type":"1099-INT","fields":[{"id":"int_1","value":1234.56,"quote":"$ 1,234.56","page":1}]}',
      '"value" is a plain number (no $ or commas). "quote" is the amount exactly as printed, copied character for character from one line of that page. "page" is the page number.',
      'The pages follow. Columns are kept, so an amount printed under a label sits under it here.',
      pages.map(function (p) { return '=== Page ' + p.num + ' ===\n' + p.layout; }).join('\n')
    ].join('\n\n');

    var res = await TRP.ai.callJson({ purpose: 'Read document', system: AI_SYSTEM, prompt: prompt, schema: AI_SCHEMA });
    if (!res.ok) return { ok: false, reason: res.reason };

    var fields = {};
    res.data.fields.forEach(function (row) {
      var f = FIELD_INDEX[row.id];
      if (!f || fields[row.id]) return;                       // unknown or repeated ids are ignored
      var value = f.kind === 'term' ? (row.value === 'long' || row.value === 'short' ? row.value : null)
        : (typeof row.value === 'number' && isFinite(row.value) ? row.value : null);
      if (value === null) return;
      var page = pages.filter(function (p) { return p.num === row.page; })[0];
      // The model saw redacted text, so the quote is checked against the same redacted text.
      var onPage = !!page && !!norm(row.quote) && norm(TRP.ai.redact(page.text)).indexOf(norm(row.quote)) !== -1;
      var carriesValue = f.kind === 'term' ? new RegExp(value + '-term', 'i').test(row.quote)
        : (row.quote.match(AMOUNT) || []).some(function (t) { return Math.abs(parseAmount(t) - value) < 0.005; });
      fields[row.id] = { value: value, quote: row.quote, page: row.page, quoteOk: onPage && carriesValue,
        quoteProblem: !onPage ? 'the quote is not on page ' + row.page : !carriesValue ? 'the quote does not contain the amount' : '' };
    });
    return { ok: true, docType: res.data.doc_type, fields: fields };
  }

  /* ---------- Validation rules ---------- */

  function validate(formId, v) {
    var problems = [];
    function has(id) { return typeof v[id] === 'number'; }
    function atMost(a, b, msg) { if (has(a) && has(b) && v[a] > v[b] + 0.005) problems.push({ fields: [a, b], message: msg }); }

    FORMS[formId].fields.forEach(function (f) {
      if (f.kind === 'amount' && !f.signed && formId !== '1099-B' && has(f.id) && v[f.id] < 0) {
        problems.push({ fields: [f.id], message: f.label + ' cannot be negative' });
      }
    });
    if (formId === '1099-DIV') {
      atMost('div_1b', 'div_1a', 'Qualified dividends are more than ordinary dividends');
      atMost('div_5', 'div_1a', 'Section 199A dividends are more than ordinary dividends');
      ['div_2b', 'div_2c', 'div_2d'].forEach(function (id) { atMost(id, 'div_2a', FIELD_INDEX[id].label + ' is more than total capital gain distributions'); });
    }
    if (formId === '1099-INT') atMost('int_9', 'int_8', 'Private activity bond interest is more than tax-exempt interest');
    if (formId === '1099-B' && has('b_gain') && has('b_1d') && has('b_1e')) {
      var expected = v.b_1d - v.b_1e + (has('b_1g') ? v.b_1g : 0);
      if (Math.abs(expected - v.b_gain) > 0.005) {
        problems.push({ fields: ['b_1d', 'b_1e', 'b_gain'], message: 'Proceeds minus basis does not equal the gain or loss shown' });
      }
    }
    return problems;
  }

  /* ---------- Reconciling the two reads into items with confidence ---------- */

  var RANK = { high: 3, medium: 2, low: 1 };
  function lower(item, level, reason) {
    if (RANK[level] < RANK[item.confidence]) { item.confidence = level; item.reason = reason; }
    else if (RANK[level] === RANK[item.confidence] && level === 'low' && item.reason.indexOf(reason) === -1) item.reason += '; ' + reason;
  }

  function same(f, a, b) { return f.kind === 'term' ? a === b : Math.abs(a - b) < 0.005; }

  function reconcile(formId, parsed, ai) {
    var form = FORMS[formId], items = [], values = {};
    form.fields.forEach(function (f) {
      var p = parsed[f.id] || null;
      var a = ai && ai.ok ? ai.fields[f.id] || null : null;
      var pZero = p && f.kind === 'amount' && p.value === 0;
      if ((!p || pZero) && !a) {
        if (pZero && f.keepZero) { /* a printed zero that matters, fall through */ }
        else {
          if (!p && f.primary) items.push({ fieldId: f.id, value: null, parser: null, ai: null, confidence: 'low', reason: 'Not found in the document. Enter it by hand' });
          return;
        }
      }
      var item = { fieldId: f.id, parser: p, ai: a, value: p ? p.value : a.value };
      if (p && a) {
        if (!same(f, p.value, a.value)) { item.confidence = 'low'; item.reason = 'The two reads disagree: parser ' + show(f, p.value) + ', AI ' + show(f, a.value); }
        else if (!a.quoteOk) { item.confidence = 'low'; item.reason = "The AI's evidence failed the check: " + a.quoteProblem; }
        else { item.confidence = 'high'; item.reason = 'Two reads agree and the quote is on page ' + a.page; }
      } else if (p) {
        item.confidence = 'medium';
        item.reason = !ai ? 'Read by the text parser only (no AI connected)'
          : !ai.ok ? 'Read by the text parser only (the AI read failed: ' + ai.reason.replace(/\.$/, '') + ')' : 'Only the text parser found this';
      } else if (a.quoteOk) {
        item.confidence = 'medium'; item.reason = 'Only the AI found this. Its quote is on page ' + a.page;
      } else {
        item.confidence = 'low'; item.reason = "Only the AI found this, and its evidence failed the check: " + a.quoteProblem;
      }
      if (form.nonStandard && item.confidence === 'high') { item.confidence = 'medium'; item.reason = 'Reads agree, but this is not a standard form. Check it against the summary'; }
      values[f.id] = item.value;
      items.push(item);
    });

    validate(formId, values).forEach(function (problem) {
      items.forEach(function (item) {
        if (problem.fields.indexOf(item.fieldId) !== -1) lower(item, 'low', 'Check failed: ' + problem.message);
      });
    });
    return items.filter(function (item) { return FIELD_INDEX[item.fieldId].use !== 'check'; });
  }

  function show(f, value) {
    if (value === null || value === undefined) return 'not found';
    if (f.kind === 'term') return value === 'long' ? 'Long-term' : 'Short-term';
    return formatMoney(value);
  }

  function formatMoney(n) {
    var s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '-$' : '$') + s;
  }

  /* ---------- One entry point per file ---------- */

  function isAccepted(file) {
    return ['application/pdf', 'image/png', 'image/jpeg'].indexOf(file.type) !== -1 || /\.(pdf|png|jpe?g)$/i.test(file.name || '');
  }
  function isPdf(file) { return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''); }

  /**
   * processFile(file, { useAi }) ->
   *   { status: 'read' | 'manual' | 'held', reason, forms, typeLabel, pages, pdf, items, events }
   * `events` are plain objects for the review log.
   */
  async function processFile(file, opts) {
    var out = { status: 'manual', reason: '', forms: [], typeLabel: 'Not recognised', pages: [], pdf: null, items: [], events: [] };
    if (!isPdf(file)) {
      out.reason = 'Images have no text layer and are not sent to the AI, because an image cannot be redacted';
      return out;
    }
    var doc;
    try { doc = await readPdf(file); }
    catch (err) {
      out.reason = pdfjsPromise ? 'The PDF could not be opened' : 'The PDF reader could not be loaded';
      out.events.push({ type: 'document.error', detail: { file: file.name, error: String(err && err.message || err) } });
      return out;
    }
    out.pages = doc.pages; out.pdf = doc.pdf;
    if (!doc.hasText) {
      out.reason = 'Scanned page with no text layer. Scans are not sent to the AI, because an image cannot be redacted';
      return out;
    }

    var cls = classify(doc.pages);
    var ai = null;
    if (opts.useAi && cls.kind !== 'prior') {
      ai = await aiRead(doc.pages, cls.forms);
      // The AI may propose a type for a document the rules could not place. Rules still read it.
      if (ai.ok && cls.kind === 'unknown' && FORMS[ai.docType]) {
        cls = { kind: 'forms', forms: [ai.docType], byAi: true };
      } else if (ai.ok && cls.kind === 'forms' && ai.docType !== 'UNKNOWN' && cls.forms.indexOf(ai.docType) === -1) {
        cls.typeConflict = ai.docType;
      }
    }
    out.events.push({ type: 'document.classified', detail: { file: file.name, by: cls.byAi ? 'AI proposal' : 'rules', result: cls.kind === 'forms' ? cls.forms.join(' + ') : cls.kind, aiSaid: ai && ai.ok ? ai.docType : undefined } });

    if (cls.kind === 'prior') {
      out.status = 'held'; out.typeLabel = 'Prior-year ' + cls.label;
      out.reason = 'Held for the prior-year check in the trust profile step';
      return out;
    }
    if (cls.kind === 'unknown') { out.reason = 'Not a document type this tool reads'; return out; }

    out.status = 'read'; out.forms = cls.forms;
    out.typeLabel = cls.forms.map(function (id) { return FORMS[id].short; }).join(' + ');
    cls.forms.forEach(function (formId) {
      reconcile(formId, parseForm(formId, doc.pages), ai).forEach(function (item) {
        var f = FIELD_INDEX[item.fieldId];
        item.formId = formId;
        if (cls.byAi) lower(item, 'medium', 'Document type was proposed by the AI, not the rules');
        if (cls.typeConflict) lower(item, 'low', 'Document type reads disagree: rules ' + formId + ', AI ' + cls.typeConflict);
        item.escalate = f.use === 'escalate' ? f.why : '';
        out.items.push(item);
      });
    });
    if (!out.items.length) { out.status = 'manual'; out.reason = 'No amounts could be read from this document'; }
    return out;
  }

  TRP.extract = {
    ready: true,
    FORMS: FORMS,
    field: function (id) { return FIELD_INDEX[id]; },
    isAccepted: isAccepted,
    loadPdfjs: loadPdfjs,
    processFile: processFile,
    formatMoney: formatMoney,
    show: show,
    parseAmount: parseAmount,
    // exposed for tests
    _buildLines: buildLines, _classify: classify, _parseForm: parseForm, _reconcile: reconcile, _validate: validate
  };
})();
