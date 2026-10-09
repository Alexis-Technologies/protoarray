// The codegen backend: every struct of the plan becomes one specialised
// encode function and one decode function through `new Function`. Array and
// object literals give V8 packed arrays and one shared hidden class per
// schema, so decoded objects are as cheap to use as the ones JSON.parse
// builds. This is the only file that may compile source text; the platform
// test enforces it.

const { fail, nest } = require('./errors.js');

const EXPECTED = { struct: 'object', array: 'array', tuple: 'tuple', ref: 'object' };
const str = JSON.stringify;

let available = true;
try {
  // oxlint-disable-next-line no-new-func
  const probe = new Function('return 1');
  available = probe() === 1;
} catch {
  available = false;
}

const build = (plan, options) => {
  const { validate } = options;
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
  const check = (node, v, path) => {
    if (!validate || node.check === null) return '';
    const test = node.pack === null ? `typeof ${v}==='${node.type}'` : `${slot(node)}.check(${v})`;
    return `if(!(${test}))F(${str(node.code)},${path},${str(node.expected)});`;
  };

  // Statements that set `dst` to the wire form of `src`; nullish src → null.
  const encodeInto = (node, src, dst) => {
    if (node.kind === 'scalar') return `${dst}=${src}==null?null:${pack(node, src)};`;
    if (node.kind === 'ref') {
      return `${dst}=${src}==null?null:${slot(node.slot)}.codec.encode(${src});`;
    }
    if (node.kind === 'struct') return `${dst}=${src}==null?null:${structFns(node).e}(${src});`;
    if (node.kind === 'tuple') {
      const parts = node.items.map(
        (item, i) => `${src}[${i}]==null?null:${pack(item.node, `${src}[${i}]`)}`,
      );
      return `${dst}=${src}==null?null:[${parts}];`;
    }
    const { item } = node;
    if (item.kind === 'scalar' && item.pack === null) return `${dst}=${src}==null?null:${src};`;
    const [n, i, r, x] = [uid('n'), uid('i'), uid('r'), uid('x')];
    return (
      `if(${src}==null)${dst}=null;else{const ${n}=${src}.length,${r}=new Array(${n});` +
      `for(let ${i}=0;${i}<${n};${i}++){let ${x};${encodeInto(item, `${src}[${i}]`, x)}` +
      `${r}[${i}]=${x};}${dst}=${r};}`
    );
  };

  // Statements that set `dst` from a non-null `src`. `path` is a source
  // expression evaluated only on error branches, relative to the enclosing
  // struct function: the caller prepends its own key through N.
  const decodeInto = (node, src, dst, path) => {
    if (node.kind === 'scalar') return `${check(node, src, path)}${dst}=${unpack(node, src)};`;
    if (node.kind === 'ref' || node.kind === 'struct') {
      const callee = node.kind === 'ref' ? `${slot(node.slot)}.codec.decode` : structFns(node).d;
      return `try{${dst}=${callee}(${src},strict);}catch(error){throw N(error,${path});}`;
    }
    const out = [`if(!Array.isArray(${src}))F('structure',${path},'array');`];
    if (node.kind === 'tuple') {
      const size = node.items.length;
      if (validate) out.push(`if(${src}.length!==${size})F('structure',${path},'length');`);
      const parts = node.items.map((item, i) => {
        const v = uid('v');
        out.push(`const ${v}=${src}[${i}];`);
        return slotValue(item.node, item.required, null, v, `${path}+${str(`[${i}]`)}`, out);
      });
      out.push(`${dst}=[${parts}];`);
      return out.join('');
    }
    const { item } = node;
    const [n, i, e, r, x] = [uid('n'), uid('i'), uid('e'), uid('r'), uid('x')];
    const at = `${path}+"["+${i}+"]"`;
    const expected = item.kind === 'scalar' ? item.expected : EXPECTED[item.kind];
    const nullCheck = node.itemRequired && validate ? `F('type',${at},${str(expected)});` : '';
    const loop = `const ${n}=${src}.length;for(let ${i}=0;${i}<${n};${i}++){const ${e}=${src}[${i}];`;
    if (item.kind === 'scalar' && item.pack === null) {
      const chk = check(item, e, at);
      if (chk !== '' || nullCheck !== '') {
        out.push(`${loop}if(${e}==null){${nullCheck}}else{${chk}}}`);
      }
      out.push(`${dst}=${src};`);
      return out.join('');
    }
    const body =
      item.kind === 'scalar'
        ? `${check(item, e, at)}${x}=${unpack(item, e)};`
        : decodeInto(item, e, x, at);
    out.push(
      `const ${r}=new Array(${src}.length);${loop}let ${x}=null;` +
        `if(${e}==null){${nullCheck}}else{${body}}${r}[${i}]=${x};}${dst}=${r};`,
    );
    return out.join('');
  };

  // One slot (a field or a tuple element): the required check, the wire
  // check, the default and the conversion. Returns the expression to use.
  const slotValue = (node, required, def, v, path, out) => {
    const req = required && validate ? `F('required',${path});` : '';
    const fallback = def === null ? 'null' : str(def);
    if (node.kind === 'scalar') {
      const chk = check(node, v, path);
      if (node.pack === null) {
        if (req !== '' || chk !== '') out.push(`if(${v}==null){${req}}else{${chk}}`);
        // A validated required slot is never nullish past its check; any other
        // slot normalises undefined to null (or to its default).
        return req !== '' ? v : `(${v}==null?${fallback}:${v})`;
      }
      const w = uid('w');
      out.push(`let ${w}=${fallback};if(${v}==null){${req}}else{${chk}${w}=${unpack(node, v)};}`);
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
    const enc = [];
    const values = [];
    for (const field of node.fields) {
      const v = uid('v');
      const w = uid('w');
      enc.push(`const ${v}=o[${str(field.key)}];`);
      if (field.node.kind === 'scalar') {
        enc.push(`const ${w}=${v}==null?null:${pack(field.node, v)};`);
      } else {
        enc.push(`let ${w};${encodeInto(field.node, v, w)}`);
      }
      values.push(w);
    }
    if (node.sparse) {
      enc.push('const r=[0];let m=0;');
      for (let i = 0; i < size; i++) {
        enc.push(`if(${values[i]}!==null){m|=${1 << i};r.push(${values[i]});}`);
      }
      enc.push('r[0]=m;return r;');
    } else if (node.tail === size) {
      enc.push(`return [${values}];`);
    } else {
      enc.push(
        `const r=[${values}];let l=${size};while(l>${node.tail}&&r[l-1]===null)l--;` +
          `if(l<${size})r.length=l;return r;`,
      );
    }
    functions.push(`function ${fns.e}(o){${enc.join('')}}`);
    const dec = [`if(!Array.isArray(a))F('structure',"",'array');`];
    let read;
    if (node.sparse) {
      dec.push(`const m=a[0];if((m|0)!==m)F('structure',"",'mask');let p=1;`);
      read = (i) => `(m&${1 << i})!==0?a[p++]:null`;
    } else {
      dec.push(`const n=a.length;if(strict&&n>${size})F('extra',"");`);
      read = (i) => `n>${i}?a[${i}]:null`;
    }
    const parts = [];
    for (const field of node.fields) {
      const v = uid('v');
      dec.push(`const ${v}=${read(field.index)};`);
      const value = slotValue(field.node, field.required, field.def, v, str(field.key), dec);
      parts.push(`${str(field.key)}:${value}`);
    }
    if (node.sparse) dec.push(`if(strict&&p!==a.length)F('extra',"");`);
    dec.push(`return {${parts}};`);
    functions.push(`function ${fns.d}(a,strict){${dec.join('')}}`);
    return fns;
  };

  let encodeBody;
  let decodeBody;
  if (plan.kind === 'struct') {
    const fns = structFns(plan);
    encodeBody = `return v==null?null:${fns.e}(v);`;
    decodeBody = `return ${fns.d}(v,strict);`;
  } else {
    const req = plan.kind === 'scalar' && validate && plan.required ? `F('required',"");` : '';
    encodeBody = `let w;${encodeInto(plan, 'v', 'w')}return w;`;
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
  // oxlint-disable-next-line no-new-func
  const factory = new Function('H', 'F', 'N', body);
  return factory(helpers, fail, nest);
};

module.exports = { available, build };
