import type { BuilderColumn } from '../../../contracts';
import type { AppError } from '../../../common/errors/app-error';
import { runQuery, type Row } from './builder-engine';

const columns: BuilderColumn[] = [
  { key: 'name', label: 'Name', type: 'text', group: 'E' },
  { key: 'dept', label: 'Department', type: 'text', group: 'E' },
  { key: 'joined', label: 'Joined', type: 'date', group: 'E' },
  { key: 'salary', label: 'Salary', type: 'money', group: 'E' },
  { key: 'remote', label: 'Remote', type: 'boolean', group: 'E' },
];
const rows: Row[] = [
  { name: 'Asha', dept: 'Engineering', joined: '2021-03-01', salary: 120000, remote: true },
  { name: 'Ben', dept: 'Engineering', joined: '2024-07-15', salary: 90000, remote: false },
  { name: 'Carl', dept: 'Sales', joined: '2023-01-10', salary: 70000, remote: false },
  { name: 'Dina', dept: null, joined: '2025-02-01', salary: null, remote: null },
];
const names = (r: { rows: Row[] }) => r.rows.map((x) => x.name);

describe('report builder engine', () => {
  it('filters with every operator', () => {
    const q = (filters: object[]) => names(runQuery(columns, rows, { columns: ['name'], filters: filters as never }));
    expect(q([{ column: 'dept', op: 'eq', value: 'engineering' }])).toEqual(['Asha', 'Ben']);
    expect(q([{ column: 'dept', op: 'neq', value: 'Engineering' }])).toEqual(['Carl', 'Dina']);
    expect(q([{ column: 'dept', op: 'in', value: ['Sales', 'Engineering'] }])).toEqual(['Asha', 'Ben', 'Carl']);
    expect(q([{ column: 'name', op: 'contains', value: 'a' }])).toEqual(['Asha', 'Carl', 'Dina']);
    expect(q([{ column: 'joined', op: 'gte', value: '2024-01-01' }])).toEqual(['Ben', 'Dina']);
    expect(q([{ column: 'salary', op: 'lte', value: '90000' }])).toEqual(['Ben', 'Carl']);
    expect(q([{ column: 'dept', op: 'empty' }])).toEqual(['Dina']);
    expect(q([{ column: 'remote', op: 'eq', value: true }])).toEqual(['Asha']);
    expect(q([{ column: 'dept', op: 'eq', value: 'Engineering' }, { column: 'remote', op: 'eq', value: 'false' }])).toEqual(['Ben']);
  });

  it('sorts with empty values last and picks the columns', () => {
    const out = runQuery(columns, rows, { columns: ['name', 'salary'], sort: { column: 'salary', direction: 'desc' } });
    expect(out.rows).toEqual([
      { name: 'Asha', salary: 120000 },
      { name: 'Ben', salary: 90000 },
      { name: 'Carl', salary: 70000 },
      { name: 'Dina', salary: null },
    ]);
    expect(out.columns.map((c) => c.key)).toEqual(['name', 'salary']);
  });

  it('summarizes by a column with counts and totals', () => {
    const out = runQuery(columns, rows, { columns: ['dept', 'name', 'salary'], groupBy: 'dept' });
    expect(out.columns.map((c) => [c.key, c.label])).toEqual([['dept', 'Department'], ['count', 'Count'], ['salary', 'Total salary']]);
    expect(out.rows).toEqual([
      { dept: 'Engineering', count: 2, salary: 210000 },
      { dept: 'Sales', count: 1, salary: 70000 },
      { dept: null, count: 1, salary: 0 },
    ]);
    expect(runQuery(columns, rows, { columns: ['dept'], groupBy: 'dept', sort: { column: 'dept', direction: 'asc' } }).rows.map((r) => r.dept)).toEqual(['Engineering', 'Sales', null]);
  });

  it('rejects unknown columns and filters that do not fit the column', () => {
    const issue = (q: Parameters<typeof runQuery>[2]) => {
      try {
        runQuery(columns, rows, q);
      } catch (e) {
        return (e as AppError).details?.[0]?.message;
      }
      return null;
    };
    expect(issue({ columns: ['nope'] })).toMatch(/Unknown column: nope/);
    expect(issue({ columns: ['name'], filters: [{ column: 'salary', op: 'contains', value: '1' }] })).toMatch(/only works on text/);
    expect(issue({ columns: ['name'], filters: [{ column: 'name', op: 'gte', value: 'B' }] })).toMatch(/compared/);
    expect(issue({ columns: ['name'], filters: [{ column: 'dept', op: 'eq' }] })).toMatch(/Give a value/);
  });
});
