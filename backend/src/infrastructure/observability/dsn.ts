export interface Dsn {
  url: string;
  auth: string;
}

/** `https://<key>@<host>/<project>` → the Sentry envelope endpoint and auth header. */
export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  const m = /^(https?):\/\/([^@/]+)@([^/]+)\/(?:(.*)\/)?(\d+)$/.exec(dsn.trim());
  if (!m) throw new Error('SENTRY_DSN must look like https://<key>@<host>/<project id>');
  const [, scheme, key, host, path, project] = m;
  return {
    url: `${scheme}://${host}/${path ? `${path}/` : ''}api/${project}/envelope/`,
    auth: `Sentry sentry_version=7, sentry_key=${key}, sentry_client=hrms-api/1.0`,
  };
}
