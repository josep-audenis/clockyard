//! Multi-bit signals (ADR 0014): bitwise gates, splitters and mergers, width
//! errors and ranged switch values.

use serde_json::{Value, json};
use sim_core::{CircuitDescription, Code, Diagnostic, Simulator};

/// "a.out" → a port, "j" → a junction.
fn end(spec: &str) -> Value {
    match spec.split_once('.') {
        Some((component, port)) => json!({ "component": component, "port": port }),
        None => json!({ "junction": spec }),
    }
}

/// Wires as (from, to), with IDs w0, w1, ….
fn wires(list: &[(&str, &str)]) -> Value {
    let wires = list.iter().enumerate();
    Value::Array(
        wires
            .map(|(i, (from, to))| json!({ "id": format!("w{i}"), "from": end(from), "to": end(to) }))
            .collect(),
    )
}

fn circuit(components: Value, list: &[(&str, &str)]) -> CircuitDescription {
    description(json!({ "components": components, "connections": wires(list) }))
}

fn description(value: Value) -> CircuitDescription {
    serde_json::from_value(value).expect("description")
}

fn load(description: &CircuitDescription) -> Simulator {
    let (sim, warnings) = Simulator::load(description).expect("valid circuit");
    assert_eq!(warnings, vec![]);
    sim
}

fn value(sim: &Simulator, component: &str, port: &str) -> u32 {
    sim.nets()[sim.port_nets()[component][port] as usize]
}

fn errors(description: &CircuitDescription) -> Vec<Diagnostic> {
    Simulator::load(description).expect_err("invalid circuit")
}

/// Deterministic sample values: the edges, then a xorshift sequence.
fn samples(mask: u32) -> Vec<u32> {
    let mut x = 0x9E37_79B9u32;
    let mut values = vec![0, mask, 1 & mask, mask >> 1];
    for _ in 0..64 {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        values.push(x & mask);
    }
    values
}

#[test]
fn gates_are_bitwise_at_any_width() {
    type Op = fn(u32, u32) -> u32;
    let gates: [(&str, Op); 7] = [
        ("and", |a, b| a & b),
        ("nand", |a, b| !(a & b)),
        ("or", |a, b| a | b),
        ("nor", |a, b| !(a | b)),
        ("xor", |a, b| a ^ b),
        ("xnor", |a, b| !(a ^ b)),
        ("not", |a, _| !a),
    ];
    for width in [1, 8, 32] {
        let mask = u32::MAX >> (32 - width);
        for (kind, op) in gates {
            let parts = json!([
                { "id": "a", "kind": "switch", "width": width },
                { "id": "b", "kind": "switch", "width": width },
                { "id": "g", "kind": kind, "width": width },
                { "id": "l", "kind": "led", "width": width },
            ]);
            let mut list = vec![("a.out", "g.a"), ("b.out", "g.b"), ("g.out", "l.in")];
            if kind == "not" {
                list = vec![("a.out", "g.in"), ("g.out", "l.in")];
            }
            let (mut sim, _) = Simulator::load(&circuit(parts, &list)).unwrap();
            let pairs = samples(mask)
                .into_iter()
                .zip(samples(mask).into_iter().rev());
            for (a, b) in pairs {
                sim.set_input("a", a).unwrap();
                sim.set_input("b", b).unwrap();
                let expected = op(a, b) & mask;
                assert_eq!(value(&sim, "l", "in"), expected, "{kind}/{width} {a} {b}");
            }
        }
    }
}

#[test]
fn not_of_zero_sets_only_the_width() {
    for (width, expected) in [(4, 15), (32, u32::MAX)] {
        let parts = json!([
            { "id": "s", "kind": "switch", "width": width },
            { "id": "n", "kind": "not", "width": width },
        ]);
        let sim = load(&circuit(parts, &[("s.out", "n.in")]));
        assert_eq!(value(&sim, "n", "out"), expected, "width {width}");
    }
}

#[test]
fn merge_of_split_gives_the_value_back() {
    for fields in [vec![3, 5], vec![1; 8], vec![32]] {
        let total: u32 = fields.iter().sum();
        let parts = json!([
            { "id": "s", "kind": "switch", "width": total },
            { "id": "sp", "kind": "split", "fields": fields },
            { "id": "m", "kind": "merge", "fields": fields },
            { "id": "l", "kind": "led", "width": total },
        ]);
        let names: Vec<String> = (0..fields.len()).map(|i| format!("f{i}")).collect();
        let field_wires: Vec<(String, String)> = names
            .iter()
            .map(|f| (format!("sp.{f}"), format!("m.{f}")))
            .collect();
        let mut list = vec![("s.out", "sp.in"), ("m.out", "l.in")];
        list.extend(field_wires.iter().map(|(a, b)| (a.as_str(), b.as_str())));
        let mut sim = load(&circuit(parts, &list));
        for x in samples(u32::MAX >> (32 - total)) {
            sim.set_input("s", x).unwrap();
            assert_eq!(value(&sim, "l", "in"), x, "{fields:?} {x}");
            if fields == [3, 5] {
                // f0 holds the lowest bits.
                assert_eq!(value(&sim, "sp", "f0"), x & 7);
                assert_eq!(value(&sim, "sp", "f1"), x >> 3);
            }
        }
    }
}

/// Each diagnostic as (code, IDs).
fn found(diagnostics: &[Diagnostic]) -> Vec<(Code, Vec<&str>)> {
    diagnostics
        .iter()
        .map(|d| (d.code, d.ids.iter().map(String::as_str).collect()))
        .collect()
}

#[test]
fn ports_of_different_widths_on_one_net_are_reported() {
    let parts = json!([
        { "id": "s", "kind": "switch", "width": 8 },
        { "id": "l", "kind": "led" },
    ]);
    let direct = errors(&circuit(parts.clone(), &[("s.out", "l.in")]));
    // Ports are named in part ID order, whichever way the wire was drawn.
    assert_eq!(
        found(&direct),
        [(Code::WidthMismatch, vec!["w0", "l", "s"])]
    );
    assert_eq!(
        direct[0].message,
        "wire w0 connects ports of different widths: `l.in` is 1 bit, `s.out` is 8 bits"
    );

    let through = errors(&description(json!({
        "components": parts,
        "junctions": [{ "id": "j" }],
        "connections": wires(&[("s.out", "j"), ("j", "l.in")]),
    })));
    assert_eq!(
        found(&through),
        [(Code::WidthMismatch, vec!["w0", "w1", "l", "s"])]
    );
}

/// A definition passing an 8-bit input straight to an 8-bit output.
fn wide_buffer(id: &str, out_width: u32) -> Value {
    json!({
        "id": id,
        "components": [
            { "id": "a", "kind": "switch", "width": 8 },
            { "id": "y", "kind": "led", "width": out_width },
        ],
        "connections": wires(&[("a.out", "y.in")]),
        "inputs": [{ "name": "a", "component": "a" }],
        "outputs": [{ "name": "y", "component": "y" }],
    })
}

#[test]
fn an_instance_port_has_its_pin_width() {
    // Checked on the level before flattening; ports named in part ID order either way the wire runs.
    for wire in [("t.out", "i.a"), ("i.a", "t.out")] {
        let wrong = errors(&description(json!({
            "components": [
                { "id": "t", "kind": "switch" },
                { "id": "i", "kind": "custom", "definition": "buf" },
            ],
            "connections": wires(&[wire]),
            "definitions": [wide_buffer("buf", 8)],
        })));
        assert_eq!(found(&wrong), [(Code::WidthMismatch, vec!["w0", "i", "t"])]);
        assert!(
            wrong[0]
                .message
                .contains("`i.a` is 8 bits, `t.out` is 1 bit"),
            "{}",
            wrong[0].message
        );
    }

    // The same port wired to an 8-bit switch carries its value through.
    let mut sim = load(&description(json!({
        "components": [
            { "id": "t", "kind": "switch", "width": 8 },
            { "id": "i", "kind": "custom", "definition": "buf" },
            { "id": "l", "kind": "led", "width": 8 },
        ],
        "connections": wires(&[("t.out", "i.a"), ("i.y", "l.in")]),
        "definitions": [wide_buffer("buf", 8)],
    })));
    sim.set_input("t", 200).unwrap();
    assert_eq!(value(&sim, "l", "in"), 200);
}

#[test]
fn a_mismatch_inside_a_definition_is_reported_once_by_its_first_instance() {
    let errors = errors(&description(json!({
        "components": [
            { "id": "i1", "kind": "custom", "definition": "bad" },
            { "id": "i2", "kind": "custom", "definition": "bad" },
        ],
        "connections": [],
        "definitions": [wide_buffer("bad", 1)],
    })));
    assert_eq!(found(&errors), [(Code::WidthMismatch, vec!["i1"])]);
    assert!(
        errors[0]
            .message
            .contains("`i1/a.out` is 8 bits, `i1/y.in` is 1 bit"),
        "{}",
        errors[0].message
    );
}

#[test]
fn bad_widths_and_fields_are_reported() {
    let cases = [
        json!({ "id": "x", "kind": "and", "width": 0 }),
        json!({ "id": "x", "kind": "and", "width": 33 }),
        json!({ "id": "x", "kind": "and", "width": 2.5 }),
        json!({ "id": "x", "kind": "led", "width": -1 }),
        json!({ "id": "x", "kind": "split", "width": 8, "fields": [4, 4] }),
        json!({ "id": "x", "kind": "split" }),
        json!({ "id": "x", "kind": "merge", "fields": [] }),
        json!({ "id": "x", "kind": "merge", "fields": [16, 17] }),
        json!({ "id": "x", "kind": "merge", "fields": vec![1; 33] }),
        json!({ "id": "x", "kind": "split", "fields": [4, 0.5] }),
        json!({ "id": "x", "kind": "and", "fields": [1] }),
        json!({ "id": "x", "kind": "custom", "definition": "d", "width": 8 }),
    ];
    for part in cases {
        let errors = errors(&circuit(json!([part]), &[]));
        assert_eq!(
            found(&errors),
            [(Code::InvalidWidth, vec!["x"])],
            "{part}: {errors:?}"
        );
    }
    // Checked in a definition nothing uses too: its pins would type instance ports.
    let unused = errors(&description(json!({
        "components": [],
        "connections": [],
        "definitions": [{
            "id": "d",
            "components": [{ "id": "g", "kind": "not", "width": 33 }],
            "connections": [],
            "inputs": [],
            "outputs": [],
        }],
    })));
    assert_eq!(found(&unused), [(Code::InvalidWidth, vec!["d"])]);
    assert!(unused[0].message.starts_with("definition d: g: width 33"));
}

#[test]
fn an_unconnected_bus_input_reads_zero_and_warns_once() {
    let parts = json!([
        { "id": "n", "kind": "not", "width": 8 },
        { "id": "sp", "kind": "split", "fields": [1, 1, 1, 1] },
    ]);
    let (sim, warnings) = Simulator::load(&circuit(parts, &[])).unwrap();
    assert_eq!(value(&sim, "n", "out"), 255);
    assert_eq!(
        found(&warnings),
        [
            (Code::UnconnectedInput, vec!["n"]),
            (Code::UnconnectedInput, vec!["sp"])
        ]
    );
}

#[test]
fn every_wire_reports_its_net_width() {
    // s ─ n (8 bits, driven); n.out ─ j (undriven ground, still a bus); k ─ m (junctions only: 1 bit).
    let sim = Simulator::load(&description(json!({
        "components": [
            { "id": "s", "kind": "switch", "width": 8 },
            { "id": "n", "kind": "not", "width": 8 },
            { "id": "g", "kind": "and", "width": 8 },
        ],
        "junctions": [{ "id": "j" }, { "id": "k" }, { "id": "m" }],
        "connections": wires(&[("s.out", "n.in"), ("g.a", "j"), ("k", "m")]),
    })))
    .unwrap()
    .0;
    let widths: Vec<u32> = ["w0", "w1", "w2"]
        .iter()
        .map(|w| sim.wire_widths()[*w])
        .collect();
    assert_eq!(widths, [8, 8, 1]);
    assert_eq!(sim.wire_nets()["w1"], 0, "the undriven bus shares ground");
}

#[test]
fn a_bus_loop_is_reported_unstable_naming_the_part_once() {
    let parts = json!([{ "id": "n", "kind": "not", "width": 8 }]);
    let (_, warnings) = Simulator::load(&circuit(parts, &[("n.out", "n.in")])).unwrap();
    assert_eq!(found(&warnings), [(Code::Unstable, vec!["n"])]);

    // A loop through a split and a merge: every field changes at once, one part named each.
    let parts = json!([
        { "id": "n", "kind": "not", "width": 2 },
        { "id": "sp", "kind": "split", "fields": [1, 1] },
        { "id": "m", "kind": "merge", "fields": [1, 1] },
    ]);
    let list = [
        ("n.out", "sp.in"),
        ("sp.f0", "m.f0"),
        ("sp.f1", "m.f1"),
        ("m.out", "n.in"),
    ];
    let (_, warnings) = Simulator::load(&circuit(parts, &list)).unwrap();
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].code, Code::Unstable);
    let mut once = warnings[0].ids.clone();
    once.dedup();
    assert_eq!(once, warnings[0].ids, "no part named twice");
}

#[test]
fn a_switch_refuses_values_wider_than_itself() {
    let parts = json!([
        { "id": "one", "kind": "switch" },
        { "id": "byte", "kind": "switch", "width": 8 },
        { "id": "word", "kind": "switch", "width": 32 },
    ]);
    let mut sim = load(&circuit(parts, &[]));
    assert_eq!(sim.set_input("one", 1), Ok(None));
    assert_eq!(
        sim.set_input("one", 2),
        Err("one is 1 bit wide, so 2 does not fit".to_string())
    );
    assert_eq!(sim.set_input("byte", 255), Ok(None));
    assert!(sim.set_input("byte", 256).is_err());
    assert_eq!(
        value(&sim, "byte", "out"),
        255,
        "a refused value changes nothing"
    );
    assert_eq!(sim.set_input("word", u32::MAX), Ok(None));
    assert_eq!(value(&sim, "word", "out"), u32::MAX);
}
