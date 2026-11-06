// Builds sim-wasm and generates JS bindings into apps/web/src/generated/sim-wasm/.
// See docs/decisions/0003-wasm-toolchain.md.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit" });

const manifest = readFileSync(new URL("../crates/sim-wasm/Cargo.toml", import.meta.url), "utf8");
const expected = manifest.match(/^wasm-bindgen = "=([^"]+)"/m)?.[1];
if (!expected) throw new Error("crates/sim-wasm/Cargo.toml must pin wasm-bindgen with =x.y.z");

let installed;
try {
  installed = execFileSync("wasm-bindgen", ["--version"], { encoding: "utf8" }).trim().split(" ")[1];
} catch {
  installed = undefined;
}
if (installed !== expected) {
  console.error(
    `wasm-bindgen CLI ${expected} required, found ${installed ?? "none"}.\n` +
      `Install it with: cargo install wasm-bindgen-cli --version ${expected} --locked`,
  );
  process.exit(1);
}

run("cargo", ["build", "-p", "sim-wasm", "--target", "wasm32-unknown-unknown", "--release"]);
run("wasm-bindgen", [
  "--target",
  "web",
  "--out-dir",
  "apps/web/src/generated/sim-wasm",
  "target/wasm32-unknown-unknown/release/sim_wasm.wasm",
]);
