/* Output: fills the official IRS PDFs with pdf-lib, and builds the review log.
 *
 * - Field names come only from pdf/field_map_2025.json, which scripts/build_field_map.py builds
 *   from the IRS PDFs. A return line with no map entry stops the fill; nothing is guessed.
 * - Full SSNs and EINs are written here, onto the PDFs the user downloads, and nowhere else.
 * - Every page is stamped as a draft. Nothing is filed or sent anywhere.
 */
(function () {
  'use strict';
  var TRP = (window.TRP = window.TRP || {});

  var PDFLIB_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
  var DRAFT = 'DRAFT - for professional review';
  var libPromise = null, mapPromise = null, sources = {};

  function loadLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    if (!libPromise) {
      libPromise = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = PDFLIB_URL;
        s.onload = function () { resolve(window.PDFLib); };
        s.onerror = function () { libPromise = null; reject(new Error('The PDF library could not be loaded')); };
        document.head.appendChild(s);
      });
    }
    return libPromise;
  }

  function loadMap() {
    if (!mapPromise) {
      mapPromise = fetch('pdf/field_map_2025.json').then(function (res) {
        if (!res.ok) throw new Error('The field map could not be loaded');
        return res.json();
      }).catch(function (err) { mapPromise = null; throw err; });
    }
    return mapPromise;
  }

  function loadSource(file) {
    if (!sources[file]) {
      sources[file] = fetch(file).then(function (res) {
        if (!res.ok) throw new Error('The IRS form ' + file + ' could not be loaded');
        return res.arrayBuffer();
      }).catch(function (err) { delete sources[file]; throw err; });
    }
    return sources[file];
  }

  /* ---------- Formatting ---------- */

  function amount(n) {
    var s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n < 0 ? '(' + s + ')' : s;
  }
  function einText(d) { d = String(d || '').replace(/\D/g, ''); return d.length === 9 ? d.slice(0, 2) + '-' + d.slice(2) : ''; }
  function ssnText(d) { d = String(d || '').replace(/\D/g, ''); return d.length === 9 ? d.slice(0, 3) + '-' + d.slice(3, 5) + '-' + d.slice(5) : ''; }
  function usDate(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[1] + '/' + p[2] + '/' + p[0] : ''; }

  /* ---------- Return -> values for each form (pure) ---------- */

  /**
   * values(result, a, pii) -> { f1041: {...}, f1041sd: {...} | null, k1: [{...}], notes: [...] }
   * Keys are the return-line keys in the field map. Text values are strings; checkboxes are true.
   */
  function values(result, a, pii) {
    var F = result.form, B = result.schB, D = result.schD, G = result.schG, notes = [];
    var one = {}, complex = a.classification === 'complex', addr = a.fiduciary_address || {};
    function put(target, key, n, always) { if (n !== null && n !== undefined && (always || n !== 0)) target[key] = amount(n); }
    function yesNo(key, answer) { if (answer === 'yes') one[key + '_yes'] = true; else if (answer === 'no') one[key + '_no'] = true; }

    one.trust_name = a.trust_name || '';
    one.fiduciary = [a.fiduciary_name, a.fiduciary_title].filter(Boolean).join(', ');
    one.street = addr.street || ''; one.city = addr.city || ''; one.state = addr.state || ''; one.zip = addr.zip || '';
    one[complex ? 'entity_complex' : 'entity_simple'] = true;
    one.k1_count = String((a.beneficiaries || []).length);
    one.ein = einText(pii.ein);
    one.date_created = usDate(a.date_created);
    if (a.first_year === 'yes') one.initial_return = true;
    if (a.final_return === 'yes') one.final_return = true;
    if (a.amended === 'yes') one.amended_return = true;
    var changes = a.changes || [];
    if (changes.indexOf('name') !== -1 || a.name_change === 'yes') one.change_name = true;
    if (changes.indexOf('fiduciary') !== -1) one.change_fiduciary = true;
    if (changes.indexOf('fiduciary_name') !== -1) one.change_fiduciary_name = true;
    if (changes.indexOf('fiduciary_address') !== -1) one.change_fiduciary_address = true;

    put(one, 'line_1', F['1']); put(one, 'line_2a', F['2a']); put(one, 'line_2b1', F['2b1']); put(one, 'line_2b2', F['2b2']);
    put(one, 'line_4', F['4']); put(one, 'line_9', F['9'], true); put(one, 'line_12', F['12']); put(one, 'line_14', F['14']);
    put(one, 'line_16', F['16'], true); put(one, 'line_17', F['17'], true); put(one, 'line_18', F['18'], true);
    put(one, 'line_21', F['21'], true); put(one, 'line_22', F['22'], true); put(one, 'line_23', F['23'], true); put(one, 'line_24', F['24'], true);

    put(one, 'schB_1', B['1'], true); put(one, 'schB_2', B['2']); put(one, 'schB_3', B['3']); put(one, 'schB_6', B['6']);
    put(one, 'schB_7', B['7'], true); if (complex) put(one, 'schB_8', B['8'], true);
    put(one, 'schB_9', B['9'], true); if (complex) put(one, 'schB_10', B['10'], true);
    put(one, 'schB_11', B['11'], true); put(one, 'schB_12', B['12']); put(one, 'schB_13', B['13'], true);
    put(one, 'schB_14', B['14'], true); put(one, 'schB_15', B['15'], true);
    put(one, 'schG_1a', G['1a'], true); put(one, 'schG_1e', G['1e'], true); put(one, 'schG_3', G['3'], true); put(one, 'schG_9', G['9'], true);

    one[result.otherInfo.q1 === 'yes' ? 'q1_yes' : 'q1_no'] = true;
    if (result.otherInfo.q1 === 'yes') one.q1_amount = amount(result.otherInfo.q1Amount);
    yesNo('q2', a.q2_earnings); yesNo('q3', a.q3_foreign_account); yesNo('q4', a.q4_foreign_trust); yesNo('q5', a.q5_seller_financing);
    yesNo('q9', a.skip_persons); yesNo('q10', a.q10_8938); yesNo('q13', a.q13_digital);
    if (a.q11_965 === 'no') { one.q11a_no = true; one.q12_no = true; }

    notes.push('Lines 25 to 30 (payments, tax due or overpayment) are left blank: this tool does not collect estimated tax payments or withholding.');
    notes.push('Other Information questions 6 and 7 (elections) are never checked by this tool. Questions answered Yes or Not sure in the interview may need details the reviewer must add.');

    /* Schedule D */
    var sd = null;
    var needsD = D['1a'].proceeds || D['1a'].basis || D['8a'].proceeds || D['8a'].basis || D['6'] || D['13'] || D['15'];
    if (needsD) {
      sd = { trust_name: one.trust_name, ein: one.ein };
      if (D['1a'].proceeds || D['1a'].basis) { sd.l1a_d = amount(D['1a'].proceeds); sd.l1a_e = amount(D['1a'].basis); sd.l1a_h = amount(D['1a'].gain); }
      if (D['8a'].proceeds || D['8a'].basis) { sd.l8a_d = amount(D['8a'].proceeds); sd.l8a_e = amount(D['8a'].basis); sd.l8a_h = amount(D['8a'].gain); }
      if (D['6']) sd.l6 = amount(Math.abs(D['6']));           // the form prints the parentheses
      if (D['13']) sd.l13 = amount(D['13']);
      if (D['15']) sd.l15 = amount(Math.abs(D['15']));
      sd.l7 = amount(D['7']); sd.l16 = amount(D['16']);
      [['l17', D['17']], ['l18a', D['18a']], ['l19', D['19']]].forEach(function (row) {
        if (row[1].bens) sd[row[0] + '_1'] = amount(row[1].bens);
        sd[row[0] + '_2'] = amount(row[1].trust); sd[row[0] + '_3'] = amount(row[1].total);
      });
      if (D['20']) sd.l20 = amount(D['20']);
      if (result.partV && result.taxMethod.indexOf('Part V') !== -1) {
        for (var n = 21; n <= 45; n++) sd['l' + n] = amount(result.partV[n]);
      }
      notes.push('Schedule D: the qualified opportunity fund question at the top is left blank, because the interview does not ask it. Sales are reported on lines 1a and 8a, which assumes basis was reported to the IRS and there are no adjustments.');
    }

    /* Schedule K-1, one per beneficiary */
    var fiduciaryBlock = [one.fiduciary, one.street, [one.city, [one.state, one.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join('\n');
    var k1 = result.k1.map(function (k, i) {
      var b = (a.beneficiaries || [])[i] || {}, v = { trust_ein: one.ein, trust_name: one.trust_name, fiduciary_block: fiduciaryBlock };
      v.ben_tin = ssnText((pii.beneficiaries || [])[i]);
      v.ben_block = [k.name, b.address].filter(Boolean).join('\n');
      put(v, 'box_1', k['1']); put(v, 'box_2a', k['2a']); put(v, 'box_2b', k['2b']); put(v, 'box_3', k['3']); put(v, 'box_4a', k['4a']);
      if (k['14A']) { v.box_14_code = 'A'; v.box_14_amount = amount(k['14A']); }
      if (a.final_return === 'yes') { v.final_k1 = true; v.final_1041 = true; }
      return v;
    });
    if (k1.length) notes.push('Schedule K-1: item H (domestic or foreign beneficiary) is left blank, because the interview does not ask it.');

    return { f1041: one, f1041sd: sd, k1: k1, notes: notes };
  }

  /* ---------- Filling one IRS PDF ---------- */

  async function fillPdf(lib, bytes, spec, vals, stamp) {
    var doc = await lib.PDFDocument.load(bytes);
    var form = doc.getForm();
    if (typeof form.deleteXFA === 'function') form.deleteXFA();     // IRS forms carry an XFA layer that would hide the filled values
    Object.keys(vals).forEach(function (key) {
      var entry = spec.fields[key], v = vals[key];
      if (!entry) throw new Error('No field is mapped for "' + key + '". The field map must be rebuilt');
      if (v === '' || v === false || v == null) return;
      if (entry.type === 'checkbox') { form.getCheckBox(entry.field).check(); return; }
      var field = form.getTextField(entry.field);
      var text = String(v), max = field.getMaxLength();
      if (text.indexOf('\n') !== -1) field.enableMultiline();
      if (max !== undefined && text.length > max) field.setMaxLength(undefined);
      field.setText(text);
    });
    var font = await doc.embedFont(lib.StandardFonts.HelveticaBold);
    doc.getPages().forEach(function (page) {
      var size = page.getSize();
      page.drawText(stamp, { x: 36, y: size.height - 11, size: 7.5, font: font, color: lib.rgb(0.72, 0.1, 0.1) });
      page.drawText(stamp, { x: 36, y: 6, size: 7.5, font: font, color: lib.rgb(0.72, 0.1, 0.1) });
    });
    doc.setTitle(DRAFT);
    return doc.save();
  }

  function safeName(s) { return String(s || 'trust').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'trust'; }

  /**
   * forms(result, a, pii, { escalated }) -> [{ id, label, name, bytes }]
   * Form 1041, Schedule D when it is needed, and one Schedule K-1 per beneficiary.
   */
  async function forms(result, a, pii, opts) {
    var lib = await loadLib(), map = await loadMap();
    var vals = values(result, a, pii), base = safeName(a.trust_name), out = [];
    var stamp = DRAFT + ' - synthetic data' + (opts && opts.escalated ? ' - contains ' + opts.escalated + ' escalated item' + (opts.escalated === 1 ? '' : 's') : '');
    async function one(id, label, formKey, v, name) {
      var bytes = await fillPdf(lib, await loadSource(map[formKey].file), map[formKey], v, stamp);
      out.push({ id: id, label: label, name: name, bytes: bytes });
    }
    await one('f1041', 'Form 1041', 'f1041', vals.f1041, 'Form_1041_2025_DRAFT_' + base + '.pdf');
    if (vals.f1041sd) await one('f1041sd', 'Schedule D', 'f1041sd', vals.f1041sd, 'Schedule_D_2025_DRAFT_' + base + '.pdf');
    for (var i = 0; i < vals.k1.length; i++) {
      await one('k1_' + i, 'Schedule K-1: ' + result.k1[i].name, 'f1041sk1', vals.k1[i], 'Schedule_K-1_2025_DRAFT_' + safeName(result.k1[i].name) + '.pdf');
    }
    return { files: out, notes: vals.notes };
  }

  /* ---------- Review log as a readable PDF ---------- */

  function winAnsi(s) {
    return String(s).replace(/[→←]/g, '->').replace(/[●◐○]/g, '').replace(/[^\x20-\x7E\xA0-\xFF‘’“”–—•…]/g, '?');
  }

  /** sections: [{ title, lines: [string] }] -> PDF bytes. */
  async function logPdf(title, subtitle, sections) {
    var lib = await loadLib();
    var doc = await lib.PDFDocument.create();
    var regular = await doc.embedFont(lib.StandardFonts.Helvetica), bold = await doc.embedFont(lib.StandardFonts.HelveticaBold);
    var W = 612, H = 792, M = 54, page = null, y = 0, red = lib.rgb(0.72, 0.1, 0.1), ink = lib.rgb(0.1, 0.1, 0.1);
    function newPage() {
      page = doc.addPage([W, H]);
      page.drawText(DRAFT, { x: M, y: H - 30, size: 8, font: bold, color: red });
      page.drawText(String(doc.getPageCount()), { x: W - M - 10, y: 28, size: 8, font: regular, color: ink });
      y = H - 56;
    }
    function write(text, font, size, indent) {
      var words = winAnsi(text).split(/\s+/), line = '', width = W - 2 * M - (indent || 0);
      function flush() {
        if (y < 56) newPage();
        page.drawText(line, { x: M + (indent || 0), y: y, size: size, font: font, color: ink });
        y -= size + 4; line = '';
      }
      words.forEach(function (w) {
        while (font.widthOfTextAtSize(w, size) > width) {            // a very long token: hard-wrap it
          var cut = Math.max(1, Math.floor(w.length * width / font.widthOfTextAtSize(w, size)) - 1);
          if (line) flush();
          line = w.slice(0, cut); flush(); w = w.slice(cut);
        }
        var next = line ? line + ' ' + w : w;
        if (font.widthOfTextAtSize(next, size) > width) { flush(); line = w; } else line = next;
      });
      if (line) flush();
    }
    newPage();
    write(title, bold, 16); write(subtitle, regular, 10); y -= 6;
    sections.forEach(function (s) {
      y -= 6; if (y < 90) newPage();
      write(s.title, bold, 12);
      s.lines.forEach(function (l) { write(l, regular, 9, 8); });
    });
    doc.setTitle(title + ' - ' + DRAFT);
    return doc.save();
  }

  /* ---------- A plain .zip (stored, no compression), so no extra library is needed ---------- */

  var CRC = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) { var c = 0xFFFFFFFF; for (var i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  /** zip([{ name, bytes: Uint8Array }]) -> Uint8Array */
  function zip(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    function header(sig, extra) { var b = new Uint8Array(extra.length + 4), v = new DataView(b.buffer); v.setUint32(0, sig, true); b.set(extra, 4); return b; }
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = f.bytes, crc = crc32(data);
      var common = new Uint8Array(26), v = new DataView(common.buffer);
      v.setUint16(0, 20, true); v.setUint16(2, 0x0800, true); v.setUint16(4, 0, true);          // version, UTF-8 names, stored
      v.setUint16(6, 0, true); v.setUint16(8, 0x21, true);                                       // time, date (1980-01-01)
      v.setUint32(10, crc, true); v.setUint32(14, data.length, true); v.setUint32(18, data.length, true);
      v.setUint16(22, name.length, true); v.setUint16(24, 0, true);
      var local = header(0x04034b50, common);
      parts.push(local, name, data);
      var c = new Uint8Array(42), cv = new DataView(c.buffer);
      cv.setUint16(0, 20, true); c.set(common, 2); cv.setUint32(38, offset, true);
      central.push(header(0x02014b50, c), name);
      offset += local.length + name.length + data.length;
    });
    var centralSize = central.reduce(function (s, p) { return s + p.length; }, 0);
    var end = new Uint8Array(18), ev = new DataView(end.buffer);
    ev.setUint16(4, files.length, true); ev.setUint16(6, files.length, true); ev.setUint32(8, centralSize, true); ev.setUint32(12, offset, true);
    var all = parts.concat(central, [header(0x06054b50, end)]);
    var out = new Uint8Array(all.reduce(function (s, p) { return s + p.length; }, 0)), at = 0;
    all.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }

  TRP.pdfFill = { ready: true, DRAFT: DRAFT, values: values, forms: forms, logPdf: logPdf, zip: zip, loadMap: loadMap, _fillPdf: fillPdf, _amount: amount };
})();
