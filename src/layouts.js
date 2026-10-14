// Collection layouts over a record codec. `rows` is the codec itself; `flat`
// concatenates fixed-width rows into one array, `columns` transposes them.
// Both are plain loops over the record functions, so they are the same for
// either backend.

const { fail, nest, refuse } = require('./errors.js');

// A row of exactly `size` slots; a null record is a run of nulls.
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

const flat = (item, size) => ({
  encode: (list) => {
    if (!Array.isArray(list)) refuse('array', '');
    const out = [];
    for (let i = 0; i < list.length; i++) out.push(...padded(item, list[i], size, i));
    return out;
  },
  decode: (array, strict) => {
    if (!Array.isArray(array)) fail('structure', '', 'array');
    if (array.length % size !== 0) fail('structure', '', 'length');
    const read = (i) => array.slice(i * size, i * size + size);
    return records(item, array.length / size, read, strict);
  },
});

const columns = (item, size) => ({
  encode: (list) => {
    if (!Array.isArray(list)) refuse('array', '');
    const out = [];
    for (let j = 0; j < size; j++) out.push(new Array(list.length));
    for (let i = 0; i < list.length; i++) {
      const row = padded(item, list[i], size, i);
      for (let j = 0; j < size; j++) out[j][i] = row[j];
    }
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
    const read = (i) => cols.map((column) => (column === null ? null : column[i]));
    return records(item, count === -1 ? 0 : count, read, strict);
  },
});

module.exports = { flat, columns };
