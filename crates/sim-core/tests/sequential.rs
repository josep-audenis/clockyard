//! Clocks and flip-flops (ADR 0017): edge sampling, virtual time, reset.

use serde_json::{Value, json};
use sim_core::{CircuitDescription, Code, Simulator};

/// "a.q" → a port, "j" → a junction.
fn end(spec: &str) -> Value {
    match spec.split_once('.') {
        Some((component, port)) => json!({ "component": component, "port": port }),
        None => json!({ "junction": spec }),
    }
}

/// Wires as (from, to), named w0, w1, …
fn wires(list: &[(&str, &str)]) -> Value {
    Value::Array(
        list.iter()
            .enumerate()
            .map(|(i, (from, to))| json!({ "id": format!("w{i}"), "from": end(from), "to": end(to) }))
            .collect(),
    )
}

/// Parts as (id, kind).
fn parts(list: &[(&str, &str)]) -> Value {
    Value::Array(
        list.iter()
            .map(|(id, kind)| json!({ "id": id, "kind": kind }))
            .collect(),
    )
}

fn load(value: Value) -> Simulator {
    let description: CircuitDescription = serde_json::from_value(value).expect("description");
    Simulator::load(&description).expect("valid").0
}

fn value(sim: &Simulator, component: &str, port: &str) -> u32 {
    sim.nets()[sim.port_nets()[component][port] as usize]
}

/// Switch `s` → a → b → c, every flip-flop on clock `k`.
fn shift_register(prefix: &str) -> Simulator {
    let id = |name: &str| format!("{prefix}{name}");
    let (s, k, a, b, c) = (id("s"), id("k"), id("a"), id("b"), id("c"));
    let port = |part: &str, name: &str| format!("{part}.{name}");
    load(json!({
        "components": parts(&[(&s, "switch"), (&k, "clock"), (&a, "dff"), (&b, "dff"), (&c, "dff")]),
        "connections": wires(&[
            (&port(&s, "out"), &port(&a, "d")),
            (&port(&a, "q"), &port(&b, "d")),
            (&port(&b, "q"), &port(&c, "d")),
            (&port(&k, "out"), &port(&a, "clk")),
            (&port(&k, "out"), &port(&b, "clk")),
            (&port(&k, "out"), &port(&c, "clk")),
        ]),
    }))
}

fn stages(sim: &Simulator, prefix: &str) -> [u32; 3] {
    ["a", "b", "c"].map(|name| value(sim, &format!("{prefix}{name}"), "q"))
}

#[test]
fn a_shift_register_moves_by_exactly_one_place_per_edge() {
    let mut sim = shift_register("");
    assert_eq!(stages(&sim, ""), [0, 0, 0]);
    sim.set_input("s", 1).unwrap();
    assert_eq!(stages(&sim, ""), [0, 0, 0], "no edge, no change");
    assert_eq!(sim.step_cycle(), None);
    assert_eq!(stages(&sim, ""), [1, 0, 0]);
    sim.set_input("s", 0).unwrap();
    sim.step_cycle();
    assert_eq!(stages(&sim, ""), [0, 1, 0]);
    sim.step_cycle();
    assert_eq!(stages(&sim, ""), [0, 0, 1]);
    sim.step_cycle();
    assert_eq!(stages(&sim, ""), [0, 0, 0]);
    // A flip-flop drives its `q` net.
    let net = sim.port_nets()["b"]["q"] as usize;
    assert_eq!(sim.net_drivers()[net], Some("b"));
}

#[test]
fn the_same_commands_give_the_same_values_whatever_the_component_order() {
    // IDs sort the other way round, so parts compile in a different order.
    let mut one = shift_register("a-");
    let mut two = shift_register("z-");
    for input in [1, 1, 0, 1, 0, 0] {
        one.set_input("a-s", input).unwrap();
        two.set_input("z-s", input).unwrap();
        one.step_cycle();
        two.step_cycle();
        assert_eq!(stages(&one, "a-"), stages(&two, "z-"));
    }
}

#[test]
fn a_clock_delayed_through_gates_still_samples_the_state_before_the_edge() {
    // f1 on the clock; f2 on the clock through four NOT gates, its d from f1.q.
    let mut sim = load(json!({
        "components": parts(&[
            ("s", "switch"), ("k", "clock"), ("f1", "dff"), ("f2", "dff"),
            ("n1", "not"), ("n2", "not"), ("n3", "not"), ("n4", "not"),
        ]),
        "connections": wires(&[
            ("s.out", "f1.d"), ("k.out", "f1.clk"), ("f1.q", "f2.d"),
            ("k.out", "n1.in"), ("n1.out", "n2.in"), ("n2.out", "n3.in"), ("n3.out", "n4.in"), ("n4.out", "f2.clk"),
        ]),
    }));
    sim.set_input("s", 1).unwrap();
    sim.step_cycle();
    assert_eq!(
        [value(&sim, "f1", "q"), value(&sim, "f2", "q")],
        [1, 0],
        "f2 saw f1's old value"
    );
    sim.step_cycle();
    assert_eq!([value(&sim, "f1", "q"), value(&sim, "f2", "q")], [1, 1]);
}

#[test]
fn a_ripple_counter_counts_up() {
    // q0 toggles each cycle; f1 is clocked by NOT q0, so it toggles when q0 falls.
    let mut sim = load(json!({
        "components": parts(&[("k", "clock"), ("f0", "dff"), ("f1", "dff"), ("i0", "not"), ("i1", "not")]),
        "connections": wires(&[
            ("k.out", "f0.clk"), ("f0.q", "i0.in"), ("i0.out", "f0.d"),
            ("i0.out", "f1.clk"), ("f1.q", "i1.in"), ("i1.out", "f1.d"),
        ]),
    }));
    let count = |sim: &Simulator| value(sim, "f1", "q") * 2 + value(sim, "f0", "q");
    let mut seen = Vec::new();
    for _ in 0..5 {
        sim.step_cycle();
        seen.push(count(&sim));
    }
    assert_eq!(seen, [1, 2, 3, 0, 1]);
}

#[test]
fn a_switch_on_clk_makes_edges_by_hand() {
    let mut sim = load(json!({
        "components": parts(&[("s", "switch"), ("c", "switch"), ("f", "dff")]),
        "connections": wires(&[("s.out", "f.d"), ("c.out", "f.clk")]),
    }));
    sim.set_input("s", 1).unwrap();
    assert_eq!(value(&sim, "f", "q"), 0);
    sim.set_input("c", 1).unwrap();
    assert_eq!(value(&sim, "f", "q"), 1, "rising edge");
    sim.set_input("s", 0).unwrap();
    sim.set_input("c", 0).unwrap();
    assert_eq!(value(&sim, "f", "q"), 1, "a falling edge samples nothing");
    sim.set_input("c", 1).unwrap();
    assert_eq!(value(&sim, "f", "q"), 0);
}

#[test]
fn a_register_holds_a_wide_value_and_its_clock_input_is_one_bit() {
    let description: CircuitDescription = serde_json::from_value(json!({
        "components": [
            { "id": "s", "kind": "switch", "width": 8 },
            { "id": "k", "kind": "clock" },
            { "id": "r", "kind": "dff", "width": 8 },
        ],
        "connections": wires(&[("s.out", "r.d"), ("k.out", "r.clk")]),
    }))
    .unwrap();
    let (mut sim, warnings) = Simulator::load(&description).expect("valid");
    assert_eq!(warnings, vec![]);
    sim.set_input("s", 0xA5).unwrap();
    sim.step_cycle();
    assert_eq!(value(&sim, "r", "q"), 0xA5);
    // A clock takes no width.
    let wide_clock: CircuitDescription = serde_json::from_value(json!({
        "components": [{ "id": "k", "kind": "clock", "width": 8 }], "connections": []
    }))
    .unwrap();
    let errors = Simulator::load(&wide_clock).unwrap_err();
    assert_eq!(errors[0].code, Code::InvalidWidth);
}

#[test]
fn time_counts_ticks_and_a_cycle_ends_low_from_low_or_high() {
    let mut sim = shift_register("");
    let clock = |sim: &Simulator| value(sim, "k", "out");
    assert_eq!((sim.time(), clock(&sim)), (0, 0));
    sim.step_cycle();
    assert_eq!((sim.time(), clock(&sim)), (2, 0));
    sim.tick(1);
    assert_eq!((sim.time(), clock(&sim)), (3, 1), "paused high");
    sim.set_input("s", 1).unwrap();
    sim.step_cycle();
    // Finished the cycle that was high, then one more: one new rising edge.
    assert_eq!((sim.time(), clock(&sim)), (6, 0));
    assert_eq!(stages(&sim, ""), [1, 0, 0]);
}

#[test]
fn reset_clears_flip_flops_clock_and_time_and_keeps_switches() {
    let mut sim = shift_register("");
    sim.set_input("s", 1).unwrap();
    sim.step_cycle();
    sim.step_cycle();
    sim.tick(1); // a rising edge, left high
    assert_eq!(stages(&sim, ""), [1, 1, 1]);
    assert_eq!(sim.reset(), None);
    assert_eq!((sim.time(), value(&sim, "k", "out")), (0, 0));
    assert_eq!(stages(&sim, ""), [0, 0, 0]);
    assert_eq!(value(&sim, "s", "out"), 1, "the switch is still on");
    sim.step_cycle();
    assert_eq!(stages(&sim, ""), [1, 0, 0]);
}

#[test]
fn tick_stops_at_the_first_tick_that_does_not_settle() {
    // A NAND fed back to itself oscillates while the clock is high.
    let mut sim = load(json!({
        "components": parts(&[("k", "clock"), ("g", "nand")]),
        "connections": wires(&[("k.out", "g.a"), ("g.out", "g.b")]),
    }));
    let unstable = sim.tick(10).expect("unstable");
    assert_eq!(
        (unstable.code, unstable.ids.clone()),
        (Code::Unstable, vec!["g".to_string()])
    );
    assert_eq!(sim.time(), 1);
}

#[test]
fn two_instances_of_a_definition_with_a_flip_flop_keep_separate_state() {
    let latch = json!({
        "id": "bit",
        "components": parts(&[("d", "switch"), ("c", "switch"), ("f", "dff"), ("q", "led")]),
        "connections": wires(&[("d.out", "f.d"), ("c.out", "f.clk"), ("f.q", "q.in")]),
        "inputs": [{ "name": "d", "component": "d" }, { "name": "c", "component": "c" }],
        "outputs": [{ "name": "q", "component": "q" }],
    });
    let mut sim = load(json!({
        "components": [
            { "id": "k", "kind": "clock" }, { "id": "s1", "kind": "switch" }, { "id": "s2", "kind": "switch" },
            { "id": "x", "kind": "custom", "definition": "bit" }, { "id": "y", "kind": "custom", "definition": "bit" },
            { "id": "lx", "kind": "led" }, { "id": "ly", "kind": "led" },
        ],
        "connections": wires(&[
            ("k.out", "x.c"), ("k.out", "y.c"), ("s1.out", "x.d"), ("s2.out", "y.d"), ("x.q", "lx.in"), ("y.q", "ly.in"),
        ]),
        "definitions": [latch],
    }));
    sim.set_input("s1", 1).unwrap();
    sim.step_cycle();
    assert_eq!([value(&sim, "lx", "in"), value(&sim, "ly", "in")], [1, 0]);
    sim.set_input("s1", 0).unwrap();
    sim.set_input("s2", 1).unwrap();
    sim.step_cycle();
    assert_eq!([value(&sim, "lx", "in"), value(&sim, "ly", "in")], [0, 1]);
    // A flip-flop inside an instance is driven by, and reported as, the instance.
    let net = sim.port_nets()["lx"]["in"] as usize;
    assert_eq!(sim.net_drivers()[net], Some("x"));
}

#[test]
fn switches_set_together_settle_once_whatever_their_order() {
    // d on f.d and c on f.clk, both turned on together: f samples d's old 0, in either order.
    let circuit = || {
        load(json!({
            "components": parts(&[("d", "switch"), ("c", "switch"), ("f", "dff")]),
            "connections": wires(&[("d.out", "f.d"), ("c.out", "f.clk")]),
        }))
    };
    let mut one = circuit();
    let mut two = circuit();
    one.set_inputs(&[("d", 1), ("c", 1)]).unwrap();
    two.set_inputs(&[("c", 1), ("d", 1)]).unwrap();
    assert_eq!([value(&one, "f", "q"), value(&two, "f", "q")], [0, 0]);
    // One at a time, d first, the edge sees d = 1.
    let mut three = circuit();
    three.set_input("d", 1).unwrap();
    three.set_input("c", 1).unwrap();
    assert_eq!(value(&three, "f", "q"), 1);
    // A refused value sets nothing.
    assert!(one.set_inputs(&[("d", 0), ("f", 1)]).is_err());
    assert_eq!(value(&one, "d", "out"), 1);
}

#[test]
fn without_a_clock_tick_stops_at_the_first_tick_that_reports_a_loop() {
    // A flip-flop beside an oscillating NOT: nothing to clock, but the loop is still unstable.
    let description: CircuitDescription = serde_json::from_value(json!({
        "components": parts(&[("f", "dff"), ("n", "not")]),
        "connections": wires(&[("n.out", "n.in")]),
    }))
    .unwrap();
    let (mut sim, warnings) = Simulator::load(&description).expect("valid");
    assert!(warnings.iter().any(|d| d.code == Code::Unstable));
    assert_eq!(sim.tick(64).map(|d| d.code), Some(Code::Unstable));
    assert_eq!(
        sim.time(),
        1,
        "stopped at the first tick, whatever the chunk"
    );
}
