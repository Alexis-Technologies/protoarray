/**
 * One adapter per library. `setup(scenario)` compiles the schema outside the
 * timed loop and returns `{ encode, decode, bytes }`; `normalize` maps a
 * decoded value to the scenario's plain shape so the round trip can be
 * checked before anything is timed.
 */

const protoarray = require('../../index.js');

const listOf = (scenario, definition, options) =>
  scenario.list
    ? protoarray.Schema.from({ array: definition }, options)
    : protoarray.Schema.from(definition, options);

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

const ADAPTERS = {
  json: {
    name: 'JSON',
    setup: (scenario) => {
      const dates = dateFields(scenario);
      // JSON writes dates as ISO strings; read them back as timestamps.
      const revive = (item) => {
        for (const key of dates) item[key] = new Date(item[key]).getTime();
        return item;
      };
      return {
        encode: (value) => JSON.stringify(value),
        decode: (text) => JSON.parse(text),
        bytes: (text) => Buffer.byteLength(text),
        normalize: (value) =>
          dates.length === 0 ? value : scenario.list ? value.map(revive) : revive(value),
      };
    },
  },
  protoarray: {
    name: 'protoarray (codegen)',
    setup: (scenario) => {
      const schema = listOf(scenario, scenario.schema.definition, {
        ...scenario.schema.options,
        codegen: true,
      });
      return {
        encode: (value) => schema.stringify(value),
        decode: (text) => schema.parse(text),
        bytes: (text) => Buffer.byteLength(text),
        normalize: (value) => plain(value),
      };
    },
  },
  'protoarray-closures': {
    name: 'protoarray (closures)',
    setup: (scenario) => {
      const schema = listOf(scenario, scenario.schema.definition, {
        ...scenario.schema.options,
        codegen: false,
      });
      return {
        encode: (value) => schema.stringify(value),
        decode: (text) => schema.parse(text),
        bytes: (text) => Buffer.byteLength(text),
        normalize: (value) => plain(value),
      };
    },
  },
  // The reference row with the values checked on encode too: what validation costs.
  'protoarray-both': {
    name: "protoarray (codegen, validate: 'both')",
    setup: (scenario) => {
      const schema = listOf(scenario, scenario.schema.definition, {
        ...scenario.schema.options,
        codegen: true,
        validate: 'both',
      });
      return {
        encode: (value) => schema.stringify(value),
        decode: (text) => schema.parse(text),
        bytes: (text) => Buffer.byteLength(text),
        normalize: (value) => plain(value),
      };
    },
  },
  'protoarray-columns': {
    name: 'protoarray (columns)',
    only: (scenario) => scenario.list === true && scenario.schema.definition.union === undefined,
    setup: (scenario) => {
      const schema = protoarray.Schema.from(
        { array: scenario.schema.definition },
        { ...scenario.schema.options, layout: 'columns' },
      );
      return {
        encode: (value) => schema.stringify(value),
        decode: (text) => schema.parse(text),
        bytes: (text) => Buffer.byteLength(text),
        normalize: (value) => plain(value),
      };
    },
  },
  // The same codec as a generated module with its own runtime: what a strict
  // CSP or an edge runtime gets instead of the closures backend.
  'protoarray-standalone': {
    name: 'protoarray (standalone, inline)',
    setup: (scenario) => {
      const vm = require('node:vm');
      const { toSource } = require('../../standalone.js');
      const source = toSource(
        listOf(scenario, scenario.schema.definition, scenario.schema.options),
        {
          runtime: 'inline',
        },
      );
      const module = { exports: {} };
      vm.runInThisContext(`(function (module) {${source}\n})`)(module);
      const schema = module.exports;
      return {
        encode: (value) => schema.stringify(value),
        decode: (text) => schema.parse(text),
        bytes: (text) => Buffer.byteLength(text),
        normalize: (value) => plain(value),
      };
    },
  },
  // Columns with the integer id written as differences and the strings of
  // few distinct values interned (a city, the tags): interning unique strings
  // (names, emails) only adds a table of them, which compresses worse.
  'protoarray-compact': {
    name: 'protoarray (columns, delta + intern)',
    only: (scenario) => scenario.name === 'records',
    setup: (scenario) => {
      const { definition } = scenario.schema;
      const interned = { type: 'string', intern: true };
      const record = {
        ...definition,
        id: { type: 'integer', delta: true },
        address: { ...definition.address, city: interned },
        tags: { array: interned },
      };
      const schema = protoarray.Schema.from(
        { array: record },
        { ...scenario.schema.options, layout: 'columns' },
      );
      return {
        encode: (value) => schema.stringify(value),
        decode: (text) => schema.parse(text),
        bytes: (text) => Buffer.byteLength(text),
        normalize: (value) => plain(value),
      };
    },
  },
  protobufjs: {
    name: 'protobufjs',
    setup: (scenario) => {
      const protobuf = require('protobufjs');
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
          bytes: (buffer) => buffer.length,
          normalize: (message) => List.toObject(message, options).items.map(fromProto),
        };
      }
      return {
        encode: (value) => Message.encode(toMessage(value)).finish(),
        decode: (buffer) => Message.decode(buffer),
        bytes: (buffer) => buffer.length,
        normalize: (message) => fromProto(Message.toObject(message, options)),
      };
    },
  },
  avsc: {
    name: 'avsc',
    setup: (scenario) => {
      const avro = require('avsc');
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
        bytes: (buffer) => buffer.length,
        normalize: (value) => {
          const json = JSON.parse(JSON.stringify(value));
          return scenario.list ? json.map(fromAvro) : fromAvro(json);
        },
      };
    },
  },
  msgpackr: {
    name: 'msgpackr',
    setup: () => {
      const { pack, unpack } = require('msgpackr');
      return {
        encode: (value) => pack(value),
        decode: (buffer) => unpack(buffer),
        bytes: (buffer) => buffer.length,
        normalize: (value) => plain(value),
      };
    },
  },
  'msgpackr-records': {
    name: 'msgpackr (records, shared structures)',
    setup: () => {
      const { Packr } = require('msgpackr');
      const structures = [];
      const packr = new Packr({ useRecords: true, structures });
      return {
        encode: (value) => packr.pack(value),
        decode: (buffer) => packr.unpack(buffer),
        bytes: (buffer) => buffer.length,
        normalize: (value) => plain(value),
      };
    },
  },
  msgpack: {
    name: '@msgpack/msgpack',
    setup: () => {
      const { Encoder, Decoder } = require('@msgpack/msgpack');
      const encoder = new Encoder();
      const decoder = new Decoder();
      return {
        encode: (value) => encoder.encode(value),
        decode: (buffer) => decoder.decode(buffer),
        bytes: (buffer) => buffer.length,
        normalize: (value) => plain(value),
      };
    },
  },
  'cbor-x': {
    name: 'cbor-x (records)',
    setup: () => {
      const { Encoder } = require('cbor-x');
      const encoder = new Encoder({ useRecords: true });
      return {
        encode: (value) => encoder.encode(value),
        decode: (buffer) => encoder.decode(buffer),
        bytes: (buffer) => buffer.length,
        normalize: (value) => plain(value),
      };
    },
  },
  'fast-json-stringify': {
    name: 'fast-json-stringify (encode) + JSON.parse',
    only: (scenario) => scenario.schema.json !== undefined,
    setup: (scenario) => {
      const fjs = require('fast-json-stringify');
      const schema = scenario.list
        ? { type: 'array', items: scenario.schema.json }
        : scenario.schema.json;
      const stringify = fjs(schema);
      return {
        encode: (value) => stringify(value),
        decode: (text) => JSON.parse(text),
        bytes: (text) => Buffer.byteLength(text),
        normalize: (value) => value,
      };
    },
  },
};

module.exports = { ADAPTERS, plain };
