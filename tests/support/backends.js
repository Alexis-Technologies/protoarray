// Every behavioural suite runs once per backend: the two must be
// indistinguishable from the outside.
const BACKENDS = [
  ['codegen', { codegen: true }],
  ['closures', { codegen: false }],
];

// Dates and BigInts have no deepStrictEqual-friendly form; this turns them into
// tagged objects while keeping key order.
const normalize = (value) => {
  if (value instanceof Date) return { $date: value.getTime() };
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = normalize(value[key]);
    return out;
  }
  return value;
};

module.exports = { BACKENDS, normalize };
