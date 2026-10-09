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
  'protoarray-columns': {
    name: 'protoarray (columns)',
    only: (scenario) => scenario.list === true,
    setup: (scenario) => {
      const schema = protoarray.Schema.from(
        { array: scenario.schema.definition },
        { layout: 'columns' },
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
      const toMessage = (value) => {
        const copy = { ...value };
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
          normalize: (message) => List.toObject(message, options).items,
        };
      }
      return {
        encode: (value) => Message.encode(toMessage(value)).finish(),
        decode: (buffer) => Message.decode(buffer),
        bytes: (buffer) => buffer.length,
        normalize: (message) => Message.toObject(message, options),
      };
    },
  },
  avsc: {
    name: 'avsc',
    setup: (scenario) => {
      const avro = require('avsc');
      const dates = dateFields(scenario);
      const record = avro.Type.forSchema(scenario.schema.avro, { wrapUnions: false });
      const type = scenario.list
        ? avro.Type.forSchema({ type: 'array', items: record }, { wrapUnions: false })
        : record;
      const prepare = (value) => {
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
        normalize: (value) => JSON.parse(JSON.stringify(value)),
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
