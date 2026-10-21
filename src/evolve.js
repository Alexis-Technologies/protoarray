// Schema.compatible: whether a newer version of a schema keeps the wire of an
// older one, by the rules of the evolution guide. A position is the contract,
// so the two plans are walked together position by position, and every place
// where the newer version reads an older payload differently is a problem,
// named after the rule it breaks: what breaks the wire is an error, what older
// peers survive but a deployment must mind is a warning, what changes nothing
// on the wire is for information. A baseline writes the schemas of a module
// as JSON (their snapshots and the options that shape their wire), and
// `restore` builds them again, so a CI job compares the schemas of today with
// the ones that shipped.
//
// The `@alexify/protoarray/evolve` subpath: a tool for development and CI,
// kept out of the core and apart from `./resolve`, which reads one version as
// another at runtime, by name. `register()` installs `Schema.compatible`.

const { SchemaDefinitionError, overflowed, join, step } = require('./errors.js');
const { PLAN, canonical, isSchema, isJson, isNull, isResolved, referenced } = require('./plan.js');
const { put } = require('./types.js');
const { isObject } = require('./snapshot.js');
const { Schema, SETTINGS, ENTITY, SAME, SIGNATURE, registrar } = require('./schema.js');
const { VERSION } = require('./version.js');

// The rules, by the problem they give, and how bad each one is. A slot that
// becomes optional, or retired, is a warning: the newer version may write a
// null (or anything) where an older validating reader holds the slot to its
// type, so readers deploy before writers, as for a value appended to an enum.
const RULES = Object.assign(Object.create(null), {
  inserted: 'error',
  moved: 'error',
  removed: 'error',
  renamed: 'info',
  required: 'error',
  retired: 'warning',
  type: 'error',
  optional: 'warning',
  appended: 'warning',
  wire: 'error',
  flat: 'error',
  default: 'warning',
  fingerprint: 'info',
});

// A list of differences is a scalar node over its item: a list all the same.
const isDeltas = (node) => node.kind === 'scalar' && node.type === 'deltas';
const isList = (node) => node.kind === 'array' || isDeltas(node);

// A key, a value or a name in a message: quoted, a number as it is. A list of
// them names the first few and counts the rest, so a message stays a line
// however wide the record or the enum.
const MOST = 5;
const show = (value) => JSON.stringify(value);
const listed = (values) => {
  if (values.length > MOST) {
    return `${values.slice(0, MOST).map(show).join(', ')} and ${values.length - MOST} more`;
  }
  const quoted = values.map(show);
  if (quoted.length < 2) return quoted.join('');
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
};
// `"a" moves up`, `"a" and "b" move further`.
const moves = (values, where) => `${listed(values)} move${values.length === 1 ? 's' : ''} ${where}`;

// The type of a node as the rules compare it: its canonical form without the
// markers of its wire (`*` interned, `~` differences), which the `wire` rule
// reports apart.
const bare = (node) => canonical(node).replace(/[*~]$/, '');

// Two lists of names (keys, enum values, flag names, a union's values)
// walked together. The same name at both cursors is one place; a name the
// other side lacks at the same place is a rename when it is nowhere else,
// otherwise the side it is on tells an insertion from a removal, and a name
// both sides have elsewhere moved: of the two at the cursors, the one further
// from its own place (the older one when they are as far), which the walk
// then skips where it stands on the other side. After an insertion or a
// removal the walk realigns on the names that follow, so one change is one
// problem. The heuristic is conservative: a key that shifts for a reason it
// cannot name is an error, never a rename.
const aligned = (previous, next, hooks) => {
  const inPrevious = new Map();
  const inNext = new Map();
  previous.forEach((name, i) => inPrevious.set(name, i));
  next.forEach((name, i) => inNext.set(name, i));
  const skipped = new Set();
  let i = 0;
  let j = 0;
  while (i < previous.length && j < next.length) {
    if (skipped.has(previous[i])) {
      i++;
      continue;
    }
    if (skipped.has(next[j])) {
      j++;
      continue;
    }
    if (previous[i] === next[j]) {
      hooks.same(i, j);
      i++;
      j++;
      continue;
    }
    const to = inNext.get(previous[i]);
    const from = inPrevious.get(next[j]);
    if (to === undefined && from === undefined) {
      hooks.renamed(i, j);
      i++;
      j++;
    } else if (to === undefined) {
      hooks.removed(i);
      i++;
    } else if (from === undefined) {
      hooks.inserted(i, j);
      j++;
    } else if (Math.abs(to - i) >= Math.abs(from - j)) {
      hooks.moved(i, to);
      skipped.add(previous[i]);
      i++;
    } else {
      hooks.moved(from, j);
      skipped.add(next[j]);
      j++;
    }
  }
  for (; i < previous.length; i++) if (!skipped.has(previous[i])) hooks.removed(i);
  for (; j < next.length; j++) if (!skipped.has(next[j])) hooks.appended(j);
};

// One place of a struct, a tuple or a collection: its node, and whether it is
// required and what it defaults to where the field (or the root) says so.
const placeOf = (node, required, def) => ({ node, required, def });
const rootOf = (plan) => {
  const required = plan.kind === 'scalar' ? plan.required !== false : true;
  return placeOf(plan, required, null);
};

// The plan a reference reaches, or the node itself.
const targetOf = (node) => (node.kind === 'ref' ? node.slot.schema[PLAN] : node);

const comparePlans = (previousPlan, nextPlan) => {
  const problems = [];
  // The canonical form of a node, printed once however many problems name it.
  const forms = new Map();
  const formOf = (node) => {
    let form = forms.get(node);
    if (form === undefined) {
      form = canonical(node);
      forms.set(node, form);
    }
    return form;
  };
  const report = (path, rule, message, previous, next) => {
    const problem = { path, rule, severity: RULES[rule], message };
    if (previous !== undefined) problem.previous = formOf(previous);
    if (next !== undefined) problem.next = formOf(next);
    problems.push(problem);
  };

  // A schema reached by reference compares once per pair of plans: a pair met
  // again, on a recursion or from another field, has been compared.
  const pairs = new Map();
  const pair = (p, n, path) => {
    let byNext = pairs.get(p);
    if (byNext === undefined) pairs.set(p, (byNext = new Set()));
    if (byNext.has(n)) return;
    byNext.add(n);
    place(rootOf(p), rootOf(n), path);
  };

  const place = (p, n, path) => {
    const from = p.node;
    const to = n.node;
    // A retired slot: what older writers sent is read as anything, or as null.
    if (isNull(to) && !isNull(from)) {
      const text = 'Retired as null: a validating decoder rejects the values older writers send';
      report(path, 'retired', text, from, to);
      return;
    }
    if (isJson(to) && !isJson(from)) {
      const text =
        'Retired as ?any: whatever older writers send is read as is, and older validating ' +
        'readers hold the slot to its type; deploy readers before writers';
      report(path, 'retired', text, from, to);
      return;
    }
    if (p.required && !n.required) {
      const text =
        'Optional now: older validating readers refuse the null this version may write; ' +
        'deploy readers before writers';
      report(path, 'optional', text, from, to);
    }
    if (!p.required && n.required) {
      report(path, 'required', 'Required now, where older payloads may send null', from, to);
    }
    if (p.def !== n.def) {
      const text =
        p.def === null
          ? `Default added (${show(n.def)}): an empty slot in older payloads decodes as it`
          : n.def === null
            ? `Default removed (${show(p.def)}): an empty slot in older payloads decodes as null`
            : `Default changed from ${show(p.def)} to ${show(n.def)}: an empty slot in older ` +
              'payloads decodes differently';
      report(path, 'default', text, from, to);
    }
    node(from, to, path);
  };

  const node = (p, n, path) => {
    if (p.kind === 'ref' || n.kind === 'ref') {
      if (p.kind === n.kind) {
        if (p.name !== n.name) {
          report(path, 'renamed', `Entity ${show(p.name)} is now ${show(n.name)}`, p, n);
        }
        pair(p.slot.schema[PLAN], n.slot.schema[PLAN], path);
        return;
      }
      // A record written in place in one version and reached by a reference
      // in the other has the same wire: the referenced schema's own form, in
      // place. The two are compared as what they are; anything else is a
      // change of type.
      const from = targetOf(p);
      const to = targetOf(n);
      if (from.kind !== to.kind) {
        report(path, 'type', `Type changed: ${bare(p)} → ${bare(n)}`, p, n);
        return;
      }
      const text =
        n.kind === 'ref'
          ? `A reference to ${show(n.name)} now, written in place before`
          : `Written in place now, a reference to ${show(p.name)} before`;
      report(path, 'renamed', text, p, n);
      node(from, to, path);
      return;
    }
    if (isList(p) && isList(n)) {
      list(p, n, path);
      return;
    }
    if (
      p.kind !== n.kind ||
      (p.kind === 'scalar' && (p.type !== n.type || p.decimals !== n.decimals))
    ) {
      report(path, 'type', `Type changed: ${bare(p)} → ${bare(n)}`, p, n);
      return;
    }
    if (p.kind === 'scalar') scalar(p, n, path);
    else if (p.kind === 'struct') struct(p, n, path);
    else if (p.kind === 'union') union(p, n, path);
    else if (p.kind === 'tuple') tuple(p, n, path);
    else {
      // A map or a dictionary: the value, under a key of the same type.
      if (p.kind === 'map' && p.key.type !== n.key.type) {
        report(path, 'type', `Type changed: ${bare(p)} → ${bare(n)}`, p, n);
        return;
      }
      place(
        placeOf(p.value, p.valueRequired, null),
        placeOf(n.value, n.valueRequired, null),
        `${path}{}`,
      );
    }
  };

  const wire = (path, what, p, n) => report(path, 'wire', `The wire changed: ${what}`, p, n);
  const switched = (name, on) => `${name} switched ${on ? 'on' : 'off'}`;

  const scalar = (p, n, path) => {
    if (p.type === 'enum') values(p.values, n.values, 'Enum value', path, p, n);
    if (p.type === 'flags') values(p.names, n.names, 'Flag', path, p, n);
    const interned = (p.intern === true) !== (n.intern === true);
    const delta = (p.delta === true) !== (n.delta === true);
    if (interned) wire(path, switched('intern', n.intern === true), p, n);
    if (delta) wire(path, switched('delta', n.delta === true), p, n);
  };

  // The values of an enum, the names of flags: an index travels. The two
  // nodes print with the first problem of the place only: every problem of a
  // wide enum would otherwise carry the whole enum.
  const values = (previous, next, word, path, p, n) => {
    const kept = new Set(next);
    const rest = (i) => {
      const after = previous.slice(i + 1).filter((value) => kept.has(value));
      return after.length === 0 ? '' : `: ${moves(after, 'up')}`;
    };
    let described = false;
    const once = (text, rule) => {
      report(path, rule, text, described ? undefined : p, described ? undefined : n);
      described = true;
    };
    aligned(previous.map(show), next.map(show), {
      same: () => {},
      renamed: (i, j) => once(`${word} ${show(previous[i])} is now ${show(next[j])}`, 'renamed'),
      removed: (i) => once(`${word} ${show(previous[i])} removed${rest(i)}`, 'removed'),
      inserted: (i, j) => {
        const text = `${word} ${show(next[j])} inserted before ${show(previous[i])}, which moves`;
        once(text, 'inserted');
      },
      moved: (i, to) => {
        once(`${word} ${show(previous[i])} moved from position ${i} to ${to}`, 'moved');
      },
      appended: (j) => {
        once(`${word} ${show(next[j])} appended: deploy decoders before encoders`, 'appended');
      },
    });
  };

  const struct = (p, n, path) => {
    if (p.sparse !== n.sparse) wire(path, switched('sparse', n.sparse), p, n);
    const at = (field) => join(path, step(field.key));
    const previous = p.fields.map((field) => field.key);
    const next = n.fields.map((field) => field.key);
    const kept = new Set(next);
    // The fields from `i` on that keep a place in the next version: what an
    // insertion or a removal before them shifts.
    const shifted = (i) => previous.slice(i).filter((key) => kept.has(key));
    // Rule 8: a stored kind's id, appended by metaschema after the fields of
    // the definition, moves when a field is appended to the definition.
    const hint = (keys) => {
      const last = p.fields[p.fields.length - 1];
      const id = /Id$/.test(last.key) && !last.required && last.node.type === 'string';
      return id && keys.includes(last.key)
        ? ` (rule 8: declare ${show(last.key)} in the definition and append after it)`
        : '';
    };
    aligned(previous, next, {
      same: (i, j) => place(p.fields[i], n.fields[j], at(n.fields[j])),
      renamed: (i, j) => {
        const text = `Field ${show(previous[i])} is now ${show(next[j])}`;
        report(at(n.fields[j]), 'renamed', text, p.fields[i].node, n.fields[j].node);
        place(p.fields[i], n.fields[j], at(n.fields[j]));
      },
      removed: (i) => {
        const keys = shifted(i + 1);
        const text =
          `Field ${show(previous[i])} removed from position ${i}` +
          (keys.length === 0 ? '' : `: ${moves(keys, 'up')}`) +
          '; keep the slot of a retired field, as ?any';
        report(at(p.fields[i]), 'removed', text, p.fields[i].node);
      },
      inserted: (i, j) => {
        const keys = shifted(i);
        const text =
          `Field ${show(next[j])} inserted at position ${j}: ${moves(keys, 'further')}` +
          hint(keys);
        report(at(n.fields[j]), 'inserted', text, undefined, n.fields[j].node);
      },
      // A field that moved is compared where it stands now: what changed
      // inside it is reported too.
      moved: (i, to) => {
        const text = `Field ${show(previous[i])} moved from position ${i} to ${to}`;
        report(at(p.fields[i]), 'moved', text, p.fields[i].node, n.fields[to].node);
        place(p.fields[i], n.fields[to], at(n.fields[to]));
      },
      appended: (j) => {
        if (!n.fields[j].required) return;
        const text = `Field ${show(next[j])} appended as required without a default: older payloads do not have it`;
        report(at(n.fields[j]), 'required', text, undefined, n.fields[j].node);
      },
    });
  };

  // The tags of a union are the indexes of the values of all its branches,
  // in order: the values compare as an enum's, then each branch of the older
  // version with every branch of the newer one that holds a value of it.
  const union = (p, n, path) => {
    if (p.key !== n.key) {
      const text = `The union discriminates on ${show(n.key)} instead of ${show(p.key)}`;
      report(path, 'type', text, p, n);
      return;
    }
    values(p.values, n.values, 'Union value', path, p, n);
    const owners = new Map();
    n.branches.forEach((branch, b) => {
      for (let i = 0; i < branch.count; i++) owners.set(show(n.values[branch.first + i]), b);
    });
    for (const branch of p.branches) {
      const targets = new Set();
      for (let i = 0; i < branch.count; i++) {
        const b = owners.get(show(p.values[branch.first + i]));
        if (b !== undefined) targets.add(b);
      }
      for (const b of targets) struct(branch.node, n.branches[b].node, `${path}[${b}]`);
    }
  };

  const tuple = (p, n, path) => {
    const size = Math.min(p.items.length, n.items.length);
    for (let i = 0; i < size; i++) place(p.items[i], n.items[i], `${path}[${i}]`);
    for (let i = size; i < p.items.length; i++) {
      report(`${path}[${i}]`, 'removed', `Element ${i} removed`, p.items[i].node);
    }
    for (let i = size; i < n.items.length; i++) {
      if (!n.items[i].required) continue;
      const text = 'Element appended as required without a default: older payloads do not have it';
      report(`${path}[${i}]`, 'required', text, undefined, n.items[i].node);
    }
  };

  // An array, a Set, a list of differences: the item, under the same layout.
  const list = (p, n, path) => {
    if (isDeltas(p) !== isDeltas(n)) wire(path, switched('delta', isDeltas(n)), p, n);
    else if (p.container !== n.container) {
      report(path, 'type', `Type changed: ${bare(p)} → ${bare(n)}`, p, n);
      return;
    } else {
      if (p.layout !== n.layout) wire(path, `layout ${p.layout} → ${n.layout}`, p, n);
      else if (p.layout === 'flat' && p.item.fields.length !== n.item.fields.length) {
        const text =
          `A flat record has ${n.item.fields.length} fields instead of ` +
          `${p.item.fields.length}: the stride of the collection changed`;
        report(path, 'flat', text, p, n);
      }
    }
    place(
      placeOf(p.item, p.itemRequired, null),
      placeOf(n.item, n.itemRequired, null),
      `${path}[]`,
    );
  };

  pair(previousPlan, nextPlan, '');
  return problems;
};

const readOptions = (options) => {
  const invalid = (text) => new SchemaDefinitionError('ERR_INVALID_OPTIONS', text);
  if (options == null) return { strict: false };
  if (typeof options !== 'object') throw invalid('Invalid options: expected an object');
  for (const key of Object.keys(options)) {
    if (key !== 'strict') throw invalid(`Invalid option "${key}"`);
  }
  if (options.strict !== undefined && typeof options.strict !== 'boolean') {
    throw invalid('Invalid option "strict"');
  }
  return { strict: options.strict === true };
};

const expectVersion = (schema) => {
  if (!isSchema(schema)) {
    throw new SchemaDefinitionError('ERR_SCHEMA_EXPECTED', 'Schema instance expected');
  }
  // A resolved schema reads one version as another: it is no version itself.
  if (isResolved(schema)) {
    const text = 'A resolved schema is no version to compare: give its writer or its reader';
    throw new SchemaDefinitionError('ERR_SCHEMA_EXPECTED', text);
  }
};

// The fingerprint of a schema, as a message names it.
const hashOf = (schema) => {
  const { fingerprint } = schema[SETTINGS];
  return typeof fingerprint === 'string' ? fingerprint : 'a function of its own';
};

// Whether `next` reads what `previous` writes and writes what it reads, by
// position: `ok` when no problem is an error (with `strict`, a warning
// neither), and every problem with the rule it breaks, its severity, a path
// as the errors spell it, and the canonical forms of the two nodes. Two
// versions hashed with different fingerprints are told apart: their ids are
// not comparable, which a handshake must know.
const compatible = (previous, next, options) => {
  expectVersion(previous);
  expectVersion(next);
  const { strict } = readOptions(options);
  let problems = [];
  if (!previous[SAME](next)) {
    try {
      problems = comparePlans(previous[PLAN], next[PLAN]);
    } catch (error) {
      // Two versions are walked together, a chain of references included: one
      // too long for the stack cannot be compared, which is no RangeError.
      if (!overflowed(error)) throw error;
      const message = 'The schemas are nested too deeply to compare';
      throw new SchemaDefinitionError('ERR_INCOMPATIBLE', message, next.name, '', error);
    }
  }
  if (previous[SETTINGS].fingerprint !== next[SETTINGS].fingerprint) {
    const text =
      `The id is computed with ${hashOf(next)} instead of ${hashOf(previous)}: ` +
      'the ids of the two versions are not comparable';
    problems.unshift({ path: '', rule: 'fingerprint', severity: RULES.fingerprint, message: text });
  }
  const worst = strict ? /^(error|warning)$/ : /^error$/;
  const ok = !problems.some((problem) => worst.test(problem.severity));
  return { ok, problems };
};

// The options that shape the wire and the canonical form, which a baseline
// carries: the ones that shape the codec (`codegen`, `validate`,
// `stringify`, `maxDepth`) change neither.
const WIRE = ['sparse', 'layout', 'intern', 'delta', 'references', 'types'];

// The fingerprint as a baseline carries it: a built-in one by its name (the
// default `fnv1a32` too, so a baseline says how its ids were computed), and a
// function of your own, which cannot travel in JSON, as null, so the id is
// recorded and not checked.
const named = (settings) =>
  typeof settings.fingerprint === 'string' ? settings.fingerprint : null;

const wireOptions = (settings) => {
  const out = {};
  for (const key of WIRE) out[key] = settings[key];
  out.fingerprint = named(settings);
  return out;
};

const optionsOf = (schema) => {
  const out = wireOptions(schema[SETTINGS]);
  // The entities the schema reaches keep the options they were built with,
  // which its id depends on.
  const entities = {};
  for (const [name, entity] of referenced(schema[PLAN], [schema])) {
    put(entities, name, wireOptions(entity[SETTINGS]));
  }
  out.entities = entities;
  return out;
};

const expected = (text) => new SchemaDefinitionError('ERR_SCHEMA_EXPECTED', text);

// The schemas given, by name, as JSON: each one's snapshot (written once,
// however many schemas share it), the entity it is of, the options that
// shape its wire, and its canonical form, its signature (the canonical forms
// of the entities it reaches, by name) and its id as checksums. The names are
// sorted and the snapshots follow them, so the file changes only when a
// schema does, not when the module's exports are reordered.
const baseline = (schemas) => {
  if (!isObject(schemas)) throw expected('A record of schemas by name expected');
  const snapshots = [];
  const indexes = new Map();
  const out = { format: 1, generator: `@alexify/protoarray@${VERSION}`, snapshots, schemas: {} };
  for (const name of Object.keys(schemas).sort()) {
    const schema = schemas[name];
    if (!isSchema(schema)) throw expected(`${show(name)} is not a Schema`);
    if (schema.snapshot === null) {
      throw expected(`${show(name)} was not read from a snapshot: give a schema of its own`);
    }
    let index = indexes.get(schema.snapshot);
    if (index === undefined) {
      index = snapshots.length;
      indexes.set(schema.snapshot, index);
      snapshots.push(schema.snapshot);
    }
    put(out.schemas, name, {
      snapshot: index,
      entity: schema[ENTITY],
      options: optionsOf(schema),
      canonical: schema.toString(),
      signature: schema[SIGNATURE],
      id: schema.id,
    });
  }
  return out;
};

const broken = (text, name) => new SchemaDefinitionError('ERR_INVALID_SNAPSHOT', text, name);

const isEntry = (entry) =>
  isObject(entry) &&
  Number.isInteger(entry.snapshot) &&
  typeof entry.entity === 'string' &&
  isObject(entry.options) &&
  (entry.options.fingerprint == null || typeof entry.options.fingerprint === 'string') &&
  typeof entry.canonical === 'string' &&
  typeof entry.signature === 'string' &&
  typeof entry.id === 'string';

// The options as the schema takes them again: the ones of the wire and the
// fingerprint, which is all a baseline carries (`wireOptions`); anything else
// is no option of a baseline, however the schema would take it. A fingerprint
// written as null (a function of the caller's own) is left out, so the
// default one applies.
const CARRIED = new Set([...WIRE, 'fingerprint']);

const carried = (options, name, inner) => {
  const out = Object.create(null);
  for (const key of Object.keys(options)) {
    // The entities of the root entry are read apart (below).
    if (key === 'entities' && !inner) continue;
    if (!CARRIED.has(key)) {
      const text = `The entry ${show(name)} carries an option that is not of the wire: ${show(key)}`;
      throw broken(text, name);
    }
    if (key === 'fingerprint' && options[key] === null) continue;
    out[key] = options[key];
  }
  return out;
};

// A form cut to a line, for a message.
const CUT = 120;
const shown = (text) => (text.length > CUT ? `${text.slice(0, CUT)}…` : text);

// The schemas of a baseline, built again from its snapshots and checked
// against the canonical form, the signature and (unless a fingerprint of the
// caller's own computed it) the id each one was written with.
const restore = (source) => {
  if (
    !isObject(source) ||
    source.format !== 1 ||
    !Array.isArray(source.snapshots) ||
    !isObject(source.schemas) ||
    (source.generator !== undefined && typeof source.generator !== 'string')
  ) {
    throw broken('A baseline of format 1 with snapshots and schemas expected');
  }
  const out = Object.create(null);
  for (const name of Object.keys(source.schemas)) {
    const entry = source.schemas[name];
    if (!isEntry(entry)) {
      throw broken(`The entry ${show(name)} of the baseline is incomplete`, name);
    }
    const snapshot = source.snapshots[entry.snapshot];
    if (snapshot === undefined) {
      throw broken(`The entry ${show(name)} names no snapshot of the baseline`, name);
    }
    if (!isObject(snapshot)) {
      throw broken(`The snapshot ${entry.snapshot} of the baseline is not an object`, name);
    }
    const options = carried(entry.options, name, false);
    if (entry.options.entities !== undefined) {
      if (!isObject(entry.options.entities)) {
        throw broken(`The entry ${show(name)} carries entities that are not a record`, name);
      }
      const entities = Object.create(null);
      for (const key of Object.keys(entry.options.entities)) {
        if (key === '__proto__') {
          throw broken(`The entry ${show(name)} carries an entity named "__proto__"`, name);
        }
        if (!isObject(entry.options.entities[key])) {
          throw broken(
            `The entry ${show(name)} carries no options for the entity ${show(key)}`,
            name,
          );
        }
        entities[key] = carried(entry.options.entities[key], name, true);
      }
      options.entities = entities;
    }
    // Each entry builds its own assembly: the entities of one Model are built
    // once per entry that is of it, which stays cheap (thirty entries of a
    // Model of thirty entities restore in about 12 ms).
    const schema = new Schema(name, snapshot, { ...options, entity: entry.entity });
    // What differs is named with both values: a baseline that another version
    // of protoarray wrote, or one edited by hand, should be told from a
    // schema that changed, before anyone writes the baseline again.
    const differs = (what, written, now) =>
      broken(
        `The entry ${show(name)} rebuilds to another ${what} than it was written with ` +
          `(written: ${shown(written)}, now: ${shown(now)}): another version of protoarray wrote ` +
          'the baseline, or it was edited; compare the versions before writing it again',
        name,
      );
    if (schema.toString() !== entry.canonical) {
      throw differs('canonical form', entry.canonical, schema.toString());
    }
    if (schema[SIGNATURE] !== entry.signature) {
      throw differs('signature', entry.signature, schema[SIGNATURE]);
    }
    if (entry.options.fingerprint !== null && schema.id !== entry.id) {
      throw differs('id', entry.id, schema.id);
    }
    out[name] = schema;
  }
  return out;
};

// Installs `Schema.compatible`, non-enumerable, once.
const register = registrar(Schema, { compatible });

module.exports = { compatible, baseline, restore, register };
// The rules, for the tests that hold the typings and the guide to them; not
// part of the public surface.
Object.defineProperty(module.exports, 'RULES', { value: RULES });
