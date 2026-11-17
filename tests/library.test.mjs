// Buildable and publishable libraries: esm and cjs, declarations, exports, consumed by an app of the workspace.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { before, describe, test } from "node:test";
import { cacheRoot, createWorkspace, fiveProjectFiles, rkpBin, sh, wasCached, wasRun } from "./helpers/workspace.mjs";

const skip = rkpBin() ? false : "no rkp binary: set RATHKIT_PACK_BIN";
const P = (n) => `@ws/${n}`;
const json = (ws, file) => JSON.parse(readFileSync(ws.path(file), "utf8"));

describe("libraries", { skip }, () => {
  let ws;
  before(() => {
    ws = createWorkspace("library", fiveProjectFiles());
  });

  test("a library has build and watch and no serve", () => {
    const { targets } = JSON.parse(ws.nx("show", "project", P("l1"), "--json").stdout);
    assert.equal(targets.build.options.library, true);
    assert.ok(targets.watch && !targets.serve);
    assert.ok(targets.build.inputs.some((i) => i.externalDependencies?.includes("typescript")), "typescript is an input");
    assert.equal(JSON.parse(ws.nx("show", "project", P("a"), "--json").stdout).targets.build.options.library, undefined);
  });

  test("the build writes esm, cjs, declarations and a package.json with exports, and does not edit the source package.json", () => {
    const source = readFileSync(ws.path("libs/l1/package.json"), "utf8");
    const r = ws.nx("run", `${P("l1")}:build`);
    assert.equal(r.status, 0, r.out);
    const files = readdirSync(ws.path("libs/l1/dist")).sort();
    assert.deepEqual(files, ["index.cjs", "index.d.ts", "index.mjs", "package.json"]);
    const manifest = json(ws, "libs/l1/dist/package.json");
    assert.equal(manifest.name, "@ws/l1");
    assert.equal(manifest.scripts, undefined);
    assert.deepEqual(Object.keys(manifest.exports), [".", "./package.json"]);
    assert.equal(manifest.files, undefined);
    const dot = manifest.exports["."];
    assert.deepEqual([dot.types, dot.import, dot.require], ["./index.d.ts", "./index.mjs", "./index.cjs"]);
    assert.equal(readFileSync(ws.path("libs/l1/package.json"), "utf8"), source);
  });

  test("the dist folder works as a package: import, require and types", () => {
    const dist = ws.path("libs/l1/dist");
    const esm = execFileSync("node", ["--input-type=module", "-e", `import { l1 } from ${JSON.stringify(join(dist, "index.mjs"))}; console.log(l1())`], { encoding: "utf8" });
    assert.equal(esm.trim(), "l1-v1");
    const cjs = execFileSync("node", ["-e", `console.log(require(${JSON.stringify(join(dist, "index.cjs"))}).l1())`], { encoding: "utf8" });
    assert.equal(cjs.trim(), "l1-v1");
    assert.match(readFileSync(join(dist, "index.d.ts"), "utf8"), /l1.*string/);
    const tarballs = mkdtempSync(join(cacheRoot, "lib-pack-"));
    try {
      sh(dist, "pnpm", ["pack", "--pack-destination", tarballs]);
      const listing = execFileSync("tar", ["-tzf", join(tarballs, readdirSync(tarballs)[0])], { encoding: "utf8" }).split("\n").filter(Boolean).sort();
      assert.deepEqual(listing, ["package/index.cjs", "package/index.d.ts", "package/index.mjs", "package/package.json"]);
    } finally {
      rmSync(tarballs, { recursive: true, force: true });
    }
  });

  test("an app consumes the built library, in the build and in the types", () => {
    const r = ws.nx("run", `${P("a")}:build`);
    assert.equal(r.status, 0, r.out);
    assert.ok(wasCached(r.out, `${P("l1")}:build`), "the library was built already");
    assert.match(readFileSync(ws.path("apps/a/dist/main.js"), "utf8"), /l1-v1/);
    // tsc finds the declarations through the exports of the library's package.json.
    writeFileSync(ws.path("apps/a/src/check.ts"), 'import { l1 } from "@ws/l1";\nconst s: string = l1();\nexport default s;\n');
    sh(ws.root, "pnpm", ["exec", "tsc", "--noEmit", "-p", "apps/a"]);
    writeFileSync(ws.path("apps/a/src/check.ts"), 'import { l1 } from "@ws/l1";\nconst n: number = l1();\nexport default n;\n');
    assert.throws(() => sh(ws.root, "pnpm", ["exec", "tsc", "--noEmit", "-p", "apps/a"]), /not assignable|Type 'string'/);
    rmSync(ws.path("apps/a/src/check.ts"));
  });

  test("a cache hit restores the whole package, and a source change rebuilds it", () => {
    rmSync(ws.path("libs/l1/dist"), { recursive: true, force: true });
    const hit = ws.nx("run", `${P("l1")}:build`);
    assert.ok(wasCached(hit.out, `${P("l1")}:build`), hit.out);
    assert.ok(existsSync(ws.path("libs/l1/dist/package.json")) && existsSync(ws.path("libs/l1/dist/index.d.ts")));
    writeFileSync(ws.path("libs/l1/src/index.ts"), 'export const l1 = (): string => "l1-v2";\nexport const added = 1;\n');
    const miss = ws.nx("run", `${P("l1")}:build`);
    assert.ok(wasRun(miss.out, `${P("l1")}:build`), miss.out);
    assert.match(readFileSync(ws.path("libs/l1/dist/index.d.ts"), "utf8"), /added/);
  });

  test("the library's own version is not part of its output hash by accident: a second run after a build is a hit", () => {
    const again = ws.nx("run", `${P("l1")}:build`);
    assert.ok(wasCached(again.out, `${P("l1")}:build`), again.out);
  });
});
