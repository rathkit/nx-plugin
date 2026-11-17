// The executors with targets written by hand in project.json (no plugin), and the option-to-flag mapping on its own.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { cacheRoot, createWorkspace, fiveProjectFiles, freePort, nxBackground, rkpBin, wasCached, wasRun, waitFor } from "./helpers/workspace.mjs";

const require = createRequire(import.meta.url);
const { buildArgs } = require("../src/lib/args.js");
const { cleanOutput, resolveRkp } = require("../src/lib/rkp.js");
const buildExecutor = require("../src/executors/build/executor.js");

const skip = rkpBin() ? false : "no rkp binary: set RATHKIT_PACK_BIN";

mkdirSync(cacheRoot, { recursive: true });
const scratch = mkdtempSync(join(cacheRoot, "exec-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

describe("option mapping", () => {
  const proj = join(scratch, "proj");
  mkdirSync(join(proj, "src"), { recursive: true });
  writeFileSync(join(proj, "src/main.ts"), "");
  const ctx = { projectAbs: proj, workspaceRoot: scratch };

  test("one script entry is written to outputPath/NAME.js", () => {
    const { args, entries, outputAbs } = buildArgs("bundle", { outputPath: "proj/dist", minify: true, sourcemap: "external", target: "es2020", external: ["react"], define: { A: "1" } }, ctx);
    assert.deepEqual(entries, ["src/main.ts"]);
    assert.equal(outputAbs, join(scratch, "proj/dist"));
    assert.deepEqual(args, ["bundle", "src/main.ts", "--outfile", join(scratch, "proj/dist/main.js"), "--minify", "--sourcemap=external", "--target", "es2020", "--external", "react", "--define", "A=1"]);
  });

  test("a page, several entries, several formats or splitting write to a folder", () => {
    assert.deepEqual(buildArgs("bundle", { entry: "index.html", outputPath: "o" }, ctx).args.slice(0, 4), ["bundle", "index.html", "--outdir", join(scratch, "o")]);
    const many = buildArgs("bundle", { entry: ["src/a.ts", "src/b.ts"], outputPath: "o" }, ctx).args;
    assert.ok(many.includes("--outdir") && many.includes("--splitting"));
    const formats = buildArgs("bundle", { outputPath: "o", format: "esm,cjs" }, ctx).args;
    assert.ok(formats.includes("--outdir") && formats.includes("--format") && !formats.includes("--splitting"));
  });

  test("serve takes a port and passes extra arguments through", () => {
    const { args } = buildArgs("serve", { port: 4300, host: "0.0.0.0", hmr: true, args: ["--no-env-files"] }, ctx);
    assert.deepEqual(args, ["serve", "src/main.ts", "--port", "4300", "--host", "0.0.0.0", "--hmr", "--no-env-files"]);
  });

  test("no entry is an error that says what to do", () => {
    const empty = join(scratch, "empty");
    mkdirSync(empty, { recursive: true });
    assert.throws(() => buildArgs("bundle", {}, { projectAbs: empty, workspaceRoot: scratch }), /no entry found in empty.*"entry" option/);
  });

  test("clean refuses the workspace, the project and anything outside the workspace", () => {
    for (const dir of [scratch, proj, join(scratch, "..")]) assert.throws(() => cleanOutput(dir, { workspaceRoot: scratch, projectAbs: proj }), /refusing/);
    mkdirSync(join(proj, "dist"), { recursive: true });
    cleanOutput(join(proj, "dist"), { workspaceRoot: scratch, projectAbs: proj });
    assert.ok(!existsSync(join(proj, "dist")));
  });

  test("the program is found from the option, then RATHKIT_PACK_BIN, then the package, then PATH", () => {
    const saved = process.env.RATHKIT_PACK_BIN;
    try {
      process.env.RATHKIT_PACK_BIN = "/env/rkp";
      assert.deepEqual(resolveRkp({ workspaceRoot: scratch, rkpBin: "tools/rkp" }), { command: join(scratch, "tools/rkp"), source: "option" });
      assert.deepEqual(resolveRkp({ workspaceRoot: scratch }), { command: "/env/rkp", source: "env" });
      delete process.env.RATHKIT_PACK_BIN;
      assert.deepEqual(resolveRkp({ workspaceRoot: scratch }), { command: "rkp", source: "path" });
    } finally {
      if (saved === undefined) delete process.env.RATHKIT_PACK_BIN;
      else process.env.RATHKIT_PACK_BIN = saved;
    }
  });

  test("a program that cannot be started is a message, not a stack", async () => {
    const context = { root: scratch, projectName: "p", projectsConfigurations: { projects: { p: { root: "proj" } } } };
    await assert.rejects(buildExecutor({ rkpBin: "does-not-exist", outputPath: "proj/dist" }, context), /could not start rkp.*pnpm add -D @rathkit\/pack/);
  });
});

const target = (extra) => ({ executor: "@rathkit/nx:build", options: { outputPath: "{projectRoot}/dist", ...extra } });

/** The workspace of the inferred-task test, with the targets written by hand and no plugin. */
function handWritten() {
  const files = { ...fiveProjectFiles() };
  for (const key of Object.keys(files)) if (key.endsWith("rathkit.config.mjs")) delete files[key];
  for (const name of ["a", "b", "c", "l1", "l2"]) {
    const dir = name.startsWith("l") ? `libs/${name}` : `apps/${name}`;
    const lib = name.startsWith("l");
    files[`${dir}/project.json`] = {
      name: `@ws/${name}`,
      targets: { build: target({ library: lib }), serve: { executor: "@rathkit/nx:serve", options: {} }, watch: target({ watch: true, library: lib }) },
    };
  }
  return files;
}

const nxJson = {
  targetDefaults: {
    "@rathkit/nx:build": { cache: true, dependsOn: ["^build"], inputs: ["default", "^default", "!{projectRoot}/dist/**/*", { externalDependencies: ["@rathkit/pack"] }], outputs: ["{options.outputPath}"] },
    "@rathkit/nx:serve": { dependsOn: ["^build"] },
  },
};

const P = (n) => `@ws/${n}`;

describe("executors with targets written by hand", { skip }, () => {
  let ws;
  before(() => {
    ws = createWorkspace("executors", handWritten(), { nxJson });
  });

  test("run-many builds all five in order, and a second run is all cache hits", () => {
    const first = ws.nx("run-many", "-t", "build");
    assert.equal(first.status, 0, first.out);
    for (const p of ["a", "b", "c", "l1", "l2"]) assert.ok(wasRun(first.out, `${P(p)}:build`), `${p}\n${first.out}`);
    assert.match(readFileSync(ws.path("apps/b/dist/main.js"), "utf8"), /l1-v1/);
    const second = ws.nx("run-many", "-t", "build");
    for (const p of ["a", "b", "c", "l1", "l2"]) assert.ok(wasCached(second.out, `${P(p)}:build`), second.out);
  });

  test("a build error fails the task and is not cached", () => {
    const file = ws.path("apps/c/src/main.ts");
    const good = readFileSync(file, "utf8");
    writeFileSync(file, 'import "./does-not-exist";\n');
    const bad = ws.nx("run", `${P("c")}:build`);
    assert.notEqual(bad.status, 0);
    assert.match(bad.out, /does-not-exist/);
    const again = ws.nx("run", `${P("c")}:build`);
    assert.ok(!wasCached(again.out, `${P("c")}:build`), "a failed task is not cached");
    writeFileSync(file, good);
    assert.equal(ws.nx("run", `${P("c")}:build`).status, 0);
  });

  test("clean removes a stale output file", () => {
    writeFileSync(ws.path("apps/c/dist/stale.js"), "x");
    writeFileSync(ws.path("apps/c/src/main.ts"), 'console.log("c-v2");\n');
    const r = ws.nx("run", `${P("c")}:build`);
    assert.equal(r.status, 0, r.out);
    assert.ok(!existsSync(ws.path("apps/c/dist/stale.js")));
  });

  test("serve and watch work from project.json", async () => {
    const port = await freePort();
    const serve = nxBackground(ws.root, ["run", `${P("a")}:serve`, `--port=${port}`, "--output-style=static"]);
    try {
      await waitFor(async () => (await fetch(`http://localhost:${port}/`)).status, { what: `serve\n${serve.output()}` });
    } finally {
      await serve.stop();
    }
    const watch = nxBackground(ws.root, ["run", `${P("a")}:watch`, "--output-style=static"]);
    try {
      const out = ws.path("apps/a/dist/main.js");
      await waitFor(() => existsSync(out), { what: `watch\n${watch.output()}` });
      writeFileSync(ws.path("apps/a/src/main.ts"), 'console.log("a-hand-watched");\n');
      await waitFor(() => /a-hand-watched/.test(readFileSync(out, "utf8")), { what: `rebuild\n${watch.output()}` });
    } finally {
      await watch.stop();
    }
  });
});
