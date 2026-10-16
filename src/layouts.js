// Collection layouts over a record codec. `rows` is the codec itself; `flat`
// concatenates fixed-width rows into one array, `columns` transposes them.
// Both are plain loops over the record functions, so they are the same for
// either backend.
//
// The root of an interned schema is a wrapper here too: it sets the message's
// string table for the length of one call.

// A closed function of the errors and the type table, run once, so that
// standalone.js can embed its source.
const kernel = (errors, types) => {
  const { fail, nest, refuse } = errors;
  const { INTERN } = types;

  // A row of exactly `size` slots; a null record is a run of nulls, which
  // decodes as a record of nulls, not as null.
  const padded = (item, record, size, index) => {
    let row = [];
    if (record != null) {
      try {
        row = item.encode(record);
      } catch (error) {
        throw nest(error, `[${index}]`);
      }
    }
    while (row.length < size) row.push(null);
    return row;
  };

  const records = (item, count, read, strict) => {
    const out = new Array(count);
    for (let i = 0; i < count; i++) {
      try {
        out[i] = item.decode(read(i), strict);
      } catch (error) {
        throw nest(error, `[${i}]`);
      }
    }
    return out;
  };

  const flat = (item, record) => {
    const size = record.fields.length;
    return {
      encode: (list) => {
        if (!Array.isArray(list)) refuse('array', '');
        const out = [];
        for (let i = 0; i < list.length; i++) {
          out.push(...padded(item, list[i], size, i));
        }
        return out;
      },
      decode: (array, strict) => {
        if (!Array.isArray(array)) fail('structure', '', 'array');
        if (array.length % size !== 0) fail('structure', '', 'length');
        const read = (i) => array.slice(i * size, i * size + size);
        return records(item, array.length / size, read, strict);
      },
    };
  };

  // A `delta` column travels as its first value and the differences between
  // neighbours, nulls kept in place; the differences of integers only are exact,
  // so the values are checked whatever `validate` says. Errors name the record
  // and the field, as the record's own would.
  const differences = (column, delta) => {
    let base = 0;
    for (let i = 0; i < column.length; i++) {
      const value = column[i];
      if (value === null) continue;
      const difference = Number.isSafeInteger(value) ? value - base : NaN;
      if (!Number.isSafeInteger(difference)) refuse('type', `[${i}].${delta.key}`, delta.expected);
      column[i] = difference;
      base = value;
    }
  };

  const sums = (column, delta, validate) => {
    const out = new Array(column.length);
    let base = 0;
    for (let i = 0; i < column.length; i++) {
      const value = column[i];
      if (typeof value !== 'number') {
        if (validate && value != null) fail('type', `[${i}].${delta.key}`, delta.expected);
        out[i] = value;
        continue;
      }
      base += value;
      if (validate && (!Number.isSafeInteger(value) || !Number.isSafeInteger(base))) {
        fail('type', `[${i}].${delta.key}`, delta.expected);
      }
      out[i] = base;
    }
    return out;
  };

  const columns = (item, record, validate) => {
    const size = record.fields.length;
    const deltas = [];
    for (const field of record.fields) {
      if (field.node.delta !== true) continue;
      // A field of a resolved record the reader does not have keeps the writer's key.
      const key = field.key === null ? field.wire : field.key;
      deltas.push({ index: field.index, key, expected: field.node.expected });
    }
    return {
      encode: (list) => {
        if (!Array.isArray(list)) refuse('array', '');
        const out = [];
        for (let j = 0; j < size; j++) out.push(new Array(list.length));
        for (let i = 0; i < list.length; i++) {
          const row = padded(item, list[i], size, i);
          for (let j = 0; j < size; j++) out[j][i] = row[j];
        }
        for (const delta of deltas) differences(out[delta.index], delta);
        return out;
      },
      decode: (array, strict) => {
        if (!Array.isArray(array)) fail('structure', '', 'array');
        if (strict && array.length > size) fail('extra', '');
        const cols = [];
        // The record count comes from the first column present: a column that is
        // missing or null stands for a column of nulls.
        let count = -1;
        for (let j = 0; j < size; j++) {
          const column = j < array.length ? array[j] : null;
          if (column !== null) {
            if (!Array.isArray(column)) fail('structure', `[${j}]`, 'array');
            if (count === -1) count = column.length;
            else if (column.length !== count) fail('structure', `[${j}]`, 'length');
          }
          cols.push(column);
        }
        for (const delta of deltas) {
          const column = cols[delta.index];
          if (column !== null) cols[delta.index] = sums(column, delta, validate.decode);
        }
        const read = (i) => cols.map((column) => (column === null ? null : column[i]));
        return records(item, count === -1 ? 0 : count, read, strict);
      },
    };
  };

  // The root codec of an interned schema: the message's string table is set
  // for the length of one call, and the payload carries it. A codec called
  // inside one (an embedded schema, a record of a layout) finds it set and
  // uses it.
  const withTable = (codec, validate) => ({
    encode: (value) => {
      if (INTERN.table !== null) return codec.encode(value);
      INTERN.table = [];
      INTERN.map = new Map();
      try {
        const body = codec.encode(value);
        return [INTERN.table, body];
      } finally {
        INTERN.table = null;
        INTERN.map = null;
      }
    },
    decode: (wire, strict) => {
      if (INTERN.table !== null) return codec.decode(wire, strict);
      if (!Array.isArray(wire) || wire.length !== 2 || !Array.isArray(wire[0])) {
        fail('structure', '', 'intern');
      }
      const table = wire[0];
      if (validate && !table.every((entry) => typeof entry === 'string')) {
        fail('structure', '', 'intern');
      }
      INTERN.table = table;
      try {
        return codec.decode(wire[1], strict);
      } finally {
        INTERN.table = null;
      }
    },
  });

  // A call from outside into an interned schema starts without a table, even
  // one made midway through another (a getter of the value encoding another
  // payload): the outer table is put back after it.
  const isolated = (run) => {
    const { table, map } = INTERN;
    INTERN.table = null;
    INTERN.map = null;
    try {
      return run();
    } finally {
      INTERN.table = table;
      INTERN.map = map;
    }
  };

  return { flat, columns, padded, withTable, isolated };
};

const layouts = kernel(require('./errors.js'), require('./types.js'));

module.exports = {
  flat: layouts.flat,
  columns: layouts.columns,
  padded: layouts.padded,
  withTable: layouts.withTable,
  isolated: layouts.isolated,
  kernel,
};
