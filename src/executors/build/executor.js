'use strict';
const { buildArgs } = require('../../lib/args');
const { projectRootOf } = require('../../lib/project');
const { resolveRkp, runRkp, cleanOutput, writeManifest, typescriptInstalled } = require('../../lib/rkp');
const fs = require('node:fs');
const path = require('node:path');

/** Builds a project with `rkp bundle`. */
async function buildExecutor(options, context) {
  const projectAbs = projectRootOf(context);
  // Library mode writes declarations when typescript is installed and the project has a tsconfig, unless `dts` says otherwise.
  const dts = options.dts ?? (options.library === true && typescriptInstalled(projectAbs, context.root) && fs.existsSync(path.join(projectAbs, 'tsconfig.json')));
  const { args, outputAbs } = buildArgs('bundle', { ...options, dts }, { projectAbs, workspaceRoot: context.root });
  const rkp = resolveRkp({ workspaceRoot: context.root, projectRoot: projectAbs, rkpBin: options.rkpBin });
  if (options.clean !== false && !options.watch) cleanOutput(outputAbs, { workspaceRoot: context.root, projectAbs });
  if (options.library === true) writeManifest(projectAbs, outputAbs);
  const code = await runRkp(rkp, args, { cwd: projectAbs, env: { ...options.env } });
  return { success: code === 0 };
}

module.exports = buildExecutor;
module.exports.default = buildExecutor;
