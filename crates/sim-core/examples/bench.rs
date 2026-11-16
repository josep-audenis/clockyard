//! Native timings of the benchmark circuits (ADR 0030):
//!
//!     node scripts/benchmarks.mjs --all
//!     cargo run --release -p sim-core --example bench [-- <directory>]
//!
//! For each `*.clockyard.json` in the directory (default `benchmarks/generated/`), by family and size: the median and
//! range over five runs of a load (validate, elaborate, compile, first settle; not reading the file, nor dropping the
//! simulator), of one switch change and its settle, and of ticks per second, for circuits with a clock. Prints a
//! Markdown table for `docs/performance.md`.

#[path = "../tests/common/mod.rs"]
mod common;

use sim_core::{Kind, Simulator};
use std::time::{Duration, Instant};

const RUNS: usize = 5;

/// Median and range of `RUNS` results of `f`, which returns what it measured.
fn runs(mut f: impl FnMut() -> f64) -> (f64, f64, f64) {
    let mut runs: Vec<f64> = (0..RUNS).map(|_| f()).collect();
    runs.sort_by(f64::total_cmp);
    (runs[RUNS / 2], runs[0], runs[RUNS - 1])
}

/// Milliseconds `f` took; what it returns is dropped after the clock stops.
fn millis<T>(f: impl FnOnce() -> T) -> (f64, T) {
    let start = Instant::now();
    let result = f();
    (start.elapsed().as_secs_f64() * 1000.0, result)
}

/// "chain-10k" → ("chain", 10), so sizes sort as numbers.
fn order(name: &str) -> (String, u32) {
    let (family, size) = name.rsplit_once('-').unwrap_or((name, "0"));
    (
        family.to_string(),
        size.trim_end_matches('k').parse().unwrap_or(0),
    )
}

fn main() {
    let dir = std::env::args()
        .nth(1)
        .unwrap_or_else(|| format!("{}/../../benchmarks/generated", env!("CARGO_MANIFEST_DIR")));
    let mut files: Vec<(String, std::path::PathBuf)> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{dir}: {e}; run `node scripts/benchmarks.mjs --all` first"))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter_map(|p| {
            let name = p
                .file_name()?
                .to_string_lossy()
                .strip_suffix(".clockyard.json")?
                .to_string();
            Some((name, p))
        })
        .collect();
    files.sort_by_key(|(name, _)| order(name));
    println!(
        "| Benchmark | Nets | Load, ms (range) | Switch change, ms (range) | Ticks per second (range) |"
    );
    println!("|---|---:|---:|---:|---:|");
    for (name, path) in files {
        let text = std::fs::read_to_string(&path).unwrap();
        let circuit = common::description(&text);
        // A circuit the engine refuses is a result too: its limit, in the table.
        if let Err(errors) = Simulator::load(&circuit) {
            let codes: Vec<String> = errors.iter().map(|d| format!("{:?}", d.code)).collect();
            println!("| {name} | – | refused: {} | – | – |", codes.join(", "));
            continue;
        }
        let load = runs(|| millis(|| Simulator::load(&circuit).expect("valid circuit")).0);
        let mut sim = Simulator::load(&circuit).expect("valid circuit").0;
        let nets = sim.nets().len();
        let switch = circuit
            .components
            .iter()
            .find(|c| c.kind == "switch" && sim.port_nets().contains_key(&c.id))
            .map(|c| c.id.clone());
        // The adder's A bits all on, so its carry in ripples through every bit.
        let ones: Vec<String> = (0..)
            .map(|i| format!("a{i}"))
            .take_while(|a| sim.port_nets().contains_key(a))
            .collect();
        let values: Vec<(&str, u32)> = ones.iter().map(|a| (a.as_str(), 1)).collect();
        assert_eq!(sim.set_inputs(&values).unwrap(), None);
        let first = if ones.is_empty() {
            switch
        } else {
            Some("cin".to_string())
        };
        let mut on = 0;
        let change = first.map(|s| {
            runs(|| {
                on ^= 1;
                let (ms, settled) = millis(|| sim.set_input(&s, on).unwrap());
                assert_eq!(settled, None, "{name} did not settle");
                ms
            })
        });
        // Ticks in chunks of 64, as the worker runs them, for 200 ms a run, where the circuit has a clock.
        let clocked = circuit
            .components
            .iter()
            .any(|c| c.kind == Kind::Clock.name())
            || circuit
                .definitions
                .iter()
                .any(|d| d.components.iter().any(|c| c.kind == Kind::Clock.name()));
        let rate = clocked.then(|| {
            runs(|| {
                let start = Instant::now();
                let mut ticks = 0u64;
                while start.elapsed() < Duration::from_millis(200) {
                    assert_eq!(sim.tick(64), None, "{name} did not settle");
                    ticks += 64;
                }
                ticks as f64 / start.elapsed().as_secs_f64()
            })
        });
        let ms = |(m, lo, hi): (f64, f64, f64)| format!("{m:.2} ({lo:.2}–{hi:.2})");
        let per_second = |(m, lo, hi): (f64, f64, f64)| format!("{m:.0} ({lo:.0}–{hi:.0})");
        println!(
            "| {name} | {nets} | {} | {} | {} |",
            ms(load),
            change.map_or("–".into(), ms),
            rate.map_or("–".into(), per_second),
        );
    }
}
