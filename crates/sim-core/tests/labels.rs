//! Net labels (ADR 0015): same-named junctions on one sheet are one net.

use serde_json::{Value, json};
use sim_core::{CircuitDescription, Code, Diagnostic, Simulator};

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

fn description(value: Value) -> CircuitDescription {
    serde_json::from_value(value).expect("description")
}

fn value(sim: &Simulator, component: &str, port: &str) -> u32 {
    sim.nets()[sim.port_nets()[component][port] as usize]
}

/// Each diagnostic as (code, IDs).
fn found(diagnostics: &[Diagnostic]) -> Vec<(Code, Vec<&str>)> {
    diagnostics
        .iter()
        .map(|d| (d.code, d.ids.iter().map(String::as_str).collect()))
        .collect()
}

/// A switch wired to label `from`, and label `to` wired to an LED, on the main sheet.
fn split_by_labels(from: &str, to: &str) -> CircuitDescription {
    description(json!({
        "components": [{ "id": "s", "kind": "switch" }, { "id": "l", "kind": "led" }],
        "junctions": [{ "id": "j1", "name": from }, { "id": "j2", "name": to }],
        "connections": wires(&[("w1", "s.out", "j1"), ("w2", "j2", "l.in")]),
    }))
}

#[test]
fn same_named_labels_join_and_different_names_do_not() {
    let (mut sim, warnings) = Simulator::load(&split_by_labels("a", "a")).unwrap();
    assert_eq!(warnings, vec![]);
    for on in [1, 0, 1] {
        sim.set_input("s", on).unwrap();
        assert_eq!(value(&sim, "l", "in"), on);
    }

    // Matching is exact: `a` and `A` are two nets, each label alone on the sheet.
    let (sim, warnings) = Simulator::load(&split_by_labels("a", "A")).unwrap();
    assert_eq!(value(&sim, "l", "in"), 0);
    assert_eq!(
        found(&warnings),
        [
            (Code::UnconnectedInput, vec!["l"]),
            (Code::UnmatchedLabel, vec!["j2"]),
            (Code::UnmatchedLabel, vec!["j1"]),
        ]
    );
    assert_eq!(
        warnings[2].message,
        "label `a` joins nothing else on this sheet"
    );
}

#[test]
fn an_empty_name_is_no_name() {
    let (sim, warnings) = Simulator::load(&split_by_labels("", "")).unwrap();
    assert_eq!(found(&warnings), [(Code::UnconnectedInput, vec!["l"])]);
    assert_ne!(sim.wire_nets()["w1"], sim.wire_nets()["w2"]);
}

/// A definition passing pin `p` to pin `q` through two junctions named `x`.
fn through_label() -> Value {
    json!({
        "id": "pass",
        "components": [{ "id": "p", "kind": "switch" }, { "id": "q", "kind": "led" }],
        "junctions": [{ "id": "jx", "name": "x" }, { "id": "jy", "name": "x" }],
        "connections": wires(&[("w1", "p.out", "jx"), ("w2", "jy", "q.in")]),
        "inputs": [{ "name": "p", "component": "p" }],
        "outputs": [{ "name": "q", "component": "q" }],
    })
}

#[test]
fn labels_stay_on_their_sheet_and_in_their_instance() {
    let (mut sim, warnings) = Simulator::load(&description(json!({
        "components": [
            { "id": "s1", "kind": "switch" }, { "id": "s2", "kind": "switch" }, { "id": "s3", "kind": "switch" },
            { "id": "i1", "kind": "custom", "definition": "pass" },
            { "id": "i2", "kind": "custom", "definition": "pass" },
            { "id": "l1", "kind": "led" }, { "id": "l2", "kind": "led" },
        ],
        // A main-sheet label named like a path into i1 must not reach i1's `x`.
        "junctions": [{ "id": "jm", "name": "i1/x" }],
        "connections": wires(&[
            ("a", "s1.out", "i1.p"), ("b", "s2.out", "i2.p"),
            ("c", "i1.q", "l1.in"), ("d", "i2.q", "l2.in"), ("e", "s3.out", "jm"),
        ]),
        "definitions": [through_label()],
    })))
    .unwrap();
    assert_eq!(found(&warnings), [(Code::UnmatchedLabel, vec!["jm"])]);
    for (s1, s2, s3) in [(1, 0, 1), (0, 1, 1), (1, 1, 0), (0, 0, 1)] {
        sim.set_input("s1", s1).unwrap();
        sim.set_input("s2", s2).unwrap();
        sim.set_input("s3", s3).unwrap();
        assert_eq!((value(&sim, "l1", "in"), value(&sim, "l2", "in")), (s1, s2));
    }
}

/// Pin switches `a` and `b` both drive label `n`; with `reader`, LED pin `y` reads it.
fn two_drivers(reader: bool) -> CircuitDescription {
    let mut parts = vec![
        json!({ "id": "a", "kind": "switch" }),
        json!({ "id": "b", "kind": "switch" }),
    ];
    let mut list = vec![("w1", "a.out", "j1"), ("w2", "b.out", "j2")];
    let mut outputs = vec![];
    if reader {
        parts.push(json!({ "id": "y", "kind": "led" }));
        list.push(("w3", "j3", "y.in"));
        outputs.push(json!({ "name": "y", "component": "y" }));
    }
    description(json!({
        "components": [
            { "id": "i1", "kind": "custom", "definition": "d" },
            { "id": "i2", "kind": "custom", "definition": "d" },
        ],
        "connections": [],
        "definitions": [{
            "id": "d",
            "components": parts,
            "junctions": [{ "id": "j1", "name": "n" }, { "id": "j2", "name": "n" }, { "id": "j3", "name": "n" }],
            "connections": wires(&list),
            "inputs": [{ "name": "a", "component": "a" }, { "name": "b", "component": "b" }],
            "outputs": outputs,
        }],
    }))
}

#[test]
fn a_label_inside_a_definition_is_judged_as_one_net_at_the_level_check() {
    let errors = Simulator::load(&two_drivers(true)).unwrap_err();
    assert_eq!(found(&errors), [(Code::MultipleDrivers, vec!["i1"])]);
    let message = &errors[0].message;
    assert!(
        message.contains("i1/w1") && message.contains("i1/w2"),
        "{message}"
    );

    let errors = Simulator::load(&two_drivers(false)).unwrap_err();
    assert_eq!(found(&errors), [(Code::OutputToOutput, vec!["i1"])]);
}

#[test]
fn a_label_joining_different_widths_is_a_width_mismatch() {
    let errors = Simulator::load(&description(json!({
        "components": [{ "id": "s", "kind": "switch", "width": 8 }, { "id": "l", "kind": "led" }],
        "junctions": [{ "id": "j1", "name": "bus" }, { "id": "j2", "name": "bus" }],
        "connections": wires(&[("w1", "s.out", "j1"), ("w2", "j2", "l.in")]),
    })))
    .unwrap_err();
    assert_eq!(
        found(&errors),
        [(Code::WidthMismatch, vec!["w1", "w2", "l", "s"])]
    );
}

#[test]
fn an_unmatched_label_in_a_definition_warns_once_per_instance() {
    let mut definition = through_label();
    definition["junctions"][1]["name"] = json!("y");
    let (_, warnings) = Simulator::load(&description(json!({
        "components": [
            { "id": "i1", "kind": "custom", "definition": "pass" },
            { "id": "i2", "kind": "custom", "definition": "pass" },
        ],
        "connections": [],
        "definitions": [definition],
    })))
    .unwrap();
    let unmatched: Vec<_> = found(&warnings)
        .into_iter()
        .filter(|(code, _)| *code == Code::UnmatchedLabel)
        .collect();
    assert_eq!(
        unmatched,
        [
            (Code::UnmatchedLabel, vec!["i1"]),
            (Code::UnmatchedLabel, vec!["i1"]),
            (Code::UnmatchedLabel, vec!["i2"]),
            (Code::UnmatchedLabel, vec!["i2"]),
        ]
    );
}
