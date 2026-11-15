//! Waveforms (ADR 0026): the engine records watched nets after every settle,
//! one value per tick, in a bounded window.

mod common;

use common::load;
use sim_core::{CircuitDescription, Simulator, WAVE_WINDOW};

/// The 8-bit counter example counting, watching its clock, its value and its Count switch.
fn counter() -> Simulator {
    let mut sim = load("8-bit-counter");
    sim.set_input("count", 1).unwrap();
    let nets = ["w-clk", "w-q", "w-count"].map(|w| sim.wire_nets()[w]);
    sim.watch(&nets).unwrap();
    sim
}

#[test]
fn the_record_holds_every_tick_however_the_ticks_are_split() {
    let mut whole = counter();
    whole.tick(100);
    let mut pieces = counter();
    for count in [1, 7, 64, 1, 27] {
        pieces.tick(count);
    }
    assert_eq!(pieces.time(), 100);
    assert_eq!(whole.waves(), pieces.waves());

    let waves = whole.waves();
    // The clock changes at every tick, rising at odd ones.
    assert_eq!(waves[0].len(), 101);
    assert_eq!(&waves[0][..3], &[(0, 0), (1, 1), (2, 0)]);
    // The value counts at each rising edge.
    assert_eq!(&waves[1][..4], &[(0, 0), (1, 1), (3, 2), (5, 3)]);
    assert_eq!(waves[1].last(), Some(&(99, 50)));
    // The switch never changed after watching began.
    assert_eq!(waves[2], [(0, 1)]);
}

#[test]
fn an_input_change_is_recorded_at_its_tick_and_a_later_one_replaces_it() {
    let mut sim = counter();
    sim.tick(4);
    sim.set_input("count", 0).unwrap();
    sim.tick(2);
    sim.set_input("count", 1).unwrap();
    assert_eq!(sim.waves()[2], [(0, 1), (4, 0), (6, 1)]);
    // Off again within tick 6: it never changed at that tick.
    sim.set_input("count", 0).unwrap();
    assert_eq!(sim.waves()[2], [(0, 1), (4, 0)]);
    // The counter held its value while Count was off.
    assert_eq!(sim.waves()[1].last(), Some(&(3, 2)));
}

#[test]
fn the_window_drops_old_changes_but_keeps_the_value_in_force() {
    let mut sim = counter();
    sim.tick(2 * WAVE_WINDOW + 3);
    let time = sim.time();
    let start = time - WAVE_WINDOW;
    for wave in sim.waves() {
        assert!(wave.len() as u64 <= WAVE_WINDOW + 1, "{}", wave.len());
        assert!(wave[0].0 <= start);
        assert!(wave.get(1).is_none_or(|c| c.0 > start));
    }
    let waves = sim.waves();
    assert_eq!(waves[0].len() as u64, WAVE_WINDOW + 1);
    assert_eq!(waves[0].last(), Some(&(time, 1)));
    assert_eq!(waves[2], [(0, 1)]);
}

#[test]
fn a_reset_or_a_load_clears_the_record() {
    let mut sim = counter();
    sim.tick(10);
    sim.reset();
    // Time is back to 0; the switch keeps its position.
    assert_eq!(sim.waves(), [vec![(0, 0)], vec![(0, 0)], vec![(0, 1)]]);

    let sim = load("8-bit-counter");
    assert!(sim.waves().is_empty());
}

#[test]
fn watching_starts_a_new_record_and_refuses_a_net_that_does_not_exist() {
    let mut sim = counter();
    sim.tick(5);
    let clk = sim.wire_nets()["w-clk"];
    sim.watch(&[clk]).unwrap();
    assert_eq!(sim.waves(), [vec![(5, 1)]]);

    let missing = sim.nets().len() as u32;
    assert_eq!(
        sim.watch(&[missing]),
        Err(format!("there is no net {missing}"))
    );
}

#[test]
fn a_tick_that_does_not_settle_is_recorded_with_the_values_it_stopped_at() {
    // A NAND fed back to itself, gated by the clock: settled while it is low, oscillating once it rises.
    let description: CircuitDescription = serde_json::from_value(serde_json::json!({
        "components": [{ "id": "k", "kind": "clock" }, { "id": "o", "kind": "nand" }],
        "connections": [
            { "id": "w-clk", "from": { "component": "k", "port": "out" }, "to": { "component": "o", "port": "a" } },
            { "id": "w-loop", "from": { "component": "o", "port": "out" }, "to": { "component": "o", "port": "b" } },
        ],
    }))
    .unwrap();
    let mut sim = Simulator::load(&description).expect("valid").0;
    let nets = ["w-clk", "w-loop"].map(|w| sim.wire_nets()[w]);
    sim.watch(&nets).unwrap();
    assert!(sim.tick(4).is_some());
    assert_eq!(sim.time(), 1);
    let waves = sim.waves();
    assert_eq!(waves[0], [(0, 0), (1, 1)]);
    let stopped = sim.nets()[nets[1] as usize];
    assert_eq!(waves[1].last(), Some(&(1, stopped)));
}

#[test]
fn time_without_a_clock_moves_the_window_along() {
    let description: CircuitDescription = serde_json::from_value(serde_json::json!({
        "components": [{ "id": "a", "kind": "switch" }, { "id": "l", "kind": "led" }],
        "connections": [{ "id": "w", "from": { "component": "a", "port": "out" }, "to": { "component": "l", "port": "in" } }],
    }))
    .unwrap();
    let mut sim = Simulator::load(&description).expect("valid").0;
    sim.set_input("a", 1).unwrap();
    sim.watch(&[sim.wire_nets()["w"]]).unwrap();
    sim.tick(5);
    sim.set_input("a", 0).unwrap();
    assert_eq!(sim.waves(), [vec![(0, 1), (5, 0)]]);
    // Nothing settles in these ticks, yet the change at 0 leaves the window.
    sim.tick(10_000);
    assert_eq!(sim.waves(), [vec![(5, 0)]]);
}

/// The cost of recording (ADR 0026 item 6): `cargo test --release --test waves -- --ignored --nocapture`.
#[test]
#[ignore = "a measurement, not a check"]
fn measure_the_reference_cpu_with_and_without_traces() {
    let ticks = 200_000;
    for traces in [0, 16] {
        let mut sim = load("catch");
        let mut nets: Vec<u32> = sim.wire_nets().values().copied().collect();
        nets.sort_unstable();
        nets.dedup();
        sim.watch(&nets[..traces]).unwrap();
        let started = std::time::Instant::now();
        sim.tick(ticks);
        let seconds = started.elapsed().as_secs_f64();
        println!(
            "{traces} traces: {:.0} cycles per second",
            ticks as f64 / 2.0 / seconds
        );
    }
}
