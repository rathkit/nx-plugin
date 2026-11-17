# Spike 9.1: an Nx workspace builds an app and a library with rkp

Roadmap item 9.1 (pack issue 29). Question: can Nx build and cache an app and a library with rkp through an executor, and what does Nx need
from rkp to do it correctly? Short answer: yes, with no change to rkp. A few things would make it safer (see the end).

Checked with rkp 0.3.0-beta.0 (built from pack main), Nx 24.0.6 and 23.3.2 (current and previous major), Node 26, pnpm 12.
The test is `tests/spike.test.mjs`: it builds a workspace in a scratch folder, installs the plugin from a packed tarball and runs `nx`.

## What was built

A workspace of two projects with hand-written `project.json` targets (the executor is the one the plugin ships, `@rathkit/nx:build`):

- `libs/greeter`: a package whose `main` is `./dist/index.js`; the target builds `src/index.ts`.
- `apps/web`: depends on `@ws/greeter` through pnpm's `workspace:*`; the target builds `src/main.ts` and has `dependsOn: ["^build"]`.

`nx run web:build` builds the library first, then the app; rkp resolves `@ws/greeter` through `node_modules` to the library's `dist/index.js`
and bundles it. The project graph needs no plugin for this: Nx reads the dependency from `package.json`.

Results, all asserted by the test:

- The library builds before the app; the app output contains the library's code and no import of it.
- A second `nx run web:build --skip-nx-cache` writes byte-identical files (a hash over the output folder is equal).
- Without `--skip-nx-cache` the second run is read from the cache for both tasks.
- Changing a library source rebuilds the library and the app; changing an unrelated file (a README at the root) rebuilds nothing.
- Every module in rkp's `--metafile` for the app is inside the app or the library project.

## What Nx needs from rkp

### Inputs

Nx hashes a task's inputs before running it, so they must be declared before rkp runs. The inputs of an rkp build are:

| What rkp reads | Where it is found | How the plugin declares it |
| --- | --- | --- |
| the project's sources, `index.html`, `public/`, `package.json`, `rathkit.config.*` | the project folder | `default` |
| the sources of the projects it imports | other projects | `^default` (the project graph, from `package.json` dependencies) |
| tsconfig files, through `extends` (`paths`, `jsx`, decorators) | the project, and the workspace root (`tsconfig.base.json`) | `default` and `{workspaceRoot}/tsconfig.base.json`, `{workspaceRoot}/tsconfig.json` |
| browserslist (`.browserslistrc`, `browserslist`), looked for from the entry's folder up | project or workspace root | `{workspaceRoot}/.browserslistrc`, `{workspaceRoot}/browserslist`; the project's own is in `default` |
| `.env`, `.env.local`, `.env.[mode]`, `.env.[mode].local` | the project folder (or `--env-dir`) | `{ fileset: "{projectRoot}/.env*", includeIgnored: true }`: these files are usually ignored by git, so without `includeIgnored` Nx does not see them |
| variables: `NODE_ENV`, `BROWSERSLIST`, `BROWSERSLIST_ENV`, and any `VITE_*` or other the code reads | the environment | `{ env: NAME }` for the first three; the plugin option `env` lists the others (Nx has no pattern for names) |
| rkp itself | `@rathkit/pack` | `{ externalDependencies: ["@rathkit/pack"] }`, only when the package resolves from the workspace |
| packages in `node_modules` | the lockfile | the project graph's external nodes (npm dependencies of the project) |

The output folder is excluded (`!{projectRoot}/dist/**/*`), so a build never feeds its own hash even when `dist` is not ignored by git.

Gaps that rkp cannot fill today: `--metafile` lists modules only. It does not list `index.html`, tsconfig files, the config, `.env` files, browserslist files or
`public/`. The plugin's rule above is therefore a rule and not a measurement. `nx-needs-from-pack.md` (draft issues, not filed) asks for a
list of every file read, including probes of files that do not exist.

### Outputs

The plugin declares one output, `{options.outputPath}` (default `{projectRoot}/dist`), and the executor deletes the folder before a build
(`clean`, on by default), so a cache restore and a fresh build leave the same files and a deleted source does not leave its output behind.
rkp writes everything under `--outdir` or `--outfile`: scripts, chunks, `.map`, `.css`, copied assets, the page, `public/`. Things that can
leave the folder are opt-in options (`--dts-dir`, `--legal-comments=external`, `--metafile`) and are not set by the plugin; `metafile` is an
option that must point outside the output folder when the output is cached (its paths differ between checkouts).

`--outdir` without `--splitting` writes `bundle.js` whatever `--entry-names` says, so a single script entry is built with `--outfile
OUT/NAME.js`; a page, several entries or splitting use `--outdir`.

### Determinism

Cache hits are only correct if the same inputs give the same bytes. Measured: building the same app twice in one folder, and in two copies of
the workspace at different paths, with `--minify --sourcemap`, gives byte-identical scripts and source maps (the maps hold relative paths).
The metafile is not identical across folders: files outside the working folder are written as absolute paths. Everything the plugin caches
is deterministic; the metafile is never cached.

The binary's version is part of the inputs through `@rathkit/pack` (installed from the lockfile). A binary chosen with `RATHKIT_PACK_BIN` or the `rkpBin` option
is not in the hash; those are for development and for the plugin's own tests.

### Exit codes and logs

A build error exits with 1 and writes nothing (no `d3` folder in the probe); the executor returns `{ success: false }` and Nx does not cache
the task. The executor passes rkp's output through, so Nx stores it with the task and replays it on a cache hit.

## Design of the inferred tasks

Nx finds projects with `createNodes` (named `createNodesV2` in Nx 22 and older; Nx 23 and 24 read `createNodes` and fall back to `createNodesV2`, never
both, so the plugin exports the same value under both names).

- **Trigger:** a `rathkit.config.{mjs,js,cjs}` file. rkp needs no config, but a project that wants Nx to build it with rkp must say so somewhere; the
  config file is rkp's own marker, it is what rkp reads, and the init generator can create an empty one. A project is only claimed when the
  folder also has a `package.json` or `project.json`, and an entry rkp can build is found. Projects of any other kind are left alone.
- **Entry:** `index.html`, else `src/main.*`, else `src/index.*`, else `main.*`, `index.*` (extensions ts tsx mts js jsx mjs).
- **`build`:** executor `@rathkit/nx:build`; `cache: true`; `dependsOn: ["^build"]`; the inputs above; `outputs: ["{options.outputPath}"]`;
  `options.outputPath: "{projectRoot}/dist"`.
- **`serve`:** executor `@rathkit/nx:serve`; `continuous: true`; `cache: false`; `dependsOn: ["^build"]`; on Nx 24 and later `readyWhen` is
  the server's port (`{options.port ?? 5173}`). Nx 23 has `continuous` but no `readyWhen`.
- **`watch`:** the build executor with `watch: true`; `continuous: true`; `cache: false`; `dependsOn: ["^build"]`.
- **Names and folders** are plugin options (`buildTargetName`, `serveTargetName`, `watchTargetName`, `outDir`, `env`), so they fit a workspace's own
  conventions and so two plugins can coexist.
- **Why executors and not `nx:run-commands`:** the executor finds the rkp program (the package, then `RATHKIT_PACK_BIN`), maps typed options to
  flags, cleans the output, forwards signals to `serve` and `watch`, and works the same in a hand-written `project.json`.

Inferred targets are merged with `project.json` and `targetDefaults` by Nx as usual, so a project overrides any of them.

## Things Nx 23 and 24 do that the design depends on

- `createNodes` returns, per config file, a project with `targets`; Nx merges them (verified in `tests/`).
- An `externalDependencies` entry that is not a package of the workspace is an error (`The externalDependency 'x' for 'web:build' could not be found`), so
  the plugin adds it only when `@rathkit/pack` resolves.
- `{fileset, includeIgnored: true}` exists in both 23 and 24; `readyWhen` only in 24.
- Nx 24 keeps its cache in `~/.nx/<workspace id>` unless `NX_CACHE_DIRECTORY` says otherwise; the tests set it to the workspace.

## Needs from rkp

None blocks the plugin. Drafts for rathkit/pack (not filed) are in `~/code/rathkit/night-drafts/nx-needs-from-pack.md`: a list of every file read,
one meaning for metafile paths, a list of every file written, `--write-exports` and the input it rewrites, `--entry-names` with `--outdir`, a readiness
signal for `serve` and `--watch`, and a bug found on the way (a stylesheet both linked and imported).
