// Self time per function and per package from a .cpuprofile.
const p = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, 'results', 'api.cpuprofile'), 'utf8'));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = p.timeDeltas;
for (let i = 0; i < p.samples.length; i++) self.set(p.samples[i], (self.get(p.samples[i]) ?? 0) + (dt[i] ?? 0));
const total = [...self.values()].reduce((a, b) => a + b, 0);
const fnAgg = new Map();
const pkgAgg = new Map();
for (const [id, t] of self) {
  const n = byId.get(id);
  const url = n.callFrame.url || '(native)';
  const pkg = url.includes('node_modules') ? url.split('node_modules')[1].split(/[\\/]/).filter(Boolean).slice(0, url.split('node_modules')[1].includes('@') ? 2 : 1).join('/') : url.includes('dist') ? 'app (dist)' : url.startsWith('node:') ? url : n.callFrame.functionName || url;
  const fn = `${n.callFrame.functionName || '(anonymous)'} ${url.replace(/.*node_modules[\\/]/, '').replace(/.*dist[\\/]/, 'dist/')}:${n.callFrame.lineNumber + 1}`;
  fnAgg.set(fn, (fnAgg.get(fn) ?? 0) + t);
  pkgAgg.set(pkg, (pkgAgg.get(pkg) ?? 0) + t);
}
const show = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).forEach(([k, v]) => console.log(`${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`));
console.log(`total sampled ${(total / 1e6).toFixed(1)} s`);
console.log('--- by package');
show(pkgAgg, 15);
console.log('--- by function');
show(fnAgg, 30);
