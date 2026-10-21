/**
 * One adapter per library and way of using it. The metadata names it in the
 * charts (`name` and `variant`), says where its version comes from
 * (`package`, null for a built-in) and whether it writes text or bytes
 * (`family`). `load(prepared)` requires the library, `setup(scenario, lib,
 * prepared)` builds the schema the way its documentation shows and returns
 * `{ encode, decode, normalize }`: `normalize` maps a decoded value to the
 * scenario's plain shape so the round trip can be checked before anything is
 * timed. Nothing is required at the top of this file, so a cold start
 * measures only the library it loads.
 *
 * `prepare(scenario)`, when present, runs in the parent process and returns
 * JSON the child gets (a snapshot, the path of a generated module): the work
 * a program does at build time or on its server, not when it starts.
 */

const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

// A scenario's definition is metaschema's, read with metaschema injected.
const definitionOf = (scenario) =>
  scenario.list ? { array: scenario.schema.definition } : scenario.schema.definition;

const dateFields = (scenario) => scenario.schema.dates || [];

// Dates travel as epoch ms in every binary format here, BigInts as strings,
// and a missing field is the same as a null one: the comparison is on values.
const plain = (value) => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) if (value[key] != null) out[key] = plain(value[key]);
    return out;
  }
  return value;
};

const text = (schema) => ({
  encode: (value) => schema.stringify(value),
  decode: (wire) => schema.parse(wire),
  normalize: plain,
});

const loadProtoarray = () => ({
  protoarray: require(path.join(ROOT, 'index.js')),
  metaschema: require('@alexify/metaschema'),
});

const fromDefinition = (lib, scenario, options) =>
  lib.protoarray.Schema.from(definitionOf(scenario), {
    metaschema: lib.metaschema,
    ...scenario.schema.options,
    ...options,
  });

// protobuf-es reads descriptors: the protobufjs JSON of a scenario becomes a
// FileDescriptorProto, embedded as base64 the way protoc-gen-es writes it into
// generated code (`fileDesc`), so the codec runs what a generated message does.
const protobufEsDescriptor = (scenario) => {
  const pb = require('@bufbuild/protobuf');
  const wkt = require('@bufbuild/protobuf/wkt');
  const { embedFileDesc } = require('@bufbuild/protobuf/codegenv2');
  const T = wkt.FieldDescriptorProto_Type;
  const L = wkt.FieldDescriptorProto_Label;
  const SCALARS = {
    string: T.STRING,
    int32: T.INT32,
    int64: T.INT64,
    bool: T.BOOL,
    double: T.DOUBLE,
  };
  const nested = { ...scenario.schema.proto.nested };
  if (scenario.list) {
    nested.List = { fields: { items: { rule: 'repeated', type: scenario.message, id: 1 } } };
  }
  const messageType = [];
  const enumType = [];
  for (const [name, type] of Object.entries(nested)) {
    if (type.values) {
      const value = Object.entries(type.values).map(([key, number]) => ({ name: key, number }));
      enumType.push({ name, value });
      continue;
    }
    const oneofs = Object.keys(type.oneofs || {});
    const field = Object.entries(type.fields).map(([key, item]) => {
      const scalar = SCALARS[item.type];
      const oneof = oneofs.findIndex((one) => type.oneofs[one].oneof.includes(key));
      return {
        name: key,
        jsonName: key,
        number: item.id,
        label: item.rule === 'repeated' ? L.REPEATED : L.OPTIONAL,
        type: scalar ?? (nested[item.type].values ? T.ENUM : T.MESSAGE),
        typeName: scalar === undefined ? `.${item.type}` : undefined,
        oneofIndex: oneof === -1 ? undefined : oneof,
        proto3Optional: item.options?.proto3_optional === true,
      };
    });
    messageType.push({ name, field, oneofDecl: oneofs.map((one) => ({ name: one })) });
  }
  const file = pb.create(wkt.FileDescriptorProtoSchema, {
    name: 'bench.proto',
    syntax: 'proto3',
    messageType,
    enumType,
  });
  return embedFileDesc(file).base64();
};

// The value → message init and message → value conversions a program writes
// around protobuf-es: enums are numbers there, 64-bit integers BigInts and a
// oneof `{ case, value }`. Compiled once per message type.
const protobufEsCodec = (pb, desc) => {
  const INT64 = pb.ScalarType.INT64;
  const toInit = new Map();
  const toValue = new Map();
  const scalarIn = (kind) =>
    kind === INT64 ? (v) => BigInt(v instanceof Date ? v.getTime() : v) : (v) => v;
  const scalarOut = (kind) => (kind === INT64 ? (v) => Number(v) : (v) => v);
  const enumIn = (type) => {
    const numbers = Object.fromEntries(type.values.map((item) => [item.name, item.number]));
    return (v) => numbers[v];
  };
  const enumOut = (type) => {
    const names = Object.fromEntries(type.values.map((item) => [item.number, item.name]));
    return (v) => names[v];
  };
  const fieldIn = (field) => {
    const kind = field.fieldKind === 'list' ? field.listKind : field.fieldKind;
    const one =
      kind === 'message'
        ? (v) => buildIn(field.message)(v)
        : kind === 'enum'
          ? enumIn(field.enum)
          : scalarIn(field.scalar);
    return field.fieldKind === 'list' ? (v) => v.map(one) : one;
  };
  const fieldOut = (field) => {
    const kind = field.fieldKind === 'list' ? field.listKind : field.fieldKind;
    const one =
      kind === 'message'
        ? (v) => buildOut(field.message)(v)
        : kind === 'enum'
          ? enumOut(field.enum)
          : scalarOut(field.scalar);
    return field.fieldKind === 'list' ? (v) => v.map(one) : one;
  };
  const buildIn = (message) => {
    if (toInit.has(message)) return toInit.get(message);
    const fields = message.fields;
    const converters = fields.map(fieldIn);
    const fn = (value) => {
      const init = {};
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        const v = value[field.localName];
        if (v == null) continue;
        const converted = converters[i](v);
        if (field.oneof) init[field.oneof.localName] = { case: field.localName, value: converted };
        else init[field.localName] = converted;
      }
      return init;
    };
    toInit.set(message, fn);
    return fn;
  };
  const buildOut = (message) => {
    if (toValue.has(message)) return toValue.get(message);
    const fields = message.fields.map((field) => ({ field, convert: fieldOut(field) }));
    const fn = (decoded) => {
      const value = {};
      for (const { field, convert } of fields) {
        if (field.oneof) {
          const one = decoded[field.oneof.localName];
          if (one.case === field.localName) value[field.localName] = convert(one.value);
        } else if (decoded[field.localName] !== undefined) {
          value[field.localName] = convert(decoded[field.localName]);
        }
      }
      return value;
    };
    toValue.set(message, fn);
    return fn;
  };
  return { toInit: buildIn(desc), toValue: buildOut(desc) };
};

const ADAPTERS = {
  json: {
    name: 'JSON',
    variant: 'stringify · parse',
    package: null,
    family: 'text',
    load: () => null,
    setup: (scenario) => {
      const dates = dateFields(scenario);
      // JSON writes dates as ISO strings; read them back as timestamps.
      const revive = (item) => {
        for (const key of dates) item[key] = new Date(item[key]).getTime();
        return item;
      };
      return {
        encode: (value) => JSON.stringify(value),
        decode: (wire) => JSON.parse(wire),
        normalize: (value) =>
          dates.length === 0 ? value : scenario.list ? value.map(revive) : revive(value),
      };
    },
  },
  protoarray: {
    name: 'protoarray',
    variant: 'codegen',
    package: '@alexify/protoarray',
    family: 'text',
    load: loadProtoarray,
    setup: (scenario, lib) => text(fromDefinition(lib, scenario, { codegen: true })),
  },
  // A client that gets its schemas as snapshots from its server: protoarray
  // alone, no metaschema. The same codec as `protoarray`, so it is timed only
  // for the cold start.
  'protoarray-snapshot': {
    name: 'protoarray',
    variant: 'codegen, from a snapshot',
    package: '@alexify/protoarray',
    family: 'text',
    coldStartOnly: true,
    prepare: (scenario) => {
      const lib = loadProtoarray();
      return { snapshot: fromDefinition(lib, scenario).snapshot };
    },
    load: () => require(path.join(ROOT, 'index.js')),
    setup: (scenario, protoarray, prepared) =>
      text(
        protoarray.Schema.from(prepared.snapshot, {
          ...scenario.schema.options,
          codegen: true,
        }),
      ),
  },
  'protoarray-closures': {
    name: 'protoarray',
    variant: 'closures, no eval',
    package: '@alexify/protoarray',
    family: 'text',
    load: loadProtoarray,
    setup: (scenario, lib) => text(fromDefinition(lib, scenario, { codegen: false })),
  },
  // The same codec as a module generated at build time with its own runtime:
  // what a strict CSP or an edge runtime gets instead of the closures backend.
  'protoarray-standalone': {
    name: 'protoarray',
    variant: 'standalone module, no eval',
    package: '@alexify/protoarray',
    family: 'text',
    prepare: (scenario) => {
      const fs = require('node:fs');
      const os = require('node:os');
      const { toSource } = require(path.join(ROOT, 'standalone.js'));
      const lib = loadProtoarray();
      const source = toSource(fromDefinition(lib, scenario), { runtime: 'inline' });
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoarray-bench-'));
      const file = path.join(dir, `${scenario.name}.js`);
      fs.writeFileSync(file, source);
      return { file };
    },
    load: (prepared) => require(prepared.file),
    setup: (scenario, schema) => text(schema),
  },
  // The reference row with the values checked before encode, by metaschema's
  // check of the same schema: what validation costs.
  'protoarray-checked': {
    name: 'protoarray',
    variant: 'codegen + metaschema check',
    package: '@alexify/protoarray',
    family: 'text',
    coldStart: false,
    load: loadProtoarray,
    setup: (scenario, lib) => {
      const schema = fromDefinition(lib, scenario, { codegen: true });
      const definition = schema.source;
      return {
        encode: (value) => {
          if (!definition.check(value).valid) throw new TypeError('invalid value');
          return schema.stringify(value);
        },
        decode: (wire) => schema.parse(wire),
        normalize: plain,
      };
    },
  },
  'protoarray-columns': {
    name: 'protoarray',
    variant: 'columns layout',
    package: '@alexify/protoarray',
    family: 'text',
    coldStart: false,
    only: (scenario) => scenario.list === true && scenario.schema.definition.union === undefined,
    load: loadProtoarray,
    setup: (scenario, lib) => text(fromDefinition(lib, scenario, { layout: 'columns' })),
  },
  // Columns with the integer id written as differences and the strings of
  // few distinct values interned (a city, the tags): interning unique strings
  // (names, emails) only adds a table of them, which compresses worse.
  'protoarray-compact': {
    name: 'protoarray',
    variant: 'columns, delta + intern',
    package: '@alexify/protoarray',
    family: 'text',
    coldStart: false,
    only: (scenario) => scenario.name === 'records',
    load: loadProtoarray,
    setup: (scenario, lib) => {
      const record = { ...scenario.schema.definition, id: 'integer' };
      const schema = lib.protoarray.Schema.from(
        { array: record },
        {
          metaschema: lib.metaschema,
          ...scenario.schema.options,
          layout: 'columns',
          delta: ['[].id'],
          intern: ['[].address.city', '[].tags[]'],
        },
      );
      return text(schema);
    },
  },
  // The same schema on the binary wire (`@alexify/protoarray/binary`): the
  // codec is built on the first call, which the cold start counts.
  'protoarray-binary': {
    name: 'protoarray',
    variant: 'binary wire',
    package: '@alexify/protoarray',
    family: 'binary',
    load: () => ({ ...loadProtoarray(), binary: require(path.join(ROOT, 'binary.js')) }),
    setup: (scenario, lib) => {
      const schema = fromDefinition(lib, scenario);
      const { toBinary, fromBinary } = lib.binary;
      return {
        encode: (value) => toBinary(schema, value),
        decode: (bytes) => fromBinary(schema, bytes),
        normalize: plain,
      };
    },
  },
  protobufjs: {
    name: 'protobufjs',
    variant: 'reflection, Root.fromJSON',
    package: 'protobufjs',
    family: 'binary',
    load: () => require('protobufjs'),
    setup: (scenario, protobuf) => {
      const root = protobuf.Root.fromJSON(scenario.schema.proto);
      const Message = root.lookupType(scenario.message);
      const dates = dateFields(scenario);
      // A tagged union travels as a oneof, which has its own shape.
      const { toProto = (value) => value, fromProto = (value) => value } = scenario.schema;
      const toMessage = (value) => {
        const copy = toProto({ ...value });
        for (const key of dates) copy[key] = value[key].getTime();
        return Message.fromObject(copy);
      };
      const options = { longs: Number, enums: String, defaults: true, arrays: true, objects: true };
      if (scenario.list) {
        const List = new protobuf.Type('List').add(
          new protobuf.Field('items', 1, scenario.message, 'repeated'),
        );
        root.add(List);
        return {
          encode: (value) => List.encode({ items: value.map(toMessage) }).finish(),
          decode: (buffer) => List.decode(buffer),
          normalize: (message) => List.toObject(message, options).items.map(fromProto),
        };
      }
      return {
        encode: (value) => Message.encode(toMessage(value)).finish(),
        decode: (buffer) => Message.decode(buffer),
        normalize: (message) => fromProto(Message.toObject(message, options)),
      };
    },
  },
  'protobuf-es': {
    name: 'protobuf-es',
    variant: 'create · toBinary · fromBinary',
    package: '@bufbuild/protobuf',
    family: 'binary',
    prepare: (scenario) => ({ descriptor: protobufEsDescriptor(scenario) }),
    load: () => ({
      pb: require('@bufbuild/protobuf'),
      codegen: require('@bufbuild/protobuf/codegenv2'),
    }),
    setup: (scenario, { pb, codegen }, prepared) => {
      const file = codegen.fileDesc(prepared.descriptor);
      const name = scenario.list ? 'List' : scenario.message;
      const desc = file.messages.find((message) => message.name === name);
      const { toInit, toValue } = protobufEsCodec(pb, desc);
      const { toProto = (value) => value, fromProto = (value) => value } = scenario.schema;
      const prepare = scenario.list
        ? (value) => toInit({ items: value.map(toProto) })
        : (value) => toInit(toProto(value));
      return {
        encode: (value) => pb.toBinary(desc, pb.create(desc, prepare(value))),
        decode: (buffer) => pb.fromBinary(desc, buffer),
        normalize: (message) =>
          scenario.list ? toValue(message).items.map(fromProto) : fromProto(toValue(message)),
      };
    },
  },
  avsc: {
    name: 'avsc',
    variant: 'Type.forSchema',
    package: 'avsc',
    family: 'binary',
    load: () => require('avsc'),
    setup: (scenario, avro) => {
      const dates = dateFields(scenario);
      // A union of records needs wrapped values: { Call: {...} }.
      const wrapUnions = scenario.schema.wrapUnions === true;
      const { toAvro, fromAvro = (value) => value } = scenario.schema;
      const record = avro.Type.forSchema(scenario.schema.avro, { wrapUnions });
      const type = scenario.list
        ? avro.Type.forSchema({ type: 'array', items: record }, { wrapUnions })
        : record;
      const prepare = (value) => {
        if (toAvro !== undefined) return scenario.list ? value.map(toAvro) : toAvro(value);
        if (dates.length === 0 && scenario.name !== 'sparse') return value;
        const one = (item) => {
          const copy = {};
          for (const key of Object.keys(item)) {
            copy[key] = item[key] instanceof Date ? item[key].getTime() : item[key];
          }
          return copy;
        };
        return scenario.list ? value.map(one) : one(value);
      };
      return {
        encode: (value) => type.toBuffer(prepare(value)),
        decode: (buffer) => type.fromBuffer(buffer),
        normalize: (value) => {
          const json = JSON.parse(JSON.stringify(value));
          return scenario.list ? json.map(fromAvro) : fromAvro(json);
        },
      };
    },
  },
  msgpackr: {
    name: 'msgpackr',
    variant: 'pack · unpack',
    package: 'msgpackr',
    family: 'binary',
    coldStart: false,
    load: () => require('msgpackr'),
    setup: (scenario, { pack, unpack }) => ({
      encode: (value) => pack(value),
      decode: (buffer) => unpack(buffer),
      normalize: plain,
    }),
  },
  'msgpackr-records': {
    name: 'msgpackr',
    variant: 'records, shared structures',
    package: 'msgpackr',
    family: 'binary',
    load: () => require('msgpackr'),
    setup: (scenario, { Packr }) => {
      const packr = new Packr({ useRecords: true, structures: [] });
      return {
        encode: (value) => packr.pack(value),
        decode: (buffer) => packr.unpack(buffer),
        normalize: plain,
      };
    },
  },
  msgpack: {
    name: '@msgpack/msgpack',
    variant: 'Encoder · Decoder',
    package: '@msgpack/msgpack',
    family: 'binary',
    load: () => require('@msgpack/msgpack'),
    setup: (scenario, { Encoder, Decoder }) => {
      const encoder = new Encoder();
      const decoder = new Decoder();
      return {
        encode: (value) => encoder.encode(value),
        decode: (buffer) => decoder.decode(buffer),
        normalize: plain,
      };
    },
  },
  'cbor-x': {
    name: 'cbor-x',
    variant: 'records',
    package: 'cbor-x',
    family: 'binary',
    load: () => require('cbor-x'),
    setup: (scenario, { Encoder }) => {
      const encoder = new Encoder({ useRecords: true });
      return {
        encode: (value) => encoder.encode(value),
        decode: (buffer) => encoder.decode(buffer),
        normalize: plain,
      };
    },
  },
  bson: {
    name: 'BSON',
    variant: 'serialize · deserialize',
    package: 'bson',
    family: 'binary',
    load: () => require('bson'),
    // A BSON document is an object: a list travels as one field of it.
    setup: (scenario, { BSON }) => ({
      encode: scenario.list
        ? (value) => BSON.serialize({ items: value })
        : (value) => BSON.serialize(value),
      decode: (buffer) => BSON.deserialize(buffer),
      normalize: (document) => plain(scenario.list ? document.items : document),
    }),
  },
  v8: {
    name: 'v8.serialize',
    variant: 'structured clone, Node only',
    package: null,
    family: 'binary',
    load: () => require('node:v8'),
    setup: (scenario, v8) => ({
      encode: (value) => v8.serialize(value),
      decode: (buffer) => v8.deserialize(buffer),
      normalize: plain,
    }),
  },
  superjson: {
    name: 'superjson',
    variant: 'stringify · parse',
    package: 'superjson',
    family: 'text',
    load: () => require('superjson'),
    setup: (scenario, superjson) => ({
      encode: (value) => superjson.stringify(value),
      decode: (wire) => superjson.parse(wire),
      normalize: plain,
    }),
  },
  devalue: {
    name: 'devalue',
    variant: 'stringify · parse',
    package: 'devalue',
    family: 'text',
    load: () => require('devalue'),
    setup: (scenario, devalue) => ({
      encode: (value) => devalue.stringify(value),
      decode: (wire) => devalue.parse(wire),
      normalize: plain,
    }),
  },
  'fast-json-stringify': {
    name: 'fast-json-stringify',
    variant: 'compiled stringify, JSON.parse',
    package: 'fast-json-stringify',
    family: 'text',
    only: (scenario) => scenario.schema.json !== undefined,
    load: () => require('fast-json-stringify'),
    setup: (scenario, fjs) => {
      const schema = scenario.list
        ? { type: 'array', items: scenario.schema.json }
        : scenario.schema.json;
      const stringify = fjs(schema);
      return {
        encode: (value) => stringify(value),
        decode: (wire) => JSON.parse(wire),
        normalize: (value) => value,
      };
    },
  },
};

module.exports = { ADAPTERS, plain };
