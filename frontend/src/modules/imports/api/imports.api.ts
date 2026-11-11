import { downloadFile, http } from '@/core/http/http-client';

export interface ImportColumn {
  header: string;
  required: boolean;
  help: string | null;
}

export interface ImportKind {
  key: string;
  label: string;
  description: string;
  columns: ImportColumn[];
}

export interface ImportSummary {
  importer: string;
  dryRun: boolean;
  total: number;
  valid: number;
  invalid: number;
  applied: number;
  pendingApproval: number;
  failed: number;
  ignoredColumns: string[];
  issues: { row: number; column: string | null; message: string }[];
  issueCount: number;
}

export const importsApi = {
  list: () => http.get<ImportKind[]>('/imports'),
  template: (key: string) => downloadFile(`/imports/${key}/template`, undefined, `${key}-import-template.csv`),
  run: (key: string, file: File, dryRun: boolean) => http.upload<ImportSummary>(`/imports/${key}`, file, { query: { dryRun } }),
};
