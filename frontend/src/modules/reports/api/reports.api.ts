import type { BuilderColumn, BuilderDataset, BuilderQuery, ReportExportFormat, ReportKey, ReportTable } from '@contracts';
import { downloadFile, http } from '@/core/http/http-client';

export interface ReportQuery {
  asOf?: string;
  from?: string;
  to?: string;
  departmentId?: string;
  fromMonth?: string;
  toMonth?: string;
}

export interface ReportResult {
  asOf?: string;
  from?: string;
  to?: string;
  fromMonth?: string;
  toMonth?: string;
  summary: Record<string, number | string | null>;
  trend?: Record<string, number | string>[];
  tables: ReportTable[];
}

export interface BuilderDatasetInfo {
  key: BuilderDataset;
  label: string;
  description: string;
  dated: { label: string; maxDays: number } | null;
  columns: BuilderColumn[];
}

export interface BuilderResult {
  columns: BuilderColumn[];
  rows: Record<string, string | number | boolean | null>[];
  total: number;
  truncated: boolean;
  capped: boolean;
}

export interface SavedReportRow {
  id: string;
  name: string;
  description: string | null;
  dataset: BuilderDataset;
  definition: Omit<BuilderQuery, 'dataset'>;
  shared: boolean;
  owner: string | null;
  mine: boolean;
  updatedAt: string;
}

export const reportsApi = {
  run: (key: ReportKey, q: ReportQuery) => http.get<ReportResult>(`/reports/${key}`, { ...q }),
  export: (key: ReportKey, q: ReportQuery, format: ReportExportFormat = 'csv') => downloadFile(`/reports/${key}/export`, { ...q, format }, `${key} report.${format}`),

  datasets: () => http.get<BuilderDatasetInfo[]>('/reports/builder/datasets'),
  runBuilder: (q: BuilderQuery) => http.post<BuilderResult>('/reports/builder/run', q),
  exportBuilder: (q: BuilderQuery, format: 'csv' | 'xlsx', title: string) => downloadFile('/reports/builder/export', undefined, `${title}.${format}`, { ...q, format, title }),
  saved: () => http.get<SavedReportRow[]>('/reports/saved'),
  save: (body: { name: string; description?: string | null; shared?: boolean; query: BuilderQuery }, id?: string) => (id ? http.put<SavedReportRow[]>(`/reports/saved/${id}`, body) : http.post<SavedReportRow[]>('/reports/saved', body)),
  removeSaved: (id: string) => http.delete<{ deleted: boolean }>(`/reports/saved/${id}`),
};
