/**
 * Table-aware in-memory fake for the narrow slice of the drizzle query builder that Function 2
 * (`runPathAReleaseSaga`) and the GHL write-back use:
 *
 *   db.select(fields?).from(table).where(sql)[.limit(n)]   (awaitable with or without `.limit`)
 *   db.update(table).set(values).where(sql)                (awaitable)
 *
 * Rows are keyed by the DATABASE column name (the schema uses snake_case for both TS key and
 * column name). `where(...)` predicates are evaluated by pulling every bound `Param` value out of
 * the drizzle SQL tree and requiring each one to equal some column value on the row. That is
 * deliberately loose (it is not a SQL engine), but it is deterministic and, unlike the previous
 * call-count-parity mocks, it returns the row that was actually asked for.
 *
 * TEST-ONLY. Proves query wiring and column names, NOT SQL semantics (PGlite suites do that).
 */
import { Param, getTableName } from "drizzle-orm";
import type { Column } from "drizzle-orm";

export type FakeRow = Record<string, unknown>;
export type FakeTables = Record<string, FakeRow[]>;

export type RecordedUpdate = {
  table: string;
  values: Record<string, unknown>;
  params: unknown[];
};

export function collectParams(node: unknown, out: unknown[] = []): unknown[] {
  if (node === null || node === undefined) return out;
  if (node instanceof Param) {
    out.push(node.value);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectParams(child, out);
    return out;
  }
  if (typeof node === "object") {
    const chunks = (node as { queryChunks?: unknown }).queryChunks;
    if (Array.isArray(chunks)) {
      for (const child of chunks) collectParams(child, out);
    }
  }
  return out;
}

function rowMatches(row: FakeRow, params: unknown[]): boolean {
  if (params.length === 0) return true;
  const values = Object.values(row);
  return params.every((p) => values.includes(p));
}

function project(
  fields: Record<string, Column> | undefined,
  row: FakeRow,
): FakeRow {
  if (!fields) return { ...row };
  const out: FakeRow = {};
  for (const [alias, column] of Object.entries(fields)) {
    out[alias] = row[column.name];
  }
  return out;
}

export type FakeDb = {
  select: (fields?: Record<string, Column>) => {
    from: (table: Parameters<typeof getTableName>[0]) => {
      where: (clause: unknown) => Promise<FakeRow[]> & {
        limit: (n: number) => Promise<FakeRow[]>;
        orderBy: (...args: unknown[]) => Promise<FakeRow[]> & {
          limit: (n: number) => Promise<FakeRow[]>;
        };
      };
    };
  };
  update: (table: Parameters<typeof getTableName>[0]) => {
    set: (values: Record<string, unknown>) => {
      where: (clause: unknown) => Promise<unknown[]> & {
        returning: () => Promise<unknown[]>;
      };
    };
  };
};

export function createFakeDb(tables: FakeTables): {
  db: FakeDb;
  updates: RecordedUpdate[];
  selects: Array<{ table: string; params: unknown[] }>;
} {
  const updates: RecordedUpdate[] = [];
  const selects: Array<{ table: string; params: unknown[] }> = [];

  const db: FakeDb = {
    select(fields) {
      return {
        from(table) {
          const name = getTableName(table);
          return {
            where(clause) {
              const params = collectParams(clause);
              selects.push({ table: name, params });
              const rows = (tables[name] ?? [])
                .filter((row) => rowMatches(row, params))
                .map((row) => project(fields, row));
              const promise = Promise.resolve(rows) as Promise<FakeRow[]> & {
                limit: (n: number) => Promise<FakeRow[]>;
                orderBy: (...args: unknown[]) => Promise<FakeRow[]> & {
                  limit: (n: number) => Promise<FakeRow[]>;
                };
              };
              promise.limit = (n: number) => Promise.resolve(rows.slice(0, n));
              promise.orderBy = () => promise;
              return promise;
            },
          };
        },
      };
    },
    update(table) {
      const name = getTableName(table);
      return {
        set(values) {
          return {
            where(clause) {
              const params = collectParams(clause);
              updates.push({ table: name, values, params });
              for (const row of tables[name] ?? []) {
                if (rowMatches(row, params)) Object.assign(row, values);
              }
              const promise = Promise.resolve([]) as unknown as Promise<unknown[]> & {
                returning: () => Promise<unknown[]>;
              };
              promise.returning = () => Promise.resolve([]);
              return promise;
            },
          };
        },
      };
    },
  };

  return { db, updates, selects };
}
