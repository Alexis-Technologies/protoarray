// Functional entry points over a compiled Schema. They do not compile a
// definition on the fly: compiling costs more than a call, and a literal in a
// hot loop would pay it every time.

const { SchemaDefinitionError } = require('./errors.js');
const { isSchema } = require('./plan.js');

const expect = (schema) => {
  if (isSchema(schema)) return schema;
  throw new SchemaDefinitionError('ERR_SCHEMA_EXPECTED', 'Schema instance expected');
};

const encode = (schema, value) => expect(schema).encode(value);

const decode = (schema, array, options) => expect(schema).decode(array, options);

const stringify = (schema, value) => expect(schema).stringify(value);

const parse = (schema, text, options) => expect(schema).parse(text, options);

module.exports = { encode, decode, stringify, parse };
