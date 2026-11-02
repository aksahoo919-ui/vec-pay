// D1 helpers.

// Current time in the same ISO format JavaScript uses (2026-11-02T10:15:30.123Z),
// taken from the database so every timestamp comes from one clock.
export const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export const newId = () => crypto.randomUUID();

export const isUniqueViolation = (err) => /UNIQUE constraint failed/i.test(String(err?.message || err));

// INSERT built from an object. Keys always come from our own code, never from the request.
export function insert(db, table, row) {
  const keys = Object.keys(row);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `?${i + 1}`).join(', ')})`;
  return db.prepare(sql).bind(...keys.map(k => row[k]));
}

// SQLite stores booleans as 0/1; the website expects true/false.
export function toPayment(row) {
  return { ...row, book_given: !!row.book_given, has_children: !!row.has_children };
}
