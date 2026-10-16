// The generator's shapes (generate.js) in metaschema's spelling: the same
// definition with the wire options taken out of it (`delta` and `intern` on a
// field), as the options by path protoarray takes them.
const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const at = (path, key) => (path === '' ? key : `${path}.${key}`);

const COLLECTIONS = /^(array|set|map|object)$/;

// A named tuple element: `{ x: 'number' }`, `{ 'z?': 'integer' }`.
const isNamed = (element) => {
  const keys = isPlain(element) ? Object.keys(element) : [];
  return keys.length === 1 && typeof element[keys[0]] === 'string';
};

const translate = (shape) => {
  const delta = [];
  const intern = [];

  const field = (source, path) => {
    if (typeof source === 'string') return source;
    if (Array.isArray(source)) {
      return source.map((element, i) =>
        isNamed(element) ? element : field(element, `${path}[${i}]`),
      );
    }
    const { delta: differences, intern: interned, ...rest } = source;
    if (differences === true) delta.push(path);
    if (interned === true) intern.push(path);
    const first = Object.keys(rest)[0];
    if (COLLECTIONS.test(first)) {
      if (first === 'array' || first === 'set') {
        return { ...rest, [first]: field(rest[first], `${path}[]`) };
      }
      const key = Object.keys(rest[first])[0];
      return { ...rest, [first]: { [key]: field(rest[first][key], `${path}{}`) } };
    }
    if (first === 'union') {
      return { ...rest, union: rest.union.map((branch, i) => field(branch, `${path}[${i}]`)) };
    }
    if (first === 'type' || first === 'enum' || first === 'flags') return rest;
    const out = {};
    for (const key of Object.keys(rest)) {
      const name = key.endsWith('?') ? key.slice(0, -1) : key;
      out[key] = field(rest[key], at(path, name));
    }
    return out;
  };

  const definition = field(shape, '');
  const options = {};
  if (delta.length > 0) options.delta = delta;
  if (intern.length > 0) options.intern = intern;
  return { definition, options };
};

module.exports = { translate };
