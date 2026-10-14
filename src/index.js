const { Schema } = require('./schema.js');
const { encode, decode, stringify, parse, check } = require('./codec.js');
const { SchemaDefinitionError, EncodeError, DecodeError } = require('./errors.js');

module.exports = {
  Schema,
  encode,
  decode,
  stringify,
  parse,
  check,
  SchemaDefinitionError,
  EncodeError,
  DecodeError,
};
