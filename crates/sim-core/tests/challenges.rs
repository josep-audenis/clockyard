//! The bundled challenges (`challenges/`, ADR 0025): every reference solution
//! passes its challenge, every starter fails it, and a bench that cannot run
//! says why.

mod common;

use common::description;
use sim_core::CircuitDescription;
use sim_core::check::{Challenge, Mismatch, Reading, Report, check};

fn read(path: &str) -> String {
    let path = format!("{}/../../challenges/{path}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
}

fn challenge(name: &str) -> Challenge {
    serde_json::from_str(&read(&format!("{name}.json"))).expect("valid challenge")
}

fn solution(name: &str) -> CircuitDescription {
    description(&read(&format!("solutions/{name}.clockyard.json")))
}

fn starter(name: &str) -> CircuitDescription {
    description(&read(&format!("starters/{name}.clockyard.json")))
}

/// Every challenge file, by name, in order.
fn all() -> Vec<String> {
    let dir = format!("{}/../../challenges", env!("CARGO_MANIFEST_DIR"));
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .expect("challenges/")
        .filter_map(|e| {
            e.ok()?
                .file_name()
                .into_string()
                .ok()?
                .strip_suffix(".json")
                .map(str::to_string)
        })
        .collect();
    names.sort();
    names
}

fn refusal(report: Report) -> String {
    match report {
        Report::Refused { reason } => reason,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn there_are_nine_challenges_so_far() {
    assert_eq!(
        all(),
        [
            "01-inverter",
            "02-xor",
            "03-half-adder",
            "04-full-adder",
            "05-adder8",
            "06-register",
            "07-register8",
            "08-counter8",
            "09-alu"
        ]
    );
}

#[test]
fn every_solution_passes_its_challenge() {
    for name in all() {
        let c = challenge(&name);
        assert_eq!(
            check(&solution(&name), &c),
            Report::Passed {
                steps: c.steps.len()
            },
            "{name}"
        );
    }
}

#[test]
fn every_starter_fails_its_challenge() {
    for name in all() {
        let report = check(&starter(&name), &challenge(&name));
        assert!(
            matches!(report, Report::Failed { .. }),
            "{name}: {report:?}"
        );
    }
}

#[test]
fn a_failed_step_names_its_inputs_and_the_outputs_that_differ() {
    // The inverter's starter: Y is left unconnected, so it reads 0 where 1 is expected.
    assert_eq!(
        check(&starter("01-inverter"), &challenge("01-inverter")),
        Report::Failed {
            step: 0,
            inputs: vec![Reading {
                name: "A".into(),
                value: 0
            }],
            mismatches: vec![Mismatch {
                name: "Y".into(),
                expected: 1,
                got: 0
            }],
        }
    );
}

#[test]
fn a_part_the_challenge_does_not_allow_is_refused() {
    // The half adder's solution uses XOR and AND, which pass on behaviour alone.
    let mut c = challenge("03-half-adder");
    c.parts = Some(vec!["nand".into()]);
    assert_eq!(
        refusal(check(&solution("03-half-adder"), &c)),
        "This challenge allows only these parts: nand. The component uses: and, xor."
    );
}

#[test]
fn components_count_by_what_they_are_built_of() {
    // The 8-bit adder is built of full-adder instances, allowed because they flatten to gates.
    let c = challenge("05-adder8");
    assert!(c.parts.as_ref().unwrap().iter().all(|p| p != "custom"));
    assert!(matches!(
        check(&solution("05-adder8"), &c),
        Report::Passed { .. }
    ));
}

#[test]
fn a_missing_definition_or_pin_is_refused() {
    let c = challenge("01-inverter");
    let mut gone = solution("01-inverter");
    gone.definitions.clear();
    assert!(
        refusal(check(&gone, &c)).starts_with("The component this challenge checks is missing")
    );

    let mut renamed = c.clone();
    renamed.inputs[0].name = "In".into();
    assert_eq!(
        refusal(check(&solution("01-inverter"), &renamed)),
        "The component has no input pin In; undo, or start the challenge again to get it back."
    );
}

#[test]
fn a_pin_of_the_wrong_width_is_refused() {
    let mut c = challenge("01-inverter");
    c.inputs[0].width = 8;
    assert_eq!(
        refusal(check(&solution("01-inverter"), &c)),
        "Pin A is 1 bit wide; this challenge needs 8 bits."
    );
}

#[test]
fn a_loop_that_does_not_settle_is_refused() {
    // A NOT gate fed back to itself inside the inverter, beside the solution's NAND.
    let mut looped = solution("01-inverter");
    let text = serde_json::json!({
        "components": [{ "id": "n", "kind": "not" }],
        "connections": [{ "id": "loop", "from": { "component": "n", "port": "out" }, "to": { "component": "n", "port": "in" } }],
    });
    let extra: CircuitDescription = serde_json::from_value(text).unwrap();
    looped.definitions[0].components.extend(extra.components);
    looped.definitions[0].connections.extend(extra.connections);
    let mut c = challenge("01-inverter");
    c.parts = None;
    assert!(refusal(check(&looped, &c)).starts_with("The circuit did not settle when it started"));
}

#[test]
fn a_circuit_with_errors_is_refused_with_the_first() {
    let mut broken = solution("01-inverter");
    broken.definitions[0].components[2].kind = "gizmo".into();
    // Named as the user sees the part, without the bench's own prefix.
    assert_eq!(
        refusal(check(&broken, &challenge("01-inverter"))),
        "The circuit has errors to fix first: g has unknown kind 'gizmo'"
    );
}

#[test]
fn a_loop_that_stops_settling_at_a_step_is_refused() {
    // A NAND fed back to itself, gated by A: settled while A is 0, oscillates once A is 1.
    let mut looped = solution("01-inverter");
    let text = serde_json::json!({
        "components": [{ "id": "osc", "kind": "nand" }],
        "connections": [
            { "id": "gate", "from": { "component": "A", "port": "out" }, "to": { "component": "osc", "port": "a" } },
            { "id": "loop", "from": { "component": "osc", "port": "out" }, "to": { "component": "osc", "port": "b" } },
        ],
    });
    let extra: CircuitDescription = serde_json::from_value(text).unwrap();
    looped.definitions[0].components.extend(extra.components);
    looped.definitions[0].connections.extend(extra.connections);
    let reason = refusal(check(&looped, &challenge("01-inverter")));
    assert!(
        reason.starts_with("At step 2 the circuit did not settle: "),
        "{reason}"
    );
    assert!(!reason.contains("dut/"), "{reason}");
}

#[test]
fn the_main_circuit_is_not_checked() {
    // A main circuit with an error of its own does not stop the check.
    let mut doc = solution("01-inverter");
    doc.components =
        serde_json::from_value(serde_json::json!([{ "id": "x", "kind": "gizmo" }])).unwrap();
    assert!(matches!(
        check(&doc, &challenge("01-inverter")),
        Report::Passed { .. }
    ));
}
