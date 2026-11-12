/* Deterministic rules engine for a 2025 Form 1041 (simple and complex trusts).
 *
 * All tax math lives here. The AI never calculates a number on the return.
 * compute(input) follows the forms line by line: Schedule D, page 1, Schedule B,
 * Schedule G line 1a, then the Schedule K-1 amounts. Every step is recorded in `trace`
 * with the excerpt id (knowledge/irs_excerpts.json) of the rule it applies.
 * Amounts are kept to the cent. Constants come from rules/constants_2025.js only.
 *
 * Where the instructions allow more than one reasonable method, the engine uses one fixed
 * method and lists it under `assumptions`, so the reviewer can see and change the choice.
 * Anything it cannot compute is listed under `unsupported`, and `ok` is false.
 */
(function () {
  'use strict';
  var TRP = (window.TRP = window.TRP || {});

  function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function num(n) { return typeof n === 'number' && isFinite(n) ? n : 0; }

  /** Tax from the 2025 Tax Rate Schedule (Instructions for Form 1041, page 33). */
  function rateScheduleTax(taxable, C) {
    if (taxable <= 0) return 0;
    var row = C.rateSchedule[0];
    C.rateSchedule.forEach(function (r) { if (taxable > r.over) row = r; });
    return r2(row.base + row.rate * (taxable - row.over));
  }

  /**
   * Schedule D (Form 1041), Part V, lines 21-45. With no capital gain, the same steps are the
   * Qualified Dividends Tax Worksheet in the instructions (page 34), line for line.
   */
  function maxRateTax(taxable, gain, qualified, C) {
    var G = C.capitalGain, L = {};
    L[21] = taxable;
    L[22] = Math.max(0, gain);
    L[23] = qualified;
    L[24] = r2(L[22] + L[23]);
    L[25] = 0;                                   // Form 4952 is not supported
    L[26] = Math.max(0, r2(L[24] - L[25]));
    L[27] = Math.max(0, r2(L[21] - L[26]));
    L[28] = Math.min(L[21], G.zeroRateMax);
    L[29] = Math.min(L[27], L[28]);
    L[30] = Math.max(0, r2(L[28] - L[29]));      // taxed at 0%
    L[31] = Math.min(L[21], L[26]);
    L[32] = r2(L[26] - L[30]);
    L[33] = Math.min(L[21], G.fifteenRateMax);
    L[34] = r2(L[27] + L[30]);
    L[35] = Math.max(0, r2(L[33] - L[34]));
    L[36] = Math.min(L[32], L[35]);
    L[37] = r2(L[36] * G.rate15);
    L[38] = L[31];
    L[39] = r2(L[30] + L[36]);
    L[40] = Math.max(0, r2(L[38] - L[39]));
    L[41] = r2(L[40] * G.rate20);
    L[42] = rateScheduleTax(L[27], C);
    L[43] = r2(L[37] + L[41] + L[42]);
    L[44] = rateScheduleTax(L[21], C);
    L[45] = Math.min(L[43], L[44]);
    return L;
  }

  function compute(input) {
    var C = TRP.constants2025;
    var out = { ok: true, unsupported: [], assumptions: [], notes: [], checks: [], trace: [],
      form: {}, schB: {}, schD: {}, partV: null, schG: {}, k1: [], taxMethod: '' };
    function t(form, line, label, value, how, source) {
      out.trace.push({ form: form, line: String(line), label: label, value: value, how: how, source: source });
      return value;
    }
    function unsupported(msg) { out.ok = false; out.unsupported.push(msg); }

    /* ----- What the engine will not compute ----- */
    var type = input.type;
    if (type !== 'simple' && type !== 'complex') unsupported('Simple or complex has not been decided');
    if (input.gainsTo !== 'principal' && input.gainsTo !== 'income') unsupported('How capital gains are allocated has not been decided');
    if (input.feesChargedTo !== 'income' && input.feesChargedTo !== 'principal') unsupported('How trustee fees are charged has not been decided');
    if (input.charity) unsupported('Charitable amounts need Schedule A, which this tool does not prepare');
    if (type === 'complex' && input.gainsTo === 'income') unsupported('A complex trust with capital gains allocated to income is outside this tool');
    var bens = input.beneficiaries || [];
    var shareTotal = bens.reduce(function (s, b) { return s + num(b.share); }, 0);
    if (!bens.length || Math.abs(shareTotal - 1) > 0.0001) unsupported('Beneficiary shares must add up to 100%');
    if ((input.sales || []).some(function (s) { return s.term !== 'short' && s.term !== 'long'; })) unsupported('A sale is missing its holding period (short-term or long-term)');
    if ((input.sales || []).some(function (s) { return typeof s.proceeds !== 'number' || typeof s.basis !== 'number'; })) unsupported('A sale is missing its proceeds or its basis');
    (input.blockers || []).forEach(unsupported);
    if (!out.ok) return out;

    var interest = num(input.interest), ordDiv = num(input.ordinaryDividends), qd = num(input.qualifiedDividends);
    var taxExempt = num(input.taxExemptInterest), fees = num(input.fees), prof = num(input.profFees);
    var complex = type === 'complex';

    /* ----- Schedule D ----- */
    var D = out.schD, st = { proceeds: 0, basis: 0 }, lt = { proceeds: 0, basis: 0 };
    (input.sales || []).forEach(function (s) {
      var bucket = s.term === 'short' ? st : lt;
      bucket.proceeds += num(s.proceeds); bucket.basis += num(s.basis);
    });
    var carry = input.carryover || {};
    D['1a'] = { proceeds: r2(st.proceeds), basis: r2(st.basis), gain: r2(st.proceeds - st.basis) };
    D['6'] = -Math.abs(num(carry.st));
    D['7'] = t('Schedule D', 7, 'Net short-term capital gain or (loss)', r2(D['1a'].gain + D['6']), 'Line 1a column (h) less the short-term loss carryover on line 6', 'f1041sd-carryover');
    D['8a'] = { proceeds: r2(lt.proceeds), basis: r2(lt.basis), gain: r2(lt.proceeds - lt.basis) };
    D['13'] = num(input.capitalGainDistributions);
    D['15'] = -Math.abs(num(carry.lt));
    D['16'] = t('Schedule D', 16, 'Net long-term capital gain or (loss)', r2(D['8a'].gain + D['13'] + D['15']), 'Line 8a column (h) plus capital gain distributions (line 13) less the long-term loss carryover on line 15', 'f1041sd-carryover');
    var net = r2(D['7'] + D['16']);
    var toBens = input.gainsTo === 'income' && net > 0;    // simple trust, gains are income under the instrument
    if (toBens && (D['7'] < 0 || D['16'] < 0)) unsupported('A net loss in one holding period with gains allocated to the beneficiaries is outside this tool');
    D['17'] = { bens: toBens ? D['7'] : 0, trust: toBens ? 0 : D['7'], total: D['7'] };
    D['18a'] = { bens: toBens ? D['16'] : 0, trust: toBens ? 0 : D['16'], total: D['16'] };
    D['19'] = { bens: r2(D['17'].bens + D['18a'].bens), trust: r2(D['17'].trust + D['18a'].trust), total: net };
    t('Schedule D', 19, 'Total net gain or (loss), column (3)', net, 'Line 17 plus line 18a. Column (1), beneficiaries: ' + D['19'].bens + '; column (2), trust: ' + D['19'].trust, 'f1041sd-summary');
    D['20'] = net < 0 ? Math.min(-net, C.capitalLossLimit) : 0;
    if (net < -C.capitalLossLimit) out.notes.push({ level: 'escalate', text: 'The capital loss is more than $' + C.capitalLossLimit.toLocaleString('en-US') + '. The Capital Loss Carryover Worksheet for next year is not prepared by this tool' });
    if (!out.ok) return out;

    /* ----- Form 1041, page 1: income ----- */
    var F = out.form;
    F['1'] = t('Form 1041', 1, 'Interest income', r2(interest), 'Taxable interest from Forms 1099-INT (boxes 1 and 3)', 'int-box1');
    F['2a'] = t('Form 1041', '2a', 'Total ordinary dividends', r2(ordDiv), 'Form 1099-DIV box 1a', 'div-box1a');
    F['4'] = t('Form 1041', 4, 'Capital gain or (loss)', net >= 0 ? net : -D['20'],
      net >= 0 ? 'Schedule D, line 19, column (3)' : 'Schedule D, line 20: the smaller of the loss or $' + C.capitalLossLimit.toLocaleString('en-US'), 'f1041sd-summary');
    F['9'] = t('Form 1041', 9, 'Total income', r2(F['1'] + F['2a'] + F['4']), 'Lines 1, 2a and 4', 'f1041-page1-totals');

    /* ----- Deductions, with the share that belongs to tax-exempt income taken out ----- */
    var gainInIncome = toBens ? net : 0;
    var grossAccounting = r2(interest + ordDiv + taxExempt + gainInIncome);
    var teShare = taxExempt > 0 && grossAccounting > 0 ? taxExempt / grossAccounting : 0;
    var feesTE = r2(fees * teShare), profTE = r2(prof * teShare), expTE = r2(feesTE + profTE);
    if (taxExempt > 0 && (fees || prof)) {
      out.assumptions.push('Indirect expenses were allocated to tax-exempt income in the ratio of tax-exempt income to gross accounting income (' +
        taxExempt + ' / ' + grossAccounting + '). The instructions require only "a reasonable proportion", so the reviewer may use another method.');
    }
    F['12'] = t('Form 1041', 12, 'Fiduciary fees', r2(fees - feesTE), feesTE ? 'Fees of ' + fees + ' less ' + feesTE + ' allocated to tax-exempt income' : 'Trustee fees from the summary', feesTE ? 'i1041-tax-exempt-allocation' : 'i1041-line-12');
    F['14'] = t('Form 1041', 14, 'Attorney, accountant, and return preparer fees', r2(prof - profTE), profTE ? 'Fees of ' + prof + ' less ' + profTE + ' allocated to tax-exempt income' : 'From the summary', 'i1041-tax-exempt-allocation');
    F['16'] = r2(F['12'] + F['14']);
    F['17'] = t('Form 1041', 17, 'Adjusted total income', r2(F['9'] - F['16']), 'Line 9 less line 16', 'f1041-page1-totals');

    /* ----- Schedule B: distributable net income and the distribution deduction ----- */
    var B = out.schB;
    B['1'] = F['17'];
    B['2'] = t('Schedule B', 2, 'Adjusted tax-exempt interest', r2(taxExempt - expTE), 'Tax-exempt interest of ' + taxExempt + ' less ' + expTE + ' of expenses allocated to it', 'i1041-schb-line2');
    B['3'] = t('Schedule B', 3, 'Net gain allocated to income (Schedule D, line 19, column (1))', Math.max(0, D['19'].bens), 'Capital gains attributable to income under the instrument', 'i1041-schb-line3');
    B['4'] = 0; B['5'] = 0;
    B['6'] = t('Schedule B', 6, 'Gain from page 1, line 4, as a negative number', F['4'] === 0 ? 0 : -F['4'], 'Removes capital gains from distributable net income; a loss is added back', 'f1041-schb');
    B['7'] = t('Schedule B', 7, 'Distributable net income', Math.max(0, r2(B['1'] + B['2'] + B['3'] + B['6'])), 'Lines 1 through 6 combined, not less than zero', 'f1041-schb');
    var chargedToIncome = input.feesChargedTo === 'income' ? r2(fees + prof) : 0;
    var accountingIncome = r2(grossAccounting - chargedToIncome);
    if (prof) out.assumptions.push('Attorney, accountant and preparer fees were charged the same way as the trustee fees (to ' + input.feesChargedTo + ').');
    B['8'] = complex ? t('Schedule B', 8, 'Accounting income', accountingIncome, 'Interest, dividends and tax-exempt income' + (chargedToIncome ? ' less ' + chargedToIncome + ' of fees charged to income' : ''), 'i1041-accounting-income') : null;
    B['9'] = t('Schedule B', 9, 'Income required to be distributed currently', input.allIncomeRequired ? Math.max(0, accountingIncome) : 0,
      input.allIncomeRequired ? 'The instrument requires all income to be distributed: accounting income of ' + accountingIncome : 'The instrument does not require income to be distributed', 'i1041-schb-line9');
    var other = complex ? r2(num(input.principalDistributed) + (input.allIncomeRequired ? 0 : num(input.incomeDistributed))) : 0;
    B['10'] = t('Schedule B', 10, 'Other amounts paid, credited, or otherwise required to be distributed', other,
      complex ? 'Amounts actually distributed that are not on line 9' : 'Not used by a simple trust', 'i1041-schb-line10');
    B['11'] = r2(B['9'] + B['10']);
    B['12'] = t('Schedule B', 12, 'Tax-exempt income included on line 11', B['2'] <= 0 ? 0 : (B['7'] <= B['11'] ? B['2'] : r2(B['2'] * B['11'] / B['7'])),
      B['7'] <= B['11'] ? 'Distributions are at least the DNI, so all of line 2' : 'Line 2 times line 11 over line 7, because less than the DNI was distributed', 'i1041-schb-line12');
    B['13'] = r2(B['11'] - B['12']);
    B['14'] = Math.max(0, r2(B['7'] - B['2']));
    B['15'] = t('Schedule B', 15, 'Income distribution deduction', Math.max(0, Math.min(B['13'], B['14'])), 'The smaller of line 13 (' + B['13'] + ') or line 14 (' + B['14'] + ')', 'f1041-schb');

    /* ----- Page 1: distribution deduction, exemption, taxable income ----- */
    F['18'] = B['15'];
    F['21'] = t('Form 1041', 21, 'Exemption', input.allIncomeRequired ? C.exemptions.allIncomeRequired : C.exemptions.otherTrust,
      input.allIncomeRequired ? 'The instrument requires all income to be distributed currently' : 'A trust not required to distribute all income currently', 'i1041-exemption');
    F['22'] = r2(F['18'] + F['21']);
    F['23'] = t('Form 1041', 23, 'Taxable income', r2(F['17'] - F['22']), 'Line 17 less line 22', 'f1041-page1-totals');

    // Qualified dividends follow the income they are part of: the share of the DNI that was distributed.
    var distributedShare = B['7'] > 0 ? Math.min(B['11'], B['7']) / B['7'] : 0;
    F['2b1'] = t('Form 1041', '2b(1)', 'Qualified dividends allocable to beneficiaries', r2(qd * distributedShare), 'Qualified dividends of ' + qd + ' times the share of DNI distributed (' + r2(distributedShare * 100) + '%)', 'i1041-line-2b');
    F['2b2'] = t('Form 1041', '2b(2)', 'Qualified dividends allocable to the trust', r2(qd - F['2b1']), 'The rest of the qualified dividends', 'i1041-line-2b');
    if (qd > 0 && distributedShare > 0 && distributedShare < 1) out.assumptions.push('Qualified dividends were split between the beneficiaries and the trust in proportion to the DNI distributed.');

    /* ----- Schedule G, line 1a: tax ----- */
    var taxable = F['23'], tax = 0;
    var hasSchD = (input.sales || []).length > 0 || D['13'] !== 0 || D['6'] !== 0 || D['15'] !== 0;
    if (taxable <= 0) {
      out.taxMethod = 'No tax: taxable income is zero or less';
    } else if (hasSchD && ((D['18a'].trust > 0 && D['19'].trust > 0) || F['2b2'] > 0)) {
      out.partV = maxRateTax(taxable, Math.min(D['18a'].trust, D['19'].trust), F['2b2'], C);
      tax = out.partV[45];
      out.taxMethod = 'Schedule D (Form 1041), Part V';
    } else if (!hasSchD && F['2b2'] > 0) {
      out.partV = maxRateTax(taxable, 0, F['2b2'], C);
      tax = out.partV[45];
      out.taxMethod = 'Qualified Dividends Tax Worksheet';
    } else {
      tax = rateScheduleTax(taxable, C);
      out.taxMethod = '2025 Tax Rate Schedule';
    }
    var G = out.schG;
    G['1a'] = t('Schedule G', '1a', 'Tax on taxable income', tax, out.taxMethod, out.partV ? 'f1041sd-part5' : 'i1041-rate-schedule');
    G['1e'] = tax; G['3'] = tax; G['9'] = tax;
    F['24'] = t('Form 1041', 24, 'Total tax', tax, 'Schedule G, Part I, line 9. No credits or other taxes are computed', 'i1041-rate-schedule');
    if (taxable > C.niitThreshold) out.notes.push({ level: 'escalate', text: 'Taxable income is above $' + C.niitThreshold.toLocaleString('en-US') + ', so the trust may owe Net Investment Income Tax (Form 8960). This tool does not compute it' });
    out.otherInfo = { q1: taxExempt > 0 ? 'yes' : 'no', q1Amount: r2(taxExempt) };

    /* ----- Schedule K-1: each class of income, net of its deductions, by share ----- */
    var base = interest + ordDiv, exp = F['16'];
    var expInt = base > 0 ? exp * interest / base : 0, expDiv = base > 0 ? exp * ordDiv / base : 0;
    var netInt = interest - expInt, netDiv = ordDiv - expDiv, netQd = ordDiv > 0 ? qd - expDiv * (qd / ordDiv) : 0;
    var paidShare = B['14'] > 0 ? B['15'] / B['14'] : 0;        // share of the taxable DNI that was deducted
    if (exp > 0 && interest > 0 && ordDiv > 0) out.assumptions.push('Deductible expenses were spread over interest and dividends in proportion to each. The instructions let the fiduciary allocate indirect expenses to any class of income.');
    out.k1 = bens.map(function (b) {
      var s = num(b.share);
      return { name: b.name, share: s,
        '1': r2(netInt * paidShare * s), '2a': r2(netDiv * paidShare * s), '2b': r2(netQd * paidShare * s),
        '3': r2(Math.max(0, D['17'].bens) * paidShare * s), '4a': r2(Math.max(0, D['18a'].bens) * paidShare * s),
        '14A': r2(B['12'] * s) };
    });
    t('Schedule K-1', 'boxes 1-4a', 'Income passed to the beneficiaries', B['15'], 'Each class of income less its share of deductions, times the share of DNI deducted (' + r2(paidShare * 100) + '%), times each beneficiary\'s share', 'i1041-k1-boxes');

    /* ----- Internal consistency checks ----- */
    var k1Total = out.k1.reduce(function (sum, k) { return sum + k['1'] + k['2a'] + k['3'] + k['4a']; }, 0);
    var tol = 0.01 * Math.max(1, bens.length) * 4 + 0.001;
    out.checks.push({ name: 'K-1 taxable amounts add up to the income distribution deduction', pass: B['7'] === 0 || Math.abs(k1Total - B['15']) <= tol, detail: r2(k1Total) + ' vs ' + B['15'] });
    out.checks.push({ name: 'The distribution deduction is not more than distributable net income', pass: B['15'] <= B['7'] + 0.001, detail: B['15'] + ' vs ' + B['7'] });
    out.checks.push({ name: 'Qualified dividends are not more than ordinary dividends', pass: qd <= ordDiv + 0.001, detail: qd + ' vs ' + ordDiv });
    if (out.checks.some(function (c) { return !c.pass; })) { out.ok = false; out.unsupported.push('An internal check failed. See the checks list'); }
    return out;
  }

  /**
   * Builds the engine input from a return's extracted items, profile answers and document facts.
   * Pure: it reads values and never asks the AI for anything.
   */
  function inputFrom(items, a, facts) {
    var sum = {}, sales = {};
    items.forEach(function (it) {
      if (it.value === null || it.value === undefined) return;
      if (it.formId === '1099-B') {
        var s = sales[it.docId] = sales[it.docId] || {};
        if (it.fieldId === 'b_1d') s.proceeds = it.value;
        else if (it.fieldId === 'b_1e') s.basis = it.value;
        else if (it.fieldId === 'b_term') s.term = it.value;
      } else if (typeof it.value === 'number') sum[it.fieldId] = (sum[it.fieldId] || 0) + it.value;
    });
    // Boxes that change the numbers in ways this tool does not compute. They stop the calculation.
    var blockers = [];
    if (sum.div_2b || sum.div_2c || sum.div_2d) blockers.push('Form 1099-DIV boxes 2b, 2c or 2d have amounts, which need the Schedule D Tax Worksheet');
    items.forEach(function (it) {
      if ((it.fieldId === 'b_1g' || it.fieldId === 'b_1f') && it.value) blockers.push('A sale has a wash sale or market discount adjustment, which needs Form 8949');
    });
    var prior = (facts && facts.prior) || {};
    var co = a.carryover && !a.carryover.skipped ? a.carryover : {};
    return {
      type: a.classification === 'simple' || a.classification === 'complex' ? a.classification : null,
      allIncomeRequired: a.all_income === 'yes',
      charity: a.charity === 'yes',
      gainsTo: a.gains_alloc, feesChargedTo: a.fees_alloc,
      interest: (sum.int_1 || 0) + (sum.int_3 || 0),
      taxExemptInterest: (sum.int_8 || 0) + (sum.div_12 || 0),
      ordinaryDividends: sum.div_1a || 0, qualifiedDividends: sum.div_1b || 0,
      capitalGainDistributions: sum.div_2a || 0,
      sales: Object.keys(sales).map(function (k) { return sales[k]; }),
      carryover: { st: prior.st != null ? prior.st : co.st || 0, lt: prior.lt != null ? prior.lt : co.lt || 0 },
      fees: sum.sum_fees || 0, profFees: sum.sum_prof || 0,
      incomeDistributed: sum.sum_income_dist || 0, principalDistributed: sum.sum_principal_dist || 0,
      blockers: blockers.filter(function (b, i) { return blockers.indexOf(b) === i; }),
      beneficiaries: (a.beneficiaries || []).map(function (b) { return { name: b.name, share: b.share / 100 }; })
    };
  }

  TRP.engine = { ready: true, compute: compute, inputFrom: inputFrom, rateScheduleTax: rateScheduleTax, maxRateTax: maxRateTax };
})();
