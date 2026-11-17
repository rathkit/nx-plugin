'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { detectEntry } = require('../lib/entry');

/** The file a project is found by. A rathkit.config.* file next to a package.json or project.json marks a project rkp builds. */
const CONFIG_GLOB = '**/rathkit.config.{mjs,js,cjs}';

const DEFAULTS = {
  buildTargetName: 'build',
  serveTargetName: 'serve',
  watchTargetName: 'watch',
  outDir: 'dist',
  env: [],
};

function nxMajor(workspaceRoot) {
  try {
    const file = require.resolve('nx/package.json', { paths: [workspaceRoot] });
    return Number.parseInt(JSON.parse(fs.readFileSync(file, 'utf8')).version, 10);
  } catch {
    return 0;
  }
}

/** A library has a package.json that says how it is consumed (main, module, types or exports) and no index.html. */
function isLibrary(projectAbs) {
  if (fs.existsSync(path.join(projectAbs, 'index.html'))) return false;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(projectAbs, 'package.json'), 'utf8'));
    return ['main', 'module', 'types', 'exports'].some((key) => manifest[key] !== undefined);
  } catch {
    return false;
  }
}

function installed(name, workspaceRoot, projectAbs) {
  try {
    require.resolve(`${name}/package.json`, { paths: [projectAbs, workspaceRoot] });
    return true;
  } catch {
    return false;
  }
}

/**
 * What decides the bytes rkp writes, so that a changed input misses the cache and an unchanged one hits:
 *  - the project's files and those of the projects it depends on (`default`, `^default`), without the output folder;
 *  - the tsconfig and browserslist files above the project (they are read from the workspace root and are not in any project);
 *  - .env files of the project, which are usually ignored by git and so invisible to Nx unless asked for;
 *  - the installed rkp, as a package of the workspace;
 *  - the variables rkp or the files it reads look at, and those named in the `env` option.
 */
function buildInputs(options, { workspaceRoot, projectAbs, library }) {
  const inputs = [
    'default',
    '^default',
    `!{projectRoot}/${options.outDir}/**/*`,
    '{workspaceRoot}/tsconfig.base.json',
    '{workspaceRoot}/tsconfig.json',
    '{workspaceRoot}/.browserslistrc',
    '{workspaceRoot}/browserslist',
    { fileset: '{projectRoot}/.env*', includeIgnored: true },
  ];
  if (installed('@rathkit/pack', workspaceRoot, projectAbs)) inputs.push({ externalDependencies: ['@rathkit/pack'] });
  // Declaration files are written by the project's own typescript, so its version is an input too.
  if (library && installed('typescript', workspaceRoot, projectAbs)) inputs.push({ externalDependencies: ['typescript'] });
  for (const name of ['NODE_ENV', 'BROWSERSLIST', 'BROWSERSLIST_ENV', ...options.env]) inputs.push({ env: name });
  return inputs;
}

function targetsFor(options, ctx) {
  const outputPath = `{projectRoot}/${options.outDir}`;
  const targets = {};
  targets[options.buildTargetName] = {
    executor: '@rathkit/nx:build',
    cache: true,
    dependsOn: [`^${options.buildTargetName}`],
    inputs: buildInputs(options, ctx),
    outputs: ['{options.outputPath}'],
    options: ctx.library ? { outputPath, library: true } : { outputPath },
    metadata: { technologies: ['rathkit'], description: ctx.library ? 'Build the library with rkp bundle (esm, cjs, declarations)' : 'Build with rkp bundle' },
  };
  // A library is not served.
  if (!ctx.library) targets[options.serveTargetName] = {
    executor: '@rathkit/nx:serve',
    cache: false,
    continuous: true,
    dependsOn: [`^${options.buildTargetName}`],
    options: {},
    metadata: { technologies: ['rathkit'], description: 'Serve with rkp serve' },
  };
  if (!ctx.library && ctx.major >= 24) targets[options.serveTargetName].readyWhen = { port: '{options.port ?? 5173}' };
  targets[options.watchTargetName] = {
    executor: '@rathkit/nx:build',
    cache: false,
    continuous: true,
    dependsOn: [`^${options.buildTargetName}`],
    options: ctx.library ? { outputPath, watch: true, library: true } : { outputPath, watch: true },
    metadata: { technologies: ['rathkit'], description: 'Build again on every change with rkp bundle --watch' },
  };
  return targets;
}

/** createNodes: a project for each rathkit.config.* next to a package.json or project.json, with build, serve and watch. */
async function createNodesFunction(configFiles, userOptions, context) {
  const options = { ...DEFAULTS, ...userOptions };
  const major = nxMajor(context.workspaceRoot);
  const results = [];
  for (const configFile of configFiles) {
    const root = path.dirname(configFile);
    const projectAbs = path.join(context.workspaceRoot, root);
    const owned = ['package.json', 'project.json'].some((f) => fs.existsSync(path.join(projectAbs, f)));
    if (!owned) continue;
    const library = isLibrary(projectAbs);
    if (!detectEntry(projectAbs, { library })) continue;
    results.push([
      configFile,
      { projects: { [root]: { root, targets: targetsFor(options, { workspaceRoot: context.workspaceRoot, projectAbs, major, library }) } } },
    ]);
  }
  return results;
}

const createNodes = [CONFIG_GLOB, createNodesFunction];

module.exports = { createNodes, createNodesFunction, CONFIG_GLOB, DEFAULTS };
