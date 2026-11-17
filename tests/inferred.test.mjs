// Inferred tasks in a real Nx workspace: 3 apps and 2 libraries, run, cached, affected, served and watched.
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { createWorkspace, fiveProjectFiles, freePort, nxBackground, rkpBin, wasCached, wasRun, waitFor } from "./helpers/workspace.mjs";

const skip = rkpBin() ? false : "no rkp binary: set RATHKIT_PACK_BIN";

const P = (n) => `@ws/${n}`; // package.json projects are named by their package

describe("inferred tasks: 3 apps and 2 libraries", { skip }, () => {
  let ws;
  before(() => {
    ws = createWorkspace("inferred", fiveProjectFiles());
  });

  test("every project has build, serve and watch", () => {
    for (const name of ["a", "b", "c", "l1", "l2"]) {
      const r = ws.nx("show", "project", P(name), "--json");
      assert.equal(r.status, 0, r.out);
      const { targets } = JSON.parse(r.stdout);
      for (const t of name.startsWith("l") ? ["build", "watch"] : ["build", "serve", "watch"]) assert.ok(targets[t], `${name}:${t}`);
      assert.equal(Boolean(targets.serve), !name.startsWith("l"), "only applications are served");
      assert.equal(targets.build.cache, true);
      assert.deepEqual(targets.build.outputs, ["{options.outputPath}"]);
      assert.equal(targets.build.options.outputPath, `${name.startsWith("l") ? "libs" : "apps"}/${name}/dist`);
      if (targets.serve) assert.equal(targets.serve.continuous, true);
    }
  });

  test("the graph orders libraries before the apps that use them", () => {
    const r = ws.nx("graph", "--file=graph.json");
    assert.equal(r.status, 0, r.out);
    const graph = JSON.parse(readFileSync(ws.path("graph.json"), "utf8")).graph;
    const deps = (p) => graph.dependencies[P(p)].map((d) => d.target).sort();
    assert.deepEqual(deps("a"), [P("l1")]);
    assert.deepEqual(deps("b"), [P("l1"), P("l2")]);
    assert.deepEqual(deps("c"), []);
  });

  test("run-many builds all five, libraries first, and a second run is all cache hits", () => {
    const first = ws.nx("run-many", "-t", "build");
    assert.equal(first.status, 0, first.out);
    for (const p of ["a", "b", "c", "l1", "l2"]) assert.ok(wasRun(first.out, P(p) + ":build"), `${p}:build ran\n${first.out}`);
    assert.ok(first.out.indexOf(`nx run ${P("l1")}:build`) < first.out.indexOf(`nx run ${P("a")}:build`));
    assert.match(readFileSync(ws.path("apps/b/dist/main.js"), "utf8"), /l1-v1[\s\S]*l2-v1|l2-v1[\s\S]*l1-v1/);

    const second = ws.nx("run-many", "-t", "build");
    for (const p of ["a", "b", "c", "l1", "l2"]) assert.ok(wasCached(second.out, P(p) + ":build"), `${p}:build cached\n${second.out}`);
  });

  test("a cache hit restores deleted outputs", () => {
    ws.nx("run-many", "-t", "build");
    ws.git("clean", "-fdxq", "--", "apps/a/dist");
    assert.ok(!existsSync(ws.path("apps/a/dist/main.js")));
    const r = ws.nx("run", P("a") + ":build");
    assert.ok(wasCached(r.out, P("a") + ":build"), r.out);
    assert.ok(existsSync(ws.path("apps/a/dist/main.js")));
  });

  test("nx affected: a change to l2 builds l2 and b, and not a, c or l1", () => {
    writeFileSync(ws.path("libs/l2/src/index.ts"), 'export const l2 = (): string => "l2-v2";\n');
    ws.commit("change l2");
    const r = ws.nx("affected", "-t", "build", "--base=HEAD~1", "--head=HEAD");
    assert.equal(r.status, 0, r.out);
    assert.ok(wasRun(r.out, P("l2") + ":build") && wasRun(r.out, P("b") + ":build"), r.out);
    for (const p of ["a", "c", "l1"]) assert.ok(!r.out.includes(`nx run ${p}:build`) || wasCached(r.out, P(p) + ":build"), `${p} should not run\n${r.out}`);
    assert.match(readFileSync(ws.path("apps/b/dist/main.js"), "utf8"), /l2-v2/);
    const everything = ws.nx("run-many", "-t", "build");
    assert.ok(["a", "c", "l1"].every((p) => wasCached(everything.out, P(p) + ":build")), everything.out);
  });

  test("a project's own target overrides the inferred one", () => {
    writeFileSync(ws.path("apps/c/project.json"), JSON.stringify({ name: "@ws/c", targets: { build: { options: { outputPath: "{projectRoot}/out", minify: true } } } }));
    const r = ws.nx("run", P("c") + ":build");
    assert.equal(r.status, 0, r.out);
    assert.ok(existsSync(ws.path("apps/c/out/main.js")));
    rmSync(ws.path("apps/c/project.json"));
    rmSync(ws.path("apps/c/out"), { recursive: true, force: true });
  });

  test("serve answers HTTP and stops cleanly", async () => {
    const port = await freePort();
    const job = nxBackground(ws.root, ["run", P("a") + ":serve", `--port=${port}`, "--output-style=static"]);
    try {
      const status = await waitFor(async () => (await fetch(`http://localhost:${port}/`)).status, { what: `serve on ${port}\n${job.output()}` });
      assert.ok(status < 500, `status ${status}`);
    } finally {
      await job.stop();
    }
    await assert.rejects(fetch(`http://localhost:${port}/`), "the server is gone after stop");
  });

  test("watch builds again when a file changes", async () => {
    const job = nxBackground(ws.root, ["run", P("a") + ":watch", "--output-style=static"]);
    try {
      const out = ws.path("apps/a/dist/main.js");
      await waitFor(() => existsSync(out), { what: `first watch build\n${job.output()}` });
      writeFileSync(ws.path("apps/a/src/main.ts"), 'import { l1 } from "@ws/l1";\nconsole.log("a-watched", l1());\n');
      await waitFor(() => /a-watched/.test(readFileSync(out, "utf8")), { what: `rebuild\n${job.output()}` });
    } finally {
      await job.stop();
    }
  });
});
