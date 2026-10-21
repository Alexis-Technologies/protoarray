// A reader version of a generated definition, for the resolved-schema parity
// suites (parity.test.js on the text wire, binary.test.js on the binary one):
// fields renamed (through the `aliases` option), dropped when optional,
// shuffled, and a new optional one.
const mutate = (definition, random) => {
  const reader = [];
  const aliases = {};
  const renamed = {};
  for (const rawKey of Object.keys(definition)) {
    const key = rawKey.replace('?', '');
    const optional = rawKey !== key || String(definition[rawKey]).startsWith('?');
    const roll = random();
    if (roll < 0.15 && optional) continue;
    const name = roll < 0.4 ? `${key}_renamed` : key;
    if (name !== key) aliases[name] = key;
    renamed[name] = key;
    reader.push([rawKey === key ? name : `${name}?`, definition[rawKey]]);
  }
  for (let i = reader.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [reader[i], reader[j]] = [reader[j], reader[i]];
  }
  reader.push(['added?', 'string']);
  return { reader: Object.fromEntries(reader), aliases, renamed };
};

// The writer's options by path for the reader: under the reader's names,
// without the fields it dropped.
const rename = (options, renamed) => {
  const names = new Map(Object.keys(renamed).map((name) => [renamed[name], name]));
  const out = {};
  for (const key of Object.keys(options)) {
    out[key] = [];
    for (const path of options[key]) {
      const top = /^[^.[{]+/.exec(path)[0];
      if (names.has(top)) out[key].push(names.get(top) + path.slice(top.length));
    }
  }
  return out;
};

module.exports = { mutate, rename };
