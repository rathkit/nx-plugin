'use strict';
const { addDependenciesToPackageJson, formatFiles, getProjects, joinPathFragments, readNxJson, updateNxJson } = require('@nx/devkit');
const { detectEntry } = require('../../lib/entry');

const PLUGIN = '@rathkit/nx-plugin';
const CONFIG_FILES = ['mjs', 'js', 'cjs'].map((e) => `rathkit.config.${e}`);
const CONFIG_TEXT = '// Options for rkp (Rathkit Pack), run by Nx through @rathkit/nx-plugin. An empty object takes the defaults.\nexport default {};\n';

function pluginRegistered(nxJson) {
  return (nxJson.plugins ?? []).some((p) => (typeof p === 'string' ? p : p.plugin) === PLUGIN);
}

/** Projects with something rkp can build, no rathkit config yet and no build target of their own. */
function candidates(tree) {
  const found = [];
  for (const [name, config] of getProjects(tree)) {
    if (config.root === '.' || config.root === '') continue;
    if (config.targets?.build) continue;
    if (CONFIG_FILES.some((f) => tree.exists(joinPathFragments(config.root, f)))) continue;
    if (detectEntry(config.root, { exists: (rel) => tree.exists(joinPathFragments(config.root, rel)) })) found.push(name);
  }
  return found;
}

async function initGenerator(tree, options = {}) {
  const nxJson = readNxJson(tree) ?? {};
  if (!pluginRegistered(nxJson)) {
    nxJson.plugins = [...(nxJson.plugins ?? []), PLUGIN];
    updateNxJson(tree, nxJson);
  }

  let task = () => {};
  if (!options.skipPackageJson && tree.exists('package.json')) {
    task = addDependenciesToPackageJson(tree, {}, { '@rathkit/pack': options.packVersion ?? 'next' }, undefined, options.keepExistingVersions === true);
  }

  const created = [];
  if (!options.skipConfig) {
    const projects = getProjects(tree);
    const requested = options.project === undefined ? candidates(tree) : [].concat(options.project);
    for (const name of requested) {
      const config = projects.get(name);
      if (!config) throw new Error(`@rathkit/nx-plugin: there is no project "${name}"`);
      if (CONFIG_FILES.some((f) => tree.exists(joinPathFragments(config.root, f)))) continue;
      const file = joinPathFragments(config.root, 'rathkit.config.mjs');
      tree.write(file, CONFIG_TEXT);
      created.push(file);
    }
  }

  if (tree.exists('.gitignore')) {
    const ignore = tree.read('.gitignore', 'utf-8');
    if (!/^\/?dist\/?$/m.test(ignore)) tree.write('.gitignore', `${ignore.replace(/\n*$/, '\n')}dist\n`);
  }

  if (!options.skipFormat) await formatFiles(tree);
  return task;
}

module.exports = initGenerator;
module.exports.default = initGenerator;
module.exports.initGenerator = initGenerator;
