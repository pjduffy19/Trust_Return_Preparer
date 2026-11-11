/* Document reading: pdf.js text-layer parsing and routing (Milestone 3). */
(function () {
  'use strict';
  var TRP = (window.TRP = window.TRP || {});
  TRP.extract = {
    ready: false,
    ACCEPTED_TYPES: ['application/pdf', 'image/png', 'image/jpeg'],
    isAccepted: function (file) {
      if (TRP.extract.ACCEPTED_TYPES.indexOf(file.type) !== -1) return true;
      return /\.(pdf|png|jpe?g)$/i.test(file.name || '');
    }
  };
})();
