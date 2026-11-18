// Builds throwaway Nx workspaces for the tests: files written, the plugin installed from a packed tarball
// (so its peers resolve to the workspace's own nx), dependencies installed with pnpm, a git repository.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Never /tmp (a small tmpfs): the default is inside the repo's own node_modules, ignored by git.
export const cacheRoot = process.env.RATHKIT_NX_TEST_DIR ?? join(repoRoot, "node_modules/.cache/rathkit-nx-test");
export const TYPESCRIPT_VERSION = process.env.RATHKIT_TYPESCRIPT_VERSION ?? "5.9.3";
export const NX_VERSION = process.env.RATHKIT_NX_VERSION ?? "24.0.6";

const packDir = process.env.RATHKIT_PACK_DIR ?? join(homedir(), "code/rathkit/pack");
/** The rkp program the tests run: RATHKIT_PACK_BIN. There is no fallback, so a stale build is never picked up by accident. */
export function rkpBin() {
  const bin = process.env.RATHKIT_PACK_BIN;
  return bin && existsSync(bin) ? bin : null;
}
/** How workspaces install @rathkit/pack: a path (file:) or an npm spec. */
export const packSpec = process.env.RATHKIT_PACK_SPEC ?? `file:${join(packDir, "npm/pack")}`;

export const testEnv = {
  ...process.env,
  NX_DAEMON: "false",
  NX_NO_CLOUD: "true",
  NX_TUI: "false",
  CI: "true",
  NO_COLOR: "1",
  FORCE_COLOR: "0",
  ...(rkpBin() ? { RATHKIT_PACK_BIN: rkpBin() } : {}),
};

let tarball;
/** `pnpm pack` of this repository, once per test process. */
export function packPlugin() {
  if (tarball) return tarball;
  const dest = join(ensure(cacheRoot), "tarballs");
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const out = execFileSync("pnpm", ["pack", "--pack-destination", dest], { cwd: repoRoot, encoding: "utf8", env: testEnv });
  tarball = join(dest, readdirSync(dest).find((f) => f.endsWith(".tgz")));
  void out;
  return tarball;
}

function ensure(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Creates a workspace. `files` maps paths to text (or to an object, written as JSON).
 * Options: nx (version), nxJson (object), extraDev (more devDependencies), install (false to skip the install of the plugin).
 */
export function createWorkspace(name, files, options = {}) {
  const nx = options.nx ?? NX_VERSION;
  const root = join(ensure(cacheRoot), `${name}-nx${nx.replace(/\..*/, "")}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dev = { nx, "@nx/devkit": nx, "@rathkit/pack": packSpec, typescript: TYPESCRIPT_VERSION, ...options.extraDev };
  if (options.install !== false) dev["@rathkit/nx-plugin"] = `file:${packPlugin()}`;
  const all = {
    "package.json": { name: "ws", private: true, version: "0.0.0", devDependencies: dev },
    "pnpm-workspace.yaml": 'packages: ["apps/*", "libs/*"]\nallowBuilds:\n  nx: false\nstrictDepBuilds: false\nautoInstallPeers: false\n',
    "nx.json": options.nxJson ?? { plugins: options.install === false ? [] : ["@rathkit/nx-plugin"] },
    ".gitignore": "node_modules\n.nx\ndist\n",
    ...files,
  };
  for (const [file, content] of Object.entries(all)) {
    const abs = join(root, file);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof content === "string" ? content : json(content));
  }
  sh(root, "pnpm", ["install", "--no-frozen-lockfile"]);
  const git = (...args) => sh(root, "git", ["-c", "commit.gpgsign=false", "-c", "user.name=t", "-c", "user.email=t@example.com", ...args]);
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return { root, git, path: (...p) => join(root, ...p), nx: (...args) => nxRun(root, args.flat()), commit: (msg) => (git("add", "-A"), git("commit", "-q", "-m", msg)) };
}

export function sh(cwd, cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { cwd, env: { ...testEnv, ...env }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status}) in ${cwd}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

/** `pnpm exec nx ...`; returns { status, stdout, stderr } and does not throw. */
export function nxRun(root, args, env = {}) {
  if (["run", "run-many", "affected"].includes(args[0]) && !args.some((a) => a.startsWith("--output-style"))) args = [...args, "--output-style=static"];
  const r = spawnSync("pnpm", ["exec", "nx", ...args], { cwd: root, env: { ...testEnv, NX_CACHE_DIRECTORY: join(root, ".nx/cache"), ...env }, encoding: "utf8" });
  return { status: r.status, stdout: stripAnsi(r.stdout), stderr: stripAnsi(r.stderr), out: stripAnsi(`${r.stdout}\n${r.stderr}`) };
}


/** Files of the sample workspace: one app that imports one library, both built with rkp. */
export function sampleFiles({ greeting = "hello" } = {}) {
  return {
    "tsconfig.base.json": { compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", target: "es2022" } },
    "libs/greeter/package.json": { name: "@ws/greeter", version: "1.0.0", type: "module", main: "./dist/index.js" },
    "libs/greeter/tsconfig.json": { extends: "../../tsconfig.base.json", include: ["src"] },
    "libs/greeter/src/index.ts": `export const greet = (n: string): string => \`${greeting} \${n}\`;\n`,
    "apps/web/package.json": { name: "@ws/web", version: "1.0.0", private: true, type: "module", dependencies: { "@ws/greeter": "workspace:*" } },
    "apps/web/tsconfig.json": { extends: "../../tsconfig.base.json", include: ["src"] },
    "apps/web/src/main.ts": 'import { greet } from "@ws/greeter";\nconsole.log(greet("nx"));\n',
  };
}

/** The line of an nx run's output for a task such as "web:build" ("> nx run web:build [local cache]"), or undefined. */
const stripAnsi = (text) => text.replace(/\u001b\[[0-9;]*m/g, "");
const taskLine = (out, task) => stripAnsi(out).split("\n").map((l) => l.trim()).find((l) => l === `> nx run ${task}` || l.startsWith(`> nx run ${task} `));
/** Whether the task was read from the cache. */
export const wasCached = (out, task) => /\[local cache\]/.test(taskLine(out, task) ?? "");
/** Whether the task ran and was not read from the cache. */
export const wasRun = (out, task) => taskLine(out, task) !== undefined && !wasCached(out, task);

/** A workspace of 3 apps and 2 libraries: a uses l1; b uses l1 and l2; c uses nothing. Each has a rathkit.config.mjs. */
export function fiveProjectFiles() {
  const cfg = "export default {};\n";
  const app = (name, deps) => ({
    [`apps/${name}/package.json`]: { name: `@ws/${name}`, version: "1.0.0", private: true, type: "module", dependencies: Object.fromEntries(deps.map((d) => [`@ws/${d}`, "workspace:*"])) },
    [`apps/${name}/rathkit.config.mjs`]: cfg,
    [`apps/${name}/tsconfig.json`]: { extends: "../../tsconfig.base.json", include: ["src"] },
    [`apps/${name}/src/main.ts`]: `${deps.map((d, i) => `import { ${d} } from "@ws/${d}";\n`).join("")}console.log("${name}", ${deps.map((d) => `${d}()`).join(", ") || "0"});\n`,
  });
  const lib = (name) => ({
    [`libs/${name}/package.json`]: {
      name: `@ws/${name}`,
      version: "1.0.0",
      type: "module",
      files: ["dist"],
      main: "./dist/index.cjs",
      types: "./dist/index.d.ts",
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.mjs", require: "./dist/index.cjs" } },
    },
    [`libs/${name}/rathkit.config.mjs`]: cfg,
    [`libs/${name}/tsconfig.json`]: { extends: "../../tsconfig.base.json", include: ["src"] },
    [`libs/${name}/src/index.ts`]: `export const ${name} = (): string => "${name}-v1";\n`,
  });
  return {
    "tsconfig.base.json": { compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", target: "es2022" } },
    ...app("a", ["l1"]),
    ...app("b", ["l1", "l2"]),
    ...app("c", []),
    ...lib("l1"),
    ...lib("l2"),
  };
}

import { spawn } from "node:child_process";
import { createServer } from "node:net";

/** A free TCP port. */
export function freePort() {
  return new Promise((ok, fail) => {
    const server = createServer();
    server.on("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => ok(port));
    });
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls `check` (sync or async, truthy when done) until it passes or `timeout` ms go by. */
export async function waitFor(check, { timeout = 30000, interval = 100, what = "the condition" } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    let value;
    try {
      value = await check();
    } catch {
      value = false;
    }
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(interval);
  }
}

/** Starts `nx ...` in the background in its own process group; stop() ends the whole group. */
export function nxBackground(root, args, env = {}) {
  const child = spawn("pnpm", ["exec", "nx", ...args], { cwd: root, env: { ...testEnv, NX_CACHE_DIRECTORY: join(root, ".nx/cache"), ...env }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const exited = new Promise((r) => child.on("close", r));
  return {
    child,
    output: () => stripAnsi(output),
    exited,
    async stop() {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
      await Promise.race([exited, sleep(10000)]);
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    },
  };
}
