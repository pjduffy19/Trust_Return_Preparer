/* Tax constants for tax year 2025 (Form 1041).
 *
 * Milestone 4 fills this file. Every value must be taken from the IRS PDFs in
 * /sources and carry a comment citing the page of the 2025 Instructions for
 * Form 1041 it came from. No values from memory.
 */
(function () {
  'use strict';
  var TRP = (window.TRP = window.TRP || {});
  TRP.constants2025 = {
    taxYear: 2025,
    // TODO(milestone 4): trust tax rate schedule, with page citation
    rateSchedule: null,
    // TODO(milestone 4): capital gain rate breakpoints, with page citation
    capitalGainBreakpoints: null,
    // TODO(milestone 4): exemption amounts by trust type, with page citation
    exemptions: null,
    // TODO(milestone 4): Net Investment Income Tax threshold, with page citation
    niitThreshold: null
  };
})();
