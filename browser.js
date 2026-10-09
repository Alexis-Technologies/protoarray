// Intentionally mirrors index.js: bundlers resolve this file through the
// package.json `browser` field and `exports` condition, so a browser-only
// runtime module can be mapped in later without changing the entry. Do not
// deduplicate.
module.exports = require('./src/index.js');
