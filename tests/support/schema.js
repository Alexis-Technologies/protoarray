// Schemas for the suites, built the way protoarray 2.0 builds them from a
// definition: metaschema reads it, injected through the `metaschema` option.
const ms = require('@alexify/metaschema');
const { Schema } = require('../../index.js');

// A nameless schema of a definition, as Schema.from builds one.
const define = (definition, options) => Schema.from(definition, { metaschema: ms, ...options });

// A schema with a name: a reference to that name is a recursion.
const named = (name, definition, options) =>
  new Schema(name, definition, { metaschema: ms, ...options });

// The entities of a model, by name: references between them by name, a
// recursion included. `types` are the custom types of the model.
const model = (entities, options, types = {}) =>
  Schema.fromModel(new ms.Model(types, new Map(Object.entries(entities))), options);

module.exports = { ms, define, named, model };
