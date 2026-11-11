/* Synthetic test cases for the rules engine.
 *
 * Case 1's expected figures come from the build specification. The expected figures for the
 * other cases were worked out by hand from the 2025 forms and instructions, independently of
 * the engine. If the engine disagrees with an expected figure, the test fails: the expected
 * figure is not changed to match.
 */
(function () {
  'use strict';
  var TRP = (window.TRP = window.TRP || {});
  var TWO = [{ name: 'Avery Maple', share: 0.5 }, { name: 'Jordan Maple', share: 0.5 }];

  function base(over) {
    var input = {
      type: 'simple', allIncomeRequired: true, charity: false, gainsTo: 'principal', feesChargedTo: 'income',
      interest: 4000, taxExemptInterest: 0, ordinaryDividends: 6000, qualifiedDividends: 4500, capitalGainDistributions: 0,
      sales: [{ term: 'long', proceeds: 25000, basis: 20000 }], carryover: { st: 0, lt: 0 },
      fees: 1200, profFees: 0, incomeDistributed: 8800, principalDistributed: 0, beneficiaries: TWO
    };
    Object.keys(over || {}).forEach(function (k) { input[k] = over[k]; });
    return input;
  }

  TRP.testCases = [
    { id: 'Case 1', title: 'Baseline simple trust',
      about: '1099-INT $4,000; 1099-DIV $6,000 ordinary ($4,500 qualified); $5,000 long-term gain allocated to principal; trustee fees $1,200 charged to income; two beneficiaries 50/50.',
      input: base(),
      expect: [
        ['form.9', 15000, 'Total income'], ['form.17', 13800, 'Adjusted total income'], ['schB.7', 8800, 'Distributable net income'],
        ['schB.15', 8800, 'Income distribution deduction'], ['form.21', 300, 'Exemption'], ['form.23', 4700, 'Taxable income'],
        ['taxMethod', 'Schedule D (Form 1041), Part V', 'Taxed at capital gain rates'],
        ['partV.30', 3250, 'Part V line 30: taxed at 0%'], ['partV.36', 1450, 'Part V line 36: taxed at 15%'], ['form.24', 217.5, 'Total tax'],
        ['form.2b1', 4500, 'Qualified dividends to beneficiaries'], ['form.2b2', 0, 'Qualified dividends to the trust'],
        ['k1.0.1', 1760, 'K-1 box 1, each: half of interest net of fees'], ['k1.0.2a', 2640, 'K-1 box 2a, each: half of dividends net of fees'],
        ['k1.0.2b', 1980, 'K-1 box 2b, each'], ['k1.1.1', 1760, 'Second K-1 box 1'], ['k1.1.2a', 2640, 'Second K-1 box 2a'], ['k1.0.4a', 0, 'No gain passes to beneficiaries']
      ] },

    { id: 'Case 2', title: 'Complex trust that accumulates part of its income',
      about: 'Same documents. The instrument does not require income to be distributed; the trustee distributed $5,000 of income and no principal.',
      input: base({ type: 'complex', allIncomeRequired: false, incomeDistributed: 5000 }),
      expect: [
        ['form.21', 100, 'Exemption'], ['schB.7', 8800, 'Distributable net income'], ['schB.8', 8800, 'Accounting income'],
        ['schB.9', 0, 'Income required to be distributed'], ['schB.10', 5000, 'Other amounts distributed'],
        ['schB.15', 5000, 'Deduction limited to amounts distributed'], ['form.23', 8700, 'Taxable income'],
        ['form.2b1', 2556.82, 'Qualified dividends to beneficiaries'], ['form.2b2', 1943.18, 'Qualified dividends to the trust'],
        ['form.24', 993.18, 'Total tax'],
        ['k1.0.1', 1000, 'K-1 box 1, each'], ['k1.0.2a', 1500, 'K-1 box 2a, each'], ['k1.0.2b', 1125, 'K-1 box 2b, each']
      ] },

    { id: 'Case 3', title: 'Simple on paper, but principal was distributed',
      about: 'Same documents. The instrument requires all income to be distributed, and $2,000 of principal was also distributed, so the trust is complex for 2025.',
      input: base({ type: 'complex', principalDistributed: 2000 }),
      expect: [
        ['form.21', 300, 'Exemption stays $300'], ['schB.9', 8800, 'Income required to be distributed'], ['schB.10', 2000, 'Principal distributed'],
        ['schB.11', 10800, 'Total distributions'], ['schB.15', 8800, 'Deduction limited to DNI'], ['form.23', 4700, 'Taxable income'], ['form.24', 217.5, 'Total tax'],
        ['k1.0.1', 1760, 'K-1 box 1, each'], ['k1.0.2a', 2640, 'K-1 box 2a, each']
      ] },

    { id: 'Case 4', title: 'Tax-exempt interest plus trustee fees',
      about: '1099-INT $4,000 taxable interest and $2,000 tax-exempt interest; trustee fees $1,200 charged to income; simple trust; no dividends or sales.',
      input: base({ taxExemptInterest: 2000, ordinaryDividends: 0, qualifiedDividends: 0, sales: [], incomeDistributed: 4800 }),
      expect: [
        ['form.9', 4000, 'Total income'], ['form.12', 800, 'Fiduciary fees: $400 of $1,200 allocated to tax-exempt income'],
        ['form.17', 3200, 'Adjusted total income'], ['schB.2', 1600, 'Adjusted tax-exempt interest'], ['schB.7', 4800, 'DNI includes net tax-exempt interest'],
        ['schB.12', 1600, 'Tax-exempt income in distributions'], ['schB.15', 3200, 'Income distribution deduction'],
        ['form.23', -300, 'Taxable income'], ['form.24', 0, 'Total tax'], ['otherInfo.q1Amount', 2000, 'Other Information, question 1 amount'],
        ['k1.0.1', 1600, 'K-1 box 1, each'], ['k1.0.14A', 800, 'K-1 box 14 code A, tax-exempt interest, each']
      ] },

    { id: 'Case 5 (engine part)', title: 'Instrument silent on capital gains',
      about: 'The allocation of capital gains is not decided, so the engine must refuse to compute.',
      input: base({ gainsTo: 'unsure' }),
      expect: [['ok', false, 'Engine refuses to compute'], ['unsupported.0', 'How capital gains are allocated has not been decided', 'Reason given']] },

    { id: 'Case 7 (engine part)', title: 'Capital loss carryover from the prior year',
      about: 'Case 1 with a $3,000 long-term capital loss carryover from 2024.',
      input: base({ carryover: { st: 0, lt: 3000 } }),
      expect: [
        ['schD.15', -3000, 'Schedule D line 15: carryover'], ['schD.16', 2000, 'Net long-term gain'], ['form.4', 2000, 'Capital gain on page 1'],
        ['form.9', 12000, 'Total income'], ['schB.7', 8800, 'DNI is unchanged'], ['form.23', 1700, 'Taxable income'], ['form.24', 0, 'All of it is gain taxed at 0%']
      ] },

    { id: 'Rate schedule', title: '2025 Tax Rate Schedule breakpoints',
      about: 'The tax at each breakpoint must equal the base amount printed for the next bracket.',
      rate: [[3150, 315], [11450, 2307], [15650, 3777], [20000, 5386.5]] }
  ];

  /** Runs every case and returns [{ id, title, about, rows: [{ label, path, expected, actual, pass }] }]. */
  TRP.runTests = function () {
    function get(obj, path) {
      return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
    }
    function same(a, b) { return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.005 : a === b; }
    return TRP.testCases.map(function (c) {
      var rows;
      if (c.rate) {
        rows = c.rate.map(function (pair) {
          var actual = TRP.engine.rateScheduleTax(pair[0], TRP.constants2025);
          return { label: 'Tax on $' + pair[0].toLocaleString('en-US'), path: 'rateScheduleTax', expected: pair[1], actual: actual, pass: same(actual, pair[1]) };
        });
      } else {
        var result = TRP.engine.compute(c.input);
        rows = c.expect.map(function (e) {
          var actual = get(result, e[0]);
          return { label: e[2], path: e[0], expected: e[1], actual: actual, pass: same(actual, e[1]) };
        });
        (result.checks || []).forEach(function (chk) {
          rows.push({ label: 'Internal check: ' + chk.name, path: 'checks', expected: true, actual: chk.pass, pass: chk.pass });
        });
      }
      return { id: c.id, title: c.title, about: c.about, rows: rows };
    });
  };
})();
