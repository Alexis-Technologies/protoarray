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
      if (!validate.encode || node.accept === null) {
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
      const valueNull = node.valueRequired ? 'type' : null;
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
      const valueNull = node.valueRequired ? 'type' : null;
      const isObject = `if(typeof ${src}!=='object'||Array.isArray(${src}))E('object',${path});`;
      const loop = `const ${ks}=Object.keys(${src});for(let ${i}=0;${i}<${ks}.length;${i}++){const ${k}=${ks}[${i}];let ${x};`;
      if (value.kind === 'scalar' && value.pack === null) {
        // Identity values travel in the same object: at most a checking pass.
        const pass =
          validate.encode && (value.accept !== null || node.valueRequired)
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
        const required = item.required ? 'required' : null;
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
    const itemNull = node.itemRequired ? 'type' : null;
    if (item.kind === 'scalar' && item.pack === null) {
      // Identity items travel in the same array: at most a checking pass.
      const pass =
        validate.encode && (item.accept !== null || node.itemRequired)
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
      const parts = node.items.map((item, i) => {
        const v = uid('v');
        out.push(`const ${v}=${src}[${i}];`);
        return slotValue(item.node, item.required, item.def, v, `${path}+${str(`[${i}]`)}`, out);
      });
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
      const v = uid('v');
      const w = uid('w');
      const key = str(field.key);
      const required = field.required ? 'required' : null;
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
    for (const field of node.fields) {
      const v = uid('v');
      // A later segment may be missing: its fields are all null.
      if (node.sparse && field.index > 0 && field.index % WORD === 0) {
        dec.push(`m=p<a.length?a[p++]:0;${mask}`);
      }
      dec.push(`const ${v}=${read(field.index)};`);
      const value = slotValue(field.node, field.required, field.def, v, str(field.key), dec);
      parts.push(`${str(field.key)}:${value}`);
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
    const cases = (call) => {
      const out = [];
      for (const branch of node.branches) {
        for (let i = 0; i < branch.count; i++) out.push(`case ${branch.first + i}:`);
        out.push(`return ${call(structFns(branch.node))};`);
      }
      return out.join('');
    };
    functions.push(
      `function ${fns.e}(o){if(typeof o!=='object'||Array.isArray(o))E('object','');const v=o[${key}];` +
        `const t=${tag}.checkedPack(v);switch(t){${cases((f) => `${f.e}(o,t)`)}}` +
        `E('union',${key},${expected});}`,
    );
    functions.push(
      `function ${fns.d}(a,strict){if(!Array.isArray(a))F('structure',"",'array');const t=a[0];` +
        `if(!${tag}.check(t))F('union',${key},${expected});` +
        `switch(t){${cases((f) => `${f.d}(a,strict,t)`)}}}`,
    );
    return fns;
  };

  const record = (node) => (node.kind === 'union' ? unionFns(node) : structFns(node));

  let encodeBody;
  let decodeBody;
  if (plan.kind === 'struct' || plan.kind === 'union') {
    const fns = record(plan);
    encodeBody = `return v==null?null:${fns.e}(v);`;
    decodeBody = `return ${fns.d}(v,strict);`;
  } else {
    const required = plan.kind === 'scalar' && plan.required;
    const req = required && validate.decode ? `F('required',"");` : '';
    encodeBody = `let w;${encodeInto(plan, 'v', 'w', '""', required ? 'required' : null)}return w;`;
    decodeBody =
      plan.kind === 'scalar'
        ? `let w=null;if(v==null){${req}}else{${decodeInto(plan, 'v', 'w', '""')}}return w;`
        : `let w;${decodeInto(plan, 'v', 'w', '""')}return w;`;
  }
  const body = [
    '"use strict";',
    ...functions,
    `function encode(v){${encodeBody}}`,
    `function decode(v,strict){${decodeBody}}`,
    'return {encode,decode};',
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
