// createNodes on its own: which folders become projects and what their targets say. No Nx install is needed.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { cacheRoot } from "./helpers/workspace.mjs";
import plugin from "../plugin.js";

mkdirSync(cacheRoot, { recursive: true });
const root = mkdtempSync(join(cacheRoot, "nodes-"));
after(() => rmSync(root, { recursive: true, force: true }));

const put = (files) => {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
};
const run = async (files, options) => {
  const [, fn] = plugin.createNodes;
  return fn(files, options, { workspaceRoot: root, nxJsonConfiguration: {} });
};

put({
  "apps/web/package.json": "{}",
  "apps/web/rathkit.config.mjs": "export default {};",
  "apps/web/src/main.ts": "",
  "apps/page/project.json": "{}",
  "apps/page/rathkit.config.js": "export default {};",
  "apps/page/index.html": "<!doctype html>",
  "apps/noentry/package.json": "{}",
  "apps/noentry/rathkit.config.mjs": "",
  "apps/noowner/rathkit.config.mjs": "",
  "apps/noowner/src/main.ts": "",
});

describe("createNodes", () => {
  test("the plugin is exported as createNodes and createNodesV2, the same value", () => {
    assert.equal(plugin.name, "@rathkit/nx");
    assert.equal(plugin.createNodes, plugin.createNodesV2);
    assert.equal(plugin.createNodes[0], "**/rathkit.config.{mjs,js,cjs}");
  });

  test("a project needs a config file, a package.json or project.json, and an entry", async () => {
    const result = await run(["apps/web/rathkit.config.mjs", "apps/page/rathkit.config.js", "apps/noentry/rathkit.config.mjs", "apps/noowner/rathkit.config.mjs"]);
    assert.deepEqual(result.map(([file]) => file), ["apps/web/rathkit.config.mjs", "apps/page/rathkit.config.js"]);
    assert.deepEqual(Object.keys(result[0][1].projects), ["apps/web"]);
  });

  test("build, serve and watch say how they are cached and ordered", async () => {
    const [[, { projects }]] = await run(["apps/web/rathkit.config.mjs"]);
    const { build, serve, watch } = projects["apps/web"].targets;
    assert.equal(build.executor, "@rathkit/nx:build");
    assert.equal(build.cache, true);
    assert.deepEqual(build.dependsOn, ["^build"]);
    assert.deepEqual(build.outputs, ["{options.outputPath}"]);
    assert.equal(build.options.outputPath, "{projectRoot}/dist");
    assert.ok(build.inputs.includes("default") && build.inputs.includes("^default"));
    assert.ok(build.inputs.includes("!{projectRoot}/dist/**/*"), "the output folder is not an input");
    assert.ok(build.inputs.some((i) => i.fileset === "{projectRoot}/.env*" && i.includeIgnored === true));
    assert.ok(build.inputs.some((i) => i.env === "NODE_ENV"));
    assert.equal(serve.executor, "@rathkit/nx:serve");
    assert.equal(serve.cache, false);
    assert.equal(serve.continuous, true);
    assert.deepEqual(serve.dependsOn, ["^build"]);
    assert.equal(watch.executor, "@rathkit/nx:build");
    assert.equal(watch.options.watch, true);
    assert.equal(watch.continuous, true);
    assert.equal(watch.cache, false);
  });

  test("target names, the output folder and extra variables are options", async () => {
    const [[, { projects }]] = await run(["apps/web/rathkit.config.mjs"], { buildTargetName: "rkp-build", serveTargetName: "rkp-serve", watchTargetName: "rkp-watch", outDir: "out", env: ["VITE_API"] });
    const { targets } = projects["apps/web"];
    assert.deepEqual(Object.keys(targets), ["rkp-build", "rkp-serve", "rkp-watch"]);
    assert.deepEqual(targets["rkp-build"].dependsOn, ["^rkp-build"]);
    assert.equal(targets["rkp-build"].options.outputPath, "{projectRoot}/out");
    assert.ok(targets["rkp-build"].inputs.some((i) => i.env === "VITE_API"));
  });
});
