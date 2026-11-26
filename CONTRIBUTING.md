# Contributing to Clockyard

Thanks for your interest. Clockyard is a browser-based digital logic and
computer-building sandbox: a Rust engine compiled to WebAssembly, run in a Web
Worker, behind a React and PixiJS editor. Everything runs in the browser, with
no backend. The [roadmap](docs/roadmap.md) says where it stands and what comes
next; the [project brief](docs/brief.md) says why it is built the way it is.

By taking part you agree to the [code of conduct](CODE_OF_CONDUCT.md). Report
security problems privately, as [SECURITY.md](SECURITY.md) says, not in an
issue.

## Principles

- **Correctness first.** A simulator that is subtly wrong is worse than one
  that clearly reports unsupported behavior.
- **One engine.** All simulation semantics live in `crates/sim-core` (Rust).
  Never add a second evaluator in TypeScript.
- **Document ≠ netlist.** The editable design and the compiled simulation graph
  are separate models. Connectivity is never inferred from geometry.
- **Deterministic and bounded.** Results never depend on frame rate, timers or
  evaluation order, and a loop that does not settle is reported, never hangs.
- **No hidden CPU.** A CPU built in Clockyard runs through its simulated parts.
- **Small, working increments.** Every change keeps the app building and
  running. No placeholder UI that looks functional but does nothing.
- **No speculative abstraction.** Add complexity when a concrete requirement
  needs it.

## Setup

You need Git, and:

1. **Rust**, stable, from [rustup](https://rustup.rs), with the WebAssembly
   target:

   ```bash
   rustup target add wasm32-unknown-unknown
   ```

   Cargo also needs a C linker. On Windows that is the Visual Studio C++ Build
   Tools: rustup offers to install them, so accept. On Ubuntu:

   ```bash
   sudo apt install build-essential
   ```

2. **The `wasm-bindgen` CLI** at exactly the version `crates/sim-wasm/Cargo.toml`
   pins (`wasm-bindgen = "=0.2.130"` today; `pnpm wasm` says so if they differ):

   ```bash
   cargo install wasm-bindgen-cli --version 0.2.130 --locked
   ```

3. **Node.js** 22.18 or later on 22, or 24.2 or later, the range `package.json`
   gives in `engines`. The generators need `import.meta.main`, and refuse to run
   without it. Install the LTS from [nodejs.org](https://nodejs.org), or use a
   version manager such as fnm or nvm; distribution packages, such as Ubuntu's
   `nodejs`, are older than 22.18.

4. **pnpm** 10, the version `package.json` names in `packageManager`:

   ```bash
   npm install -g pnpm@10.28.1
   ```

   On Node 22 or 24, `corepack enable` works too; Node 25 and later no longer
   include Corepack. Either may need an administrator shell on Windows, or
   `sudo` on Linux with a system-wide Node.

5. **The dependencies**, from the repository's root. This also points Git at
   the repository's hooks (`.githooks/`):

   ```bash
   pnpm install
   ```

6. **Chromium for Playwright**, once, for the browser tests:

   ```bash
   pnpm --filter web exec playwright install chromium
   ```

   On Linux, Chromium needs system libraries too; this installs them, with
   `sudo`:

   ```bash
   pnpm --filter web exec playwright install --with-deps chromium
   ```

## Build and run

```bash
pnpm dev
```

builds the WASM engine (`pnpm wasm`) and starts Vite. Open
http://localhost:5173 for the editor, and http://localhost:5173/about/ for the
about page. After changing Rust code, run `pnpm wasm` again; the page reloads.
`pnpm build` writes a static site to `apps/web/dist`.

## Checks

```bash
pnpm verify
```

runs every check, in this order, and stops at the first that fails. The
pre-push hook runs it before every push
([ADR 0009](docs/decisions/0009-local-checks-instead-of-ci.md)); there is no
hosted CI. It takes several minutes, most of it the browser tests.

| Check | On its own |
|-------|------------|
| Rust formatting | `cargo fmt --all --check` |
| Clippy, warnings as errors (and undocumented `sim-core` items) | `cargo clippy --workspace --all-targets -- -D warnings` |
| Generated files up to date | `node scripts/reference-cpu.mjs --check`, `node scripts/reference-cpu-2.mjs --check`, `node scripts/challenges.mjs --check`, `node scripts/benchmarks.mjs --check` |
| Licenses, and the notices file up to date | `node scripts/licenses.mjs --check` |
| Rust tests | `cargo test --workspace` |
| `sim-core`'s docs build, warnings as errors | `cargo rustdoc -p sim-core -- -D warnings` |
| WASM build | `pnpm wasm` |
| ESLint | `pnpm lint` |
| TypeScript | `pnpm typecheck` |
| Unit tests (Vitest) | `pnpm --filter web test` |
| Production build | `pnpm --filter web build` |
| Browser tests (Playwright) | `pnpm --filter web e2e` |

`pnpm test` runs the Rust and web unit tests together, and `pnpm test:e2e`
builds the WASM module and runs the browser tests. The web checks import the
WASM module, so run `pnpm wasm` before them.

## Generated files

Some files are written by scripts and checked by `pnpm verify`. Never edit them
by hand: change the script, run it, and commit both.

| Script | Writes |
|--------|--------|
| `node scripts/reference-cpu.mjs` | `examples/reference-cpu.clockyard.json`, `examples/catch.clockyard.json` |
| `node scripts/reference-cpu-2.mjs` | `examples/reference-cpu-2.clockyard.json`, `examples/catch-2.clockyard.json` |
| `node scripts/challenges.mjs` | `challenges/`, but not its README: the challenges, their benches, solutions and starters |
| `node scripts/benchmarks.mjs` | `benchmarks/*-1k.clockyard.json` (`--all` writes every size to the ignored `benchmarks/generated/`) |
| `node scripts/licenses.mjs` | `apps/web/public/third-party-licenses.txt` |

## Making a change

1. For anything large, open an issue first, or comment on an existing one.
2. Branch from `main`.
3. A design choice, or a change to one, gets an ADR in
   [docs/decisions](docs/decisions/): copy the shape of a recent one, and add
   it to that directory's README.
4. Add tests with the change: engine tests in `crates/sim-core`, unit tests
   next to the web code, and a Playwright test for what a user does in the
   browser.
5. Keep the docs saying what the code does, and update the
   [roadmap](docs/roadmap.md)'s status when an increment moves.
6. Run `pnpm verify`, then open a pull request; its template asks for the rest.

What is out of scope is listed in the roadmap's
[Out of scope](docs/roadmap.md#out-of-scope-for-now) section: no backend,
accounts or network calls with user data, among others.

## Code style

- Rust: `rustfmt` defaults, Clippy clean, no `unsafe` without an ADR, no panics
  on user-supplied input. Every public item in `sim-core` is documented by what
  it means in the simulation.
- TypeScript: `strict` mode, no `any` without a comment explaining why, ESLint
  clean.
- Names say what things are. Comments explain why, not what.

## Tests

- Engine: unit tests for every gate truth table, propagation, fan-out, order
  independence, oscillation handling, clocking, elaboration. Where an
  invariant exists, tests over many random cases, such as programs run
  against a model of the CPU.
- Frontend: document editing, serialization, import validation, worker
  protocol.
- End-to-end: Playwright for core browser workflows.
- Example circuits in `examples/` double as fixtures.
- Performance claims need a reproducible benchmark (`pnpm bench`).

## Commits

Use clear, imperative subjects (`Add NAND gate truth table tests`). One logical
change per commit.

## Licensing

Clockyard is dual-licensed under MIT OR Apache-2.0. Unless you explicitly state
otherwise, any contribution intentionally submitted for inclusion in the work
by you, as defined in the Apache-2.0 license, shall be dual licensed as above,
without any additional terms or conditions.

New dependencies and bundled assets must use licenses compatible with both.
`node scripts/licenses.mjs --check` holds every shipped package to an allowlist
and every dev-only one to a wider one
([ADR 0042](docs/decisions/0042-a-project-others-can-join.md)); a license on
neither is a decision for an ADR, not an addition to the list.
