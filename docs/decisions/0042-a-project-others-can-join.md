# 0042. A project others can join: contributor docs, community files, a license check, and a documented core

- Status: Accepted
- Date: 2026-11-25
- Depends on: ADR 0037 (the Phase 7 plan, increment 5); ADR 0009 (local
  checks instead of hosted CI); brief §13

## Context

ADR 0037 item 2.5 makes Phase 7's last increment the repository's own
readiness for others: contributor docs that match the project, the usual
community files, a license check, `sim-core` documented as a library, and
generators that cannot pass unrun. Its target: a fresh clone set up from
`CONTRIBUTING.md` alone runs `pnpm verify` to the end, on Windows and on one
Linux machine, and the license check passes. This ADR chooses how.

What there is today:

- **`CONTRIBUTING.md`** says the project is at Phase 0 with the editor next.
  Its checks list `pnpm test`, a script `pnpm verify` does not use, and
  leave out half of what `pnpm verify` runs: the generators' checks, the
  build and the browser tests' place in it. It says nothing of the WASM
  build's toolchain (the `wasm32-unknown-unknown` target and a pinned
  `wasm-bindgen-cli`, which `scripts/build-wasm.mjs` asks for). The README's table
  says "IndexedDB later", which ADR 0029 built.
- **No** code of conduct, security policy, or issue and pull request
  templates. There is no `.github/` directory.
- **Licenses.** The project is MIT OR Apache-2.0. What the build ships:
  - Rust, through `sim-wasm` for `wasm32-unknown-unknown` (`cargo metadata
    --filter-platform`): 21 crates, all MIT OR Apache-2.0, MIT, Unlicense OR
    MIT, or (MIT OR Apache-2.0) AND Unicode-3.0.
  - npm, `pnpm licenses list --prod`: 21 packages under MIT, BSD-3-Clause,
    ISC, and OFL-1.1 for the three IBM Plex font packages, whose files the
    build bundles.
  - The about page's shots and recordings and the logo are the project's
    own.
  - Dev-only npm packages add Apache-2.0, BSD-2-Clause, CC-BY-4.0
    (`caniuse-lite`, data), MPL-2.0 (`lightningcss`) and BlueOak-1.0.0
    (`minimatch`). None of them reach the build's output.
  - Nothing checks any of this, and the fonts' OFL text does not travel
    with the build.
- **`sim-core`** has 96 public items without documentation
  (`-W missing_docs`). `cargo doc` is not run, and with warnings as errors
  it fails today: a public doc links to a private item
  (`crates/sim-core/src/description.rs`, `ComponentDesc::widths`).
- **Generators.** `scripts/reference-cpu.mjs` and `reference-cpu-2.mjs`
  write their files only `if (import.meta.main)`, which Node has from 22.18
  and 24.2. `package.json` asks for Node 22.13 or later. On 22.13 to 22.17,
  or 23.x, `--check` prints nothing and passes.
- **Platforms.** The owner works on Windows. WSL with Ubuntu, and Docker,
  are installed there, so a Linux run needs no other machine.
- **ADR 0009 stands.** Checks run in the pre-push hook. ADR 0037 item 4
  keeps hosted CI out of this phase.

## Decision

1. **Generators cannot pass unrun.**
   - `package.json`'s `engines.node` becomes `^22.18.0 || >=24.2.0`, the
     versions with `import.meta.main`.
   - Each script that tests `import.meta.main` first throws if it is
     `undefined`: "this script needs Node 22.18 or 24.2 or later". So a
     script run on an older Node fails at once, and `pnpm verify` stops.
     `challenges.mjs` imports both, so it fails the same way.
   - `scripts/challenges.mjs` and `benchmarks.mjs` run on import and
     already check for real; they are unchanged.

2. **`sim-core` documented.**
   - `#![warn(missing_docs)]` in `crates/sim-core/src/lib.rs`. Clippy
     already runs with `-D warnings`, so an undocumented public item fails
     `pnpm verify`.
   - `cargo rustdoc -p sim-core -- -D warnings` joins `pnpm verify` after
     the tests, so broken intra-doc links fail too. It passes its flags
     after `--`, with no environment variable, so the same command runs in
     PowerShell and in a POSIX shell.
   - The 96 items are documented by what they mean in the simulation, from
     `docs/simulation-model.md`, not by restating their names; existing doc
     links that fail, such as the one to a private item, are fixed first.
   - `asm` and `sim-wasm` are not in scope: the brief names the core as the
     part that could become a library.

3. **A license check, from the package managers' own data.**
   - `scripts/licenses.mjs`, with no new dependency, runs in `pnpm verify`
     after the generators' checks. It reads:
     - `cargo metadata --format-version 1 --filter-platform
       wasm32-unknown-unknown`, walking the resolve graph from `sim-wasm`
       through normal dependencies: what the WASM module is built from;
     - `pnpm licenses list --prod --json` for the web app's dependencies,
       and `pnpm licenses list --dev --json` for the tools.
     - Both lists take in more than reaches the output: proc-macro crates
       (`syn`, `serde_derive`, `wasm-bindgen-macro`, …) and type-only
       packages (`@types/react`, `csstype`, …). That is deliberate: they
       are held to the shipped list, the safe side, rather than sorted by
       hand.
     - The project's own crates (`sim-core`, `sim-wasm`, `asm`) are left
       out of both the check and the notices: their license is the
       repository's, `LICENSE-MIT` and `LICENSE-APACHE` at the root.
   - **Allowlists**, by SPDX expression:
     - shipped: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC,
       Unicode-3.0, Unlicense, Zlib, OFL-1.1. An `OR` passes if one side
       does; an `AND` if every side does.
     - dev-only: the shipped list, and CC-BY-4.0, MPL-2.0 and
       BlueOak-1.0.0. They are tools that never reach the output; MPL-2.0
       would need its files' sources offered if it were shipped, which is
       why it is not on the shipped list.
     - **How an expression is read:** SPDX license IDs joined by `AND` and
       `OR`, with parentheses honoured and `AND` binding tighter than `OR`.
       Anything else fails as unknown and is named: `WITH`, the old
       `MIT/Apache-2.0` slash form, `SEE LICENSE IN`, a missing license,
       or pnpm's `Unknown`.
     - A package with no license, or one off its list, fails the check and
       names it. A new license is a decision for an ADR or an amendment,
       not a silent addition.
     - **The fonts stay under the OFL.** They are not relicensed: they ship
       beside the MIT OR Apache-2.0 code, which the OFL allows when their
       copyright notice and license go with them and they are not sold on
       their own. The notices file carries both.
   - **Names, not a snapshot.** The check compares licenses, not package
     lists, since the lists differ by platform (optional native packages).
   - **Notices travel with the build.** The script writes
     `apps/web/public/third-party-licenses.txt`: for each shipped package,
     its name, version, license, and the text of every `LICENSE*`,
     `LICENCE*`, `COPYING*`, `OFL*` and `NOTICE*` file in its own
     directory (an Apache-2.0 `NOTICE` must travel with the work). The
     directory is that of the crate's `manifest_path` for Rust, and the
     package's `paths` entry from pnpm. Vite copies the file into `dist/`;
     the about page's footer links to it. `--check` fails if the file is
     out of date, as the other generators' files do. A shipped package with
     no license file in its directory fails the check.
   - Line endings: license texts are read with each CRLF made LF, and
     `--check` compares the same way, as the other generators do, so a
     checkout with `core.autocrlf` and one without agree.
   - The list of shipped packages is the same on Windows and Linux (the
     prod tree has no optional native packages, and the Rust list is for
     one target), so the file is the same on both. Step 5's Linux run holds
     that.

4. **Community files**, written for this project, short:
   - `CODE_OF_CONDUCT.md`: adopts the Contributor Covenant 2.1 by name and
     link, with how to report.
   - `SECURITY.md`: what counts (the app runs only in the browser; a file
     or link that makes it run script, leak data, or hang the tab past its
     bounds), which version is supported (`main`), and how to report
     privately.
   - `.github/ISSUE_TEMPLATE/`: a bug report (what was done, what was
     expected, what happened, the file or link if there is one, browser and
     OS) and a feature request (the problem first, then the idea); a
     `config.yml` that points design questions to the docs.
   - `.github/pull_request_template.md`: what changed and why, the ADR if
     there is one, the docs kept in step, and that `pnpm verify` passed.
   - **How reports reach the owner: GitHub alone,** chosen by the owner on
     accepting this ADR. No address is made up here. Security reports go
     through GitHub's private vulnerability reporting, which the owner
     switches on in the repository's settings. Conduct reports go through
     GitHub's own tools: private vulnerability reporting for anything that
     must stay private, and GitHub's moderation and report-abuse for the
     rest.

5. **Contributor docs brought up to date.**
   - `CONTRIBUTING.md` rewritten from the project as it is:
     - what Clockyard is, and where it stands (the roadmap);
     - setup: Rust with the `wasm32-unknown-unknown` target,
       `wasm-bindgen-cli` at the version `crates/sim-wasm` pins, Node in
       the `engines` range, pnpm, and Chromium for Playwright, each with
       the command that installs it;
     - build and run: `pnpm wasm`, `pnpm dev`, and opening the app;
     - checks: `pnpm verify`, what it runs in order, and each piece on its
       own, with the names `package.json` really has;
     - generated files: which scripts write which directories, and that
       they are never edited by hand;
     - how a change is made: a branch, an ADR for a design choice, docs in
       step, the roadmap updated, tests with the change;
     - what is out of scope, pointing at the roadmap's list;
     - licensing, as now, with the license check.
   - The README: its table's storage row (IndexedDB with JSON files, ADR
     0029), its Node requirement (22.13+ today; the new range), and
     anything else stale there.

6. **The target.** A fresh clone, set up by following `CONTRIBUTING.md`
   and nothing else, runs `pnpm verify` to the end:
   - on Windows, in a new directory outside the existing checkout;
   - on Linux: Ubuntu under WSL, with its own toolchains installed by the
     same instructions, in the Linux file system.
   Each run is recorded in the roadmap with its date, the versions used, and
   the time it took. Where the instructions fall short, they are fixed and
   the run starts again. There is no Playwright test of this increment's
   own: its target is the check itself, as ADR 0037 says.

7. **Order of work.** Each step is one pull request:
   1. The Node range and the generators' guard.
   2. `sim-core` documented, and `cargo rustdoc` in `pnpm verify`.
   3. The license check and the notices file, with the about page's link.
   4. `CONTRIBUTING.md`, the README, the community files and templates.
   5. The two fresh-clone runs, fixes they call for, and the roadmap: Phase
      7 done.

   *As built (step 1):* as planned; the README's Node line changed with
   the range.

   *As built (step 2):* as planned. The doc build takes a second or two.

   *As built (step 3):* `@pixi/colord`, a fork of `colord` that `pixi.js`
   ships, carries no license file, though its `package.json` says MIT.
   Its upstream text, the MIT license with Vlad Shilov's copyright, is
   kept in `scripts/license-texts/@pixi+colord.txt`, and the notices file
   marks it as kept there. A shipped package with no file of its own and
   none kept there still fails the check; a kept text is added only with
   the package's own source for it. The check reads its expressions with a
   small reader that tests itself each run, and the whole check takes
   about a second. The notices file is some 210 KB, fetched only from the
   about page's link.

## Alternatives considered

- **Hosted CI now,** so a Linux run happens on every push. ADR 0009 chose
  local checks and ADR 0037 item 4 keeps that until outside contributions
  call for it. WSL gives the Linux run today; CI can come with its own ADR.
- **A license tool** (`cargo-deny`, `license-checker`). Each is a new
  dependency, or a binary every contributor must install, for what the
  package managers already report. The check is a short script.
- **A committed list of packages and licenses,** compared whole. It breaks
  on every platform difference and every lockfile update that changes
  nothing that matters. Licenses checked against an allowlist do not.
- **The Contributor Covenant's full text copied in.** Adopting it by name
  and link keeps one canonical text and a short file.
- **`#![deny(missing_docs)]`** in place of `warn`. With Clippy's `-D
  warnings` the effect in `pnpm verify` is the same, and `warn` lets a
  contributor build while they write the docs.
- **Docs for `sim-wasm` and `asm` too.** They are a thin adapter and a tool
  for the editor's programs; the brief names only the core as a library.
- **A Docker image for the Linux run.** It would pin the toolchain, but a
  contributor does not set up from a Dockerfile; the target is the
  instructions themselves.

## Consequences

- `pnpm verify` gains `cargo rustdoc` and the license check, and refuses an
  old Node. Its time grows by the doc build, measured in step 2.
- A dependency under a new license stops the push until an ADR decides it.
- `third-party-licenses.txt` changes when a shipped dependency changes, and
  is regenerated like the examples.
- The owner switches on private vulnerability reporting; nothing here does.
- Phase 7 is done when step 5 is. What comes after is not decided here.
