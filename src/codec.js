// Placeholders until the protoarray format is designed: the package, its
// typings, tests, bundle checks and docs are wired end to end around these two
// names, and their signatures will change with the real API.

const notImplemented = (name) => {
  throw new Error(`${name} is not implemented yet`);
};

const encode = (schema, value) => notImplemented('encode');

const decode = (schema, array) => notImplemented('decode');

module.exports = { encode, decode };
