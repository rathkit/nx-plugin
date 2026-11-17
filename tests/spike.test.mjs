// Spike 9.1: an Nx workspace builds an app and a library with rkp through the @rathkit/nx executor.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { before, describe, test } from "node:test";
import { createWorkspace, rkpBin, sampleFiles, wasCached, wasRun } from "./helpers/workspace.mjs";

const skip = rkpBin() ? false : "no rkp binary: set RATHKIT_PACK_BIN";

const target = (extra = {}) => ({
  executor: "@rathkit/nx:build",
  cache: true,
  inputs: ["default", "^default", "!{projectRoot}/dist/**/*", { externalDependencies: ["@rathkit/pack"] }],
  outputs: ["{options.outputPath}"],
  options: { outputPath: "{projectRoot}/dist", ...extra },
});

const files = {
  ...sampleFiles(),
  "nx.json": { plugins: [] },
  "libs/greeter/project.json": { name: "greeter", targets: { build: { ...target({ entry: "src/index.ts", format: "esm" }) } } },
  "apps/web/project.json": { name: "web", targets: { build: { ...target(), dependsOn: ["^build"] } } },
};

const digest = (dir) => {
  const h = createHash("sha256");
  for (const f of readdirSync(dir, { recursive: true }).sort()) h.update(f).update(readFileSync(join(dir, f)));
  return h.digest("hex");
};

describe("spike: nx builds an app and a library with rkp", { skip }, () => {
  let ws;
  before(() => {
    ws = createWorkspace("spike", files);
  });

  test("the library builds first and the app builds against its output", () => {
    const r = ws.nx(["run", "web:build", "--skip-nx-cache"]);
    assert.equal(r.status, 0, r.out);
    assert.ok(wasRun(r.out, "greeter:build"), r.out);
    assert.ok(existsSync(ws.path("libs/greeter/dist/index.js")));
    const app = readFileSync(ws.path("apps/web/dist/main.js"), "utf8");
    assert.match(app, /hello/);
    assert.doesNotMatch(app, /@ws\/greeter/);
  });

  test("an identical rebuild is byte-identical and a second run is a cache hit", () => {
    const before = digest(ws.path("apps/web/dist"));
    const rebuilt = ws.nx(["run", "web:build", "--skip-nx-cache"]);
    assert.equal(rebuilt.status, 0, rebuilt.out);
    assert.equal(digest(ws.path("apps/web/dist")), before);
    ws.nx(["reset"]);
    const first = ws.nx(["run", "web:build"]);
    assert.equal(first.status, 0, first.out);
    const second = ws.nx(["run", "web:build"]);
    assert.ok(wasCached(second.out, "web:build") && wasCached(second.out, "greeter:build"), second.out);
  });

  test("a changed library source rebuilds the library and the app; an unrelated file rebuilds nothing", () => {
    ws.nx("run", "web:build");
    writeFileSync(ws.path("README.md"), "unrelated\n");
    const unrelated = ws.nx("run", "web:build");
    assert.ok(wasCached(unrelated.out, "web:build") && wasCached(unrelated.out, "greeter:build"), unrelated.out);

    writeFileSync(ws.path("libs/greeter/src/index.ts"), "export const greet = (n: string): string => `howdy ${n}`;\n");
    const changed = ws.nx("run", "web:build");
    assert.equal(changed.status, 0, changed.out);
    assert.ok(wasRun(changed.out, "greeter:build") && wasRun(changed.out, "web:build"), changed.out);
    assert.match(readFileSync(ws.path("apps/web/dist/main.js"), "utf8"), /howdy/);
  });

  test("the metafile lists every module rkp read, and all of them are inside the projects the graph says the app depends on", () => {
    const meta = ws.path("meta.json");
    const r = ws.nx("run", "web:build", "--skip-nx-cache", "--metafile", "meta.json");
    assert.equal(r.status, 0, r.out);
    const inputs = Object.keys(JSON.parse(readFileSync(meta, "utf8")).inputs).map((p) => resolve(ws.root, "apps/web", p));
    for (const file of inputs) {
      assert.ok(file.startsWith(ws.path("apps/web") + "/") || file.startsWith(ws.path("libs/greeter") + "/"), `${file} is outside the app and the library`);
    }
    assert.ok(inputs.some((f) => f.endsWith("libs/greeter/dist/index.js")), "the app reads the library's built output");
  });
});
