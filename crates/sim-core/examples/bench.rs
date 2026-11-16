//! Native timings of the benchmark circuits (ADR 0030):
//!
//!     node scripts/benchmarks.mjs --all
//!     cargo run --release -p sim-core --example bench [-- <directory>]
//!
//! For each `*.clockyard.json` in the directory (default `benchmarks/generated/`): the median and range over five
//! runs of a load (validate, elaborate, compile, first settle) and of one switch change and its settle, and ticks per
//! second for circuits with a clock. Prints a Markdown table for `docs/performance.md`.

#[path = "../tests/common/mod.rs"]
mod common;

use sim_core::Simulator;
use std::time::{Duration, Instant};

const RUNS: usize = 5;

/// Median and range of `RUNS` timings of `f`, in milliseconds.
fn time(mut f: impl FnMut()) -> (f64, f64, f64) {
    let mut runs: Vec<f64> = (0..RUNS)
        .map(|_| {
            let start = Instant::now();
            f();
            start.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    runs.sort_by(f64::total_cmp);
    (runs[RUNS / 2], runs[0], runs[RUNS - 1])
}

fn main() {
    let dir = std::env::args()
        .nth(1)
        .unwrap_or_else(|| format!("{}/../../benchmarks/generated", env!("CARGO_MANIFEST_DIR")));
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{dir}: {e}; run `node scripts/benchmarks.mjs --all` first"))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.to_string_lossy().ends_with(".clockyard.json"))
        .collect();
    files.sort();
    println!(
        "| Benchmark | Nets | Load, ms (range) | Switch change, ms (range) | Ticks per second |"
    );
    println!("|---|---:|---:|---:|---:|");
    for path in files {
        let name = path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .replace(".clockyard.json", "");
        let circuit = common::description(&std::fs::read_to_string(&path).unwrap());
        // A circuit the engine refuses is a result too: its limit, in the table.
        if let Err(errors) = Simulator::load(&circuit) {
            let codes: Vec<String> = errors.iter().map(|d| format!("{:?}", d.code)).collect();
            println!("| {name} | – | refused: {} | – | – |", codes.join(", "));
            continue;
        }
        let (load, load_min, load_max) = time(|| {
            Simulator::load(&circuit).expect("valid circuit");
        });
        let mut sim = Simulator::load(&circuit).expect("valid circuit").0;
        let nets = sim.nets().len();
        // A switch to flip, if the sheet has one ("s", or "cin" for the adder).
        let switch = ["s", "cin"]
            .into_iter()
            .find(|s| sim.port_nets().contains_key(*s));
        // The adder's A bits all on, so its carry in ripples through every bit.
        let ones: Vec<String> = (0..)
            .map(|i| format!("a{i}"))
            .take_while(|a| sim.port_nets().contains_key(a))
            .collect();
        let values: Vec<(&str, u32)> = ones.iter().map(|a| (a.as_str(), 1)).collect();
        sim.set_inputs(&values).unwrap();
        let change = switch.map(|s| {
            let mut on = 0;
            time(|| {
                on ^= 1;
                sim.set_input(s, on).unwrap();
            })
        });
        // Ticks for a second's worth, in chunks as the worker runs them, where there is a clock to tick.
        let clocked = name.starts_with("counters") || name.starts_with("cpu");
        let rate = clocked.then(|| {
            let start = Instant::now();
            let mut ticks = 0u64;
            while start.elapsed() < Duration::from_secs(1) {
                assert_eq!(sim.tick(64), None, "{name} did not settle");
                ticks += 64;
            }
            ticks as f64 / start.elapsed().as_secs_f64()
        });
        let ms = |(m, lo, hi): (f64, f64, f64)| format!("{m:.1} ({lo:.1}–{hi:.1})");
        println!(
            "| {name} | {nets} | {} | {} | {} |",
            ms((load, load_min, load_max)),
            change.map_or("–".into(), ms),
            rate.map_or("–".into(), |r| format!("{r:.0}")),
        );
    }
}
