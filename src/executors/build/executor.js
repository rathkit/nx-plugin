'use strict';
const { buildArgs } = require('../../lib/args');
const { projectRootOf } = require('../../lib/project');
const { resolveRkp, runRkp, cleanOutput } = require('../../lib/rkp');

/** Builds a project with `rkp bundle`. */
async function buildExecutor(options, context) {
  const projectAbs = projectRootOf(context);
  const { args, outputAbs } = buildArgs('bundle', options, { projectAbs, workspaceRoot: context.root });
  const rkp = resolveRkp({ workspaceRoot: context.root, projectRoot: projectAbs, rkpBin: options.rkpBin });
  if (options.clean !== false && !options.watch) cleanOutput(outputAbs, { workspaceRoot: context.root, projectAbs });
  const code = await runRkp(rkp, args, { cwd: projectAbs, env: { ...options.env } });
  return { success: code === 0 };
}

module.exports = buildExecutor;
module.exports.default = buildExecutor;
