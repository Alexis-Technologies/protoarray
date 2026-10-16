// Every behavioural suite runs once per backend: the two must be
// indistinguishable from the outside.
const BACKENDS = [
  ['codegen', { codegen: true }],
  ['closures', { codegen: false }],
];

// Dates, BigInts, bytes, Sets and Maps have no deepStrictEqual-friendly form;
// this turns them into tagged objects while keeping key order. A `__proto__`
// key stays an own property, as JSON.parse and decode make it.
const normalize = (value) => {
  if (value instanceof Date) return { $date: value.getTime() };
  if (value instanceof Uint8Array) return { $bytes: Array.from(value) };
  if (value instanceof Set) return { $set: Array.from(value, normalize) };
  if (value instanceof Map) {
    return { $map: Array.from(value, (entry) => [entry[0], normalize(entry[1])]) };
  }
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      const property = { value: normalize(value[key]), enumerable: true, writable: true };
      Object.defineProperty(out, key, { ...property, configurable: true });
    }
    return out;
  }
  return value;
};

module.exports = { BACKENDS, normalize };
