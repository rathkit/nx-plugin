'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');

/**
 * Finds the rkp program. In order: the `rkpBin` option, the RATHKIT_PACK_BIN variable, the program of the
 * installed @rathkit/pack package (found from the project, then from the workspace root), and last `rkp` on PATH.
 */
function resolveRkp({ workspaceRoot, projectRoot, rkpBin } = {}) {
  if (rkpBin) return { command: path.resolve(workspaceRoot ?? process.cwd(), rkpBin), source: 'option' };
  if (process.env.RATHKIT_PACK_BIN) return { command: process.env.RATHKIT_PACK_BIN, source: 'env' };
  for (const from of [projectRoot, workspaceRoot].filter(Boolean)) {
    try {
      const requireFrom = createRequire(path.join(from, 'package.json'));
      const pack = requireFrom('@rathkit/pack');
      return { command: pack.binaryPath(), source: '@rathkit/pack' };
    } catch (error) {
      // Not installed here, or no build for this platform: keep looking, then fall back to PATH.
      if (error && error.code !== 'MODULE_NOT_FOUND' && !/no build for/.test(String(error.message))) throw error;
    }
  }
  return { command: 'rkp', source: 'path' };
}

function missingMessage(rkp) {
  return (
    `@rathkit/nx-plugin: could not start rkp (${rkp.command}). Install it with "pnpm add -D @rathkit/pack@next" ` +
    'or set RATHKIT_PACK_BIN to the program.'
  );
}

/** Runs rkp and resolves to its exit code. A signal sent to this process is passed on, so Ctrl-C ends a watch or serve. */
function runRkp(rkp, args, { cwd, env, stdio = 'inherit' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(rkp.command, args, { cwd, env: { ...process.env, ...env }, stdio });
    const forward = (signal) => () => child.kill(signal);
    const handlers = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((s) => [s, forward(s)]);
    for (const [s, h] of handlers) process.on(s, h);
    const done = () => handlers.forEach(([s, h]) => process.off(s, h));
    child.on('error', (error) => {
      done();
      if (error.code === 'ENOENT') reject(new Error(missingMessage(rkp)));
      else reject(error);
    });
    child.on('close', (code, signal) => {
      done();
      resolve(code ?? (signal ? 0 : 1));
    });
  });
}

/** Deletes a build output folder, refusing anything that is not strictly inside the workspace and below the project root's parent. */
function cleanOutput(outputAbs, { workspaceRoot, projectAbs }) {
  const inside = (parent, child) => {
    const rel = path.relative(parent, child);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  if (!inside(workspaceRoot, outputAbs)) throw new Error(`@rathkit/nx-plugin: refusing to clean ${outputAbs}, which is outside the workspace`);
  if (outputAbs === projectAbs || inside(outputAbs, projectAbs) || inside(outputAbs, workspaceRoot)) {
    throw new Error(`@rathkit/nx-plugin: refusing to clean ${outputAbs}, which contains the project`);
  }
  fs.rmSync(outputAbs, { recursive: true, force: true });
}

/**
 * The package.json a library is published from: the project's, copied into the output folder. rkp then rewrites main, module, types
 * and exports in that copy (`--write-exports`), so the project's own package.json, which is an input of the build, is never edited.
 * `scripts`, `devDependencies` and `files` are left out: the first two mean nothing to a consumer and the third names the source layout.
 */
function writeManifest(projectAbs, outputAbs) {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectAbs, 'package.json'), 'utf8'));
  delete manifest.scripts;
  delete manifest.devDependencies;
  // The output folder is the package: everything in it is published, and `files` names paths of the source layout.
  delete manifest.files;
  for (const key of ['main', 'module', 'types', 'exports']) delete manifest[key];
  fs.mkdirSync(outputAbs, { recursive: true });
  fs.writeFileSync(path.join(outputAbs, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Whether `typescript` can be found from the project or the workspace root (declaration files need it). */
function typescriptInstalled(projectAbs, workspaceRoot) {
  try {
    require.resolve('typescript/package.json', { paths: [projectAbs, workspaceRoot] });
    return true;
  } catch {
    return false;
  }
}

module.exports = { resolveRkp, runRkp, cleanOutput, writeManifest, typescriptInstalled };
