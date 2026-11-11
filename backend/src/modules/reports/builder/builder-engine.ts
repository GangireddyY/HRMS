import type { BuilderColumn, BuilderFilter, BuilderQuery } from '../../../contracts';
import { AppError } from '../../../common/errors/app-error';

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

const isEmpty = (v: Cell) => v === null || v === '';
const lower = (v: Cell) => String(v ?? '').toLowerCase();

function compare(a: Cell, b: Cell): number {
  if (isEmpty(a) && isEmpty(b)) return 0;
  if (isEmpty(a)) return 1;
  if (isEmpty(b)) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
}

function asType(col: BuilderColumn, v: unknown): Cell {
  if (v === null || v === undefined || v === '') return null;
  if (col.type === 'number' || col.type === 'money') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (col.type === 'boolean') return v === true || v === 'true' || v === 'yes';
  return String(v);
}

function matches(col: BuilderColumn, f: BuilderFilter, value: Cell): boolean {
  switch (f.op) {
    case 'empty':
      return isEmpty(value);
    case 'not_empty':
      return !isEmpty(value);
    case 'in': {
      const list = (Array.isArray(f.value) ? f.value : [f.value]).map((x) => lower(x as Cell));
      return list.includes(lower(value));
    }
    case 'contains':
      return lower(value).includes(lower(f.value as Cell));
    case 'eq':
    case 'neq': {
      const target = asType(col, f.value);
      const same = col.type === 'text' || col.type === 'date' ? lower(value) === lower(target) : value === target;
      return f.op === 'eq' ? same : !same;
    }
    case 'gte':
    case 'lte': {
      const target = asType(col, f.value);
      if (isEmpty(value) || target === null) return false;
      const c = compare(value, target);
      return f.op === 'gte' ? c >= 0 : c <= 0;
    }
  }
}

/** Checks a query against the dataset's columns. */
export function validateQuery(columns: BuilderColumn[], q: Pick<BuilderQuery, 'columns' | 'filters' | 'sort' | 'groupBy'>) {
  const known = new Map(columns.map((c) => [c.key, c]));
  const unknown = [...q.columns, ...(q.filters ?? []).map((f) => f.column), ...(q.sort ? [q.sort.column] : []), ...(q.groupBy ? [q.groupBy] : [])].filter((k) => !known.has(k) && k !== 'count');
  if (unknown.length) throw AppError.validation([{ field: 'columns', message: `Unknown column${unknown.length === 1 ? '' : 's'}: ${[...new Set(unknown)].join(', ')}` }]);
  for (const f of q.filters ?? []) {
    const col = known.get(f.column)!;
    if ((f.op === 'gte' || f.op === 'lte') && col.type === 'text') throw AppError.validation([{ field: 'filters', message: `"${col.label}" can't be compared as more or less` }]);
    if (f.op === 'contains' && col.type !== 'text') throw AppError.validation([{ field: 'filters', message: `"Contains" only works on text columns (not "${col.label}")` }]);
    if (f.op !== 'empty' && f.op !== 'not_empty' && (f.value === undefined || f.value === null || f.value === '' || (Array.isArray(f.value) && !f.value.length))) {
      throw AppError.validation([{ field: 'filters', message: `Give a value for the "${col.label}" filter` }]);
    }
  }
  return known;
}

/**
 * Filters, summarizes (count and totals per value of `groupBy`), sorts and picks the columns. Rows are the dataset's
 * own (already limited to what the person may see).
 */
export function runQuery(columns: BuilderColumn[], rows: Row[], q: Pick<BuilderQuery, 'columns' | 'filters' | 'sort' | 'groupBy'>): { columns: BuilderColumn[]; rows: Row[] } {
  const known = validateQuery(columns, q);
  let out = rows.filter((r) => (q.filters ?? []).every((f) => matches(known.get(f.column)!, f, r[f.column] ?? null)));
  let cols = q.columns.map((k) => known.get(k)!);

  if (q.groupBy) {
    const by = known.get(q.groupBy)!;
    const totals = cols.filter((c) => c.key !== by.key && (c.type === 'number' || c.type === 'money'));
    const groups = new Map<string, { key: Cell; count: number; sums: number[] }>();
    for (const r of out) {
      const value = r[by.key] ?? null;
      const id = JSON.stringify(value);
      const g = groups.get(id) ?? { key: value, count: 0, sums: totals.map(() => 0) };
      g.count += 1;
      totals.forEach((t, i) => (g.sums[i]! += typeof r[t.key] === 'number' ? (r[t.key] as number) : 0));
      groups.set(id, g);
    }
    cols = [by, { key: 'count', label: 'Count', type: 'number', group: 'Summary' }, ...totals.map((t) => ({ ...t, label: `Total ${t.label.toLowerCase()}` }))];
    out = [...groups.values()].map((g) => ({ [by.key]: g.key, count: g.count, ...Object.fromEntries(totals.map((t, i) => [t.key, Math.round(g.sums[i]! * 100) / 100])) }));
    if (!q.sort) out.sort((a, b) => (b.count as number) - (a.count as number));
  }

  if (q.sort) {
    const { column, direction } = q.sort;
    out = [...out].sort((a, b) => {
      const x = a[column] ?? null;
      const y = b[column] ?? null;
      if (isEmpty(x) || isEmpty(y)) return compare(x, y);
      return compare(x, y) * (direction === 'desc' ? -1 : 1);
    });
  }
  return { columns: cols, rows: out.map((r) => Object.fromEntries(cols.map((c) => [c.key, r[c.key] ?? null]))) };
}
