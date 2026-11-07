import type { ReportExportFormat, ReportKey, ReportTable } from '@contracts';
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

export const reportsApi = {
  run: (key: ReportKey, q: ReportQuery) => http.get<ReportResult>(`/reports/${key}`, { ...q }),
  export: (key: ReportKey, q: ReportQuery, format: ReportExportFormat = 'csv') => downloadFile(`/reports/${key}/export`, { ...q, format }, `${key} report.${format}`),
};
