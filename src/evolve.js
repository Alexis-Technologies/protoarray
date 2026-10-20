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
const { PLAN, canonical, isSchema, referenced } = require('./plan.js');
const { isObject } = require('./snapshot.js');
const { Schema, SETTINGS, ENTITY, SAME } = require('./schema.js');

// The rules, by the problem they give, and how bad each one is. A retired
// slot is for information when it takes anything (`?any`) and a warning when
// it takes only null, which a validating decoder holds older writers to.
const RULES = Object.assign(Object.create(null), {
  inserted: 'error',
  moved: 'error',
  removed: 'error',
  renamed: 'info',
  required: 'error',
  retired: 'info',
  type: 'error',
  optional: 'info',
  appended: 'warning',
  wire: 'error',
  flat: 'error',
  default: 'warning',
});

const isJson = (node) => node.kind === 'scalar' && node.type === 'json';
const isNull = (node) => node.kind === 'scalar' && node.type === 'null';
// A list of differences is a scalar node over its item: a list all the same.
const isDeltas = (node) => node.kind === 'scalar' && node.type === 'deltas';
const isList = (node) => node.kind === 'array' || isDeltas(node);

// A key, a value or a name in a message: quoted, a number as it is.
const show = (value) => JSON.stringify(value);
const listed = (values) => {
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

// One slot of a struct, a tuple or a collection: its node, and whether it is
// required and what it defaults to where the field (or the root) says so.
const slotOf = (node, required, def) => ({ node, required, def });
const rootOf = (plan) => {
  const required = plan.kind === 'scalar' ? plan.required !== false : true;
  return slotOf(plan, required, null);
};

const comparePlans = (previousPlan, nextPlan) => {
  const problems = [];
  const report = (path, rule, message, previous, next, severity = RULES[rule]) => {
    const problem = { path, rule, severity, message };
    if (previous !== undefined) problem.previous = canonical(previous);
    if (next !== undefined) problem.next = canonical(next);
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
    slot(rootOf(p), rootOf(n), path);
  };

  const slot = (p, n, path) => {
    const from = p.node;
    const to = n.node;
    // A retired slot: what older writers sent is read as anything, or as null.
    if (isNull(to) && !isNull(from)) {
      const text = 'Retired as null: a validating decoder rejects the values older writers send';
      report(path, 'retired', text, from, to, 'warning');
      return;
    }
    if (isJson(to) && !isJson(from)) {
      report(
        path,
        'retired',
        'Retired as ?any: whatever older writers send is read as is',
        from,
        to,
      );
      return;
    }
    if (p.required && !n.required) report(path, 'optional', 'Optional now', from, to);
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
      if (p.kind !== n.kind) {
        report(path, 'type', `Type changed: ${bare(p)} → ${bare(n)}`, p, n);
        return;
      }
      if (p.name !== n.name) {
        report(path, 'renamed', `Entity ${show(p.name)} is now ${show(n.name)}`, p, n);
      }
      pair(p.slot.schema[PLAN], n.slot.schema[PLAN], path);
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
      slot(
        slotOf(p.value, p.valueRequired, null),
        slotOf(n.value, n.valueRequired, null),
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

  // The values of an enum, the names of flags: an index travels.
  const values = (previous, next, word, path, p, n) => {
    const rest = (i) => {
      const after = previous.slice(i + 1).filter((value) => next.includes(value));
      return after.length === 0 ? '' : `: ${moves(after, 'up')}`;
    };
    aligned(previous.map(show), next.map(show), {
      same: () => {},
      renamed: (i, j) => {
        report(path, 'renamed', `${word} ${show(previous[i])} is now ${show(next[j])}`, p, n);
      },
      removed: (i) => {
        report(path, 'removed', `${word} ${show(previous[i])} removed${rest(i)}`, p, n);
      },
      inserted: (i, j) => {
        const text = `${word} ${show(next[j])} inserted before ${show(previous[i])}, which moves`;
        report(path, 'inserted', text, p, n);
      },
      moved: (i, to) => {
        const text = `${word} ${show(previous[i])} moved from position ${i} to ${to}`;
        report(path, 'moved', text, p, n);
      },
      appended: (j) => {
        const text = `${word} ${show(next[j])} appended: deploy decoders before encoders`;
        report(path, 'appended', text, p, n);
      },
    });
  };

  const struct = (p, n, path) => {
    if (p.sparse !== n.sparse) wire(path, switched('sparse', n.sparse), p, n);
    const at = (field) => join(path, step(field.key));
    const previous = p.fields.map((field) => field.key);
    const next = n.fields.map((field) => field.key);
    // The fields from `i` on that keep a place in the next version: what an
    // insertion or a removal before them shifts.
    const shifted = (i) => previous.slice(i).filter((key) => next.includes(key));
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
      same: (i, j) => slot(p.fields[i], n.fields[j], at(n.fields[j])),
      renamed: (i, j) => {
        const text = `Field ${show(previous[i])} is now ${show(next[j])}`;
        report(at(n.fields[j]), 'renamed', text, p.fields[i].node, n.fields[j].node);
        slot(p.fields[i], n.fields[j], at(n.fields[j]));
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
      moved: (i, to) => {
        const text = `Field ${show(previous[i])} moved from position ${i} to ${to}`;
        report(at(p.fields[i]), 'moved', text, p.fields[i].node, n.fields[to].node);
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
    for (let i = 0; i < size; i++) slot(p.items[i], n.items[i], `${path}[${i}]`);
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
    slot(slotOf(p.item, p.itemRequired, null), slotOf(n.item, n.itemRequired, null), `${path}[]`);
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

const version = (schema) => {
  if (!isSchema(schema)) {
    throw new SchemaDefinitionError('ERR_SCHEMA_EXPECTED', 'Schema instance expected');
  }
  // A resolved schema reads one version as another: it is no version itself.
  if (schema[PLAN].text !== undefined) {
    const text = 'A resolved schema is no version to compare: give its writer or its reader';
    throw new SchemaDefinitionError('ERR_SCHEMA_EXPECTED', text);
  }
};

// Whether `next` reads what `previous` writes and writes what it reads, by
// position: `ok` when no problem is an error (with `strict`, a warning
// neither), and every problem with the rule it breaks, its severity, a path
// as the errors spell it, and the canonical forms of the two nodes.
const compatible = (previous, next, options) => {
  version(previous);
  version(next);
  const { strict } = readOptions(options);
  if (previous[SAME](next)) return { ok: true, problems: [] };
  let problems;
  try {
    problems = comparePlans(previous[PLAN], next[PLAN]);
  } catch (error) {
    // Two versions are walked together, a chain of references included: one
    // too long for the stack cannot be compared, which is no RangeError.
    if (!overflowed(error)) throw error;
    const message = 'The schemas are nested too deeply to compare';
    throw new SchemaDefinitionError('ERR_INCOMPATIBLE', message, next.name, '', error);
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
    entities[name] = wireOptions(entity[SETTINGS]);
  }
  out.entities = entities;
  return out;
};

const expected = (text) => new SchemaDefinitionError('ERR_SCHEMA_EXPECTED', text);

// The schemas given, by name, as JSON: each one's snapshot (written once,
// however many schemas share it), the entity it is of, the options that
// shape its wire, and its canonical form and id as checksums.
const baseline = (schemas) => {
  if (!isObject(schemas)) throw expected('A record of schemas by name expected');
  const snapshots = [];
  const indexes = new Map();
  const out = { format: 1, snapshots, schemas: {} };
  for (const name of Object.keys(schemas)) {
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
    out.schemas[name] = {
      snapshot: index,
      entity: schema[ENTITY],
      options: optionsOf(schema),
      canonical: schema.toString(),
      id: schema.id,
    };
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
  typeof entry.id === 'string';

// The options as the schema takes them again: a fingerprint written as null
// (a function of the caller's own) is left out, so the default one applies.
const carried = (options) => {
  const out = { ...options };
  if (out.fingerprint === null) delete out.fingerprint;
  return out;
};

// The schemas of a baseline, built again from its snapshots and checked
// against the canonical form each one was written with, and against its id
// unless a fingerprint of the caller's own computed it.
const restore = (source) => {
  if (
    !isObject(source) ||
    source.format !== 1 ||
    !Array.isArray(source.snapshots) ||
    !isObject(source.schemas)
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
    const options = carried(entry.options);
    if (isObject(options.entities)) {
      const entities = {};
      for (const key of Object.keys(options.entities)) {
        entities[key] = carried(options.entities[key]);
      }
      options.entities = entities;
    }
    const schema = new Schema(name, snapshot, { ...options, entity: entry.entity });
    // The id is checked where the baseline says how it was computed: by a
    // built-in fingerprint, or by the default one when it names none.
    const checked = entry.options.fingerprint === null || schema.id === entry.id;
    if (schema.toString() !== entry.canonical || !checked) {
      throw broken('The baseline does not rebuild to its canonical form: write it again', name);
    }
    out[name] = schema;
  }
  return out;
};

let registered = false;

// Installs `Schema.compatible`, non-enumerable, once.
const register = () => {
  if (registered) return;
  registered = true;
  Object.defineProperty(Schema, 'compatible', {
    value: compatible,
    writable: true,
    configurable: true,
  });
};

module.exports = { compatible, baseline, restore, register };
