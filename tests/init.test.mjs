// The init generator: on a virtual tree, and through `nx add @rathkit/nx` in a real clean workspace.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, test } from "node:test";
import { createWorkspace, packPlugin, rkpBin } from "./helpers/workspace.mjs";

const require = createRequire(import.meta.url);
const { addProjectConfiguration, readJson, readNxJson, writeJson } = require("@nx/devkit");
const { createTreeWithEmptyWorkspace } = require("@nx/devkit/testing");
const init = require("../src/generators/init/generator.js");

function treeWithProjects() {
  const tree = createTreeWithEmptyWorkspace();
  writeJson(tree, "package.json", { name: "ws", devDependencies: {} });
  tree.write(".gitignore", "node_modules\n");
  addProjectConfiguration(tree, "web", { root: "apps/web", targets: {} });
  tree.write("apps/web/src/main.ts", "");
  addProjectConfiguration(tree, "site", { root: "apps/site", targets: {} });
  tree.write("apps/site/index.html", "");
  addProjectConfiguration(tree, "old", { root: "apps/old", targets: { build: { executor: "nx:noop" } } });
  tree.write("apps/old/src/main.ts", "");
  addProjectConfiguration(tree, "docs", { root: "docs", targets: {} });
  return tree;
}

describe("init generator on a tree", () => {
  test("registers the plugin once, adds @rathkit/pack, and opts in the projects rkp can build", async () => {
    const tree = treeWithProjects();
    await init(tree, { skipFormat: true });
    await init(tree, { skipFormat: true });
    assert.deepEqual(readNxJson(tree).plugins.filter((p) => p === "@rathkit/nx"), ["@rathkit/nx"]);
    assert.equal(readJson(tree, "package.json").devDependencies["@rathkit/pack"], "next");
    assert.ok(tree.exists("apps/web/rathkit.config.mjs"));
    assert.ok(tree.exists("apps/site/rathkit.config.mjs"));
    assert.ok(!tree.exists("apps/old/rathkit.config.mjs"), "a project with its own build target is left alone");
    assert.ok(!tree.exists("docs/rathkit.config.mjs"), "nothing to build, nothing created");
    assert.match(tree.read(".gitignore", "utf-8"), /^dist$/m);
  });

  test("project names the projects; skipConfig and skipPackageJson skip their parts", async () => {
    const tree = treeWithProjects();
    await init(tree, { project: "old", skipPackageJson: true, skipFormat: true });
    assert.ok(tree.exists("apps/old/rathkit.config.mjs"));
    assert.ok(!tree.exists("apps/web/rathkit.config.mjs"));
    assert.equal(readJson(tree, "package.json").devDependencies["@rathkit/pack"], undefined);
    const bare = treeWithProjects();
    await init(bare, { skipConfig: true, skipFormat: true });
    assert.ok(!bare.exists("apps/web/rathkit.config.mjs"));
    await assert.rejects(init(treeWithProjects(), { project: "nope", skipFormat: true }), /no project "nope"/);
  });

  test("keepExistingVersions keeps a version that is already there; an existing plugin entry with options stays", async () => {
    const tree = treeWithProjects();
    writeJson(tree, "package.json", { name: "ws", devDependencies: { "@rathkit/pack": "0.3.0-beta.0" } });
    const nxJson = readNxJson(tree);
    nxJson.plugins = [{ plugin: "@rathkit/nx", options: { outDir: "out" } }];
    writeJson(tree, "nx.json", nxJson);
    await init(tree, { keepExistingVersions: true, skipFormat: true });
    assert.equal(readJson(tree, "package.json").devDependencies["@rathkit/pack"], "0.3.0-beta.0");
    assert.deepEqual(readNxJson(tree).plugins, [{ plugin: "@rathkit/nx", options: { outDir: "out" } }]);
  });
});

const skip = rkpBin() ? false : "no rkp binary: set RATHKIT_PACK_BIN";

describe("nx add @rathkit/nx in a clean workspace", { skip }, () => {
  test("one command, then a first build", () => {
    const files = {
      "apps/web/package.json": { name: "@ws/web", version: "1.0.0", private: true, type: "module" },
      "apps/web/index.html": '<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>\n',
      "apps/web/src/main.ts": 'console.log("first build");\n',
    };
    // The plugin is not installed and nx.json has no plugins: this is a workspace that has never heard of @rathkit/nx.
    const ws = createWorkspace("add", files, { install: false });
    assert.deepEqual(JSON.parse(readFileSync(ws.path("nx.json"), "utf8")).plugins, []);

    const added = ws.nx("add", `@rathkit/nx@file:${packPlugin()}`);
    assert.equal(added.status, 0, added.out);
    assert.ok(readNxJsonFile(ws).plugins.includes("@rathkit/nx"), added.out);
    const dev = JSON.parse(readFileSync(ws.path("package.json"), "utf8")).devDependencies;
    assert.ok(dev["@rathkit/nx"], "the plugin is a dev dependency");
    assert.match(dev["@rathkit/pack"], /^file:/, "keepExistingVersions: the version already there is kept");
    assert.ok(existsSync(ws.path("apps/web/rathkit.config.mjs")), "the project is opted in");

    const build = ws.nx("run", "@ws/web:build");
    assert.equal(build.status, 0, build.out);
    assert.ok(readdirDist(ws).length > 0, "first build wrote files");
  });
});

const readNxJsonFile = (ws) => JSON.parse(readFileSync(ws.path("nx.json"), "utf8"));
const readdirDist = (ws) => require("node:fs").readdirSync(ws.path("apps/web/dist"));
