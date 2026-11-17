'use strict';
const path = require('node:path');

/** The root of the project an executor runs for, as an absolute path. */
function projectRootOf(context) {
  const name = context.projectName;
  const node = context.projectGraph?.nodes?.[name]?.data;
  const config = context.projectsConfigurations?.projects?.[name];
  const root = node?.root ?? config?.root;
  if (root === undefined) throw new Error(`@rathkit/nx: cannot find the root of project "${name}"`);
  return path.resolve(context.root, root);
}

module.exports = { projectRootOf };
