// Runs the rules-engine test cases from the command line:  node tests/run.js
global.window = {};
['../rules/constants_2025.js', '../rules/engine.js', './cases.js'].forEach(function (f) { require(f); });
var failed = 0, total = 0;
window.TRP.runTests().forEach(function (c) {
  console.log('\n' + c.id + ': ' + c.title);
  c.rows.forEach(function (r) {
    total++; if (!r.pass) failed++;
    console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.label + ': expected ' + r.expected + ', got ' + r.actual);
  });
});
console.log('\n' + (total - failed) + ' of ' + total + ' checks passed');
process.exit(failed ? 1 : 0);
