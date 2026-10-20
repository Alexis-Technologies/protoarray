// The generated backend of the binary wire: every struct of the plan becomes
// one write function and one read function, compiled through codegen.js's
// `compile` (the one place source text becomes a function), as codegen.js
// compiles the text wire. The source has the same shape: one `eN(w,o)` and
// one `dN(r)` per struct, a decoded record built as one object literal, a
// union as a switch over its tag, a referenced schema called through a slot.
// `H` holds the helpers (type nodes and slots), `F` throws a DecodeError, `E`
// an EncodeError and `N` re-throws one with a key or an index prepended. A
// `path` below is a source expression that is only evaluated on an error
// branch. The closures backend (./closures.js) writes and reads the same
// bytes and is the reference this one is checked against.
//
// The wire (see docs/guide/wire-format.md), little-endian: a struct is a
// header bitset (a presence bit per field, required ones too, then the value
// of every boolean field) in whole bytes, and its present fields in
// declaration order; a union its tag (a byte up to 256 values, a varint past
// them) and the branch's struct without the discriminator; a collection its
// count, a presence bitmap when its items may be null, and its items; a map
// its entries (key, a presence byte when a value may be null, value); a
// dictionary its keys and values; a tuple a bitmap and its elements. A
// `number` is a float64; an integer, a date (ms) and a scaled decimal are
// zigzag varints; an enum index a byte (a varint past 256 values); a flags
// mask a varint per 31 names; a boolean outside a struct a byte; a string its
// bytes behind its length (wire.js); bytes behind their length; a bigint its
// decimal digits as a string; json its text as a string; null nothing.
//
// Decode checks the structure of the wire in every mode, as the text wire
// checks its arrays: the bounds of every read (a truncated message is a
// DecodeError), that a count fits the bytes left, a bitmap and a string their
// length, a presence byte and a union's tag their values, and that the text
// of a json or a bigint slot parses. Behind `validate` it checks the values:
// the range of an enum index, a date, a boolean, an integer within the safe
// range, the words of a flags mask, a required field's presence. Encode
// trusts its values and checks only the shapes the wire is built from, as the
// text wire does, which here includes a string slot holding a string, a bytes
// slot holding a Uint8Array and an integer slot holding a safe integer: the
// text wire carries anything else as it is, the binary one has no form for it.
//
// A plan from Schema.resolve (../resolve.js) has the writer's wire under the
// reader's keys: a field only the writer has is read and dropped, and absent
// when the reader's object is written, as is a tuple's `skip` element; a
// record is built in the reader's `order` with its `extras` at their
// defaults; a bridge between two scalar types, a value the reader drops and a
// collection of another optionality carry the writer's node as `writer`, the
// form the wire has, and the node's own `pack`, `unpack` and `checkedUnpack`
// convert between it and the reader's value, as they do on the text wire.

const { expectedOf, step } = require('../errors.js');
const { isBytes, isMap, listOf, put, member } = require('../types.js');
const codegen = require('../codegen.js');
const { byteTag, wordsOf, inHeader, wireOf, droppedBit } = require('./inspect.js');

const str = JSON.stringify;

// The source of a plan's binary codec and the helpers it reads through `H`.
// `context.validate` says whether decode checks the wire; `context.slot(slot)`
// gives the `{ write, read }` of the schema a slot calls.
const generate = (plan, context) => {
  const { validate } = context;
  const helpers = [];
  const slots = new Map();
  const functions = [];
  const structs = new Map();
  let counter = 0;
  const uid = (prefix) => `${prefix}${counter++}`;

  const slot = (value) => {
    let index = slots.get(value);
    if (index === undefined) {
      index = helpers.length;
      helpers.push(value);
      slots.set(value, index);
    }
    return `H[${index}]`;
  };

  // A decode check of a value, only with validation, and one of the structure
  // of the wire, in every mode; `path` is a source expression.
  const always = (condition, code, path, detail) =>
    `if(${condition})F(${str(code)},${path},${str(detail)});`;
  const check = validate ? always : () => '';
  const structure = (condition, path, detail) => always(condition, 'structure', path, detail);
  const truncated = (path) => structure('r.pos>r.end', path, 'length');
  // The else branch of a presence test where the reader requires a value the
  // writer may omit (Schema.resolve), only with validation.
  const absent = (path, expected) => (validate ? `else{F('type',${path},${str(expected)});}` : '');

  // The value of `src` ready for the wire, or null when nothing travels: a
  // converted scalar is packed first (an enum value not of the enum, an
  // invalid date travel as null, as on the text wire; a decimal past the safe
  // integers is refused, `always`). Gives the statements and the expression.
  const ready = (node, src, path) => {
    if (node.kind !== 'scalar' || node.pack === null) return ['', src];
    if (node.type === 'null') return ['', 'null'];
    // A bridge (Schema.resolve) packs the reader's value into the writer's form.
    if (node.writer === undefined && (node.type === 'bigint' || node.type === 'bytes')) {
      return ['', src];
    }
    const x = uid('x');
    let out = `const ${x}=${src}==null?null:${slot(node)}.pack(${src});`;
    if (node.always === true) {
      out += `if(${x}===undefined)E(${str(node.code)},${path},${str(expectedOf(node))});`;
    }
    return [out, x];
  };

  // Statements that write a string, which must be one: the writer measures it.
  const writeString = (x, path) =>
    `if(typeof ${x}!=='string')E('type',${path},'string');w.string(${x});`;

  // Statements that write a ready, present scalar.
  const writeScalar = (node, x, path) => {
    // A bridge writes the writer's form; a value the reader drops never travels.
    if (node.writer !== undefined && node.type !== 'null') return writeScalar(node.writer, x, path);
    if (node.decimals !== undefined) return `w.svar(${x});`;
    switch (node.type) {
      case 'number':
        return `w.f64(${x});`;
      case 'integer':
        // Only a safe integer has a form: an infinity or a fraction would read
        // back as another number (the writer's loop ends on any value).
        return `if(!Number.isSafeInteger(${x}))E('type',${path},'integer');w.svar(${x});`;
      case 'date':
        return `w.svar(${x});`;
      case 'boolean':
        return `w.u8(${x}?1:0);`;
      case 'string':
        return writeString(x, path);
      case 'enum':
        return byteTag(node) ? `w.u8(${x});` : `w.uvar(${x});`;
      case 'flags':
        return wordsOf(node) === 1 ? `w.uvar(${x});` : `w.words(${x},${wordsOf(node)});`;
      case 'bytes':
        return `if(!${slot(isBytes)}(${x}))E('type',${path},'bytes');w.raw(${x});`;
      case 'bigint':
        return `w.string(String(${x}));`;
      case 'json': {
        // A value JSON has no text for (a function) travels as null, as on
        // the text wire.
        const t = uid('t');
        return `const ${t}=JSON.stringify(${x});w.string(${t}===undefined?'null':${t});`;
      }
      default:
        return '';
    }
  };

  // Statements that write a present `x` of any kind. A slot (a reference by
  // name or an embedded schema) is called as it is.
  const emit = (node, x, path) => {
    if (node.kind === 'scalar') return writeScalar(node, x, path);
    if (node.slot !== undefined) {
      return `try{${slot(context.slot(node.slot))}.write(w,${x});}catch(error){throw N(error,${path});}`;
    }
    if (node.kind === 'struct' || node.kind === 'union') {
      return `try{${record(node).e}(w,${x});}catch(error){throw N(error,${path});}`;
    }
    if (node.kind === 'array') return emitArray(node, x, path);
    if (node.kind === 'map') return emitMap(node, x, path);
    if (node.kind === 'dict') return emitDict(node, x, path);
    return emitTuple(node, x, path);
  };

  // The count, a bitmap when an item may be null, the items. A Set travels as
  // its elements. A null item of a list of required items has no form.
  const emitArray = (node, x, path) => {
    const { item } = node;
    const [l, n, i, s] = [uid('l'), uid('n'), uid('i'), uid('s')];
    const at = `${path}+"["+${i}+"]"`;
    const head =
      node.container === 'set'
        ? `const ${l}=Array.isArray(${x})?${x}:${slot(listOf)}(${x});` +
          `if(${l}===undefined)E('set',${path});`
        : `if(!Array.isArray(${x}))E('array',${path});const ${l}=${x};`;
    const [pre, y] = ready(item, `${l}[${i}]`, at);
    const count = `const ${n}=${l}.length;w.uvar(${n});`;
    // The wire's optionality is the writer's (Schema.resolve).
    if (!wireOf(node).itemRequired) {
      return (
        `${head}${count}const ${s}=w.bitmap(${n});for(let ${i}=0;${i}<${n};${i}++){${pre}` +
        `if(${y}!=null){w.mark(${s},${i});${emit(item, y, at)}}}`
      );
    }
    return (
      `${head}${count}for(let ${i}=0;${i}<${n};${i}++){${pre}` +
      `if(${y}==null)E('type',${at},${str(expectedOf(item))});${emit(item, y, at)}}`
    );
  };

  // A nullable value behind a presence byte, a required one as it is.
  const emitValue = (node, required, src, at) => {
    const [pre, y] = ready(node, src, at);
    if (required) {
      return `${pre}if(${y}==null)E('type',${at},${str(expectedOf(node))});${emit(node, y, at)}`;
    }
    return `${pre}if(${y}==null)w.u8(0);else{w.u8(1);${emit(node, y, at)}}`;
  };

  // The count, then each entry: its key (a string or a number) and its value.
  // An entry's path is its index: a key may be anything.
  const emitMap = (node, x, path) => {
    const [i, e] = [uid('i'), uid('e')];
    const at = `${path}+"["+${i}+"]"`;
    const key = node.key.type === 'string' ? writeString(`${e}[0]`, at) : `w.f64(${e}[0]);`;
    const value = emitValue(node.value, wireOf(node).valueRequired, `${e}[1]`, at);
    return (
      `if(!${slot(isMap)}(${x}))E('map',${path});w.uvar(${x}.size);let ${i}=0;` +
      `for(const ${e} of ${x}){${key}${value}${i}++;}`
    );
  };

  const emitDict = (node, x, path) => {
    const [ks, i, k] = [uid('k'), uid('i'), uid('k')];
    const at = `${slot(member)}(${path},${k})`;
    const value = emitValue(node.value, wireOf(node).valueRequired, `${x}[${k}]`, at);
    return (
      `if(typeof ${x}!=='object'||Array.isArray(${x}))E('object',${path});` +
      `const ${ks}=Object.keys(${x});w.uvar(${ks}.length);` +
      `for(let ${i}=0;${i}<${ks}.length;${i}++){const ${k}=${ks}[${i}];w.string(${k});${value}}`
    );
  };

  const emitTuple = (node, x, path) => {
    const s = uid('s');
    const out = [
      `if(!Array.isArray(${x}))E('array',${path});const ${s}=w.bitmap(${node.items.length});`,
    ];
    node.items.forEach((item, i) => {
      const at = `${path}+${str(`[${i}]`)}`;
      const [pre, y] = ready(item.node, `${x}[${i}]`, at);
      out.push(`${pre}if(${y}!=null){w.mark(${s},${i});${emit(item.node, y, at)}}`);
    });
    return out.join('');
  };

  // The text wire's form of the writer's scalar, set into `t`, for a bridge
  // (Schema.resolve) to convert: an enum's index, a flags mask, an integer or
  // a string, the writer types a bridge reads.
  const readRaw = (node, t, path) => {
    if (node.type === 'enum') {
      return `const ${t}=${byteTag(node) ? 'r.u8()' : 'r.uvar()'};${truncated(path)}`;
    }
    if (node.type === 'flags') {
      const words = wordsOf(node);
      return `const ${t}=${words === 1 ? 'r.uvar()' : `r.words(${words})`};${truncated(path)}`;
    }
    if (node.type === 'integer') {
      return `const ${t}=r.svar();${truncated(path)}${safe(t, path, 'integer')}`;
    }
    return `const ${t}=r.string();${structure(`${t}===undefined`, path, 'length')}`;
  };

  // Statements that set `dst` from a resolved scalar (Schema.resolve): a value
  // the reader drops is read in the writer's form, whatever it is, and
  // dropped; a bridge converts the writer's form, checked with validation.
  const readBridged = (node, dst, path) => {
    const t = uid('t');
    if (node.type === 'null') return `let ${t};${readInto(node.writer, t, path)}${dst}=null;`;
    const raw = readRaw(node.writer, t, path);
    if (!validate) return `${raw}${dst}=${slot(node)}.unpack(${t});`;
    return (
      `${raw}${dst}=${slot(node)}.checkedUnpack(${t});` +
      `if(${dst}===undefined)F(${str(node.code)},${path},${str(node.expected)});`
    );
  };

  // An integer of the wire is a safe one, under validation: the varint is
  // exact over them and no further.
  const safe = (t, path, expected) => check(`!Number.isSafeInteger(${t})`, 'type', path, expected);

  // Statements that set `dst` from a present scalar on the wire. A converted
  // type checks and converts through its own `checkedUnpack` (types.js) under
  // validation and its `unpack` without, as on the text wire, so the two
  // wires agree on what a date, a mask or a bigint is.
  const readScalar = (node, dst, path) => {
    if (node.writer !== undefined) return readBridged(node, dst, path);
    const t = uid('t');
    const converted = (raw, unpack) =>
      `const ${t}=${raw};${truncated(path)}` +
      (validate
        ? `${dst}=${slot(node)}.checkedUnpack(${t});` +
          `if(${dst}===undefined)F(${str(node.code)},${path},${str(node.expected)});`
        : `${dst}=${unpack};`);
    if (node.decimals !== undefined) {
      const scale = 10 ** node.decimals;
      return `const ${t}=r.svar();${truncated(path)}${safe(t, path, node.expected)}${dst}=${t}/${scale};`;
    }
    switch (node.type) {
      case 'number':
        return `${structure('r.pos+8>r.end', path, 'length')}${dst}=r.f64();`;
      case 'integer':
        return `const ${t}=r.svar();${truncated(path)}${safe(t, path, 'integer')}${dst}=${t};`;
      case 'date':
        return converted('r.svar()', `new Date(${t})`);
      case 'boolean':
        return (
          `const ${t}=r.u8();${truncated(path)}` +
          `${check(`!(${t}<2)`, 'type', path, 'boolean')}${dst}=${t}===1;`
        );
      case 'string':
        return `${dst}=r.string();${structure(`${dst}===undefined`, path, 'length')}`;
      case 'enum':
        return (
          `const ${t}=${byteTag(node) ? 'r.u8()' : 'r.uvar()'};${truncated(path)}` +
          `${check(`!(${t}<${node.values.length})`, 'enum', path, node.expected)}` +
          `${dst}=${slot(node.values)}[${t}];`
        );
      case 'flags': {
        const words = wordsOf(node);
        const raw = words === 1 ? 'r.uvar()' : `r.words(${words})`;
        return converted(raw, `${slot(node)}.unpack(${t})`);
      }
      case 'bytes':
        return `${dst}=r.raw();${structure(`${dst}===undefined`, path, 'length')}`;
      case 'bigint':
        return (
          `const ${t}=r.string();${structure(`${t}===undefined`, path, 'length')}` +
          (validate
            ? `${dst}=${slot(node)}.checkedUnpack(${t});` +
              `if(${dst}===undefined)F('type',${path},'bigint');`
            : `try{${dst}=BigInt(${t});}catch{F('type',${path},'bigint');}`)
        );
      case 'json':
        return (
          `const ${t}=r.string();${structure(`${t}===undefined`, path, 'length')}` +
          `try{${dst}=JSON.parse(${t});}catch{F('json',${path});}`
        );
      default:
        return `${dst}=null;`;
    }
  };

  // A collection's count: read, then bounded by the bytes left, of which
  // every item takes at least one (a required item does, since a `null` is
  // never required; a map's or a dictionary's key takes a byte) or a bit of
  // the bitmap (a nullable item), so no count allocates past the message.
  const readCount = (c, path, perByte) => {
    const left = perByte === 1 ? 'r.end-r.pos' : `(r.end-r.pos)*${perByte}`;
    return `const ${c}=r.uvar();${structure(`r.pos>r.end||${c}>${left}`, path, 'length')}`;
  };

  // A bitmap of `count` bits at `s`, which the count's bound made fit; `b` is
  // the bytes.
  const readBitmap = (b, s, count) =>
    `const ${b}=r.bytes,${s}=r.pos;r.pos=${s}+Math.ceil(${count}/8);`;
  const bit = (b, s, i) => `(${b}[${s}+(${i}>>3)]&(1<<(${i}&7)))!==0`;

  // Statements that set `dst` from a present value of any kind.
  const readInto = (node, dst, path) => {
    if (node.kind === 'scalar') return readScalar(node, dst, path);
    if (node.slot !== undefined) {
      return `try{${dst}=${slot(context.slot(node.slot))}.read(r);}catch(error){throw N(error,${path});}`;
    }
    if (node.kind === 'struct' || node.kind === 'union') {
      return `try{${dst}=${record(node).d}(r);}catch(error){throw N(error,${path});}`;
    }
    if (node.kind === 'array') {
      const { item } = node;
      const [c, i, b, s, o, y] = [uid('c'), uid('c'), uid('b'), uid('s'), uid('o'), uid('y')];
      const at = `${path}+"["+${i}+"]"`;
      const done = node.container === 'set' ? `${dst}=new Set(${o});` : `${dst}=${o};`;
      if (!wireOf(node).itemRequired) {
        // An absent item where the reader requires one (Schema.resolve) is
        // refused as a null one is on the text wire.
        const refused = node.itemRequired ? absent(at, expectedOf(item)) : '';
        return (
          `${readCount(c, path, 8)}${readBitmap(b, s, c)}` +
          `const ${o}=new Array(${c});for(let ${i}=0;${i}<${c};${i}++){let ${y}=null;` +
          `if(${bit(b, s, i)}){${readInto(item, y, at)}}${refused}${o}[${i}]=${y};}${done}`
        );
      }
      return (
        `${readCount(c, path, 1)}const ${o}=new Array(${c});` +
        `for(let ${i}=0;${i}<${c};${i}++){let ${y};${readInto(item, y, at)}${o}[${i}]=${y};}${done}`
      );
    }
    if (node.kind === 'map') {
      const [c, i, k, o, y] = [uid('c'), uid('c'), uid('k'), uid('o'), uid('y')];
      const at = `${path}+"["+${i}+"]"`;
      const key =
        node.key.type === 'string'
          ? `const ${k}=r.string();${structure(`${k}===undefined`, at, 'length')}`
          : `${structure('r.pos+8>r.end', at, 'length')}const ${k}=r.f64();`;
      const value = readValue(node.value, wireOf(node).valueRequired, node.valueRequired, y, at);
      return (
        `${readCount(c, path, 1)}const ${o}=new Map();` +
        `for(let ${i}=0;${i}<${c};${i}++){${key}let ${y}=null;${value}${o}.set(${k},${y});}` +
        `${dst}=${o};`
      );
    }
    if (node.kind === 'dict') {
      const [c, i, k, o, y] = [uid('c'), uid('c'), uid('k'), uid('o'), uid('y')];
      const at = `${slot(member)}(${path},${k})`;
      const value = readValue(node.value, wireOf(node).valueRequired, node.valueRequired, y, at);
      return (
        `${readCount(c, path, 1)}const ${o}={};` +
        `for(let ${i}=0;${i}<${c};${i}++){const ${k}=r.string();` +
        `${structure(`${k}===undefined`, path, 'length')}let ${y}=null;${value}` +
        `if(${k}==='__proto__')${slot(put)}(${o},${k},${y});else ${o}[${k}]=${y};}${dst}=${o};`
      );
    }
    const [b, s] = [uid('b'), uid('s')];
    const out = [`${readBitmap(b, s, node.items.length)}${truncated(path)}`];
    const parts = [];
    node.items.forEach((item, i) => {
      const y = uid('y');
      const at = `${path}+${str(`[${i}]`)}`;
      // An element the reader does not have (Schema.resolve) is read and dropped.
      if (item.skip === true) {
        out.push(`if(${bit(b, s, i)}){let ${y};${readInto(item.node, y, at)}}`);
        return;
      }
      out.push(slotValue(item.node, item.required, item.def, y, bit(b, s, i), at));
      parts.push(y);
    });
    // The reader's elements the writer does not have, at their defaults.
    if (node.extras !== undefined) for (const extra of node.extras) parts.push(str(extra.def));
    out.push(`${dst}=[${parts}];`);
    return out.join('');
  };

  // A map's or a dictionary's value: behind a presence byte when the writer
  // may omit it, as it is when the wire requires it; one the reader requires
  // (Schema.resolve) is refused when absent.
  const readValue = (node, onWire, required, y, at) => {
    if (onWire) return readInto(node, y, at);
    const f = uid('f');
    const refused = required ? absent(at, expectedOf(node)) : '';
    return (
      `const ${f}=r.u8();${truncated(at)}${structure(`!(${f}<2)`, at, 'presence')}` +
      `if(${f}===1){${readInto(node, y, at)}}${refused}`
    );
  };

  // One slot (a field or a tuple element) whose presence `test` says: the
  // value, the default or, for a required one under validation, an error.
  const slotValue = (node, required, def, y, test, path) => {
    const fallback = def === null ? 'null' : str(def);
    const missing = required && validate ? `else{F('required',${path});}` : '';
    return `let ${y}=${fallback};if(${test}){${readInto(node, y, path)}}${missing}`;
  };

  const structFns = (node) => {
    let fns = structs.get(node);
    if (fns !== undefined) return fns;
    fns = { e: uid('e'), d: uid('d') };
    structs.set(node, fns);
    const size = node.fields.length;
    // A branch of a union: its tag `t` fills the discriminator; the union
    // function has checked the value and written the tag already.
    const { tag } = node;
    const lead = tag === undefined ? 0 : 1;
    // The header: a presence bit per field, then a bit per boolean field.
    const flags = node.fields.filter((field) => inHeader(wireOf(field.node)));
    const bits = size + flags.length;
    const bytes = (bits + 7) >> 3;
    const masks = Array.from({ length: bytes }, (_, i) => `m${i}`);
    const at = (i) => [`m${i >> 3}`, 1 << (i & 7)];
    const enc = lead === 0 ? [`if(typeof o!=='object'||Array.isArray(o))E('object','');`] : [];
    if (bytes > 0) {
      enc.push(`w.ensure(${bytes});const s=w.pos;w.pos=s+${bytes};let ${masks.join('=0,')}=0;`);
    }
    let next = size;
    for (const field of node.fields) {
      const [m, mask] = at(field.index);
      const flag = inHeader(wireOf(field.node)) ? at(next++) : null;
      // A field only the writer has, or one the reader drops (Schema.resolve),
      // never travels, nor does a null one.
      if (field.key === null || field.node.type === 'null') continue;
      const key = str(field.key);
      const where = str(step(field.key));
      const v = uid('v');
      enc.push(`const ${v}=o[${key}];`);
      if (flag !== null) {
        enc.push(`if(${v}!=null){${m}|=${mask};if(${v})${flag[0]}|=${flag[1]};}`);
        continue;
      }
      const [pre, x] = ready(field.node, v, where);
      enc.push(`${pre}if(${x}!=null){${m}|=${mask};${emit(field.node, x, where)}}`);
    }
    if (bytes > 0) {
      enc.push(`const b=w.bytes;${masks.map((m, i) => `b[s+${i}]=${m};`).join('')}`);
    }
    functions.push(`function ${fns.e}(w,o){${enc.join('')}}`);
    const dec = [];
    const heads = Array.from({ length: bytes }, (_, i) => `h${i}`);
    const head = (i) => `(h${i >> 3}&${1 << (i & 7)})!==0`;
    if (bytes > 0) {
      dec.push(
        `const b=r.bytes,p=r.pos;${structure(`p+${bytes}>r.end`, '""', 'length')}` +
          `const ${heads.map((h, i) => `${h}=b[p+${i}]`).join(',')};r.pos=p+${bytes};`,
      );
    }
    const parts = [];
    const decoded = new Map();
    next = size;
    for (const field of node.fields) {
      // A field only the writer has (Schema.resolve) is read, under the
      // writer's key on an error, and dropped.
      const dropped = field.key === null;
      const where = str(step(dropped ? field.wire : field.key));
      const v = uid('v');
      if (inHeader(wireOf(field.node))) {
        const flag = head(next++);
        if (dropped) continue;
        if (droppedBit(field.node)) dec.push(`const ${v}=null;`);
        else {
          const fallback = field.def === null ? 'null' : str(field.def);
          const missing = field.required && validate ? `else{F('required',${where});}` : '';
          dec.push(`let ${v}=${fallback};if(${head(field.index)}){${v}=${flag};}${missing}`);
        }
      } else if (dropped) {
        dec.push(`if(${head(field.index)}){let ${v};${readInto(field.node, v, where)}}`);
        continue;
      } else {
        dec.push(slotValue(field.node, field.required, field.def, v, head(field.index), where));
      }
      if (node.order === undefined) parts.push(`${str(field.key)}:${v}`);
      else decoded.set(field.key, v);
    }
    // A resolved record is built in the reader's key order, with the reader's
    // fields the writer does not have at their defaults.
    if (node.order !== undefined) {
      for (const extra of node.extras) decoded.set(extra.key, str(extra.def));
      for (const key of node.order) parts.push(`${str(key)}:${decoded.get(key)}`);
    }
    if (lead === 1) parts.splice(tag.position, 0, `${str(tag.key)}:${slot(tag.values)}[t]`);
    dec.push(`return {${parts}};`);
    functions.push(`function ${fns.d}(r${lead === 0 ? '' : ',t'}){${dec.join('')}}`);
    return fns;
  };

  // A union picks its branch by the discriminator on encode and by the tag on
  // decode; either one outside the union is an error even without validation,
  // since there is no branch to fall back to.
  const unionFns = (node) => {
    let fns = structs.get(node);
    if (fns !== undefined) return fns;
    fns = { e: uid('e'), d: uid('d') };
    structs.set(node, fns);
    const tag = slot(node.tag);
    const key = str(node.key);
    const where = str(step(node.key));
    const expected = str(node.tag.expected);
    const wide = !byteTag(node.tag);
    // A branch the reader has no values of (Schema.resolve) has no case: its
    // tags fall through to the error.
    const cases = (call) => {
      const out = [];
      for (const branch of node.branches) {
        if (branch.node === null) continue;
        for (let i = 0; i < branch.count; i++) out.push(`case ${branch.first + i}:`);
        out.push(call(structFns(branch.node)));
      }
      return out.join('');
    };
    functions.push(
      `function ${fns.e}(w,o){if(typeof o!=='object'||Array.isArray(o))E('object','');` +
        `const t=${tag}.checkedPack(o[${key}]);switch(t){` +
        `${cases((f) => `w.${wide ? 'uvar' : 'u8'}(t);return ${f.e}(w,o);`)}}` +
        `E('union',${where},${expected});}`,
    );
    functions.push(
      `function ${fns.d}(r){const t=r.${wide ? 'uvar' : 'u8'}();${truncated(where)}switch(t){` +
        `${cases((f) => `return ${f.d}(r,t);`)}}F('union',${where},${expected});}`,
    );
    return fns;
  };

  const record = (node) => (node.kind === 'union' ? unionFns(node) : structFns(node));

  let encodeBody;
  let decodeBody;
  if (plan.kind === 'struct' || plan.kind === 'union') {
    const fns = record(plan);
    encodeBody = `if(v==null)E('required','');${fns.e}(w,v);`;
    decodeBody = `return ${fns.d}(r);`;
  } else if (plan.kind === 'scalar') {
    // A root scalar travels behind a presence byte.
    const [pre, x] = ready(plan, 'v', '""');
    encodeBody = `${pre}if(${x}==null)w.u8(0);else{w.u8(1);${writeScalar(plan, x, '""')}}`;
    const missing = plan.required && validate ? `else{F('required',"");}` : '';
    decodeBody =
      `let x=null;const f=r.u8();${truncated('""')}${structure('!(f<2)', '""', 'presence')}` +
      `if(f===1){${readScalar(plan, 'x', '""')}}${missing}return x;`;
  } else {
    encodeBody = `if(v==null)E('required','');${emit(plan, 'v', '""')}`;
    decodeBody = `let x;${readInto(plan, 'x', '""')}return x;`;
  }
  const body = [
    '"use strict";',
    ...functions,
    `function write(w,v){${encodeBody}}`,
    `function read(r){${decodeBody}}`,
    'return {write,read};',
  ].join('\n');
  return { body, helpers };
};

// The `{ write, read }` of a plan: `write(w, v)` into a Writer, `read(r)` from
// a Reader (wire.js).
const build = (plan, context) => {
  const { body, helpers } = generate(plan, context);
  return codegen.compile(body)(helpers);
};

module.exports = { build, generate };
