// Runs the test suite once for each Nx version: node tools/matrix.mjs [version ...]
// Default: the versions in matrix.json (CI runs the same list). Needs RATHKIT_PACK_BIN, like the tests.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const listed = JSON.parse(readFileSync(new URL("../matrix.json", import.meta.url), "utf8")).nx;
const versions = process.argv.length > 2 ? process.argv.slice(2) : listed;
const results = [];
for (const version of versions) {
  console.log(`\n== nx ${version}`);
  const r = spawnSync("pnpm", ["test"], { stdio: "inherit", env: { ...process.env, RATHKIT_NX_VERSION: version } });
  results.push([version, r.status === 0]);
}
console.log("\n" + results.map(([v, ok]) => `nx ${v}: ${ok ? "pass" : "FAIL"}`).join("\n"));
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
