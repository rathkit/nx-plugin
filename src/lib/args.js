'use strict';
const path = require('node:path');
const { detectEntry } = require('./entry');

const list = (value) => (value === undefined || value === null ? [] : [].concat(value));

/**
 * The rkp command line for the options of the build and serve executors.
 * `projectAbs` is the project's folder (rkp runs there), `workspaceRoot` the workspace's.
 * Returns { args, entries, outputAbs }.
 */
function buildArgs(command, options, { projectAbs, workspaceRoot }) {
  const o = options;
  const library = o.library === true;
  let entries = list(o.entry);
  if (entries.length === 0) {
    const found = detectEntry(projectAbs, { library });
    if (!found) {
      throw new Error(
        `@rathkit/nx-plugin: no entry found in ${path.relative(workspaceRoot, projectAbs) || '.'}. ` +
          'Set the "entry" option, or add index.html, src/main.ts or src/index.ts.',
      );
    }
    entries = [found];
  }
  const outputAbs = path.resolve(workspaceRoot, o.outputPath ?? path.join(path.relative(workspaceRoot, projectAbs), 'dist'));
  const args = [command, ...entries];

  if (command === 'bundle') {
    const requested = list(typeof o.format === 'string' ? o.format.split(',') : o.format);
    const formats = requested.length === 0 && library ? ['esm', 'cjs'] : requested;
    const html = entries.some((e) => e.endsWith('.html'));
    const single = entries.length === 1 && !html && !o.splitting && !library && formats.length <= 1;
    if (single) {
      const name = path.basename(entries[0]).replace(/\.[^.]+$/, '');
      args.push('--outfile', path.join(outputAbs, `${name}.js`));
    } else {
      args.push('--outdir', outputAbs);
      if (o.splitting || (entries.length > 1 && !html && formats.length <= 1)) args.push('--splitting');
    }
    if (formats.length) args.push('--format', formats.join(','));
    if (o.watch) args.push('--watch');
    if (o.dts) args.push(o.dtsBundle ? '--dts-bundle' : '--dts');
    if (library) {
      if (o.packages !== 'bundle') args.push('--packages=external');
      args.push(`--write-exports=${path.join(outputAbs, 'package.json')}`);
    }
    if (o.metafile) args.push(`--metafile=${path.resolve(workspaceRoot, o.metafile)}`);
  } else {
    if (o.port !== undefined) args.push('--port', String(o.port));
    if (o.host) args.push('--host', o.host);
    if (o.hmr) args.push('--hmr');
    if (o.https) args.push('--https');
  }

  if (o.minify === true) args.push('--minify');
  if (o.sourcemap === true) args.push('--sourcemap');
  else if (typeof o.sourcemap === 'string') args.push(`--sourcemap=${o.sourcemap}`);
  if (o.target) args.push('--target', o.target);
  for (const e of list(o.external)) args.push('--external', e);
  for (const c of list(o.conditions)) args.push('--condition', c);
  for (const [k, v] of Object.entries(o.define ?? {})) args.push('--define', `${k}=${v}`);
  for (const [k, v] of Object.entries(o.loader ?? {})) args.push('--loader', `${k}=${v}`);
  for (const [k, v] of Object.entries(o.alias ?? {})) args.push('--alias', `${k}=${v}`);
  if (o.config) args.push('--config', path.resolve(workspaceRoot, o.config));
  if (o.tsconfig) args.push('--tsconfig', path.resolve(workspaceRoot, o.tsconfig));
  if (o.mode) args.push('--mode', o.mode);
  if (o.publicPath) args.push('--public-path', o.publicPath);
  args.push(...list(o.args));
  return { args, entries, outputAbs };
}

module.exports = { buildArgs };
