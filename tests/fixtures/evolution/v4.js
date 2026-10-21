// V4: incompatible by position (a type widened, a field renamed, the enum
// values reordered, a default added), and a Model, whose entities the CLI
// exports under their own names.
const { Schema, Model } = require('@alexify/metaschema');

const User = new Schema('User', {
  id: 'number',
  name: { type: 'string', aliases: ['fullName'] },
  role: { enum: ['guest', 'user', 'admin'] },
  email: { type: 'string', default: '' },
  score: { type: 'number', default: 0 },
});

const model = new Model(
  {},
  new Map([
    ['Address', { Struct: {}, city: 'string', zip: '?string' }],
    ['Contact', { Struct: {}, home: 'Address', phone: '?string' }],
  ]),
);

module.exports = { User, model };
