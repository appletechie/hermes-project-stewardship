// Fleet web build: the Desktop plugin (desktop/src) as a Hermes web dashboard
// plugin bundle. The Desktop externals (react, react/jsx-runtime,
// @hermes/plugin-sdk) resolve to the shims in src/, which read the dashboard's
// window.__HERMES_PLUGIN_SDK__. Keep dist/index.js generated: edit src/ or
// desktop/src/, then run node hermes_dockyard_plugin/fleet_web/build.mjs.
// --check rebuilds in memory and fails if the committed bundle is stale.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// Pin esbuild's working directory so module-path comments are the same
// whichever directory the build is launched from.
const REPO = join(HERE, '..', '..');
const SRC = join(HERE, 'src');
const OUT = join(HERE, 'dist', 'index.js');
const require = createRequire(join(HERE, '..', 'dashboard', 'package.json'));
const { build } = require('esbuild');

const SHIMS = {
  react: join(SRC, 'react.js'),
  'react/jsx-runtime': join(SRC, 'react.js'),
  'react/jsx-dev-runtime': join(SRC, 'react.js'),
  '@hermes/plugin-sdk': join(SRC, 'sdk.js'),
};

const result = await build({
  entryPoints: [join(SRC, 'entry.js')],
  bundle: true,
  write: false,
  absWorkingDir: REPO,
  outfile: OUT,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  minify: false,
  treeShaking: true,
  sourcemap: false,
  legalComments: 'none',
  plugins: [{
    name: 'hermes-dashboard-sdk',
    setup(b) {
      b.onResolve({ filter: /^(react|react\/jsx-runtime|react\/jsx-dev-runtime|@hermes\/plugin-sdk)$/ }, (args) => ({ path: SHIMS[args.path] }));
    },
  }],
  banner: {
    js: '// GENERATED — edit fleet_web/src/ or desktop/src/, then run node hermes_dockyard_plugin/fleet_web/build.mjs',
  },
});

if (result.errors.length) throw new Error(`esbuild reported ${result.errors.length} error(s)`);
const bytes = Buffer.from(result.outputFiles[0].contents);
const hash = createHash('sha256').update(bytes).digest('hex');
if (process.argv.includes('--check')) {
  if (!existsSync(OUT) || !readFileSync(OUT).equals(bytes)) {
    console.error('fleet_web/dist/index.js is stale: run node hermes_dockyard_plugin/fleet_web/build.mjs and commit the result');
    process.exit(1);
  }
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, bytes);
}
console.log(`dist/index.js: ${bytes.length} bytes sha256=${hash}`);
