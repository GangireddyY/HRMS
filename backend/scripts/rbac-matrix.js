/**
 * Generates the RBAC permission matrix from the compiled contracts and writes it into docs/RBAC.md
 * between the RBAC-MATRIX markers (or prints it with --stdout).
 * Usage: npm run docs:rbac
 */
const fs = require('node:fs');
const path = require('node:path');
const { MODULES, PERMISSIONS, SYSTEM_ROLE_TEMPLATES } = require('../dist/contracts');

const ABBR = { OWN: 'Own', TEAM: 'Team', DEPARTMENT: 'Dept', ORGANIZATION: 'Org' };
const roles = SYSTEM_ROLE_TEMPLATES;
const header = `| Permission | ${roles.map((r) => r.name).join(' | ')} |`;
const sep = `|---|${roles.map(() => ':-:').join('|')}|`;

const lines = [];
lines.push('### Module summary\n');
lines.push('Cells show *permissions granted / permissions in module* and the broadest **record scope** among the granted scopable permissions (— = no access).\n');
lines.push(`| Module | ${roles.map((r) => r.name).join(' | ')} |`);
lines.push(sep);
const scopable = new Set(PERMISSIONS.filter((p) => p.scopable).map((p) => p.key));
const rank = { OWN: 1, TEAM: 2, DEPARTMENT: 3, ORGANIZATION: 4 };
for (const m of MODULES) {
  const keys = PERMISSIONS.filter((p) => p.module === m.key).map((p) => p.key);
  const cells = roles.map((r) => {
    const g = r.grants.filter((x) => keys.includes(x.key));
    if (!g.length) return '—';
    const scoped = g.filter((x) => scopable.has(x.key));
    if (!scoped.length) return `${g.length}/${keys.length}`;
    const broad = scoped.reduce((a, x) => (rank[x.scope] > rank[a] ? x.scope : a), 'OWN');
    return `${g.length}/${keys.length} · ${ABBR[broad]}`;
  });
  lines.push(`| ${m.name} | ${cells.join(' | ')} |`);
}

for (const m of MODULES) {
  lines.push(`\n### ${m.name} (\`${m.key}\`)\n`);
  lines.push(header);
  lines.push(sep);
  for (const p of PERMISSIONS.filter((x) => x.module === m.key)) {
    const cells = roles.map((r) => {
      const g = r.grants.find((x) => x.key === p.key);
      return g ? (p.scopable ? ABBR[g.scope] : '✓') : '';
    });
    const flags = [p.scopable ? 'scoped' : '', p.restricted ? '**restricted**' : ''].filter(Boolean).join(', ');
    lines.push(`| \`${p.key}\`${flags ? ` (${flags})` : ''} | ${cells.join(' | ')} |`);
  }
}
const matrix = lines.join('\n') + '\n';
if (process.argv.includes('--stdout')) {
  process.stdout.write(matrix);
} else {
  const doc = path.join(__dirname, '..', '..', 'docs', 'RBAC.md');
  const START = '<!-- RBAC-MATRIX:START -->';
  const END = '<!-- RBAC-MATRIX:END -->';
  const current = fs.readFileSync(doc, 'utf8');
  const from = current.indexOf(START);
  const to = current.indexOf(END);
  if (from < 0 || to < 0) throw new Error('RBAC-MATRIX markers not found in docs/RBAC.md');
  fs.writeFileSync(doc, `${current.slice(0, from + START.length)}\n\n${matrix}\n${current.slice(to)}`, 'utf8');
  console.log('docs/RBAC.md updated');
}
