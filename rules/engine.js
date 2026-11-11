/* Deterministic rules engine (Milestone 4).
 * All tax math lives here. The AI never calculates a number on the return.
 */
(function () {
  'use strict';
  var TRP = (window.TRP = window.TRP || {});
  TRP.engine = {
    ready: false,
    compute: function () {
      throw new Error('Rules engine is not built yet (Milestone 4).');
    }
  };
})();
