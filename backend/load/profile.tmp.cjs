// Preload: records a CPU profile from PROFILE_START_S to PROFILE_START_S + PROFILE_SECONDS after start.
const inspector = require('node:inspector');
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const start = Number(process.env.PROFILE_START_S || 30) * 1000;
const seconds = Number(process.env.PROFILE_SECONDS || 30) * 1000;
const session = new inspector.Session();
session.connect();
setTimeout(() => {
  session.post('Profiler.enable', () =>
    session.post('Profiler.start', () => {
      console.log('[profile] started');
      setTimeout(() => {
        session.post('Profiler.stop', (err, { profile }) => {
          const dir = join(__dirname, 'results');
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, 'api.cpuprofile'), JSON.stringify(profile));
          console.log('[profile] written');
        });
      }, seconds).unref();
    }),
  );
}, start).unref();
