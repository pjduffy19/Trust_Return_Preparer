/* Tax constants for tax year 2025 (Form 1041).
 *
 * Every value below was copied from the IRS PDFs in /sources, and each carries the page it came
 * from. "i1041" is sources/i1041_2025.pdf (2025 Instructions for Form 1041); "f1041sd" is
 * sources/f1041sd_2025.pdf (2025 Schedule D (Form 1041)). Nothing here is from memory.
 */
(function () {
  'use strict';
  var TRP = (window.TRP = window.TRP || {});
  TRP.constants2025 = {
    taxYear: 2025,

    // 2025 Tax Rate Schedule - i1041 page 33, "2025 Tax Rate Schedule" (Schedule G, line 1a).
    // Each row: taxable income over `over`, tax is `base` plus `rate` of the amount over `over`.
    rateSchedule: [
      { over: 0, base: 0, rate: 0.10 },          // i1041 p.33: $0 to $3,150: 10%
      { over: 3150, base: 315.00, rate: 0.24 },  // i1041 p.33: over $3,150: $315.00 + 24%
      { over: 11450, base: 2307.00, rate: 0.35 },// i1041 p.33: over $11,450: $2,307.00 + 35%
      { over: 15650, base: 3777.00, rate: 0.37 } // i1041 p.33: over $15,650: $3,777.00 + 37%
    ],

    // Capital gain and qualified dividend rate breakpoints - i1041 page 2, "Capital gains and
    // qualified dividends", and f1041sd page 2, Part V, lines 28 and 33.
    capitalGain: {
      zeroRateMax: 3250,      // i1041 p.2: "The 0% rate applies to amounts up to $3,250."
      fifteenRateMax: 15900,  // i1041 p.2: "The 15% rate applies to amounts over $3,250 and up to $15,900."
      rate15: 0.15,           // f1041sd p.2, line 37: "Multiply line 36 by 15% (0.15)"
      rate20: 0.20            // f1041sd p.2, line 41: "Multiply line 40 by 20% (0.20)"
    },

    // Exemption - i1041 page 29, "Line 21-Exemption".
    exemptions: {
      allIncomeRequired: 300, // i1041 p.29: trust required to distribute all income currently: $300
      otherTrust: 100         // i1041 p.29: "A trust not described above is allowed a $100 exemption."
    },

    // Capital loss limit - f1041sd page 2, Part IV, line 20: the smaller of the loss or $3,000.
    capitalLossLimit: 3000,

    // Net Investment Income Tax - i1041 page 38: imposed "to the extent that they have
    // undistributed NII and AGI exceeding $15,650". This tool does not compute the NIIT;
    // the threshold is used only to flag a possible Form 8960 liability for the reviewer.
    niitThreshold: 15650
  };
})();
