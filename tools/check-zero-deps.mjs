// Fails if the package could pull code in at install time or runtime.
// Rules: no dependencies, optionalDependencies or bundled deps; no install scripts; peer dependencies are
// exactly nx, @nx/devkit and @rathkit/pack (an Nx plugin is a plugin for nx, and it runs rkp), none optional.
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const problems = [];
for (const field of ["dependencies", "optionalDependencies", "bundledDependencies", "bundleDependencies"]) {
  if (pkg[field] && Object.keys(pkg[field]).length > 0) problems.push(`"${field}" must be empty`);
}
for (const script of ["preinstall", "install", "postinstall", "prepare"]) {
  if (pkg.scripts?.[script]) problems.push(`install-time script "${script}" is not allowed`);
}
const peers = Object.keys(pkg.peerDependencies ?? {}).sort();
const expected = ["@nx/devkit", "@rathkit/pack", "nx"];
if (peers.join() !== expected.join()) problems.push(`peerDependencies must be ${expected.join(", ")}; found ${peers.join(", ")}`);
for (const name of peers) if (pkg.peerDependenciesMeta?.[name]?.optional) problems.push(`peer "${name}" must not be optional`);

if (problems.length > 0) {
  console.error(problems.map((p) => `package.json: ${p}`).join("\n"));
  process.exit(1);
}
console.log("zero-deps: ok");
