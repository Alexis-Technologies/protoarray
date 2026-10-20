// V2: an optional field appended, which keeps every position.
const { Schema } = require('@alexify/metaschema');

const User = new Schema('User', {
  id: 'integer',
  fullName: 'string',
  role: { enum: ['admin', 'user'] },
  email: '?string',
});

module.exports = { User };
