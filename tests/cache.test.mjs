// Cache correctness: identical inputs give byte-identical output (in any folder), and every input that matters invalidates.
// Run for each Nx version with RATHKIT_NX_VERSION (tools/matrix.mjs does that for the versions in matrix.json).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { before, describe, test } from "node:test";
import { NX_VERSION, createWorkspace, fiveProjectFiles, rkpBin, wasCached, wasRun } from "./helpers/workspace.mjs";

const skip = rkpBin() ? false : "no rkp binary: set RATHKIT_PACK_BIN";
const P = (n) => `@ws/${n}`;
const digest = (dir) => {
  const h = createHash("sha256");
  for (const f of readdirSync(dir, { recursive: true }).sort()) {
    try {
      h.update(f).update(readFileSync(join(dir, f)));
    } catch {} // a folder
  }
  return h.digest("hex");
};

const files = () => ({
  ...fiveProjectFiles(),
  "apps/a/src/main.ts": 'import { l1 } from "@ws/l1";\nconsole.log("a", l1(), import.meta.env.VITE_API);\n',
  "apps/a/src/env.d.ts": "interface ImportMeta { env: Record<string, string> }\n",
  ".gitignore": "node_modules\n.nx\n.env*\n",
});
const nxJson = { plugins: [{ plugin: "@rathkit/nx-plugin", options: { env: ["VITE_API"] } }] };

describe(`cache correctness on nx ${NX_VERSION}`, { skip }, () => {
  let ws;
  before(() => {
    ws = createWorkspace("cache", files(), { nxJson });
  });
  const run = (name, env = {}) => {
    const r = nxIn(ws, ["run", `${P(name)}:build`], env);
    assert.equal(r.status, 0, r.out);
    return r;
  };

  test("identical inputs give byte-identical output, in this folder and in another one", () => {
    run("a");
    const first = { app: digest(ws.path("apps/a/dist")), lib: digest(ws.path("libs/l1/dist")) };
    // Again, without the cache.
    assert.equal(nxIn(ws, ["run", `${P("a")}:build`, "--skip-nx-cache"]).status, 0);
    assert.deepEqual({ app: digest(ws.path("apps/a/dist")), lib: digest(ws.path("libs/l1/dist")) }, first);
    // The same files in a second workspace at another path.
    const other = createWorkspace("cache-other", files(), { nxJson });
    assert.equal(nxIn(other, ["run", `${P("a")}:build`]).status, 0);
    assert.deepEqual({ app: digest(other.path("apps/a/dist")), lib: digest(other.path("libs/l1/dist")) }, first);
  });

  test("an unchanged workspace is all cache hits, also after touching files and unrelated changes", () => {
    run("a");
    utimesSync(ws.path("apps/a/src/main.ts"), new Date(), new Date(Date.now() + 5000));
    writeFileSync(ws.path("README.md"), "unrelated\n");
    writeFileSync(ws.path("apps/c/src/main.ts"), 'console.log("c changed");\n');
    const r = run("a");
    assert.ok(wasCached(r.out, `${P("a")}:build`) && wasCached(r.out, `${P("l1")}:build`), r.out);
  });

  test("the output folder is not an input: a tracked or leftover dist does not change the hash", () => {
    run("a");
    writeFileSync(ws.path(".gitignore"), "node_modules\n.nx\n.env*\n"); // dist is not ignored here
    writeFileSync(ws.path("apps/a/dist/extra.txt"), "left over\n");
    ws.commit("dist is visible to git");
    const r = run("a");
    assert.ok(wasCached(r.out, `${P("a")}:build`), r.out);
    assert.ok(existsSync(ws.path("apps/a/dist/main.js")));
  });

  // Each of these changes something rkp reads, and must make the task run again.
  const invalidators = {
    "a source of the app": () => writeFileSync(ws.path("apps/a/src/main.ts"), 'import { l1 } from "@ws/l1";\nconsole.log("a2", l1(), import.meta.env.VITE_API);\n'),
    "a source of a library it uses (the library is rebuilt, then the app)": () => writeFileSync(ws.path("libs/l1/src/index.ts"), 'export const l1 = (): string => "l1-v9";\n'),
    "the workspace tsconfig.base.json": () => writeFileSync(ws.path("tsconfig.base.json"), JSON.stringify({ compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", target: "es2021" } })),
    "the project's rathkit.config.mjs": () => writeFileSync(ws.path("apps/a/rathkit.config.mjs"), "export default { plugins: [] };\n"),
    "a .env file that git ignores": () => writeFileSync(ws.path("apps/a/.env"), `VITE_FROM_FILE=${Date.now()}\n`),
    "the browserslist file at the workspace root": () => writeFileSync(ws.path(".browserslistrc"), "chrome 120\n"),
    "the app's package.json": () => writeFileSync(ws.path("apps/a/package.json"), JSON.stringify({ name: "@ws/a", version: "1.0.1", private: true, type: "module", dependencies: { "@ws/l1": "workspace:*" } })),
  };
  for (const [what, change] of Object.entries(invalidators)) {
    test(`changing ${what} invalidates the app's build`, () => {
      run("a");
      change();
      const r = run("a");
      assert.ok(wasRun(r.out, `${P("a")}:build`), `a:build should run\n${r.out}`);
    });
  }

  test("a variable named in the env option invalidates, and the build sees it", () => {
    const one = nxIn(ws, ["run", `${P("a")}:build`], { VITE_API: "one" });
    assert.equal(one.status, 0, one.out);
    assert.match(readFileSync(ws.path("apps/a/dist/main.js"), "utf8"), /one/);
    const again = nxIn(ws, ["run", `${P("a")}:build`], { VITE_API: "one" });
    assert.ok(wasCached(again.out, `${P("a")}:build`), again.out);
    const two = nxIn(ws, ["run", `${P("a")}:build`], { VITE_API: "two" });
    assert.ok(wasRun(two.out, `${P("a")}:build`), two.out);
    assert.match(readFileSync(ws.path("apps/a/dist/main.js"), "utf8"), /two/);
  });

  test("NODE_ENV invalidates", () => {
    run("a");
    const r = nxIn(ws, ["run", `${P("a")}:build`], { NODE_ENV: "production" });
    assert.ok(wasRun(r.out, `${P("a")}:build`), r.out);
  });

  test("a failed build is not cached and the next good build is", () => {
    const file = ws.path("apps/c/src/main.ts");
    const good = readFileSync(file, "utf8");
    writeFileSync(file, 'import "./missing";\n');
    assert.notEqual(nxIn(ws, ["run", `${P("c")}:build`]).status, 0);
    writeFileSync(file, good);
    assert.ok(wasRun(run("c").out, `${P("c")}:build`));
    assert.ok(wasCached(run("c").out, `${P("c")}:build`));
  });

  test("the plugin works with the daemon off and with the project graph cache cleared", () => {
    run("a");
    assert.equal(nxIn(ws, ["reset"]).status, 0);
    // reset also drops the cache of task results: the first run builds, the second is a hit.
    assert.ok(wasRun(run("a").out, `${P("a")}:build`));
    assert.ok(wasCached(run("a").out, `${P("a")}:build`));
  });
});

import { nxRun } from "./helpers/workspace.mjs";
function nxIn(ws, args, env) {
  return nxRun(ws.root, args, env);
}
