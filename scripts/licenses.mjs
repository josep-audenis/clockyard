// The license check and the notices file (ADR 0042 item 3), from the package managers' own data.
//
//   node scripts/licenses.mjs           writes apps/web/public/third-party-licenses.txt
//   node scripts/licenses.mjs --check   fails if a license is off its list, or the file is not what it would write
//
// Shipped: the crates the WASM module is built from (sim-wasm's normal dependencies for wasm32) and the web
// app's production npm packages. Dev-only: every workspace's dev npm packages. Both lists take in more than
// reaches the output (proc-macro crates, type-only packages); they are held to the shipped list, the safe side.
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = (path) => new URL(`../${path}`, import.meta.url);
const OUT = "apps/web/public/third-party-licenses.txt";
const SHIPPED = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Unicode-3.0", "Unlicense", "Zlib", "OFL-1.1"];
const DEV = [...SHIPPED, "CC-BY-4.0", "MPL-2.0", "BlueOak-1.0.0"];
// The files that carry a package's license and notices, in its own directory.
const LICENSE_FILE = /^(LICEN[CS]E|COPYING|OFL|NOTICE)/i;

/**
 * Whether an SPDX expression passes with `allowed`: IDs joined by AND and OR, parentheses honoured, AND binding
 * tighter than OR. An OR passes if one side does, an AND if every side does. Anything else (WITH, the old
 * `MIT/Apache-2.0` form, `SEE LICENSE IN`, a missing license) throws, naming the expression.
 */
export function passes(expression, allowed) {
  const unknown = () => new Error(`"${expression ?? ""}" is not an SPDX expression this check reads`);
  const tokens = (expression ?? "").match(/\(|\)|[^\s()]+/g) ?? [];
  let at = 0;
  const id = /^[A-Za-z0-9.+-]+$/;
  const factor = () => {
    const token = tokens[at++];
    if (token === "(") {
      const value = or();
      if (tokens[at++] !== ")") throw unknown();
      return value;
    }
    if (token === undefined || token === "AND" || token === "OR" || token === "WITH" || !id.test(token)) throw unknown();
    return allowed.includes(token);
  };
  const and = () => {
    let value = factor();
    while (tokens[at] === "AND") {
      at++;
      value = factor() && value;
    }
    return value;
  };
  const or = () => {
    let value = and();
    while (tokens[at] === "OR") {
      at++;
      value = and() || value;
    }
    return value;
  };
  const value = or();
  if (at !== tokens.length) throw unknown();
  return value;
}

// The reader's own check, run every time: cheap, and a wrong reader would pass anything.
const selfCheck = () => {
  const ok = (e, want) => {
    if (passes(e, SHIPPED) !== want) throw new Error(`license reader: ${e} should ${want ? "" : "not "}pass`);
  };
  ok("MIT", true);
  ok("(MIT OR Apache-2.0) AND Unicode-3.0", true);
  ok("Unlicense OR MIT", true);
  ok("MIT AND GPL-3.0", false);
  ok("GPL-3.0 OR MPL-2.0", false);
  ok("GPL-3.0 OR MIT AND ISC", true);
  ok("(GPL-3.0 OR MIT) AND MPL-2.0", false);
  for (const bad of ["MIT/Apache-2.0", "Apache-2.0 WITH LLVM-exception", "SEE LICENSE IN LICENSE.txt", "", undefined, "(MIT", "MIT OR"]) {
    let threw = false;
    try {
      passes(bad, SHIPPED);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error(`license reader: "${bad}" should be refused`);
  }
};

const run = (command) => execSync(command, { cwd: root(""), encoding: "utf8", maxBuffer: 64 << 20 });

/** The crates sim-wasm is built from for wasm32, without the project's own (their license is the repository's). */
function crates() {
  const meta = JSON.parse(
    run("cargo metadata --format-version 1 --filter-platform wasm32-unknown-unknown --manifest-path crates/sim-wasm/Cargo.toml"),
  );
  const packages = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const queue = [meta.packages.find((p) => p.name === "sim-wasm").id];
  while (queue.length > 0) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id).deps) {
      if (dep.dep_kinds.some((k) => k.kind === null)) queue.push(dep.pkg);
    }
  }
  return [...seen]
    .map((id) => packages.get(id))
    .filter((p) => p.source !== null)
    .map((p) => ({ name: p.name, version: p.version, license: p.license, dir: dirname(p.manifest_path) }));
}

/** npm packages from `pnpm licenses list`, `--prod` or `--dev`, over every workspace. */
function npm(flag) {
  const groups = JSON.parse(run(`pnpm -r licenses list ${flag} --json`));
  return Object.values(groups).flatMap((list) =>
    list.flatMap((p) => p.paths.map((dir, i) => ({ name: p.name, version: p.versions[i] ?? p.versions[0], license: p.license, dir }))),
  );
}

/** A package's license texts: its own files, or for a package that ships none, the text kept in scripts/license-texts. */
function texts(p) {
  const files = readdirSync(p.dir)
    .filter((f) => LICENSE_FILE.test(f))
    .sort();
  if (files.length > 0) return files.map((f) => [f, readFileSync(join(p.dir, f), "utf8")]);
  const kept = `scripts/license-texts/${p.name.replace("/", "+")}.txt`;
  if (existsSync(root(kept))) return [[`${kept} (the package ships no license file)`, readFileSync(root(kept), "utf8")]];
  return [];
}

selfCheck();
const check = process.argv.includes("--check");
const problems = [];
const held = (list, allowed, side) => {
  for (const p of list) {
    try {
      if (!passes(p.license, allowed)) problems.push(`${p.name} ${p.version}: ${p.license} is not on the ${side} list`);
    } catch (error) {
      problems.push(`${p.name} ${p.version}: ${error.message}`);
    }
  }
};
const key = (p) => `${p.name}@${p.version}`;
const unique = (list) => [...new Map(list.map((p) => [key(p), p])).values()];
// Code-unit order, not localeCompare, so the file is the same on every platform.
const shipped = unique([...crates(), ...npm("--prod")]).sort((a, b) => (key(a) < key(b) ? -1 : 1));
held(shipped, SHIPPED, "shipped");
held(unique(npm("--dev")), DEV, "dev-only");

const sections = shipped.map((p) => {
  const found = texts(p);
  if (found.length === 0) problems.push(`${p.name} ${p.version}: no license file in ${p.dir}`);
  const body = found.map(([file, text]) => `--- ${file}\n\n${text.replaceAll("\r\n", "\n").trimEnd()}\n`).join("\n");
  return `${"=".repeat(78)}\n${p.name} ${p.version}\nLicense: ${p.license}\n\n${body}`;
});
const text = [
  "Third-party licenses",
  "",
  "Clockyard is MIT OR Apache-2.0. It ships the packages below, each under its own",
  "license; the IBM Plex fonts stay under the SIL Open Font License 1.1.",
  "Written by scripts/licenses.mjs; do not edit by hand.",
  "",
  ...sections,
].join("\n");

if (problems.length > 0) {
  console.error(`License check failed (ADR 0042 item 3); a new license is a decision for an ADR:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
if (check) {
  let current = "";
  try {
    current = readFileSync(root(OUT), "utf8").replaceAll("\r\n", "\n");
  } catch {
    // Missing counts as stale.
  }
  if (current !== text) {
    console.error(`${OUT} is not what scripts/licenses.mjs writes; run it and commit the result.`);
    process.exit(1);
  }
} else {
  writeFileSync(root(OUT), text);
  console.log(`${OUT}: ${shipped.length} packages`);
}
