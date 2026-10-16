// Schemas for the CLI tests, in metaschema: one embedded in another, and a
// recursion.
const { Schema } = require('@alexify/metaschema');

const Address = new Schema('Address', { city: 'string', zip: '?string' });

const User = new Schema('User', {
  id: 'integer',
  name: 'string',
  home: Address,
  'boss?': 'User',
  role: { enum: ['admin', 'user'] },
});

module.exports = { Address, User, notASchema: 1 };
