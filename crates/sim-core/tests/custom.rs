//! Custom components (ADR 0012): elaboration, instance separation, nesting and errors.

use serde_json::{Value, json};
use sim_core::{CircuitDescription, Code, Simulator};

/// "a.out" → a port, "j" → a junction.
fn end(spec: &str) -> Value {
    match spec.split_once('.') {
        Some((component, port)) => json!({ "component": component, "port": port }),
        None => json!({ "junction": spec }),
    }
}

/// Wires as (id, from, to).
fn wires(list: &[(&str, &str, &str)]) -> Value {
    Value::Array(
        list.iter()
            .map(|(id, from, to)| json!({ "id": id, "from": end(from), "to": end(to) }))
            .collect(),
    )
}

/// A full adder: inputs A, B, Cin; outputs S, Cout.
fn full_adder() -> Value {
    json!({
        "id": "fa",
        "components": [
            { "id": "a", "kind": "switch" }, { "id": "b", "kind": "switch" }, { "id": "c", "kind": "switch" },
            { "id": "x1", "kind": "xor" }, { "id": "x2", "kind": "xor" },
            { "id": "n1", "kind": "and" }, { "id": "n2", "kind": "and" }, { "id": "o", "kind": "or" },
            { "id": "s", "kind": "led" }, { "id": "co", "kind": "led" }
        ],
        "connections": wires(&[
            ("w1", "a.out", "x1.a"), ("w2", "b.out", "x1.b"), ("w3", "x1.out", "x2.a"), ("w4", "c.out", "x2.b"),
            ("w5", "x2.out", "s.in"), ("w6", "a.out", "n1.a"), ("w7", "b.out", "n1.b"), ("w8", "x1.out", "n2.a"),
            ("w9", "c.out", "n2.b"), ("w10", "n1.out", "o.a"), ("w11", "n2.out", "o.b"), ("w12", "o.out", "co.in"),
        ]),
        "inputs": [{ "name": "A", "component": "a" }, { "name": "B", "component": "b" }, { "name": "Cin", "component": "c" }],
        "outputs": [{ "name": "S", "component": "s" }, { "name": "Cout", "component": "co" }]
    })
}

fn description(value: Value) -> CircuitDescription {
    serde_json::from_value(value).expect("description")
}

fn value(sim: &Simulator, component: &str, port: &str) -> u32 {
    sim.nets()[sim.port_nets()[component][port] as usize]
}

/// Top level: switches for A, B, Cin feeding one instance, LEDs on S and Cout.
fn one_adder(instance: &str) -> Vec<(String, String, String)> {
    let p = instance;
    vec![
        (format!("{p}-wa"), format!("{p}a.out"), format!("{p}.A")),
        (format!("{p}-wb"), format!("{p}b.out"), format!("{p}.B")),
        (format!("{p}-wc"), format!("{p}c.out"), format!("{p}.Cin")),
        (format!("{p}-ws"), format!("{p}.S"), format!("{p}s.in")),
        (format!("{p}-wo"), format!("{p}.Cout"), format!("{p}co.in")),
    ]
}

#[test]
fn a_full_adder_instance_adds_and_two_instances_keep_separate_state() {
    let mut components = Vec::new();
    let mut list = Vec::new();
    for p in ["f", "g"] {
        components.push(json!({ "id": p, "kind": "custom", "definition": "fa" }));
        for (suffix, kind) in [
            ("a", "switch"),
            ("b", "switch"),
            ("c", "switch"),
            ("s", "led"),
            ("co", "led"),
        ] {
            components.push(json!({ "id": format!("{p}{suffix}"), "kind": kind }));
        }
        list.extend(one_adder(p));
    }
    let list: Vec<(&str, &str, &str)> = list
        .iter()
        .map(|(a, b, c)| (a.as_str(), b.as_str(), c.as_str()))
        .collect();
    let (mut sim, warnings) = Simulator::load(&description(json!({
        "components": components, "connections": wires(&list), "definitions": [full_adder()]
    })))
    .expect("valid");
    assert_eq!(warnings, vec![]);
    for (a, b, c) in [(0, 0, 0), (1, 0, 0), (1, 1, 0), (1, 1, 1), (0, 1, 1)] {
        sim.set_input("fa", a).unwrap();
        sim.set_input("fb", b).unwrap();
        sim.set_input("fc", c).unwrap();
        let total = a + b + c;
        assert_eq!(value(&sim, "fs", "in"), total & 1, "S of {a}+{b}+{c}");
        assert_eq!(value(&sim, "fco", "in"), total >> 1, "Cout of {a}+{b}+{c}");
        // The other instance's inputs are all 0: its outputs stay 0.
        assert_eq!((value(&sim, "gs", "in"), value(&sim, "gco", "in")), (0, 0));
    }
}

#[test]
fn definitions_nest_and_an_unconnected_instance_input_reads_zero() {
    // "add2": two full adders chained by carry; its pins A0 B0 A1 B1 → S0 S1 C.
    let add2 = json!({
        "id": "add2",
        "components": [
            { "id": "a0", "kind": "switch" }, { "id": "b0", "kind": "switch" },
            { "id": "a1", "kind": "switch" }, { "id": "b1", "kind": "switch" },
            { "id": "lo", "kind": "custom", "definition": "fa" }, { "id": "hi", "kind": "custom", "definition": "fa" },
            { "id": "s0", "kind": "led" }, { "id": "s1", "kind": "led" }, { "id": "c", "kind": "led" }
        ],
        "connections": wires(&[
            ("1", "a0.out", "lo.A"), ("2", "b0.out", "lo.B"), ("3", "lo.S", "s0.in"), ("4", "lo.Cout", "hi.Cin"),
            ("5", "a1.out", "hi.A"), ("6", "b1.out", "hi.B"), ("7", "hi.S", "s1.in"), ("8", "hi.Cout", "c.in"),
        ]),
        "inputs": [
            { "name": "A0", "component": "a0" }, { "name": "B0", "component": "b0" },
            { "name": "A1", "component": "a1" }, { "name": "B1", "component": "b1" }
        ],
        "outputs": [{ "name": "S0", "component": "s0" }, { "name": "S1", "component": "s1" }, { "name": "C", "component": "c" }]
    });
    let mut components = vec![json!({ "id": "x", "kind": "custom", "definition": "add2" })];
    let mut list = Vec::new();
    for pin in ["A0", "B0", "A1", "B1"] {
        components.push(json!({ "id": pin, "kind": "switch" }));
        list.push((format!("w{pin}"), format!("{pin}.out"), format!("x.{pin}")));
    }
    for pin in ["S0", "S1", "C"] {
        components.push(json!({ "id": pin, "kind": "led" }));
        list.push((format!("w{pin}"), format!("x.{pin}"), format!("{pin}.in")));
    }
    let list: Vec<(&str, &str, &str)> = list
        .iter()
        .map(|(a, b, c)| (a.as_str(), b.as_str(), c.as_str()))
        .collect();
    let (mut sim, warnings) = Simulator::load(&description(json!({
        "components": components, "connections": wires(&list), "definitions": [full_adder(), add2]
    })))
    .expect("valid");
    // The low adder's carry-in pin is not wired inside add2: reads 0, and is reported as the top-level instance.
    assert!(
        warnings
            .iter()
            .all(|d| d.code == Code::UnconnectedInput && d.ids == vec!["x".to_string()])
    );
    assert!(!warnings.is_empty());
    for a in 0..4u32 {
        for b in 0..4u32 {
            sim.set_input("A0", a & 1).unwrap();
            sim.set_input("A1", a >> 1).unwrap();
            sim.set_input("B0", b & 1).unwrap();
            sim.set_input("B1", b >> 1).unwrap();
            let sum =
                value(&sim, "S0", "in") + 2 * value(&sim, "S1", "in") + 4 * value(&sim, "C", "in");
            assert_eq!(sum, a + b, "{a}+{b}");
        }
    }
}

fn codes(value: Value) -> Vec<(Code, Vec<String>)> {
    match Simulator::load(&description(value)) {
        Ok(_) => vec![],
        Err(errors) => errors.into_iter().map(|d| (d.code, d.ids)).collect(),
    }
}

#[test]
fn missing_recursive_and_badly_pinned_definitions_are_errors() {
    let ids = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    assert_eq!(
        codes(
            json!({ "components": [{ "id": "x", "kind": "custom", "definition": "nope" }], "connections": [] })
        ),
        vec![(Code::UnknownDefinition, ids(&["x"]))]
    );
    // "loop" contains an instance of itself, through "other".
    let looping = json!({
        "components": [{ "id": "x", "kind": "custom", "definition": "loop" }],
        "connections": [],
        "definitions": [
            { "id": "loop", "components": [{ "id": "i", "kind": "custom", "definition": "other" }], "connections": [], "inputs": [], "outputs": [] },
            { "id": "other", "components": [{ "id": "j", "kind": "custom", "definition": "loop" }], "connections": [], "inputs": [], "outputs": [] }
        ]
    });
    assert_eq!(
        codes(looping),
        vec![(Code::RecursiveDefinition, ids(&["x"]))]
    );
    // Two pins on one part would join two outside wires through one switch.
    let mut shared = full_adder();
    shared["inputs"][1]["component"] = json!("a");
    assert_eq!(
        codes(json!({
            "components": [{ "id": "x", "kind": "custom", "definition": "fa" }],
            "connections": [],
            "definitions": [shared]
        })),
        vec![(Code::InvalidPin, ids(&["x"]))]
    );
    let mut bad = full_adder();
    bad["inputs"][1]["name"] = json!("A"); // two pins named A
    bad["outputs"][0]["component"] = json!("x1"); // an XOR is not an LED
    // Pins are checked only where the definition is used, and reported against the instance.
    assert_eq!(
        codes(json!({ "components": [], "connections": [], "definitions": [bad.clone()] })),
        vec![]
    );
    assert_eq!(
        codes(json!({
            "components": [{ "id": "x", "kind": "custom", "definition": "fa" }, { "id": "y", "kind": "custom", "definition": "fa" }],
            "connections": [],
            "definitions": [bad]
        })),
        vec![
            (Code::InvalidPin, ids(&["x"])),
            (Code::InvalidPin, ids(&["x"]))
        ]
    );
    let wrong_port = json!({
        "components": [{ "id": "x", "kind": "custom", "definition": "fa" }, { "id": "l", "kind": "led" }],
        "connections": wires(&[("w", "x.Nope", "l.in")]),
        "definitions": [full_adder()]
    });
    assert_eq!(codes(wrong_port), vec![(Code::UnknownPort, ids(&["w"]))]);
}

#[test]
fn errors_inside_an_instance_name_the_instance() {
    // Inside "bad", two outputs drive one LED pin, as its own sheet would say: reported against instance "x".
    let bad = json!({
        "id": "bad",
        "components": [{ "id": "n1", "kind": "not" }, { "id": "n2", "kind": "not" }, { "id": "o", "kind": "led" }],
        "connections": wires(&[("1", "n1.out", "o.in"), ("2", "n2.out", "o.in")]),
        "inputs": [],
        "outputs": [{ "name": "O", "component": "o" }]
    });
    let found = codes(json!({
        "components": [{ "id": "x", "kind": "custom", "definition": "bad" }], "connections": [], "definitions": [bad]
    }));
    assert_eq!(found, vec![(Code::MultipleDrivers, vec!["x".to_string()])]);
}

#[test]
fn a_small_file_cannot_expand_without_bound() {
    // d0 holds one junction; each d(k) holds two instances of d(k-1): 2^40 junctions from 41 definitions.
    let mut definitions = vec![json!({
        "id": "d0", "components": [], "junctions": [{ "id": "j" }], "connections": [], "inputs": [], "outputs": []
    })];
    for k in 1..=40 {
        let inner = format!("d{}", k - 1);
        definitions.push(json!({
            "id": format!("d{k}"),
            "components": [
                { "id": "a", "kind": "custom", "definition": inner },
                { "id": "b", "kind": "custom", "definition": inner }
            ],
            "connections": [], "inputs": [], "outputs": []
        }));
    }
    let found = codes(json!({
        "components": [{ "id": "top", "kind": "custom", "definition": "d40" }],
        "connections": [],
        "definitions": definitions
    }));
    assert_eq!(found, vec![(Code::TooLarge, vec!["top".to_string()])]);
}

#[test]
fn an_undriven_instance_input_joined_to_other_inputs_is_still_an_error() {
    let ids = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let found = |connections: Value| {
        codes(json!({
            "components": [
                { "id": "x", "kind": "custom", "definition": "fa" },
                { "id": "y", "kind": "custom", "definition": "fa" },
                { "id": "g", "kind": "and" }
            ],
            "connections": connections,
            "definitions": [full_adder()]
        }))
    };
    // Left alone outside, each input reads 0 inside (fan-out inside is fine).
    assert_eq!(found(json!([])), vec![]);
    // Joined to a gate's input, or to another instance's input, nothing drives either: an error.
    assert_eq!(
        found(wires(&[("w", "x.A", "g.a")])),
        vec![(Code::InputToInput, ids(&["w"]))]
    );
    assert_eq!(
        found(wires(&[("w", "x.A", "y.B")])),
        vec![(Code::InputToInput, ids(&["w"]))]
    );
    // Two inputs of one instance joined with nothing driving them, likewise.
    assert_eq!(
        found(wires(&[("w", "x.A", "x.B")])),
        vec![(Code::InputToInput, ids(&["w"]))]
    );
    // Even when nothing inside reads those inputs.
    let unused = json!({
        "id": "u",
        "components": [{ "id": "p", "kind": "switch" }],
        "connections": [],
        "inputs": [{ "name": "p", "component": "p" }],
        "outputs": []
    });
    let joined = |connections: Value| {
        codes(json!({
            "components": [
                { "id": "x", "kind": "custom", "definition": "u" },
                { "id": "y", "kind": "custom", "definition": "u" },
                { "id": "g", "kind": "and" }
            ],
            "connections": connections,
            "definitions": [unused.clone()]
        }))
    };
    assert_eq!(
        joined(wires(&[("w", "x.p", "y.p")])),
        vec![(Code::InputToInput, ids(&["w"]))]
    );
    assert_eq!(
        joined(wires(&[("w", "x.p", "g.a")])),
        vec![(Code::InputToInput, ids(&["w"]))]
    );
    // Left alone, unused inputs are fine.
    assert_eq!(joined(json!([])), vec![]);
    // Inside a definition, output pins read: two shorted with nothing driving them, likewise an error.
    let shorted = json!({
        "id": "s",
        "components": [{ "id": "o1", "kind": "led" }, { "id": "o2", "kind": "led" }],
        "connections": wires(&[("w", "o1.in", "o2.in")]),
        "inputs": [],
        "outputs": [{ "name": "o1", "component": "o1" }, { "name": "o2", "component": "o2" }]
    });
    assert_eq!(
        codes(json!({
            "components": [{ "id": "x", "kind": "custom", "definition": "s" }],
            "connections": [],
            "definitions": [shorted]
        })),
        vec![(Code::InputToInput, ids(&["x"]))]
    );
}

#[test]
fn an_unconnected_pin_passed_through_or_an_undriven_output_reads_zero() {
    // "pt": input pin a feeds gate g and goes straight out as output pin o; output pin z is driven by nothing.
    let pt = json!({
        "id": "pt",
        "components": [
            { "id": "a", "kind": "switch" }, { "id": "g", "kind": "not" },
            { "id": "o", "kind": "led" }, { "id": "z", "kind": "led" }
        ],
        "connections": wires(&[("1", "a.out", "g.in"), ("2", "a.out", "o.in")]),
        "inputs": [{ "name": "a", "component": "a" }],
        "outputs": [{ "name": "o", "component": "o" }, { "name": "z", "component": "z" }]
    });
    let sim = Simulator::load(&description(json!({
        "components": [
            { "id": "x", "kind": "custom", "definition": "pt" },
            { "id": "h", "kind": "not" }, { "id": "h1", "kind": "not" }, { "id": "h2", "kind": "not" }
        ],
        // x.a left unconnected; its pass-through read by h; the undriven z fanned out to two readers.
        "connections": wires(&[("w", "x.o", "h.in"), ("v1", "x.z", "h1.in"), ("v2", "x.z", "h2.in")]),
        "definitions": [pt]
    })))
    .expect("loads");
    for reader in ["h", "h1", "h2"] {
        assert_eq!(value(&sim.0, reader, "out"), 1, "{reader} reads 0");
    }
}

#[test]
fn the_engine_enforces_id_rules_and_pin_ports() {
    let ids = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    // "/" separates instance paths, at the top level and inside definitions alike.
    assert_eq!(
        codes(json!({ "components": [{ "id": "a/b", "kind": "not" }], "connections": [] })),
        vec![(Code::InvalidId, ids(&["a/b"]))]
    );
    let mut slashed = full_adder();
    slashed["connections"][0]["id"] = json!("w/1");
    assert_eq!(
        codes(json!({ "components": [], "connections": [], "definitions": [slashed] })),
        vec![(Code::InvalidId, ids(&["fa"]))]
    );
    // Two instances with one ID, even of a definition with nothing in it.
    let empty =
        json!({ "id": "e", "components": [], "connections": [], "inputs": [], "outputs": [] });
    assert_eq!(
        codes(json!({
            "components": [{ "id": "x", "kind": "custom", "definition": "e" }, { "id": "x", "kind": "custom", "definition": "e" }],
            "connections": [],
            "definitions": [empty]
        })),
        vec![(Code::DuplicateId, ids(&["x"]))]
    );
    // Inside a definition, a wire to a pin must use the pin part's own port.
    let mut wrong = full_adder();
    wrong["connections"][0]["from"] = json!({ "component": "a", "port": "in" });
    assert_eq!(
        codes(json!({
            "components": [{ "id": "x", "kind": "custom", "definition": "fa" }],
            "connections": [],
            "definitions": [wrong]
        })),
        vec![(Code::UnknownPort, ids(&["x"]))]
    );
}

#[test]
fn pins_that_drive_one_wire_are_outputs_joined() {
    let ids = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    // "si": its two input pins shorted inside; "u": one output pin driven by nothing inside.
    let si = json!({
        "id": "si",
        "components": [{ "id": "a", "kind": "switch" }, { "id": "b", "kind": "switch" }, { "id": "g", "kind": "and" }],
        "connections": wires(&[("short", "a.out", "b.out"), ("r", "b.out", "g.a")]),
        "inputs": [{ "name": "a", "component": "a" }, { "name": "b", "component": "b" }],
        "outputs": []
    });
    let u = json!({
        "id": "u", "components": [{ "id": "o", "kind": "led" }], "connections": [],
        "inputs": [], "outputs": [{ "name": "o", "component": "o" }]
    });
    let load = |components: Value, connections: Value| {
        codes(
            json!({ "components": components, "connections": connections, "definitions": [si.clone(), u.clone()] }),
        )
    };
    // Shorted inside: an error on the instance, whether or not anything drives it outside.
    let x = json!([{ "id": "x", "kind": "custom", "definition": "si" }, { "id": "s", "kind": "switch" }]);
    assert_eq!(
        load(x.clone(), json!([])),
        vec![(Code::MultipleDrivers, ids(&["x"]))]
    );
    assert_eq!(
        load(x, wires(&[("w", "s.out", "x.a")])),
        vec![(Code::MultipleDrivers, ids(&["x"]))]
    );
    // Two instance outputs joined outside, undriven inside or not.
    let two = json!([
        { "id": "p", "kind": "custom", "definition": "u" },
        { "id": "q", "kind": "custom", "definition": "u" },
        { "id": "h", "kind": "not" }
    ]);
    assert_eq!(
        load(two.clone(), wires(&[("w", "p.o", "q.o")])),
        vec![(Code::OutputToOutput, ids(&["w"]))]
    );
    assert_eq!(
        load(two, wires(&[("w", "p.o", "q.o"), ("v", "q.o", "h.in")])),
        vec![(Code::MultipleDrivers, ids(&["v", "w"]))]
    );
}

#[test]
fn net_drivers_name_the_top_level_part_and_an_instance_for_a_gate_inside_it() {
    let mut components = vec![json!({ "id": "f", "kind": "custom", "definition": "fa" })];
    for (id, kind) in [
        ("fa", "switch"),
        ("fb", "switch"),
        ("fc", "switch"),
        ("fs", "led"),
        ("fco", "led"),
    ] {
        components.push(json!({ "id": id, "kind": kind }));
    }
    let list = one_adder("f");
    let list: Vec<(&str, &str, &str)> = list
        .iter()
        .map(|(a, b, c)| (a.as_str(), b.as_str(), c.as_str()))
        .collect();
    let (sim, _) = Simulator::load(&description(json!({
        "components": components, "connections": wires(&list), "definitions": [full_adder()]
    })))
    .expect("valid");
    let drivers = sim.net_drivers();
    let driver = |wire: &str| drivers[sim.wire_nets()[wire] as usize];
    assert_eq!(drivers.len(), sim.nets().len());
    assert_eq!(drivers[0], None);
    assert_eq!(driver("f-wa"), Some("fa"));
    assert_eq!(driver("f-ws"), Some("f"));
    assert_eq!(driver("f-wo"), Some("f"));
}
