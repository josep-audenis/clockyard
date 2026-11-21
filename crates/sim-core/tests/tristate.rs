//! The tri-state buffer and nets with several drivers (ADR 0035, step 3).

use serde_json::{Value, json};
use sim_core::check::{Challenge, Mismatch, Report, check};
use sim_core::{CircuitDescription, Code, Diagnostic, Simulator};

/// "a.out" → a port, "j" → a junction.
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

fn part(id: &str, kind: &str) -> Value {
    json!({ "id": id, "kind": kind })
}

fn wide(id: &str, kind: &str, width: u32) -> Value {
    json!({ "id": id, "kind": kind, "width": width })
}

fn instance(id: &str, definition: &str) -> Value {
    json!({ "id": id, "kind": "custom", "definition": definition })
}

fn describe(value: Value) -> CircuitDescription {
    serde_json::from_value(value).expect("description")
}

fn circuit(parts: Vec<Value>, list: &[(&str, &str)]) -> CircuitDescription {
    describe(json!({ "components": parts, "connections": wires(list) }))
}

/// Loads a circuit that has nothing to warn about.
fn load(description: &CircuitDescription) -> Simulator {
    let (sim, warnings) = Simulator::load(description).expect("valid");
    assert_eq!(warnings, vec![]);
    sim
}

fn errors(description: &CircuitDescription) -> Vec<Diagnostic> {
    Simulator::load(description).expect_err("an invalid circuit")
}

/// A port's value and its unknown bits.
fn bits(sim: &Simulator, component: &str, port: &str) -> (u32, u32) {
    let net = sim.port_nets()[component][port] as usize;
    (sim.nets()[net], sim.unknown()[net])
}

const X: (u32, u32) = (1, 1);
const Z: (u32, u32) = (0, 1);

/// Two 8-bit sources `a` and `b` behind buffers `ta` and `tb`, enabled by `ea` and `eb`, on one bus read by `l`.
fn shared_bus() -> CircuitDescription {
    circuit(
        vec![
            wide("a", "switch", 8),
            wide("b", "switch", 8),
            part("ea", "switch"),
            part("eb", "switch"),
            wide("ta", "tri", 8),
            wide("tb", "tri", 8),
            wide("l", "led", 8),
        ],
        &[
            ("a.out", "ta.in"),
            ("ea.out", "ta.en"),
            ("b.out", "tb.in"),
            ("eb.out", "tb.en"),
            ("ta.out", "l.in"),
            ("tb.out", "l.in"),
        ],
    )
}

#[test]
fn two_buffers_share_a_bus_and_two_enabled_at_once_show_x() {
    let mut sim = load(&shared_bus());
    // Neither enabled: nothing drives the bus.
    assert_eq!(bits(&sim, "l", "in"), (0, 0xFF));
    sim.set_inputs(&[("a", 0x5A), ("b", 0x0F), ("ea", 1)])
        .unwrap();
    assert_eq!(bits(&sim, "l", "in"), (0x5A, 0));
    // Both enabled: the bits they agree on stay, the others are X.
    assert_eq!(sim.set_input("eb", 1), Ok(None));
    assert_eq!(bits(&sim, "l", "in"), (0x5F, 0x55));
    assert_eq!(sim.set_input("b", 0x5A), Ok(None));
    assert_eq!(bits(&sim, "l", "in"), (0x5A, 0), "two drivers that agree");
    assert_eq!(sim.set_input("ea", 0), Ok(None));
    assert_eq!(sim.set_input("b", 0x0F), Ok(None));
    assert_eq!(bits(&sim, "l", "in"), (0x0F, 0));

    // Every wire of the group, the reader and each buffer's reported `out` are the bus's one net, numbered
    // after every part's; the bus is named by its buffer with the lowest ID.
    let bus = sim.port_nets()["l"]["in"];
    assert_eq!(sim.port_nets()["ta"]["out"], bus);
    assert_eq!(sim.port_nets()["tb"]["out"], bus);
    assert_eq!([sim.wire_nets()["w4"], sim.wire_nets()["w5"]], [bus, bus]);
    assert_eq!(bus as usize, sim.nets().len() - 1);
    assert_eq!(sim.net_drivers()[bus as usize], Some("ta"));
    // Parts keep the nets they would have without the bus.
    let alone = load(&circuit(
        vec![
            wide("a", "switch", 8),
            wide("b", "switch", 8),
            part("ea", "switch"),
            part("eb", "switch"),
        ],
        &[],
    ));
    for switch in ["a", "b", "ea", "eb"] {
        assert_eq!(
            sim.port_nets()[switch]["out"],
            alone.port_nets()[switch]["out"]
        );
    }
}

#[test]
fn the_resolution_table_holds_for_every_pair_of_values() {
    // Each driver is a buffer whose enable is AND(g, x), x = NAND(loop, x): Z with g at 0, its input with g at 1,
    // and X with g at 1 and the loop on.
    let mut parts = vec![part("l", "led")];
    let mut list: Vec<(String, String)> = Vec::new();
    for d in ["p", "q"] {
        for (suffix, kind) in [
            ("i", "switch"),
            ("g", "switch"),
            ("loop", "switch"),
            ("x", "nand"),
            ("en", "and"),
            ("t", "tri"),
        ] {
            parts.push(part(&format!("{d}{suffix}"), kind));
        }
        let port = |part: &str, port: &str| format!("{d}{part}.{port}");
        list.extend([
            (port("loop", "out"), port("x", "a")),
            (port("x", "out"), port("x", "b")),
            (port("g", "out"), port("en", "a")),
            (port("x", "out"), port("en", "b")),
            (port("en", "out"), port("t", "en")),
            (port("i", "out"), port("t", "in")),
            (port("t", "out"), "l.in".to_string()),
        ]);
    }
    let list: Vec<(&str, &str)> = list.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
    let mut sim = load(&circuit(parts, &list));
    // A driver's value as switches (i, g, loop).
    let drive = |value: char| match value {
        'Z' => (0, 0, 0),
        '0' => (0, 1, 0),
        '1' => (1, 1, 0),
        _ => (0, 1, 1),
    };
    let table = [('Z', "Z01X"), ('0', "00XX"), ('1', "1X1X"), ('X', "XXXX")];
    for (p, row) in table {
        for (q, expected) in "Z01X".chars().zip(row.chars()) {
            let ((pi, pg, pl), (qi, qg, ql)) = (drive(p), drive(q));
            // A loop switched on reports itself; the bus is what is looked at.
            let _ = sim
                .set_inputs(&[
                    ("pi", pi),
                    ("pg", pg),
                    ("ploop", pl),
                    ("qi", qi),
                    ("qg", qg),
                    ("qloop", ql),
                ])
                .unwrap();
            let bus = match bits(&sim, "l", "in") {
                (0, 0) => '0',
                (1, 0) => '1',
                Z => 'Z',
                _ => 'X',
            };
            assert_eq!(bus, expected, "{p} with {q}");
        }
    }
}

#[test]
fn a_disabled_buffer_gives_z_which_every_part_that_computes_reads_as_x() {
    let mut sim = load(&circuit(
        vec![
            part("d", "switch"),
            part("e", "switch"),
            part("e2", "switch"),
            part("t", "tri"),
            part("n", "not"),
            part("zero", "switch"),
            part("g", "and"),
            part("t2", "tri"),
            part("l", "led"),
        ],
        &[
            ("d.out", "t.in"),
            ("e.out", "t.en"),
            ("t.out", "l.in"),
            ("t.out", "n.in"),
            ("t.out", "g.a"),
            ("zero.out", "g.b"),
            // A second buffer, enabled, passing the first one's output on.
            ("t.out", "t2.in"),
            ("e2.out", "t2.en"),
        ],
    ));
    // Alone on its net, a buffer needs no resolver: its own net is the wire's, and it can be Z.
    assert_eq!(bits(&sim, "l", "in"), Z);
    assert_eq!(sim.port_nets()["l"]["in"], sim.port_nets()["t"]["out"]);
    assert_eq!(bits(&sim, "n", "out"), X);
    assert_eq!(bits(&sim, "g", "out"), (0, 0), "AND with 0");
    assert_eq!(bits(&sim, "t2", "out"), Z);
    sim.set_input("e2", 1).unwrap();
    assert_eq!(bits(&sim, "t2", "out"), X, "a Z input is passed on as X");
    sim.set_inputs(&[("d", 1), ("e", 1)]).unwrap();
    assert_eq!(
        [
            bits(&sim, "l", "in"),
            bits(&sim, "n", "out"),
            bits(&sim, "t2", "out")
        ],
        [(1, 0), (0, 0), (1, 0)]
    );
    assert!(sim.unknown().iter().all(|&u| u == 0));
}

#[test]
fn an_unknown_enable_makes_the_output_x_and_en_is_one_bit_wide() {
    // en from a loop that does not settle.
    let description = circuit(
        vec![
            wide("d", "switch", 4),
            part("on", "switch"),
            part("x", "nand"),
            wide("t", "tri", 4),
        ],
        &[
            ("d.out", "t.in"),
            ("on.out", "x.a"),
            ("x.out", "x.b"),
            ("x.out", "t.en"),
        ],
    );
    let mut sim = load(&description);
    sim.set_input("d", 0b1010).unwrap();
    assert_eq!(
        bits(&sim, "t", "out"),
        (0b1010, 0),
        "enabled while the loop rests at 1"
    );
    assert!(
        sim.set_input("on", 1)
            .unwrap()
            .is_some_and(|d| d.is_error())
    );
    assert_eq!(bits(&sim, "t", "out"), (0b1111, 0b1111));

    let wrong = circuit(
        vec![wide("d", "switch", 4), wide("t", "tri", 4)],
        &[("d.out", "t.in"), ("d.out", "t.en")],
    );
    assert_eq!(errors(&wrong)[0].code, Code::WidthMismatch);
}

#[test]
fn only_tri_state_outputs_may_share_a_wire() {
    let gate_and_buffer = |reader: bool| {
        let mut list = vec![("g.out", "t.out")];
        if reader {
            list.push(("t.out", "l.in"));
        }
        circuit(
            vec![part("g", "not"), part("t", "tri"), part("l", "led")],
            &list,
        )
    };
    let found = errors(&gate_and_buffer(false));
    assert_eq!(found[0].code, Code::OutputToOutput);
    assert_eq!(
        found[0].message,
        "wire w0 connects two outputs: only tri-state outputs may share a wire"
    );
    let found = errors(&gate_and_buffer(true));
    assert_eq!(found[0].code, Code::MultipleDrivers);
    assert_eq!(
        found[0].message,
        "input l.in has more than one driver: only tri-state outputs may share a wire"
    );
    // Two ordinary outputs keep the message they had.
    let found = errors(&circuit(
        vec![part("g", "not"), part("h", "not")],
        &[("g.out", "h.out")],
    ));
    assert_eq!(found[0].message, "wire w0 connects two outputs");
    // A definition opened as a sheet has its pins as switches: one on a bus is an ordinary output.
    let found = errors(&circuit(
        vec![part("pin", "switch"), part("t", "tri"), part("l", "led")],
        &[("pin.out", "l.in"), ("t.out", "l.in")],
    ));
    assert_eq!(found[0].code, Code::MultipleDrivers);
}

/// A buffer as a component: pins `d` and `e` in, `y` out. `y` is a bus pin.
fn driver() -> Value {
    json!({
        "id": "drv",
        "components": [part("d", "switch"), part("e", "switch"), part("t", "tri"), part("y", "led")],
        "connections": wires(&[("d.out", "t.in"), ("e.out", "t.en"), ("t.out", "y.in")]),
        "inputs": [{ "name": "d", "component": "d" }, { "name": "e", "component": "e" }],
        "outputs": [{ "name": "y", "component": "y" }],
    })
}

/// Two `kind` instances `u1` and `u2`, each with switches on `d` and `e`, their `y` pins joined on LED `l`.
fn two_on_a_bus(kind: &str, definitions: Vec<Value>) -> CircuitDescription {
    let mut parts = vec![part("l", "led")];
    let mut list: Vec<(String, String)> = Vec::new();
    for u in ["u1", "u2"] {
        parts.extend([
            instance(u, kind),
            part(&format!("{u}d"), "switch"),
            part(&format!("{u}e"), "switch"),
        ]);
        list.extend([
            (format!("{u}d.out"), format!("{u}.d")),
            (format!("{u}e.out"), format!("{u}.e")),
            (format!("{u}.y"), "l.in".to_string()),
        ]);
    }
    let list: Vec<(&str, &str)> = list.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
    describe(
        json!({ "components": parts, "connections": wires(&list), "definitions": definitions }),
    )
}

#[test]
fn bus_pins_of_instances_share_a_wire_nested_ones_too() {
    // `outer` wraps a `drv`: its `y` is a bus pin because the instance's is.
    let outer = json!({
        "id": "outer",
        "components": [part("d", "switch"), part("e", "switch"), instance("inner", "drv"), part("y", "led")],
        "connections": wires(&[("d.out", "inner.d"), ("e.out", "inner.e"), ("inner.y", "y.in")]),
        "inputs": [{ "name": "d", "component": "d" }, { "name": "e", "component": "e" }],
        "outputs": [{ "name": "y", "component": "y" }],
    });
    for (kind, definitions) in [("drv", vec![driver()]), ("outer", vec![driver(), outer])] {
        let mut sim = load(&two_on_a_bus(kind, definitions));
        assert_eq!(bits(&sim, "l", "in"), Z, "{kind}");
        sim.set_inputs(&[("u1d", 1), ("u1e", 1)]).unwrap();
        assert_eq!(bits(&sim, "l", "in"), (1, 0), "{kind}");
        sim.set_input("u2e", 1).unwrap();
        assert_eq!(bits(&sim, "l", "in"), X, "{kind}: 1 against 0");
        // The instances report the bus as their pin's net.
        assert_eq!(sim.port_nets()["u1"]["y"], sim.port_nets()["l"]["in"]);
    }
}

#[test]
fn a_pin_that_is_not_a_bus_pin_cannot_share_a_wire() {
    let pins = json!([{ "name": "d", "component": "d" }, { "name": "e", "component": "e" }]);
    let out = json!([{ "name": "y", "component": "y" }]);
    // Driven inside by a gate.
    let gate = json!({
        "id": "gate",
        "components": [part("d", "switch"), part("e", "switch"), part("g", "and"), part("y", "led")],
        "connections": wires(&[("d.out", "g.a"), ("e.out", "g.b"), ("g.out", "y.in")]),
        "inputs": pins, "outputs": out,
    });
    // Wired straight through from an input pin: joined to a bus, the bus would drive back into `d`.
    let through = json!({
        "id": "through",
        "components": [part("d", "switch"), part("e", "switch"), part("y", "led")],
        "connections": wires(&[("d.out", "y.in")]),
        "inputs": pins, "outputs": out,
    });
    // The same through a label inside.
    let labelled = json!({
        "id": "labelled",
        "components": [part("d", "switch"), part("e", "switch"), part("y", "led")],
        "junctions": [{ "id": "j1", "name": "N" }, { "id": "j2", "name": "N" }],
        "connections": wires(&[("d.out", "j1"), ("j2", "y.in")]),
        "inputs": pins, "outputs": out,
    });
    // A buffer and a gate on the pin's net inside: an error in the definition itself.
    let mixed = json!({
        "id": "mixed",
        "components": [part("d", "switch"), part("e", "switch"), part("t", "tri"), part("g", "not"), part("y", "led")],
        "connections": wires(&[("d.out", "t.in"), ("e.out", "t.en"), ("t.out", "y.in"), ("g.out", "y.in")]),
        "inputs": pins, "outputs": out,
    });
    // Nothing drives the pin inside.
    let empty = json!({
        "id": "empty",
        "components": [part("d", "switch"), part("e", "switch"), part("y", "led")],
        "connections": [],
        "inputs": pins, "outputs": out,
    });
    for definition in [gate, through, labelled, mixed, empty] {
        let kind = definition["id"].as_str().unwrap().to_string();
        let found = errors(&two_on_a_bus(&kind, vec![definition]));
        assert!(
            found
                .iter()
                .any(|d| matches!(d.code, Code::MultipleDrivers | Code::OutputToOutput)),
            "{kind}: {found:?}"
        );
    }
    // One such pin beside a real buffer: the message says what may share.
    let mut one = two_on_a_bus("drv", vec![driver()]);
    one.components
        .push(serde_json::from_value(part("g", "not")).unwrap());
    one.connections.push(
        serde_json::from_value(json!({ "id": "extra", "from": end("g.out"), "to": end("l.in") }))
            .unwrap(),
    );
    let found = errors(&one);
    assert!(
        found[0]
            .message
            .ends_with("only tri-state outputs may share a wire"),
        "{found:?}"
    );
}

#[test]
fn a_buffer_cannot_drive_a_definitions_input_pin_from_inside() {
    let definition = json!({
        "id": "back",
        "components": [part("a", "switch"), part("t", "tri"), part("y", "led")],
        "connections": wires(&[("a.out", "y.in"), ("t.out", "y.in"), ("a.out", "t.in"), ("a.out", "t.en")]),
        "inputs": [{ "name": "a", "component": "a" }],
        "outputs": [{ "name": "y", "component": "y" }],
    });
    let found = errors(&describe(json!({
        "components": [instance("u", "back"), part("s", "switch"), part("l", "led")],
        "connections": wires(&[("s.out", "u.a"), ("u.y", "l.in")]),
        "definitions": [definition],
    })));
    assert_eq!(found[0].code, Code::MultipleDrivers);
    assert_eq!(found[0].ids, ["u"], "named by the instance");
}

#[test]
fn two_bus_pins_on_one_net_inside_join_the_buses_wired_to_them() {
    let two = json!({
        "id": "two",
        "components": [part("d", "switch"), part("e", "switch"), part("t", "tri"), part("y1", "led"), part("y2", "led")],
        "connections": wires(&[("d.out", "t.in"), ("e.out", "t.en"), ("t.out", "y1.in"), ("t.out", "y2.in")]),
        "inputs": [{ "name": "d", "component": "d" }, { "name": "e", "component": "e" }],
        "outputs": [{ "name": "y1", "component": "y1" }, { "name": "y2", "component": "y2" }],
    });
    let mut sim = load(&describe(json!({
        "components": [
            instance("u", "two"), part("ud", "switch"), part("ue", "switch"),
            part("a", "switch"), part("ea", "switch"), part("ta", "tri"), part("l1", "led"),
            part("tb", "tri"), part("eb", "switch"), part("b", "switch"), part("l2", "led"),
        ],
        "connections": wires(&[
            ("ud.out", "u.d"), ("ue.out", "u.e"),
            ("a.out", "ta.in"), ("ea.out", "ta.en"), ("u.y1", "l1.in"), ("ta.out", "l1.in"),
            ("b.out", "tb.in"), ("eb.out", "tb.en"), ("u.y2", "l2.in"), ("tb.out", "l2.in"),
        ]),
        "definitions": [two],
    })));
    assert_eq!(
        sim.port_nets()["l1"]["in"],
        sim.port_nets()["l2"]["in"],
        "one bus"
    );
    sim.set_inputs(&[("a", 1), ("ea", 1)]).unwrap();
    assert_eq!(
        bits(&sim, "l2", "in"),
        (1, 0),
        "driven from the other side of the component"
    );
}

#[test]
fn labels_join_two_groups_of_buffers_into_one_bus() {
    let mut description = shared_bus();
    // Cut the bus in two: ta on junction j1, tb and the LED on j2, both named BUS.
    description.connections.retain(|w| w.id != "w4");
    description.junctions = serde_json::from_value(json!([
        { "id": "j1", "name": "BUS" }, { "id": "j2", "name": "BUS" }
    ]))
    .unwrap();
    description.connections.extend(
        serde_json::from_value::<Vec<_>>(wires(&[("ta.out", "j1"), ("j2", "l.in")]))
            .unwrap()
            .into_iter()
            .enumerate()
            .map(|(i, mut w): (usize, sim_core::description::Connection)| {
                w.id = format!("label{i}");
                w
            }),
    );
    let mut sim = load(&description);
    sim.set_inputs(&[("a", 7), ("ea", 1)]).unwrap();
    assert_eq!(bits(&sim, "l", "in"), (7, 0));
    assert_eq!(sim.port_nets()["ta"]["out"], sim.port_nets()["tb"]["out"]);
}

#[test]
fn a_loop_through_a_bus_names_every_buffer_on_it() {
    // t1 drives the bus with the bus's own inverse; t2 drives it with a switch. `spare` unconnected switches
    // move the delta limit, and with it which of the loop's three primitives is changing when it comes.
    let looped = |spare: usize| {
        let mut parts = vec![
            part("e1", "switch"),
            part("t1", "tri"),
            part("d2", "switch"),
            part("e2", "switch"),
            part("t2", "tri"),
            part("n", "not"),
            part("l", "led"),
        ];
        parts.extend((0..spare).map(|i| part(&format!("spare{i}"), "switch")));
        circuit(
            parts,
            &[
                ("t1.out", "l.in"),
                ("t2.out", "l.in"),
                ("t1.out", "n.in"),
                ("n.out", "t1.in"),
                ("e1.out", "t1.en"),
                ("d2.out", "t2.in"),
                ("e2.out", "t2.en"),
            ],
        )
    };
    let mut sim = load(&looped(0));
    // Enabled over a floating bus, the loop never oscillates: it reads X from the start, and X is stable.
    // Nothing failed to settle, so nothing is reported.
    assert_eq!(sim.set_input("e1", 1), Ok(None));
    assert_eq!(bits(&sim, "l", "in"), X);

    // Handed a known bus, it oscillates between known values. One primitive of the ring changes each delta:
    // the NOT, the buffer, or the bus, and the bus is named by every buffer on it.
    let mut named = Vec::new();
    for spare in 0..3 {
        let mut sim = load(&looped(spare));
        assert_eq!(sim.set_input("e2", 1), Ok(None));
        assert_eq!(bits(&sim, "l", "in"), (0, 0));
        let report = sim
            .set_inputs(&[("e1", 1), ("e2", 0)])
            .unwrap()
            .expect("the loop");
        assert_eq!(report.code, Code::Unstable);
        named.push(report.ids);
        assert_eq!(bits(&sim, "l", "in"), X);
        // Back on the switch, everything is known again and the warning goes.
        assert_eq!(sim.set_inputs(&[("e1", 0), ("e2", 1)]), Ok(None));
        assert_eq!(bits(&sim, "l", "in"), (0, 0));
    }
    named.sort();
    assert_eq!(named, [vec!["n"], vec!["t1"], vec!["t1", "t2"]]);
}

#[test]
fn a_bus_changing_hands_floats_for_a_delta_which_a_latch_keeps_and_a_flip_flop_does_not_see() {
    // tb's enable arrives one delta after ta's is gone. q = OR(bus AND arm, q) latches whatever passes once
    // armed (a latch straight on a floating bus is X from the start); f samples the bus at a clock edge.
    let mut description = shared_bus();
    let extra = circuit(
        vec![
            part("late", "or"),
            wide("arm", "switch", 8),
            wide("gate", "and", 8),
            wide("q", "or", 8),
            part("c", "switch"),
            wide("f", "dff", 8),
        ],
        &[
            ("eb.out", "late.a"),
            ("eb.out", "late.b"),
            ("late.out", "tb.en"),
            ("ta.out", "gate.a"),
            ("arm.out", "gate.b"),
            ("gate.out", "q.a"),
            ("q.out", "q.b"),
            ("ta.out", "f.d"),
            ("c.out", "f.clk"),
        ],
    );
    description.connections.retain(|w| w.id != "w3");
    description.components.extend(extra.components);
    description
        .connections
        .extend(extra.connections.into_iter().map(|mut w| {
            w.id = format!("x{}", w.id);
            w
        }));
    let mut sim = load(&description);
    sim.set_input("ea", 1).unwrap();
    sim.set_input("arm", 0xFF).unwrap();
    assert_eq!(bits(&sim, "q", "out"), (0, 0));
    assert_eq!(sim.set_inputs(&[("ea", 0), ("eb", 1)]), Ok(None));
    assert_eq!(bits(&sim, "l", "in"), (0, 0), "settled on tb");
    assert_eq!(
        bits(&sim, "q", "out"),
        (0xFF, 0xFF),
        "the latch took the float as X, and holds it"
    );
    sim.set_input("c", 1).unwrap();
    assert_eq!(
        bits(&sim, "f", "q"),
        (0, 0),
        "the flip-flop samples the settled bus"
    );
}

#[test]
fn a_clock_that_floats_while_a_load_or_a_reset_settles_is_no_edge() {
    // The clock comes through a buffer. Settling from all-zero nets, the buffer is disabled for a delta, so
    // the clock reads unknown before it reads 1.
    let description = circuit(
        vec![
            part("k", "switch"),
            part("ek", "switch"),
            part("t", "tri"),
            part("d", "switch"),
            part("f", "dff"),
        ],
        &[
            ("k.out", "t.in"),
            ("ek.out", "t.en"),
            ("t.out", "f.clk"),
            ("d.out", "f.d"),
        ],
    );
    let mut sim = load(&description);
    sim.set_inputs(&[("ek", 1), ("d", 1)]).unwrap();
    sim.set_input("k", 1).unwrap();
    assert_eq!(bits(&sim, "f", "q"), (1, 0), "a certain edge");
    assert_eq!(sim.reset(), None);
    assert_eq!(bits(&sim, "t", "out"), (1, 0));
    assert_eq!(
        bits(&sim, "f", "q"),
        (0, 0),
        "reset, and not clocked by its own settle"
    );
    // The same after an edit that keeps state: the flip-flop keeps its value.
    sim.set_input("k", 0).unwrap();
    sim.set_input("k", 1).unwrap();
    let (kept, _) = Simulator::load_keeping(&description, &sim).expect("valid");
    assert_eq!(bits(&kept, "f", "q"), (1, 0));
    assert!(kept.unknown().iter().all(|&u| u == 0));
}

#[test]
fn a_challenge_counts_a_floating_or_unknown_output_as_a_mismatch() {
    let definition = json!({
        "id": "gate",
        "components": [part("d", "switch"), part("e", "switch"), part("t", "tri"), part("y", "led")],
        "connections": wires(&[("d.out", "t.in"), ("e.out", "t.en"), ("t.out", "y.in")]),
        "inputs": [{ "name": "d", "component": "d" }, { "name": "e", "component": "e" }],
        "outputs": [{ "name": "y", "component": "y" }],
    });
    let description =
        describe(json!({ "components": [], "connections": [], "definitions": [definition] }));
    let challenge: Challenge = serde_json::from_value(json!({
        "definition": "gate",
        "inputs": [{ "name": "d", "width": 1 }, { "name": "e", "width": 1 }],
        "outputs": [{ "name": "y", "width": 1 }],
        "steps": [
            { "set": { "d": 1, "e": 1 }, "expect": { "y": 1 } },
            { "set": { "e": 0 }, "expect": { "y": 0 } },
        ],
    }))
    .unwrap();
    match check(&description, &challenge) {
        Report::Failed {
            step, mismatches, ..
        } => {
            assert_eq!(step, 1);
            assert_eq!(
                mismatches,
                [Mismatch {
                    name: "y".into(),
                    expected: 0,
                    got: 0,
                    unknown: 1
                }]
            );
            // The unknown bits cross as their own field, left out when there are none.
            let text = serde_json::to_string(&mismatches).unwrap();
            assert_eq!(text, r#"[{"name":"y","expected":0,"got":0,"unknown":1}]"#);
        }
        other => panic!("expected a failed step, got {other:?}"),
    }
}
