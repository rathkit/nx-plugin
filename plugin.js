'use strict';
// The Nx plugin: add "@rathkit/nx-plugin" to the plugins of nx.json.
// Nx 23 and 24 read `createNodes`; older ones read `createNodesV2`, which is the same value.
const { createNodes } = require('./src/plugin/create-nodes');

module.exports = { name: '@rathkit/nx-plugin', createNodes, createNodesV2: createNodes };
