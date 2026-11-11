/* Trust profile: the questions the documents cannot answer, and the rules that use the answers.
 *
 * Everything here is deterministic. The AI is not involved in this step at all.
 * - QUESTIONS are asked one at a time, in order, when their `when` test passes.
 * - classify() applies the simple-trust test from the Form 1041 instructions.
 * - stop() says when the return is outside this tool's scope.
 * - flags() lists what the reviewer must look at (Low items and escalations).
 * Each question cites an excerpt id from knowledge/irs_excerpts.json, or null for an app boundary.
 */
(function () {
  'use strict';
  var TRP = (window.TRP = window.TRP || {});
  var YEAR = 2025;

  var YES_NO = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
  var UNSURE = { value: 'unsure', label: 'Not sure' };

  function money(n) { return TRP.extract.formatMoney(n); }
  function same(a, b) { return String(a || '').replace(/\s+/g, ' ').trim().toLowerCase() === String(b || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }

  /* ---------- Scope ---------- */

  var OUT_OF_SCOPE = {
    estate: ["a decedent's estate", 'f1041-item-a'],
    grantor: ['a grantor type trust', 'i1041-grantor'],
    qdt: ['a qualified disability trust', 'f1041-item-a'],
    esbt: ['an electing small business trust (ESBT)', 'f1041-item-a'],
    bankruptcy: ['a bankruptcy estate', 'f1041-item-a'],
    pooled: ['a pooled income fund', 'f1041-item-a']
  };

  /** Returns { text, source } when the return cannot continue, otherwise null. */
  function stop(ctx) {
    var a = ctx.a;
    if (a.entity && OUT_OF_SCOPE[a.entity]) {
      return { text: 'This tool prepares returns for simple and complex trusts only, so I can\'t prepare a return for ' + OUT_OF_SCOPE[a.entity][0] + '. Please hand this one to your reviewer.', source: OUT_OF_SCOPE[a.entity][1] };
    }
    if (a.entity === 'unsure') {
      return { text: "I can't continue until the type of entity is known, because the rest of the return depends on it. Check the trust instrument or ask your reviewer, then change this answer.", source: 'f1041-item-a' };
    }
    if (a.domestic === 'no' || a.domestic === 'unsure') {
      return { text: a.domestic === 'no' ? 'This tool does not prepare returns for foreign trusts. Please hand this one to your reviewer.'
        : "I can't continue until it is clear whether this is a U.S. trust. Ask your reviewer, then change this answer.", source: null };
    }
    if (a.business === 'yes' || a.business === 'unsure') {
      return { text: a.business === 'yes' ? 'This tool does not prepare returns for trusts with business, farm or rental income. Please hand this one to your reviewer.'
        : "I can't continue until it is clear whether the trust has business, farm or rental income. Ask your reviewer, then change this answer.", source: 'f1041-lines-3-5-6' };
    }
    return null;
  }

  /* ---------- Simple or complex: the rule ---------- */

  /**
   * The three-part test in the Form 1041 instructions ("Simple Trust"). A trust that fails any
   * part is complex for the year. Returns { decided, type, reasons, unsure }.
   */
  function classify(a) {
    var keys = ['all_income', 'charity', 'principal'];
    var unsure = keys.filter(function (k) { return a[k] === 'unsure'; });
    if (keys.some(function (k) { return !a[k]; })) return { decided: false, pending: true, unsure: unsure };
    if (unsure.length) return { decided: false, unsure: unsure };
    var reasons = [];
    if (a.all_income === 'no') reasons.push('the instrument does not require all income to be distributed currently');
    if (a.charity === 'yes') reasons.push('the instrument provides for charitable amounts');
    if (a.principal === 'yes') reasons.push('principal was distributed in ' + YEAR);
    return { decided: true, type: reasons.length ? 'complex' : 'simple', reasons: reasons, unsure: [] };
  }

  function classificationText(ctx) {
    var c = classify(ctx.a), prior = ctx.facts.prior.type;
    var text;
    if (c.type === 'simple') {
      text = 'From your answers, this is a simple trust for ' + YEAR + ': the instrument requires all income to be distributed currently, it has no charitable provisions, and no principal was distributed.';
    } else {
      text = 'From your answers, this is a complex trust for ' + YEAR + ', because ' + c.reasons.join(' and ') + '.';
      if (ctx.a.all_income === 'yes' && ctx.a.charity === 'no' && ctx.a.principal === 'yes') {
        text += ' The instrument alone would make it a simple trust, but distributing principal makes it complex for this year.';
      }
    }
    if (prior && prior !== c.type) text += ' Last year\'s return shows a ' + prior + ' trust, so this is a change.';
    return text + ' Is that right?';
  }

  /* ---------- The questions ---------- */

  function inScope(ctx) { return !stop(ctx) && ctx.a.entity === 'trust' && ctx.a.domestic === 'yes' && ctx.a.business === 'no'; }
  // The rest of the interview runs once the type is confirmed, or once it is known to be undecided (a Not sure answer).
  function later(ctx) {
    var c = classify(ctx.a);
    return inScope(ctx) && (!!ctx.a.classification || (!c.pending && !c.decided));
  }
  function notFirst(ctx) { return later(ctx) && ctx.a.first_year === 'no'; }
  function isComplex(ctx) { return ctx.a.classification === 'complex'; }
  function escalateIfYes(text) { return function (v) { return v === 'yes' ? { level: 'escalate', text: text } : null; }; }

  var QUESTIONS = [
    /* Scope */
    { id: 'entity', section: 'Scope', type: 'choice', source: 'f1041-item-a',
      text: 'What type of entity is this return for?',
      why: 'Form 1041 covers several kinds of estates and trusts. This tool handles simple and complex trusts only.',
      options: [
        { value: 'trust', label: 'A simple or complex trust' }, { value: 'estate', label: "Decedent's estate" },
        { value: 'grantor', label: 'Grantor type trust' }, { value: 'qdt', label: 'Qualified disability trust' },
        { value: 'esbt', label: 'ESBT' }, { value: 'bankruptcy', label: 'Bankruptcy estate' },
        { value: 'pooled', label: 'Pooled income fund' }, UNSURE] },
    { id: 'domestic', section: 'Scope', type: 'choice', source: null, unsure: true, options: YES_NO,
      text: 'Is this a U.S. (domestic) trust?',
      why: 'Foreign trusts are outside what this tool prepares.',
      when: function (ctx) { return ctx.a.entity === 'trust'; } },
    { id: 'business', section: 'Scope', type: 'choice', source: 'f1041-lines-3-5-6', unsure: true, options: YES_NO,
      text: 'Does the trust have any business, farm or rental income, including from a partnership or S corporation?',
      why: 'Those lines of Form 1041 need other schedules that this tool does not prepare.',
      when: function (ctx) { return ctx.a.entity === 'trust' && ctx.a.domestic === 'yes'; } },

    /* Simple or complex */
    { id: 'all_income', section: 'Simple or complex', type: 'choice', source: 'i1041-simple-trust', unsure: true, options: YES_NO, clears: ['classification'],
      text: 'Does the trust instrument require all income to be distributed currently?',
      why: 'It is the first of three tests for a simple trust.', when: inScope },
    { id: 'charity', section: 'Simple or complex', type: 'choice', source: 'i1041-simple-trust', unsure: true, options: YES_NO, clears: ['classification'],
      text: 'Does the trust instrument provide for any amounts to be paid, permanently set aside, or used for charitable purposes?',
      why: 'A trust with charitable provisions cannot be a simple trust.', when: inScope },
    { id: 'principal', section: 'Simple or complex', type: 'choice', source: 'i1041-simple-trust', unsure: true, options: YES_NO, clears: ['classification'],
      text: function (ctx) {
        var p = ctx.facts.principalDist;
        return 'Did the trust distribute any principal (corpus) in ' + YEAR + '?' +
          (p === null ? '' : " The trustee's summary shows total principal distributions of " + money(p) + '.');
      },
      why: 'Distributing principal makes a trust complex for that year, whatever the instrument says.', when: inScope },
    { id: 'classification', section: 'Simple or complex', type: 'choice', source: 'i1041-complex-trust',
      text: classificationText,
      why: 'The rules propose the classification from your answers. You confirm it.',
      options: function (ctx) {
        var t = classify(ctx.a).type;
        return [{ value: t, label: 'Yes, ' + (t === 'simple' ? 'a simple trust' : 'a complex trust') },
          { value: 'redo', label: "No, I'll change an answer" }];
      },
      when: function (ctx) { return inScope(ctx) && classify(ctx.a).decided; } },

    /* The trust */
    { id: 'trust_name', section: 'The trust', type: 'text', source: 'i1041-name',
      text: 'What is the exact name of the trust?', why: 'It goes at the top of Form 1041 and on each Schedule K-1.',
      hint: 'As shown on the Form SS-4 used to get the EIN', when: later },
    { id: 'name_change', section: 'The trust', type: 'choice', source: 'i1041-change-name', unsure: true, options: YES_NO,
      text: function (ctx) { return 'Last year\'s return shows the name "' + ctx.facts.prior.name + '", and you entered "' + ctx.a.trust_name + '". Did the trust\'s name change?'; },
      why: 'If it changed, the "Change in trust\'s name" box in item F is checked. If it did not, one of the two names is wrong.',
      when: function (ctx) { return later(ctx) && ctx.a.trust_name && ctx.facts.prior.name && !same(ctx.a.trust_name, ctx.facts.prior.name); },
      flag: function (v) { return v === 'no' ? { level: 'low', text: "The trust's name differs from last year's return, but you said it did not change" } : null; } },
    { id: 'ein', section: 'The trust', type: 'tin', kind: 'ein', source: 'i1041-ein',
      text: "What is the trust's employer identification number (EIN)?",
      why: 'It is item C on Form 1041. It is kept in this tab only, shown masked, and never sent to the AI.',
      hint: 'Nine digits, for example 00-0000000. Use a made-up number.', when: later },
    { id: 'ein_conflict', section: 'The trust', type: 'choice', source: 'i1041-ein',
      text: function (ctx) {
        return "The EIN you entered ends in " + digits(ctx.pii.ein).slice(-4) + ", but last year's return shows one ending in " + digits(ctx.facts.prior.ein).slice(-4) + '. Which is right?';
      },
      why: 'A trust keeps the same EIN from year to year, so a mismatch usually means a typing error or the wrong prior-year return.',
      options: [{ value: 'mine', label: 'The one I entered' }, { value: 'reenter', label: "I'll re-enter it" }, UNSURE],
      when: function (ctx) { return later(ctx) && ctx.pii.ein && ctx.facts.prior.ein && digits(ctx.pii.ein) !== digits(ctx.facts.prior.ein); },
      flag: function (v) { return v === 'mine' ? { level: 'low', text: "The EIN differs from last year's return. You kept the one you entered" } : null; } },
    { id: 'date_created', section: 'The trust', type: 'date', source: 'i1041-date-created',
      text: 'On what date was the trust created?', why: 'It is item D on Form 1041.', when: later },
    { id: 'fiduciary_name', section: 'The trust', type: 'text', source: 'i1041-fiduciary',
      text: "What is the fiduciary's name?", why: 'Form 1041 asks for the name and title of the fiduciary.', hint: 'The trustee, a person or a company', when: later },
    { id: 'fiduciary_title', section: 'The trust', type: 'text', source: 'i1041-fiduciary',
      text: "What is the fiduciary's title?", why: 'It is entered with the name, for example "Trustee".', hint: 'For example: Trustee', when: later },
    { id: 'fiduciary_address', section: 'The trust', type: 'address', source: 'i1041-address',
      text: "What is the fiduciary's mailing address?", why: 'It goes in the address lines at the top of Form 1041.', when: later },

    /* This return */
    { id: 'first_year', section: 'This return', type: 'choice', source: 'f1041-item-f', options: YES_NO, unsure: true,
      text: 'Is ' + YEAR + " the trust's first tax year?",
      why: 'A first return checks "Initial return" in item F. Otherwise I compare this year with last year\'s return.', when: later },
    { id: 'prior_return', section: 'This return', type: 'choice', source: null,
      text: 'Do you have the ' + (YEAR - 1) + ' Form 1041 and Schedules K-1? If so, attach them with the paperclip, send them, and I will read them.',
      why: 'Last year\'s return shows the EIN, the classification, the beneficiaries and any capital loss carryover.',
      options: [{ value: 'none', label: "I don't have it" }],
      when: function (ctx) { return notFirst(ctx) && !ctx.facts.hasPrior; },
      flag: function (v) { return v === 'none' ? { level: 'low', text: 'Not the first year, but no prior-year return was provided. Carryovers and consistency could not be checked' } : null; } },
    { id: 'prior_type', section: 'This return', type: 'choice', source: 'f1041-item-a', unsure: true,
      text: 'How was the trust treated on last year\'s return?',
      why: 'A change from last year is worth a second look by the reviewer.',
      options: [{ value: 'simple', label: 'Simple trust' }, { value: 'complex', label: 'Complex trust' }],
      when: function (ctx) { return notFirst(ctx) && (ctx.facts.hasPrior || ctx.a.prior_return) && !ctx.facts.prior.type; } },
    { id: 'carryover', section: 'This return', type: 'amounts', source: null,
      fields: [{ key: 'st', label: 'Short-term capital loss carryover' }, { key: 'lt', label: 'Long-term capital loss carryover' }],
      text: 'Does the trust have a capital loss carryover from ' + (YEAR - 1) + '? Enter the amounts, or 0 if there is none.',
      why: "A carryover from last year's Schedule D reduces this year's capital gains.",
      skipLabel: 'Not sure',
      when: function (ctx) { return notFirst(ctx) && (ctx.facts.hasPrior || ctx.a.prior_return) && ctx.facts.prior.st === null && ctx.facts.prior.lt === null; } },
    { id: 'changes', section: 'This return', type: 'multi', source: 'f1041-item-f',
      text: "Did any of these change since last year's return?",
      why: 'Each one is a box in item F on Form 1041.',
      options: [{ value: 'name', label: "The trust's name" }, { value: 'fiduciary', label: 'The fiduciary (a different trustee)' },
        { value: 'fiduciary_name', label: "The fiduciary's name" }, { value: 'fiduciary_address', label: "The fiduciary's address" }],
      noneLabel: 'None of these', when: notFirst },
    { id: 'final_return', section: 'This return', type: 'choice', source: 'i1041-final-return', options: YES_NO, unsure: true,
      text: 'Is this the trust\'s final return, because the trust ended in ' + YEAR + '?',
      why: 'A final return checks "Final return" in item F and "Final K-1" on each Schedule K-1.', when: later,
      flag: escalateIfYes('Final return: excess deductions and unused carryovers on termination are outside this tool') },
    { id: 'amended', section: 'This return', type: 'choice', source: 'i1041-amended', options: YES_NO,
      text: 'Is this an amended return?', why: 'An amended return checks "Amended return" in item F and needs an explanation of each change.', when: later,
      flag: escalateIfYes('Amended return: the explanation of changes must be prepared by the reviewer') },

    /* Beneficiaries */
    { id: 'beneficiaries', section: 'Beneficiaries', type: 'beneficiaries', source: 'i1041-item-b',
      text: 'Who are the beneficiaries, and what share of the income does each receive?',
      why: 'Each beneficiary gets a Schedule K-1, and item B on Form 1041 is the number of K-1s. Identifying numbers are shown masked and never sent to the AI.',
      when: later },
    { id: 'skip_persons', section: 'Beneficiaries', type: 'choice', source: 'i1041-q9', options: YES_NO, unsure: true,
      text: 'Are any present or future beneficiaries skip persons?',
      why: 'It is question 9 under Other Information on Form 1041.', when: later },

    /* The instrument */
    { id: 'gains_alloc', section: 'The instrument', type: 'choice', source: 'i1041-accounting-income',
      text: 'How does the trust instrument, or local law, allocate capital gains?',
      why: 'Gains allocated to principal stay in the trust and are taxed to it. Gains allocated to income can pass to the beneficiaries. This tool does not interpret the instrument for you.',
      options: [{ value: 'principal', label: 'To principal (corpus)' }, { value: 'income', label: 'To income' },
        { value: 'unsure', label: "The instrument is silent, or I'm not sure" }],
      when: later },
    { id: 'fees_alloc', section: 'The instrument', type: 'choice', source: 'i1041-line-12',
      text: 'How are the trustee fees charged?',
      why: 'Fees charged to income reduce what the beneficiaries receive. Fees charged to principal do not.',
      options: [{ value: 'income', label: 'To income' }, { value: 'principal', label: 'To principal' },
        { value: 'both', label: 'Split between both' }, UNSURE],
      when: later,
      flag: function (v) { return v === 'both' ? { level: 'escalate', text: 'Trustee fees are split between income and principal. The reviewer must supply the split' } : null; } },

    /* Other Information (Form 1041, page 3) */
    { id: 'tax_exempt', section: 'Other information', type: 'choice', source: 'i1041-q1',
      text: function (ctx) {
        return ctx.facts.taxExempt > 0
          ? 'The documents show ' + money(ctx.facts.taxExempt) + ' of tax-exempt income. I will answer Yes to question 1, and part of the trustee fees will be allocated to it. Is that amount complete?'
          : 'The documents show no tax-exempt income. Did the trust receive any tax-exempt income in ' + YEAR + '?';
      },
      why: 'Question 1 asks for the amount, and expenses must be split between taxable and tax-exempt income.',
      options: function (ctx) {
        return ctx.facts.taxExempt > 0
          ? [{ value: 'yes', label: 'Yes, that is all of it' }, { value: 'more', label: 'No, there is more' }, UNSURE]
          : [{ value: 'no', label: 'No' }, { value: 'more', label: 'Yes' }, UNSURE];
      },
      when: later,
      flag: function (v) { return v === 'more' ? { level: 'low', text: 'There is tax-exempt income that is not in the documents. Add the document or enter it by hand' } : null; } },
    { id: 'q2_earnings', section: 'Other information', type: 'choice', source: 'f1041-q2', options: YES_NO, unsure: true,
      text: "Did the trust receive any individual's earnings (salary, wages or other pay) under a contract assignment or similar arrangement?",
      why: 'It is question 2 under Other Information.', when: later,
      flag: escalateIfYes('Assigned earnings (question 2) are outside this tool') },
    { id: 'q3_foreign_account', section: 'Other information', type: 'choice', source: 'i1041-q3', options: YES_NO, unsure: true,
      text: 'At any time in ' + YEAR + ', did the trust have an interest in, or signature authority over, a financial account in a foreign country?',
      why: 'It is question 3, and a Yes can mean other filings are due.', when: later,
      flag: escalateIfYes('Foreign financial account (question 3): the country and any FinCEN filing are for the reviewer') },
    { id: 'q4_foreign_trust', section: 'Other information', type: 'choice', source: 'i1041-q4', options: YES_NO, unsure: true,
      text: 'Did the trust receive a distribution from a foreign trust, or was it the grantor of or a transferor to one?',
      why: 'It is question 4, and a Yes can mean Form 3520 is due.', when: later,
      flag: escalateIfYes('Foreign trust dealings (question 4) are outside this tool') },
    { id: 'q5_seller_financing', section: 'Other information', type: 'choice', source: 'i1041-q5', options: YES_NO, unsure: true,
      text: 'Did the trust receive or pay any qualified residence interest on seller-provided financing?',
      why: 'It is question 5, and a Yes needs an attachment.', when: later,
      flag: escalateIfYes('Seller-financed mortgage interest (question 5) needs an attachment the reviewer must prepare') },
    { id: 'q6_663b', section: 'Other information', type: 'choice', source: 'i1041-q6', options: YES_NO, unsure: true,
      text: 'Has the fiduciary decided to make the section 663(b) election, the "65-day" election?',
      why: 'It is question 6 and is open to complex trusts. This tool never makes an election; it only records what the fiduciary decided.',
      when: function (ctx) { return later(ctx) && isComplex(ctx); },
      flag: escalateIfYes('Section 663(b) election: this tool does not make tax elections') },
    { id: 'q7_643e', section: 'Other information', type: 'choice', source: 'i1041-q7', options: YES_NO, unsure: true,
      text: 'Has the fiduciary decided to make the section 643(e)(3) election, to recognize gain on property distributed in kind?',
      why: 'It is question 7. This tool never makes an election; it only records what the fiduciary decided.', when: later,
      flag: escalateIfYes('Section 643(e)(3) election: this tool does not make tax elections') },
    { id: 'q10_8938', section: 'Other information', type: 'choice', source: 'i1041-q10', options: YES_NO, unsure: true,
      text: 'Was the trust a specified domestic entity required to file Form 8938 for ' + YEAR + '?',
      why: 'It is question 10.', when: later,
      flag: escalateIfYes('Form 8938 (question 10) is outside this tool') },
    { id: 'q11_965', section: 'Other information', type: 'choice', source: 'f1041-q11-12', options: YES_NO, unsure: true,
      text: 'Did the trust make a section 965(i) election, or distribute or hold S corporation stock covered by one?',
      why: 'It covers questions 11 and 12.', when: later,
      flag: escalateIfYes('Section 965(i) (questions 11 and 12) is outside this tool') },
    { id: 'q13_digital', section: 'Other information', type: 'choice', source: 'i1041-digital', options: YES_NO, unsure: true,
      text: 'In ' + YEAR + ', did the trust receive, sell, exchange or otherwise dispose of a digital asset?',
      why: 'It is question 13.', when: later,
      flag: escalateIfYes('Digital asset transactions (question 13) are outside this tool') }
  ];

  var BY_ID = {};
  QUESTIONS.forEach(function (q) { BY_ID[q.id] = q; });

  function applicable(ctx) { return QUESTIONS.filter(function (q) { return !q.when || q.when(ctx); }); }
  function next(ctx) {
    if (stop(ctx)) return null;
    return applicable(ctx).filter(function (q) { return !(q.id in ctx.a); })[0] || null;
  }
  function resolve(q, ctx) {
    var options = typeof q.options === 'function' ? q.options(ctx) : (q.options || []).slice();
    if (q.unsure) options.push(UNSURE);
    return { text: typeof q.text === 'function' ? q.text(ctx) : q.text, options: options };
  }

  /* ---------- What the reviewer must look at ---------- */

  function flags(ctx) {
    var a = ctx.a, out = [];
    function add(id, level, text) { out.push({ id: id, level: level, text: text }); }

    QUESTIONS.forEach(function (q) {
      if (!(q.id in a)) return;
      if (a[q.id] === 'unsure') {
        var heavy = q.id === 'gains_alloc' ? 'The instrument is silent or unclear on capital gains. The reviewer must decide before the return can be generated'
          : 'Not sure: ' + resolve(q, ctx).text.split('?')[0] + '?';
        add(q.id, 'low', heavy);
      }
      var f = q.flag ? q.flag(a[q.id], ctx) : null;
      if (f) add(q.id, f.level, f.text);
    });

    var c = classify(a);
    if (!c.pending && !c.decided) add('classification', 'low', 'Simple or complex is undecided, because an answer it depends on is Not sure');

    if (a.principal && a.principal !== 'unsure' && ctx.facts.principalDist !== null && (a.principal === 'yes') !== (ctx.facts.principalDist > 0)) {
      add('principal_doc', 'low', "Your answer on principal distributions disagrees with the trustee's summary (" + money(ctx.facts.principalDist) + ')');
    }
    if (a.carryover && a.carryover.skipped) add('carryover', 'low', 'Capital loss carryover from ' + (YEAR - 1) + ' is not known');
    if (a.first_year === 'yes' && ctx.facts.hasPrior) add('first_year_doc', 'low', 'You said this is the first tax year, but a prior-year return was uploaded');

    var bens = a.beneficiaries || [], priorBens = ctx.facts.prior.bens || [];
    if (bens.length && priorBens.length) {
      var now = bens.map(function (b) { return b.name.toLowerCase().trim(); }).sort().join('|');
      var then = priorBens.map(function (n) { return n.toLowerCase().trim(); }).sort().join('|');
      if (now !== then) add('beneficiaries_prior', 'low', "The beneficiaries differ from last year's K-1s (" + priorBens.join(', ') + ')');
    }
    return out;
  }

  /* ---------- A readable summary of the finished profile ---------- */

  function summary(ctx) {
    var a = ctx.a, rows = [];
    function label(id) {
      var q = BY_ID[id], v = a[id];
      var opt = resolve(q, ctx).options.filter(function (o) { return o.value === v; })[0];
      return opt ? opt.label : String(v);
    }
    if (a.trust_name) rows.push(['Trust', a.trust_name]);
    if (a.ein) rows.push(['EIN', a.ein]);
    if (a.classification && a.classification !== 'redo') rows.push(['Type for ' + YEAR, a.classification === 'simple' ? 'Simple trust' : 'Complex trust']);
    if (a.fiduciary_name) rows.push(['Fiduciary', a.fiduciary_name + (a.fiduciary_title ? ', ' + a.fiduciary_title : '')]);
    if (a.first_year) rows.push(['Return', [a.first_year === 'yes' ? 'Initial return' : null, a.final_return === 'yes' ? 'Final return' : null,
      a.amended === 'yes' ? 'Amended return' : null].filter(Boolean).join(', ') || 'Not initial, final or amended']);
    if (a.beneficiaries) rows.push(['Beneficiaries (' + a.beneficiaries.length + ' K-1s)', a.beneficiaries.map(function (b) { return b.name + ' ' + b.share + '%'; }).join(', ')]);
    if (a.gains_alloc) rows.push(['Capital gains', label('gains_alloc')]);
    if (a.fees_alloc) rows.push(['Trustee fees', label('fees_alloc')]);
    var st = ctx.facts.prior.st !== null ? ctx.facts.prior.st : a.carryover && !a.carryover.skipped ? a.carryover.st : null;
    var lt = ctx.facts.prior.lt !== null ? ctx.facts.prior.lt : a.carryover && !a.carryover.skipped ? a.carryover.lt : null;
    if (st || lt) rows.push(['Capital loss carryover from ' + (YEAR - 1), 'Short-term ' + money(st || 0) + ', long-term ' + money(lt || 0)]);
    return rows;
  }

  TRP.profile = {
    YEAR: YEAR, QUESTIONS: QUESTIONS, byId: BY_ID,
    applicable: applicable, next: next, resolve: resolve,
    stop: stop, classify: classify, flags: flags, summary: summary
  };
})();
