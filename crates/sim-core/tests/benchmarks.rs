//! The committed benchmark circuits (`benchmarks/`, ADR 0030) load and compute what they should, so they never rot.
//! Their timings are `examples/bench.rs`'s business, not a test's.

mod common;

use common::{description, value};
use sim_core::Simulator;

fn load(name: &str) -> Simulator {
    let path = format!(
        "{}/../../benchmarks/{name}-1k.clockyard.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let (sim, warnings) = Simulator::load(&description(&text)).expect("valid circuit");
    assert_eq!(warnings, vec![], "{name} loads without warnings");
    sim
}

#[test]
fn the_chain_inverts_once_per_gate() {
    let mut sim = load("chain");
    // 998 NOT gates: an even number, so the LED follows the switch.
    assert_eq!(value(&sim, "l", "in"), 0);
    assert_eq!(sim.set_input("s", 1).unwrap(), None);
    assert_eq!(value(&sim, "l", "in"), 1);
}

#[test]
fn every_gate_of_the_fanout_follows_its_one_switch() {
    let mut sim = load("fanout");
    let leds = || (0..499).map(|i| format!("l{i}"));
    assert!(leds().all(|l| value(&sim, &l, "in") == 1));
    assert_eq!(sim.set_input("s", 1).unwrap(), None);
    assert!(leds().all(|l| value(&sim, &l, "in") == 0));
}

#[test]
fn the_adder_carries_through_every_bit() {
    let mut sim = load("adder");
    // All ones plus a carry in: every sum bit 0, and a carry out.
    let ones: Vec<String> = (0..249).map(|i| format!("a{i}")).collect();
    let mut values: Vec<(&str, u32)> = ones.iter().map(|a| (a.as_str(), 1)).collect();
    values.push(("cin", 1));
    assert_eq!(sim.set_inputs(&values).unwrap(), None);
    assert!((0..249).all(|i| value(&sim, &format!("s{i}"), "in") == 0));
    assert_eq!(value(&sim, "cout", "in"), 1);
}

#[test]
fn every_counter_counts_down_by_one_per_cycle() {
    let mut sim = load("counters");
    assert_eq!(sim.tick(2 * 3), None);
    for c in [0, 57] {
        let count: u32 = (0..8)
            .map(|b| value(&sim, &format!("c{c}q{b}"), "q") << b)
            .sum();
        assert_eq!(count, 256 - 3, "counter {c}");
    }
}

#[test]
fn every_cpu_copy_runs_its_program_as_the_reference_cpu_does_alone() {
    let mut sim = load("cpu");
    let mut alone = common::load("reference-cpu");
    let mut seen = std::collections::BTreeSet::new();
    // Cycle by cycle, where each program has got to: its ROM's address, inside each copy.
    for cycle in 0..40 {
        assert_eq!(sim.tick(2), None);
        assert_eq!(alone.tick(2), None);
        let expected = value(&alone, "rom", "addr");
        seen.insert(expected);
        for i in 0..4 {
            assert_eq!(
                value(&sim, &format!("cpu{i}/rom"), "addr"),
                expected,
                "copy {i}, cycle {cycle}"
            );
        }
    }
    // It moved: a CPU whose clock did not reach it would sit at one address.
    assert!(seen.len() > 1, "{seen:?}");
}
