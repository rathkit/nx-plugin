'use strict';
const { buildArgs } = require('../../lib/args');
const { projectRootOf } = require('../../lib/project');
const { resolveRkp, runRkp } = require('../../lib/rkp');

/** Runs the development server, `rkp serve`, until it is stopped. */
async function serveExecutor(options, context) {
  const projectAbs = projectRootOf(context);
  const { args } = buildArgs('serve', options, { projectAbs, workspaceRoot: context.root });
  const rkp = resolveRkp({ workspaceRoot: context.root, projectRoot: projectAbs, rkpBin: options.rkpBin });
  const code = await runRkp(rkp, args, { cwd: projectAbs, env: { ...options.env } });
  return { success: code === 0 };
}

module.exports = serveExecutor;
module.exports.default = serveExecutor;
