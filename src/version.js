// The version of this package, for what it writes into files of its own (the
// `generator` of a baseline): the release bumps it with package.json, and a
// test holds the two together. A constant rather than package.json itself,
// which a bundler would inline whole into the subpath that reads it.
const VERSION = '2.1.0';

module.exports = { VERSION };
