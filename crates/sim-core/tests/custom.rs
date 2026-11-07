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

fn value(sim: &Simulator, component: &str, port: &str) -> u8 {
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
        sim.set_input("fa", a == 1).unwrap();
        sim.set_input("fb", b == 1).unwrap();
        sim.set_input("fc", c == 1).unwrap();
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
    for a in 0..4u8 {
        for b in 0..4u8 {
            sim.set_input("A0", a & 1 == 1).unwrap();
            sim.set_input("A1", a >> 1 == 1).unwrap();
            sim.set_input("B0", b & 1 == 1).unwrap();
            sim.set_input("B1", b >> 1 == 1).unwrap();
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
    // Inside "bad", two outputs drive one LED pin: reported against the top-level instance "x".
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
    assert_eq!(found, vec![(Code::OutputToOutput, vec!["x".to_string()])]);
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
