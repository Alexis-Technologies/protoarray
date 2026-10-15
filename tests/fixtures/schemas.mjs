// An ES module whose default export is a schema, for the CLI tests.
import { Schema } from '@alexify/protoarray';

export default Schema.from({ id: 'integer', at: 'date' });
