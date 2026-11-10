export interface SelectOption<V> {
  label: string;
  value: V;
  disabled?: boolean;
  /** Secondary line shown under the label in the list. */
  description?: string;
}

export interface TableColumn<Row> {
  key: string;
  label: string;
  /** Server-side sort field (enables the sort toggle). */
  sortField?: string;
  align?: 'left' | 'right' | 'center';
  class?: string;
  /** Plain value accessor when no cell slot is provided. */
  value?: (row: Row) => unknown;
  /** The cell as text for CSV export (falls back to `value`, then the row's `key` field). */
  exportValue?: (row: Row) => string | number | boolean | null | undefined;
  /** Leave the column out of the export (e.g. actions). */
  noExport?: boolean;
}
