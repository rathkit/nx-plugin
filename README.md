# @rathkit/nx

An [Nx](https://nx.dev) plugin for [Rathkit Pack](https://github.com/rathkit/pack) (`rkp`), a JavaScript and TypeScript bundler written in Rust with zero dependencies.

**Status: beta.** Targets and options can change between 0.x releases. Not published yet.

## Peer dependencies

`nx` and `@nx/devkit` are **peer dependencies**, because that is what an Nx plugin is: it runs inside the Nx of your workspace and uses its API,
so it must not bring a copy of its own. So is `@rathkit/pack`, the package that gives the `rkp` program. `@rathkit/nx` itself has no
dependencies (`pnpm check:zero-deps` enforces it).

| Peer | Versions | Why |
| --- | --- | --- |
| `nx` | 23 and 24 (the current and the previous major) | the plugin API, the task runner |
| `@nx/devkit` | the same as `nx` | the generators |
| `@rathkit/pack` | any (0.x is beta) | the `rkp` program the executors run |

## Install

```
nx add @rathkit/nx
```

or by hand: `pnpm add -D @rathkit/nx @rathkit/pack@next` and add `"@rathkit/nx"` to `plugins` in `nx.json`.

## What it does

- **Inferred tasks** (`createNodes`): a project with a `rathkit.config.{mjs,js,cjs}` next to its `package.json` or `project.json` gets `build`, `serve` and
  `watch`, with inputs, outputs, caching and `dependsOn: ["^build"]` set. See [docs/spike-9.1.md](docs/spike-9.1.md) for how the inputs are chosen.
- **Executors** `@rathkit/nx:build` and `@rathkit/nx:serve` for targets written by hand in `project.json`.
- **Libraries**: library mode, declarations and `exports`.

## Targets written by hand

Without the plugin (or to override it), use the executors in a `project.json`. Options are in `src/executors/*/schema.json`; `args` passes any other
`rkp` flag as written. `nx.json` can set the shared parts once:

```json
{
  "targetDefaults": {
    "@rathkit/nx:build": {
      "cache": true,
      "dependsOn": ["^build"],
      "inputs": ["default", "^default", "!{projectRoot}/dist/**/*", { "externalDependencies": ["@rathkit/pack"] }],
      "outputs": ["{options.outputPath}"]
    }
  }
}
```

```json
{
  "name": "web",
  "targets": {
    "build": { "executor": "@rathkit/nx:build", "options": { "outputPath": "{projectRoot}/dist", "minify": true } },
    "serve": { "executor": "@rathkit/nx:serve", "options": { "port": 4200 } }
  }
}
```

The program is found from the `rkpBin` option, then the `RATHKIT_PACK_BIN` variable, then the installed `@rathkit/pack`, then `rkp` on `PATH`.
`outputPath` is deleted before a build (`"clean": false` keeps it).

## Develop

Node and pnpm versions are in `package.json` (`engines`, `packageManager`) and `.node-version`. Use pnpm, never npm or yarn.

```
pnpm install
pnpm check       # zero-deps check and the tests
```

The tests build real Nx workspaces in `node_modules/.cache/rathkit-nx-test` (override with `RATHKIT_NX_TEST_DIR`), install `nx` and `@nx/devkit`
from the network, and need an `rkp` program: set `RATHKIT_PACK_BIN`, or build `rathkit/pack` next to this repository
(`cargo build --release`). `RATHKIT_NX_VERSION` picks the Nx version (default 24.0.6); `RATHKIT_PACK_SPEC` picks how `@rathkit/pack` is
installed into the workspaces (default: the `npm/pack` folder of the checkout).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first: it covers the issue-first rule, signed commits with a sign-off ([DCO](DCO)), the
[AI policy](AI_POLICY.md), the [code of conduct](CODE_OF_CONDUCT.md), [governance](GOVERNANCE.md) and [members](MEMBERS.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
