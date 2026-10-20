// Four versions of the User record of the evolution guide, for the CLI tests:
// V1 is where it starts.
const { Schema } = require('@alexify/metaschema');

const User = new Schema('User', {
  id: 'integer',
  fullName: 'string',
  role: { enum: ['admin', 'user'] },
});

module.exports = { User };
