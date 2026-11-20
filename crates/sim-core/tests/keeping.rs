//! Editing a running circuit (ADR 0033): a load that keeps state carries time
//! and every part matched by ID from the circuit simulated before it.

mod common;

use common::{description, example, load, value};
use serde_json::{Value, json};
use sim_core::description::{ComponentDesc, Connection, Endpoint, PortRef};
use sim_core::{CircuitDescription, Simulator};

fn port(spec: &str) -> Endpoint {
    let (component, port) = spec.split_once('.').expect("component.port");
    Endpoint::Port(PortRef {
        component: component.to_string(),
        port: port.to_string(),
    })
}

fn part(id: &str, kind: &str) -> ComponentDesc {
    ComponentDesc {
        id: id.to_string(),
        kind: kind.to_string(),
        ..ComponentDesc::default()
    }
}

fn wire(id: &str, from: &str, to: &str) -> Connection {
    Connection {
        id: id.to_string(),
        from: port(from),
        to: port(to),
    }
}

/// The 8-bit counter example, with an extra LED on its value: a connectivity edit.
fn counter_with_led() -> CircuitDescription {
    let mut edited = description(&example("8-bit-counter"));
    edited.components.push(ComponentDesc {
        width: Some(8.0),
        ..part("extra", "led")
    });
    edited.connections.push(wire("w-extra", "r.q", "extra.in"));
    edited
}

fn keep(description: &CircuitDescription, previous: &Simulator) -> Simulator {
    Simulator::load_keeping(description, previous)
        .expect("valid circuit")
        .0
}

fn from_json(value: Value) -> CircuitDescription {
    serde_json::from_value(value).expect("description")
}

/// A counter run to 5, at tick 10.
fn counted() -> Simulator {
    let mut sim = load("8-bit-counter");
    sim.set_input("count", 1).unwrap();
    sim.tick(10);
    assert_eq!(value(&sim, "r", "q"), 5);
    sim
}

#[test]
fn a_counter_keeps_counting_across_an_edit() {
    let sim = keep(&counter_with_led(), &counted());
    assert_eq!(sim.time(), 10);
    assert_eq!(value(&sim, "r", "q"), 5);
    assert_eq!(
        value(&sim, "extra", "in"),
        5,
        "the new LED shows the kept value"
    );
    let mut sim = sim;
    // `count` was carried, so the editor's re-send changes nothing.
    sim.set_input("count", 1).unwrap();
    assert_eq!(value(&sim, "r", "q"), 5);
    sim.step_cycle();
    assert_eq!(value(&sim, "r", "q"), 6);

    // A plain load starts again, as an open does.
    let fresh = Simulator::load(&counter_with_led()).unwrap().0;
    assert_eq!((fresh.time(), value(&fresh, "r", "q")), (0, 0));
}

#[test]
fn a_new_id_or_a_new_width_starts_at_zero_and_a_switch_keeps_the_bits_that_fit() {
    let mut before = counted();
    before.set_input("step", 0xab).unwrap();

    let mut renamed = description(&example("8-bit-counter"));
    for c in &mut renamed.components {
        if c.id == "r" {
            c.id = "r2".to_string();
        }
    }
    for w in &mut renamed.connections {
        for end in [&mut w.from, &mut w.to] {
            if let Endpoint::Port(p) = end
                && p.component == "r"
            {
                p.component = "r2".to_string();
            }
        }
    }
    assert_eq!(value(&keep(&renamed, &before), "r2", "q"), 0);

    // Four bits wide everywhere: the register starts again, the switch keeps its low four bits.
    let mut narrow = description(&example("8-bit-counter"));
    narrow.definitions.clear();
    narrow.components.retain(|c| c.id != "add");
    narrow
        .connections
        .retain(|w| w.id == "w-clk" || w.id == "w-out");
    for c in &mut narrow.components {
        if c.id == "r" || c.id == "step" || c.id == "out" {
            c.width = Some(4.0);
        }
    }
    narrow.connections.push(wire("w-d", "step.out", "r.d"));
    let sim = keep(&narrow, &before);
    assert_eq!(value(&sim, "step", "out"), 0xb);
    assert_eq!(value(&sim, "r", "q"), 0);
}

/// Switch `s` clocks flip-flop `f`, whose data is NOT switch `x`; the edit adds an LED (`extra_led`).
fn clocked(extra_led: bool) -> CircuitDescription {
    let mut components = vec![
        json!({ "id": "s", "kind": "switch" }),
        json!({ "id": "x", "kind": "switch" }),
        json!({ "id": "n", "kind": "not" }),
        json!({ "id": "f", "kind": "dff" }),
    ];
    let mut connections = vec![
        json!({ "id": "w-x", "from": { "component": "x", "port": "out" }, "to": { "component": "n", "port": "in" } }),
        json!({ "id": "w-d", "from": { "component": "n", "port": "out" }, "to": { "component": "f", "port": "d" } }),
        json!({ "id": "w-s", "from": { "component": "s", "port": "out" }, "to": { "component": "f", "port": "clk" } }),
    ];
    if extra_led {
        components.push(json!({ "id": "l", "kind": "led" }));
        connections.push(json!({ "id": "w-l", "from": { "component": "f", "port": "q" }, "to": { "component": "l", "port": "in" } }));
    }
    from_json(json!({ "components": components, "connections": connections }))
}

#[test]
fn re_sending_the_switches_after_an_edit_clocks_nothing() {
    // `f` took 0 when `s` rose with `x` on; `x` was turned off after, so its data is now 1.
    let mut before = Simulator::load(&clocked(false)).unwrap().0;
    before.set_input("x", 1).unwrap();
    before.set_input("s", 1).unwrap();
    before.set_input("x", 0).unwrap();
    assert_eq!(value(&before, "f", "q"), 0);
    // What the editor does after every load: every switch it holds, at once.
    let resend = [("s", 1), ("x", 0)];
    let mut kept = keep(&clocked(true), &before);
    kept.set_inputs(&resend).unwrap();
    assert_eq!(value(&kept, "f", "q"), 0);
    // Before ADR 0033 the switches restarted at 0, so the re-send was an edge, and `f` took the data.
    let mut fresh = Simulator::load(&clocked(true)).unwrap().0;
    fresh.set_inputs(&resend).unwrap();
    assert_eq!(value(&fresh, "f", "q"), 1);
}

#[test]
fn moving_a_wire_to_a_clock_input_does_not_clock_it() {
    // `clocked` with a second switch `t`, and the clock wire from `clock`.
    let from = |clock: &str| {
        let mut d = clocked(false);
        d.components.push(part("t", "switch"));
        for w in &mut d.connections {
            if w.id == "w-s" {
                w.from = port(&format!("{clock}.out"));
            }
        }
        d
    };
    // `f` holds 1 from a rise of `s`, now low; its data is now 0 and `t` is on.
    let mut before = Simulator::load(&from("s")).unwrap().0;
    before.set_input("s", 1).unwrap();
    before.set_input("s", 0).unwrap();
    before.set_inputs(&[("x", 1), ("t", 1)]).unwrap();
    assert_eq!(value(&before, "f", "q"), 1);
    // The edit moves the clock wire to `t`, which is on: a flip-flop sampling now would take 0.
    let mut sim = keep(&from("t"), &before);
    assert_eq!(value(&sim, "f", "q"), 1);
    // The next rising edge it sees still clocks it.
    sim.set_input("t", 0).unwrap();
    sim.set_input("t", 1).unwrap();
    assert_eq!(value(&sim, "f", "q"), 0);
}

fn memories(address: f64) -> CircuitDescription {
    from_json(json!({
        "components": [
            { "id": "a", "kind": "switch", "width": address }, { "id": "d", "kind": "switch", "width": 8 },
            { "id": "we", "kind": "switch" }, { "id": "c", "kind": "switch" }, { "id": "k", "kind": "keyboard" },
            { "id": "m", "kind": "ram", "width": 8, "addressWidth": address },
            { "id": "v", "kind": "screen", "width": 8, "addressWidth": 7 }
        ],
        "connections": [
            { "id": "w1", "from": { "component": "a", "port": "out" }, "to": { "component": "m", "port": "addr" } },
            { "id": "w2", "from": { "component": "d", "port": "out" }, "to": { "component": "m", "port": "din" } },
            { "id": "w3", "from": { "component": "we", "port": "out" }, "to": { "component": "m", "port": "we" } },
            { "id": "w4", "from": { "component": "c", "port": "out" }, "to": { "component": "m", "port": "clk" } },
            { "id": "w5", "from": { "component": "d", "port": "out" }, "to": { "component": "v", "port": "din" } },
            { "id": "w6", "from": { "component": "we", "port": "out" }, "to": { "component": "v", "port": "we" } },
            { "id": "w7", "from": { "component": "c", "port": "out" }, "to": { "component": "v", "port": "clk" } }
        ]
    }))
}

#[test]
fn ram_screen_and_keyboard_are_kept_and_a_resized_ram_is_cleared() {
    let mut sim = Simulator::load(&memories(2.0)).unwrap().0;
    sim.set_inputs(&[("a", 1), ("d", 42), ("we", 1), ("k", 65)])
        .unwrap();
    sim.set_input("c", 1).unwrap();
    assert_eq!(sim.memory("m").unwrap()[1], 42);
    assert_eq!(sim.memory("v").unwrap()[0], 42);

    let kept = keep(&memories(2.0), &sim);
    assert_eq!(sim.memory("m"), kept.memory("m"));
    assert_eq!(sim.memory("v"), kept.memory("v"));
    assert_eq!(value(&kept, "k", "out"), 65);
    assert_eq!(value(&kept, "m", "out"), 42, "reads the kept word");

    let resized = keep(&memories(3.0), &sim);
    assert_eq!(resized.memory("m"), Some(&[0; 8][..]));
    assert_eq!(
        sim.memory("v"),
        resized.memory("v"),
        "the screen did not change"
    );
}

#[test]
fn the_reference_cpu_keeps_every_register_and_its_ram_across_an_edit() {
    let mut sim = load("reference-cpu");
    sim.tick(301);
    let mut edited = description(&example("reference-cpu"));
    edited.components.push(part("extra", "led"));
    edited
        .connections
        .push(wire("w-extra", "clk.out", "extra.in"));
    let kept = keep(&edited, &sim);
    assert_eq!(kept.time(), 301);
    // Every port of every part, inside instances too, reads as it did.
    for (component, ports) in sim.port_nets() {
        for (name, &net) in ports {
            assert_eq!(
                kept.nets()[kept.port_nets()[component][name] as usize],
                sim.nets()[net as usize],
                "{component}.{name}"
            );
        }
    }
    let rams: Vec<&str> = sim
        .port_nets()
        .keys()
        .map(String::as_str)
        .filter(|id| sim.memory(id).is_some())
        .collect();
    assert!(!rams.is_empty());
    for id in rams {
        assert_eq!(sim.memory(id), kept.memory(id), "{id}");
    }
}

#[test]
fn parts_moved_into_a_new_instance_start_at_zero() {
    let before = counted();
    // The register, now inside an instance `box`: its elaborated ID is `box/r`.
    let mut moved = description(&example("8-bit-counter"));
    moved.components.retain(|c| c.id != "r");
    moved
        .connections
        .retain(|w| !["w-q", "w-sum", "w-clk", "w-out"].contains(&w.id.as_str()));
    let reg: CircuitDescription = from_json(json!({
        "components": [], "connections": [],
        "definitions": [{
            "id": "reg",
            "components": [
                { "id": "d", "kind": "switch", "width": 8 }, { "id": "clk", "kind": "switch" },
                { "id": "r", "kind": "dff", "width": 8 }, { "id": "q", "kind": "led", "width": 8 }
            ],
            "connections": [
                { "id": "i1", "from": { "component": "d", "port": "out" }, "to": { "component": "r", "port": "d" } },
                { "id": "i2", "from": { "component": "clk", "port": "out" }, "to": { "component": "r", "port": "clk" } },
                { "id": "i3", "from": { "component": "r", "port": "q" }, "to": { "component": "q", "port": "in" } }
            ],
            "inputs": [{ "name": "d", "component": "d" }, { "name": "clk", "component": "clk" }],
            "outputs": [{ "name": "q", "component": "q" }]
        }]
    }));
    moved.definitions.extend(reg.definitions);
    moved.components.push(ComponentDesc {
        definition: Some("reg".to_string()),
        ..part("box", "custom")
    });
    moved.connections.extend([
        wire("w-q", "box.q", "add.a"),
        wire("w-sum", "add.sum", "box.d"),
        wire("w-clk", "k.out", "box.clk"),
        wire("w-out", "box.q", "out.in"),
    ]);
    let sim = keep(&moved, &before);
    assert_eq!(value(&sim, "box/r", "q"), 0);
    // The instance itself keeps its register across a later edit.
    let mut sim = sim;
    sim.step_cycle();
    let n = value(&sim, "box/r", "q");
    assert_ne!(n, 0);
    let mut again = moved.clone();
    again.components.push(part("extra", "led"));
    again
        .connections
        .push(wire("w-extra", "count.out", "extra.in"));
    assert_eq!(value(&keep(&again, &sim), "box/r", "q"), n);
}

#[test]
fn an_edit_with_errors_leaves_the_previous_circuit_to_carry_from() {
    let before = counted();
    let mut broken = counter_with_led();
    // Two drivers on the LED's input.
    broken
        .connections
        .push(wire("w-bad", "count.out", "extra.in"));
    assert!(Simulator::load_keeping(&broken, &before).is_err());
    let fixed = keep(&counter_with_led(), &before);
    assert_eq!((fixed.time(), value(&fixed, "r", "q")), (10, 5));
}

#[test]
fn the_clock_takes_the_level_of_the_kept_time_without_clocking() {
    // At tick 5 the clock is high: the register, last clocked at tick 5, must not take its next value at the load.
    let mut sim = load("8-bit-counter");
    sim.set_input("count", 1).unwrap();
    sim.tick(5);
    assert_eq!(value(&sim, "r", "q"), 3);
    let mut kept = keep(&counter_with_led(), &sim);
    assert_eq!(value(&kept, "k", "out"), 1);
    assert_eq!(value(&kept, "r", "q"), 3);
    kept.tick(2);
    assert_eq!(value(&kept, "r", "q"), 4);
}

#[test]
fn records_are_kept_and_follow_their_wires_when_nets_split_or_join() {
    let mut sim = load("8-bit-counter");
    sim.set_input("count", 1).unwrap();
    sim.watch_wires(&["w-q", "w-out", "w-count"]);
    sim.tick(6);
    // `w-q` and `w-out` share the register's net: one record.
    let before = sim.waves();
    assert_eq!(before.len(), 2);
    assert_eq!(before[0], [(0, 0), (1, 1), (3, 2), (5, 3)]);

    // Kept as it was across an edit that leaves the nets alone.
    let kept = keep(&counter_with_led(), &sim);
    assert_eq!(kept.waves(), before);

    // Split: `w-out` now comes from `count`. Both halves show the register's history; the `count` net, whose first
    // watched wire is now `w-out`, takes it too.
    let mut split = description(&example("8-bit-counter"));
    for w in &mut split.connections {
        if w.id == "w-out" {
            w.from = port("count.out");
        }
    }
    for c in &mut split.components {
        if c.id == "out" {
            c.width = None;
        }
    }
    let waves = keep(&split, &sim).waves();
    assert_eq!(waves.len(), 2);
    assert_eq!(waves[0], before[0]);
    assert_eq!(waves[1][..4], before[0][..]);
    assert_eq!(
        waves[1].last(),
        Some(&(6, 1)),
        "then the count switch's value"
    );

    // Join: watched in the order `w-count`, `w-q`; after the edit `w-q` reads the count switch, so the joined net shows
    // `w-count`'s history, the first watched wire on it.
    let mut sim2 = load("8-bit-counter");
    sim2.set_input("count", 1).unwrap();
    sim2.watch_wires(&["w-count", "w-q"]);
    sim2.tick(6);
    let count_history = sim2.waves()[0].clone();
    let mut joined = description(&example("8-bit-counter"));
    joined.components.push(part("extra", "led"));
    for w in &mut joined.connections {
        if w.id == "w-q" {
            w.from = port("count.out");
            w.to = port("extra.in");
        }
    }
    let waves = keep(&joined, &sim2).waves();
    assert_eq!(waves, [count_history]);
}
