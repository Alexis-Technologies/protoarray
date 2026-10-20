// V3: an enum value appended (decoders go first) and a field with a default.
const { Schema } = require('@alexify/metaschema');

const User = new Schema('User', {
  id: 'integer',
  fullName: 'string',
  role: { enum: ['admin', 'user', 'guest'] },
  email: '?string',
  score: { type: 'number', default: 0 },
});

module.exports = { User };
