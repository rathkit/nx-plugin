'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT_EXTENSIONS = ['ts', 'tsx', 'mts', 'js', 'jsx', 'mjs'];
const APP_NAMES = ['src/main', 'src/index', 'main', 'index'];
const LIBRARY_NAMES = ['src/index', 'index', 'src/main', 'main'];

function firstFile(projectAbs, names) {
  for (const name of names) {
    for (const ext of SCRIPT_EXTENSIONS) {
      const rel = `${name}.${ext}`;
      if (fs.existsSync(path.join(projectAbs, rel))) return rel;
    }
  }
  return null;
}

/**
 * The entry rkp builds for a project, relative to the project root, or null when there is none.
 * An `index.html` is the entry of an application (rkp reads the page and builds the scripts it names).
 * Otherwise: src/main, src/index, main, index, with the extensions ts tsx mts js jsx mjs. A library
 * prefers src/index.
 */
function detectEntry(projectAbs, { library = false } = {}) {
  if (!library && fs.existsSync(path.join(projectAbs, 'index.html'))) return 'index.html';
  return firstFile(projectAbs, library ? LIBRARY_NAMES : APP_NAMES);
}

module.exports = { detectEntry, SCRIPT_EXTENSIONS };
