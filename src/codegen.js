// The codegen backend: every struct of the plan becomes one specialised
// encode function and one decode function through `new Function`. Array and
// object literals give V8 packed arrays and one shared hidden class per
// schema, so decoded objects are as cheap to use as the ones JSON.parse
// builds. This is the only file that may compile source text; the platform
// test enforces it.
//
// The generated source is one `function eN(o){…}` and one `function
// dN(a,strict){…}` per struct, then `encode` and `decode` over the root. `H`
// holds the helpers (type nodes and codec slots), `F` throws a DecodeError,
// `E` an EncodeError and `N` re-throws one with a key or index prepended. A
// `path` below is a source expression that is only evaluated on an error
// branch.

const { expectedOf, fail, nest, refuse } = require('./errors.js');
const { WORD, isMap, listOf, put } = require('./types.js');

const str = JSON.stringify;

// What encode requires: the writer's flag on a plan from Schema.resolve, where
// the twin is set, the same flag as decode otherwise.
const outRequired = (own, twin) => (twin === undefined ? own : twin);

// Above this many records a collection's text comes from JSON.stringify of
// its wire: building the text by hand wins on small payloads (a call per
// value instead of a walk over a fresh array) and loses on long lists, where
// the native serializer's single pass is cheaper (see bench/bench.js).
const THRESHOLD = 64;

// The JSON text of a value at `key` of an array, as JSON.stringify of the
// array writes it: toJSON called with the key, undefined, a function and a
// symbol written as null.
// A short string with nothing to escape is its text in quotes; the others
// take JSON.stringify. Surrogates take the long way too, so a lone one is
// escaped as JSON.stringify escapes it.
const quoted = (s) => {
  if (s.length > 64) return JSON.stringify(s);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 32 || code === 34 || code === 92 || (code >= 0xd800 && code <= 0xdfff)) {
      return JSON.stringify(s);
    }
  }
  return `"${s}"`;
};

const text = (value, key) => {
  const v =
    value !== null && typeof value === 'object' && typeof value.toJSON === 'function'
      ? value.toJSON(`${key}`)
      : value;
  const out = JSON.stringify(v);
  return out === undefined ? 'null' : out;
};

let available = true;
try {
  // oxlint-disable-next-line no-new-func
  const probe = new Function('return 1');
  available = probe() === 1;
} catch {
  available = false;
}

// The source of a plan's codec and the helpers it reads through `H`. It is
// deterministic, so the source can be generated again on demand instead of
// being kept on every codec.
const generate = (plan, options) => {
  // Which direction is checked: `validate.encode` the values given to encode,
  // `validate.decode` the wire.
  const { validate } = options;
  // A checking codec (Schema#check) calls the checking codecs of the schemas
  // it embeds.
  const via = options.checking ? 'checker' : 'codec';
  // Whether `stringify` builds the text itself (see textInto).
  const { builder } = options;
  const helpers = [];
  const slots = new Map();
  const functions = [];
  const structs = new Map();
  let counter = 0;
  const uid = (prefix) => `${prefix}${counter++}`;

  // Everything the generated code needs arrives through `H`: a minifier may
  // rename module-level identifiers, parameters it cannot touch.
  const slot = (value) => {
    let index = slots.get(value);
    if (index === undefined) {
      index = helpers.length;
      helpers.push(value);
      slots.set(value, index);
    }
    return `H[${index}]`;
  };

  // Identity scalars are checked inline; the other types go through the type
  // table, as closures do.
  const pack = (node, v) => (node.pack === null ? v : `${slot(node)}.pack(${v})`);
  const unpack = (node, v) => (node.unpack === null ? v : `${slot(node)}.unpack(${v})`);
  // True when `v` is not of an identity scalar's type: typeof, or a call for
  // the one type typeof cannot tell.
  const invalid = (node, v) =>
    node.type === 'integer' ? `!Number.isInteger(${v})` : `typeof ${v}!=='${node.type}'`;

  // The wire check of an identity scalar (json has none).
  const check = (node, v, path) => {
    if (!validate.decode || node.check === null) return '';
    return `if(${invalid(node, v)})F(${str(node.code)},${path},${str(node.expected)});`;
  };

  // Statements that set `dst` to the decoded form of a non-null scalar `src`:
  // a converted type checks and converts in one call, an identity type is
  // checked inline and travels as it is.
  const convert = (node, src, dst, path) => {
    if (validate.decode && node.checkedUnpack !== undefined) {
      return (
        `${dst}=${slot(node)}.checkedUnpack(${src});` +
        `if(${dst}===undefined)F(${str(node.code)},${path},${str(node.expected)});`
      );
    }
    return `${check(node, src, path)}${dst}=${unpack(node, src)};`;
  };

  // The encode-side twin of `check`: true when a value given to encode is not
  // of the type. A nullish value fails it too, so a required identity slot
  // needs one test, not two.
  const rejects = (node, v) => {
    if (node.pack !== null) return `!${slot(node)}.accept(${v})`;
    // v-v is NaN for NaN and the infinities, which have no JSON form.
    if (node.type === 'number') return `typeof ${v}!=='number'||${v}-${v}!==0`;
    return invalid(node, v);
  };

  // An own key of a fresh object; `__proto__` goes through put, which keeps it
  // from setting the prototype.
  const assign = (r, k, x) =>
    `if(${k}==='__proto__')${slot(put)}(${r},${k},${x});else ${r}[${k}]=${x};`;

  // Statements that set `dst` to the wire form of `src`. Under validation a
  // nullish src with a `nullCode` (`required`, or `type` for an array item)
  // throws it; otherwise it becomes null. Without validation nothing is
  // checked, so a trusting codec pays nothing. A slot (a reference by name or
  // an embedded schema) is called as it is.
  const encodeInto = (node, src, dst, path, nullCode = null) => {
    const scalar = node.kind === 'scalar';
    const expected = str(expectedOf(node));
    const nil =
      validate.encode && nullCode !== null
        ? `E(${str(nullCode)},${path},${expected});`
        : `${dst}=null;`;
    if (scalar) {
      // A type checked whatever `validate` says (`always`) takes the checking path.
      if ((!validate.encode && node.always !== true) || node.accept === null) {
        return `${dst}=${src}==null?null:${pack(node, src)};`;
      }
      const code = str(node.code);
      if (node.checkedPack !== undefined) {
        return (
          `if(${src}==null)${nil}else{${dst}=${slot(node)}.checkedPack(${src});` +
          `if(${dst}===undefined)E(${code},${path},${expected});}`
        );
      }
      if (node.pack === null && nullCode !== null) {
        const which = nullCode === node.code ? code : `${src}==null?${str(nullCode)}:${code}`;
        return `if(${rejects(node, src)})E(${which},${path},${expected});${dst}=${src};`;
      }
      return (
        `if(${src}==null)${nil}else{if(${rejects(node, src)})E(${code},${path},${expected});` +
        `${dst}=${pack(node, src)};}`
      );
    }
    if (node.slot !== undefined || node.kind === 'struct' || node.kind === 'union') {
      const callee = node.slot !== undefined ? `${slot(node.slot)}.${via}.encode` : record(node).e;
      return (
        `if(${src}==null)${nil}else try{${dst}=${callee}(${src});}` +
        `catch(error){throw N(error,${path});}`
      );
    }
    if (node.kind === 'map') {
      const [r, i, e, x] = [uid('r'), uid('i'), uid('e'), uid('x')];
      // An entry's path is its index: a key may be anything until checked.
      const at = `${path}+"["+${i}+"]"`;
      const key = validate.encode
        ? `if(${rejects(node.key, `${e}[0]`)})E('type',${at},${str(node.key.expected)});`
        : '';
      const valueNull = outRequired(node.valueRequired, node.valueEncodeRequired) ? 'type' : null;
      return (
        `if(${src}==null)${nil}else{if(!${slot(isMap)}(${src}))E('map',${path});` +
        `const ${r}=[];let ${i}=0;for(const ${e} of ${src}){${key}let ${x};` +
        `${encodeInto(node.value, `${e}[1]`, x, at, valueNull)}${r}.push(${e}[0],${x});${i}++;}` +
        `${dst}=${r};}`
      );
    }
    if (node.kind === 'dict') {
      const { value } = node;
      const [ks, r, i, k, x] = [uid('k'), uid('r'), uid('i'), uid('k'), uid('x')];
      const at = `(${path}===""?${k}:${path}+"."+${k})`;
      const valueNull = outRequired(node.valueRequired, node.valueEncodeRequired) ? 'type' : null;
      const isObject = `if(typeof ${src}!=='object'||Array.isArray(${src}))E('object',${path});`;
      const loop = `const ${ks}=Object.keys(${src});for(let ${i}=0;${i}<${ks}.length;${i}++){const ${k}=${ks}[${i}];let ${x};`;
      if (value.kind === 'scalar' && value.pack === null) {
        // Identity values travel in the same object: at most a checking pass.
        const pass =
          validate.encode && (value.accept !== null || valueNull !== null)
            ? `${loop}${encodeInto(value, `${src}[${k}]`, x, at, valueNull)}}`
            : '';
        return `if(${src}==null)${nil}else{${isObject}${pass}${dst}=${src};}`;
      }
      return (
        `if(${src}==null)${nil}else{${isObject}const ${r}={};${loop}` +
        `${encodeInto(value, `${src}[${k}]`, x, at, valueNull)}${assign(r, k, x)}}${dst}=${r};}`
      );
    }
    const isArray = `if(!Array.isArray(${src}))E('array',${path});`;
    if (node.kind === 'tuple') {
      const out = [];
      const parts = node.items.map((item, i) => {
        const t = uid('t');
        const at = `${path}+${str(`[${i}]`)}`;
        const required = outRequired(item.required, item.encodeRequired) ? 'required' : null;
        out.push(`let ${t};${encodeInto(item.node, `${src}[${i}]`, t, at, required)}`);
        return t;
      });
      return `if(${src}==null)${nil}else{${isArray}${out.join('')}${dst}=[${parts}];}`;
    }
    const { item } = node;
    const [n, i, e, r, x] = [uid('n'), uid('i'), uid('e'), uid('r'), uid('x')];
    // A Set travels as the array of its elements; an array is taken as it is.
    let list = src;
    let head = isArray;
    if (node.container === 'set') {
      list = uid('l');
      head =
        `const ${list}=Array.isArray(${src})?${src}:${slot(listOf)}(${src});` +
        `if(${list}===undefined)E('set',${path});`;
    }
    const at = `${path}+"["+${i}+"]"`;
    const itemNull = outRequired(node.itemRequired, node.itemEncodeRequired) ? 'type' : null;
    if (item.kind === 'scalar' && item.pack === null) {
      // Identity items travel in the same array: at most a checking pass.
      const pass =
        validate.encode && (item.accept !== null || itemNull !== null)
          ? `for(let ${i}=0;${i}<${list}.length;${i}++){const ${e}=${list}[${i}];let ${x};` +
            `${encodeInto(item, e, x, at, itemNull)}}`
          : '';
      return `if(${src}==null)${nil}else{${head}${pass}${dst}=${list};}`;
    }
    return (
      `if(${src}==null)${nil}else{${head}const ${n}=${list}.length,${r}=new Array(${n});` +
      `for(let ${i}=0;${i}<${n};${i}++){let ${x};` +
      `${encodeInto(item, `${list}[${i}]`, x, at, itemNull)}${r}[${i}]=${x};}${dst}=${r};}`
    );
  };

  // Statements that set `dst` from a non-null `src`. `path` is a source
  // expression evaluated only on error branches, relative to the enclosing
  // struct function: the caller prepends its own key through N.
  const decodeInto = (node, src, dst, path) => {
    if (node.kind === 'scalar') return convert(node, src, dst, path);
    if (node.slot !== undefined || node.kind === 'struct' || node.kind === 'union') {
      const callee = node.slot !== undefined ? `${slot(node.slot)}.${via}.decode` : record(node).d;
      return `try{${dst}=${callee}(${src},strict);}catch(error){throw N(error,${path});}`;
    }
    if (node.kind === 'dict') {
      const { value } = node;
      const out = [
        `if(${src}===null||typeof ${src}!=='object'||Array.isArray(${src}))` +
          `F('structure',${path},'object');`,
      ];
      const [ks, r, i, k, e, x] = [uid('k'), uid('r'), uid('i'), uid('k'), uid('e'), uid('x')];
      const at = `(${path}===""?${k}:${path}+"."+${k})`;
      const nullCheck =
        node.valueRequired && validate.decode ? `F('type',${at},${str(expectedOf(value))});` : '';
      const loop =
        `const ${ks}=Object.keys(${src});for(let ${i}=0;${i}<${ks}.length;${i}++){` +
        `const ${k}=${ks}[${i}],${e}=${src}[${k}];`;
      if (value.kind === 'scalar' && value.pack === null) {
        const chk = check(value, e, at);
        if (chk !== '' || nullCheck !== '') {
          out.push(`${loop}if(${e}==null){${nullCheck}}else{${chk}}}`);
        }
        out.push(`${dst}=${src};`);
        return out.join('');
      }
      const body = decodeInto(value, e, x, at);
      out.push(
        `const ${r}={};${loop}let ${x}=null;if(${e}==null){${nullCheck}}else{${body}}` +
          `${assign(r, k, x)}}${dst}=${r};`,
      );
      return out.join('');
    }
    const out = [`if(!Array.isArray(${src}))F('structure',${path},'array');`];
    if (node.kind === 'tuple') {
      const size = node.items.length;
      if (validate.decode) {
        out.push(`if(${src}.length!==${size})F('structure',${path},'length');`);
      }
      const parts = [];
      node.items.forEach((item, i) => {
        // An element the reader does not have (Schema.resolve) is not read.
        if (item.skip === true) return;
        const v = uid('v');
        out.push(`const ${v}=${src}[${i}];`);
        parts.push(
          slotValue(item.node, item.required, item.def, v, `${path}+${str(`[${i}]`)}`, out),
        );
      });
      // The reader's elements the writer does not have.
      if (node.extras !== undefined) for (const extra of node.extras) parts.push(str(extra.def));
      out.push(`${dst}=[${parts}];`);
      return out.join('');
    }
    if (node.kind === 'map') {
      const [n, i, k, e, r, x] = [uid('n'), uid('i'), uid('k'), uid('e'), uid('r'), uid('x')];
      const at = `${path}+"["+(${i}/2)+"]"`;
      const nullCheck =
        node.valueRequired && validate.decode
          ? `F('type',${at},${str(expectedOf(node.value))});`
          : '';
      out.push(
        `const ${n}=${src}.length;if(${n}%2!==0)F('structure',${path},'length');` +
          `const ${r}=new Map();for(let ${i}=0;${i}<${n};${i}+=2){` +
          `const ${k}=${src}[${i}],${e}=${src}[${i}+1];${check(node.key, k, at)}let ${x}=null;` +
          `if(${e}==null){${nullCheck}}else{${decodeInto(node.value, e, x, at)}}` +
          `${r}.set(${k},${x});}${dst}=${r};`,
      );
      return out.join('');
    }
    const { item } = node;
    const set = node.container === 'set';
    const [n, i, e, r, x] = [uid('n'), uid('i'), uid('e'), uid('r'), uid('x')];
    const at = `${path}+"["+${i}+"]"`;
    const nullCheck =
      node.itemRequired && validate.decode ? `F('type',${at},${str(expectedOf(item))});` : '';
    const loop = `const ${n}=${src}.length;for(let ${i}=0;${i}<${n};${i}++){const ${e}=${src}[${i}];`;
    if (item.kind === 'scalar' && item.pack === null) {
      const chk = check(item, e, at);
      if (chk !== '' || nullCheck !== '') {
        out.push(`${loop}if(${e}==null){${nullCheck}}else{${chk}}}`);
      }
      out.push(set ? `${dst}=new Set(${src});` : `${dst}=${src};`);
      return out.join('');
    }
    const body = decodeInto(item, e, x, at);
    out.push(
      `const ${r}=new Array(${src}.length);${loop}let ${x}=null;` +
        `if(${e}==null){${nullCheck}}else{${body}}${r}[${i}]=${x};}` +
        (set ? `${dst}=new Set(${r});` : `${dst}=${r};`),
    );
    return out.join('');
  };

  // One slot (a field or a tuple element): the required check, the wire
  // check, the default and the conversion. Returns the expression to use.
  const slotValue = (node, required, def, v, path, out) => {
    const req = required && validate.decode ? `F('required',${path});` : '';
    const fallback = def === null ? 'null' : str(def);
    if (node.kind === 'scalar') {
      if (node.pack === null) {
        const chk = check(node, v, path);
        if (req !== '' || chk !== '') out.push(`if(${v}==null){${req}}else{${chk}}`);
        // A validated required slot is never nullish past its check; any other
        // slot normalises undefined to null (or to its default).
        return req !== '' ? v : `(${v}==null?${fallback}:${v})`;
      }
      const w = uid('w');
      out.push(`let ${w}=${fallback};if(${v}==null){${req}}else{${convert(node, v, w, path)}}`);
      return w;
    }
    const w = uid('w');
    out.push(`let ${w}=null;if(${v}==null){${req}}else{${decodeInto(node, v, w, path)}}`);
    return w;
  };

  const structFns = (node) => {
    let fns = structs.get(node);
    if (fns !== undefined) return fns;
    fns = { e: uid('e'), d: uid('d') };
    structs.set(node, fns);
    const size = node.fields.length;
    // A branch of a union: its tag `t` leads the wire and fills the
    // discriminator; the union function has checked the value already.
    const { tag } = node;
    const lead = tag === undefined ? 0 : 1;
    const width = size + lead;
    const tail = node.tail + lead;
    const enc = lead === 0 ? [`if(typeof o!=='object'||Array.isArray(o))E('object','');`] : [];
    const values = lead === 0 ? [] : ['t'];
    for (const field of node.fields) {
      const required = outRequired(field.required, field.encodeRequired) ? 'required' : null;
      if (field.key === null) {
        // A field only the writer has (Schema.resolve): null on the wire,
        // which a writer that requires it rejects.
        if (validate.encode && required !== null) enc.push(`E('required',${str(field.wire)});`);
        values.push('null');
        continue;
      }
      const v = uid('v');
      const w = uid('w');
      const key = str(field.key);
      enc.push(`const ${v}=o[${key}];let ${w};${encodeInto(field.node, v, w, key, required)}`);
      values.push(w);
    }
    if (node.sparse && size <= WORD) {
      enc.push('const r=[0];let m=0;');
      for (let i = 0; i < size; i++) {
        enc.push(`if(${values[i]}!==null){m|=${1 << i};r.push(${values[i]});}`);
      }
      enc.push('r[0]=m;return r;');
    } else if (node.sparse) {
      // One [mask, ...present values] segment per 31 fields; `l` is where the
      // last segment with something in it ends, the first one always kept.
      enc.push('const r=[0];let m=0,s=0,l=0;');
      for (let i = 0; i < size; i++) {
        if (i > 0 && i % WORD === 0) {
          enc.push(`r[s]=m;${i === WORD ? '' : 'if(m!==0)'}l=r.length;s=r.length;r.push(0);m=0;`);
        }
        enc.push(`if(${values[i]}!==null){m|=${1 << (i % WORD)};r.push(${values[i]});}`);
      }
      enc.push('r[s]=m;if(m!==0)l=r.length;if(l<r.length)r.length=l;return r;');
    } else if (tail === width) {
      enc.push(`return [${values}];`);
    } else {
      enc.push(
        `const r=[${values}];let l=${width};while(l>${tail}&&r[l-1]===null)l--;` +
          `if(l<${width})r.length=l;return r;`,
      );
    }
    functions.push(`function ${fns.e}(o${lead === 0 ? '' : ',t'}){${enc.join('')}}`);
    const dec = lead === 0 ? [`if(!Array.isArray(a))F('structure',"",'array');`] : [];
    let read;
    const mask = `if(typeof m!=='number'||(m|0)!==m||m<0)F('structure',"",'mask');`;
    if (node.sparse) {
      dec.push(`${size <= WORD ? 'const' : 'let'} m=a[0];${mask}let p=1;`);
      read = (i) => `(m&${1 << (i % WORD)})!==0?a[p++]:null`;
    } else {
      dec.push(`const n=a.length;if(strict&&n>${width})F('extra',"");`);
      read = (i) => `n>${i + lead}?a[${i + lead}]:null`;
    }
    const parts = [];
    const decoded = new Map();
    for (const field of node.fields) {
      // A later segment may be missing: its fields are all null.
      if (node.sparse && field.index > 0 && field.index % WORD === 0) {
        dec.push(`m=p<a.length?a[p++]:0;${mask}`);
      }
      // A field the reader does not have (Schema.resolve) is not read; in a
      // sparse record its value still takes its place.
      if (field.key === null) {
        if (node.sparse) dec.push(`if((m&${1 << (field.index % WORD)})!==0)p++;`);
        continue;
      }
      const v = uid('v');
      dec.push(`const ${v}=${read(field.index)};`);
      const value = slotValue(field.node, field.required, field.def, v, str(field.key), dec);
      if (node.order === undefined) parts.push(`${str(field.key)}:${value}`);
      else decoded.set(field.key, value);
    }
    // A resolved record is built in the reader's key order, with the reader's
    // fields the writer does not have at their defaults.
    if (node.order !== undefined) {
      for (const extra of node.extras) decoded.set(extra.key, str(extra.def));
      for (const key of node.order) parts.push(`${str(key)}:${decoded.get(key)}`);
    }
    if (lead === 1) parts.splice(tag.position, 0, `${str(tag.key)}:${slot(tag.values)}[t]`);
    if (node.sparse) dec.push(`if(strict&&p!==a.length)F('extra',"");`);
    dec.push(`return {${parts}};`);
    functions.push(`function ${fns.d}(a,strict${lead === 0 ? '' : ',t'}){${dec.join('')}}`);
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
    const expected = str(node.tag.expected);
    // A branch the reader has no values of (Schema.resolve) has no case: its
    // tags fall through to the error.
    const cases = (call) => {
      const out = [];
      for (const branch of node.branches) {
        if (branch.node === null) continue;
        for (let i = 0; i < branch.count; i++) out.push(`case ${branch.first + i}:`);
        out.push(`return ${call(structFns(branch.node))};`);
      }
      return out.join('');
    };
    const dropped = node.branches.some((branch) => branch.node === null);
    functions.push(
      `function ${fns.e}(o){if(typeof o!=='object'||Array.isArray(o))E('object','');const v=o[${key}];` +
        `const t=${tag}.checkedPack(v);switch(t){${cases((f) => `${f.e}(o,t)`)}}` +
        `E('union',${key},${expected});}`,
    );
    functions.push(
      `function ${fns.d}(a,strict){if(!Array.isArray(a))F('structure',"",'array');const t=a[0];` +
        `if(!${tag}.check(t))F('union',${key},${expected});` +
        `switch(t){${cases((f) => `${f.d}(a,strict,t)`)}}` +
        `${dropped ? `F('union',${key},${expected});` : ''}}`,
    );
    return fns;
  };

  const record = (node) => (node.kind === 'union' ? unionFns(node) : structFns(node));

  // The builder: `stringify` writes the JSON text of the wire as it encodes,
  // with the checks and errors of encode, in its order, and the text
  // JSON.stringify of the wire would give. `dst` is set to null for a null on
  // the wire and to its text otherwise; `key` is the position the value has in
  // its array, for a toJSON. A record or a collection of records is written by
  // hand; any other value is encoded, then written as JSON.stringify would.
  const isRecord = (node) =>
    node.slot !== undefined || node.kind === 'struct' || node.kind === 'union';

  const quote = (w) => `${slot(quoted)}(${w})`;

  // The text of a scalar's wire `w`, not null: typeof tells a trusted value of
  // another type (written as it is) from one of the type.
  const textOf = (node, w, key) => {
    const any = `${slot(text)}(${w},${key})`;
    const number = `(${w}-${w}===0?''+${w}:'null')`;
    if (node.type === 'json' || node.type === 'null') return any;
    if (node.pack === null) {
      if (node.type === 'number' || node.type === 'integer') {
        return validate.encode ? `''+${w}` : `(typeof ${w}==='number'?${number}:${any})`;
      }
      if (node.type === 'boolean') {
        return validate.encode
          ? `(${w}?'true':'false')`
          : `(${w}===true?'true':${w}===false?'false':${any})`;
      }
      if (!validate.encode) return `(typeof ${w}==='string'?${quote(w)}:${any})`;
      return quote(w);
    }
    return `(typeof ${w}==='number'?${number}:${any})`;
  };

  const textInto = (node, src, dst, path, nullCode, key) => {
    // An embedded schema's codec writes its own layout: it is called as it is.
    const recordArray =
      node.slot === undefined &&
      node.kind === 'array' &&
      node.container === undefined &&
      isRecord(node.item);
    if (!isRecord(node) && !recordArray) {
      const w = uid('w');
      return (
        `let ${w};${encodeInto(node, src, w, path, nullCode)}` +
        `${dst}=${w}===null?null:${textOf(node, w, key)};`
      );
    }
    const expected = str(expectedOf(node));
    const nil =
      validate.encode && nullCode !== null
        ? `E(${str(nullCode)},${path},${expected});`
        : `${dst}=null;`;
    if (!recordArray) {
      // An embedded schema writes its own text where its codec can; a nested
      // record is written in place.
      const c = node.slot === undefined ? null : `${slot(node.slot)}.codec`;
      let write;
      if (c !== null) {
        write =
          `${dst}=${c}.stringify!==undefined?${c}.stringify(${src}):` +
          `${slot(text)}(${c}.encode(${src}),${key});`;
      } else if (node.kind === 'union') write = `${dst}=${builderFns(node)}(${src});`;
      else write = structText(node, src, dst, null);
      return `if(${src}==null)${nil}else try{${write}}catch(error){throw N(error,${path});}`;
    }
    const [n, i, x, w] = [uid('n'), uid('i'), uid('x'), uid('w')];
    const at = `${path}+"["+${i}+"]"`;
    const itemNull = outRequired(node.itemRequired, node.itemEncodeRequired) ? 'type' : null;
    return (
      `if(${src}==null)${nil}else{if(!Array.isArray(${src}))E('array',${path});` +
      `const ${n}=${src}.length;if(${n}>${THRESHOLD}){let ${w};` +
      `${encodeInto(node, src, w, path, nullCode)}${dst}=JSON.stringify(${w});}else{` +
      `let s='[';for(let ${i}=0;${i}<${n};${i}++){let ${x};` +
      `${textInto(node.item, `${src}[${i}]`, x, at, itemNull, i)}` +
      `s+=(${i}===0?'':',')+(${x}===null?'null':${x});}${dst}=s+']';}}`
    );
  };

  // A function for a union, a union's branch or the root; a record nested in
  // another is written in place instead (structText).
  const builderFns = (node) => {
    const name = uid('s');
    if (node.kind === 'union') unionBuilder(node, name);
    else {
      const d = uid('d');
      const body = structText(node, 'o', d, node.tag === undefined ? null : 't');
      const params = node.tag === undefined ? 'o' : 'o,t';
      functions.push(`function ${name}(${params}){let ${d};${body}return ${d};}`);
    }
    return name;
  };

  // Statements that set `dst` to the text of the record in `o` (a variable),
  // its tag in `t` for a union's branch. Inlined where a record nests in
  // another: a call per nested record costs more than the text it writes.
  const structText = (node, o, dst, t) => {
    const size = node.fields.length;
    const lead = t === null ? 0 : 1;
    const width = size + lead;
    const tail = node.tail + lead;
    const out =
      lead === 0 ? [`if(typeof ${o}!=='object'||Array.isArray(${o}))E('object','');`] : [];
    const texts = lead === 0 ? [] : [`''+${t}`];
    const [p, r, q, m, s] = [uid('p'), uid('r'), uid('q'), uid('m'), uid('s')];
    // A sparse record's positions depend on what is present: `p` counts them.
    if (node.sparse) out.push(`let ${p}=1;`);
    for (const field of node.fields) {
      const required = outRequired(field.required, field.encodeRequired) ? 'required' : null;
      const x = uid('t');
      if (node.sparse && field.index > 0 && field.index % WORD === 0) out.push(`${p}++;`);
      if (field.key === null) {
        if (validate.encode && required !== null) out.push(`E('required',${str(field.wire)});`);
        out.push(`const ${x}=null;`);
      } else {
        const v = uid('v');
        const key = str(field.key);
        const position = node.sparse ? p : field.index + lead;
        out.push(
          `const ${v}=${o}[${key}];let ${x};${textInto(field.node, v, x, key, required, position)}`,
        );
        if (node.sparse) out.push(`if(${x}!==null)${p}++;`);
      }
      texts.push(x);
    }
    const textAt = (x) => (lead === 1 && x === texts[0] ? x : `(${x}===null?'null':${x})`);
    if (node.sparse) {
      // One mask and its present values per 31 fields; the first segment is
      // always kept, a later one up to the last that has something in it.
      out.push(`let ${r}='',${q}='',${m}=0,${s}='';`);
      for (let i = 0; i < size; i++) {
        if (i > 0 && i % WORD === 0) {
          out.push(
            i === WORD
              ? `${r}='['+${m}+${s};`
              : `${q}+=','+${m}+${s};if(${m}!==0){${r}+=${q};${q}='';}`,
          );
          out.push(`${m}=0;${s}='';`);
        }
        out.push(`if(${texts[i]}!==null){${m}|=${1 << (i % WORD)};${s}+=','+${texts[i]};}`);
      }
      out.push(
        size > WORD
          ? `${q}+=','+${m}+${s};if(${m}!==0)${r}+=${q};${dst}=${r}+']';`
          : `${dst}='['+${m}+${s}+']';`,
      );
      return out.join('');
    }
    // The trailing run of optional fields is trimmed of its nulls: `q` holds
    // the nulls that a value after them would keep.
    const head = texts.slice(0, tail).map(textAt);
    if (tail === width) {
      out.push(`${dst}='['+${head.join("+','+")}+']';`);
      return out.join('');
    }
    out.push(`let ${s}='['${head.length === 0 ? '' : `+${head.join("+','+")}`},${q}='';`);
    for (let i = tail; i < width; i++) {
      const sep = i === 0 ? '' : ',';
      out.push(
        `if(${texts[i]}!==null){${s}+=${q}+'${sep}'+${texts[i]};${q}='';}else ${q}+='${sep}null';`,
      );
    }
    out.push(`${dst}=${s}+']';`);
    return out.join('');
  };

  const unionBuilder = (node, name) => {
    const tag = slot(node.tag);
    const key = str(node.key);
    const out = [];
    for (const branch of node.branches) {
      if (branch.node === null) continue;
      for (let i = 0; i < branch.count; i++) out.push(`case ${branch.first + i}:`);
      out.push(`return ${builderFns(branch.node)}(o,t);`);
    }
    functions.push(
      `function ${name}(o){if(typeof o!=='object'||Array.isArray(o))E('object','');` +
        `const t=${tag}.checkedPack(o[${key}]);switch(t){${out.join('')}}` +
        `E('union',${key},${str(node.tag.expected)});}`,
    );
  };

  let encodeBody;
  let decodeBody;
  if (plan.kind === 'struct' || plan.kind === 'union') {
    const fns = record(plan);
    encodeBody = `return v==null?null:${fns.e}(v);`;
    decodeBody = `return ${fns.d}(v,strict);`;
  } else {
    const required = plan.kind === 'scalar' && plan.required;
    const requiredIn = plan.kind === 'scalar' && outRequired(plan.required, plan.encodeRequired);
    const req = required && validate.decode ? `F('required',"");` : '';
    encodeBody = `let w;${encodeInto(plan, 'v', 'w', '""', requiredIn ? 'required' : null)}return w;`;
    decodeBody =
      plan.kind === 'scalar'
        ? `let w=null;if(v==null){${req}}else{${decodeInto(plan, 'v', 'w', '""')}}return w;`
        : `let w;${decodeInto(plan, 'v', 'w', '""')}return w;`;
  }
  // The builder serves the payloads it writes by hand: a record, a union, a
  // collection.
  const stringify =
    builder && (plan.kind === 'struct' || plan.kind === 'union' || plan.kind === 'array');
  let stringifyBody = '';
  if (stringify && plan.kind === 'array') {
    stringifyBody = `let t;${textInto(plan, 'v', 't', '""', null, '""')}return t===null?'null':t;`;
  } else if (stringify) {
    stringifyBody = `return v==null?'null':${builderFns(plan)}(v);`;
  }
  const body = [
    '"use strict";',
    ...functions,
    `function encode(v){${encodeBody}}`,
    `function decode(v,strict){${decodeBody}}`,
    stringify ? `function stringify(v){${stringifyBody}}` : '',
    `return {encode,decode${stringify ? ',stringify' : ''}};`,
  ].join('\n');
  return { body, helpers };
};

const build = (plan, options) => {
  const { body, helpers } = generate(plan, options);
  // oxlint-disable-next-line no-new-func
  const factory = new Function('H', 'F', 'N', 'E', body);
  const codec = factory(helpers, fail, nest, refuse);
  // Off the public surface, for debugging through the codec symbol: generated
  // again when read, so a codec does not hold its source text.
  Object.defineProperty(codec, 'source', { get: () => generate(plan, options).body });
  return codec;
};

module.exports = { available, build };
