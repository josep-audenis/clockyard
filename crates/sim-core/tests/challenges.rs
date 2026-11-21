//! The bundled challenges (`challenges/`, ADR 0025): every reference solution
//! passes its challenge, every starter fails it, and a bench that cannot run
//! says why.

mod common;

use common::description;
use sim_core::CircuitDescription;
use sim_core::check::{Challenge, Mismatch, Reading, Report, check, check_on};
use sim_core::description::{Endpoint, PortRef};

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

/// The challenge checked as the editor checks it: on its bench, if it names one.
fn report(document: &CircuitDescription, challenge: &Challenge) -> Report {
    match &challenge.bench {
        Some(name) => check_on(
            document,
            challenge,
            &description(&read(&format!("benches/{name}.clockyard.json"))),
        ),
        None => check(document, challenge),
    }
}

/// The steps a pass counts: the challenge's own, or those of every run.
fn steps(challenge: &Challenge) -> usize {
    challenge.steps.len() + challenge.runs.iter().map(|r| r.steps.len()).sum::<usize>()
}

fn refusal(report: Report) -> String {
    match report {
        Report::Refused { reason } => reason,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn there_are_twelve_challenges() {
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
            "09-alu",
            "10-cpu",
            "11-program",
            "12-display"
        ]
    );
}

#[test]
fn every_solution_passes_its_challenge() {
    for name in all() {
        let c = challenge(&name);
        assert!(steps(&c) > 0, "{name} checks something");
        assert_eq!(
            report(&solution(&name), &c),
            Report::Passed { steps: steps(&c) },
            "{name}"
        );
    }
}

#[test]
fn every_starter_fails_its_challenge() {
    for name in all() {
        let report = report(&starter(&name), &challenge(&name));
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
            run: None,
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

fn port(component: &str, port: &str) -> Endpoint {
    Endpoint::Port(PortRef {
        component: component.into(),
        port: port.into(),
    })
}

/// A solution with one change inside the component the challenge checks.
struct Mutant {
    name: &'static str,
    doc: CircuitDescription,
}

impl Mutant {
    fn new(name: &'static str) -> Self {
        Mutant {
            name,
            doc: solution(name),
        }
    }

    fn inside(&mut self) -> &mut sim_core::description::DefinitionDesc {
        let id = challenge(self.name).definition;
        self.doc
            .definitions
            .iter_mut()
            .find(|d| d.id == id)
            .expect("the definition")
    }

    /// The wire into `to` now comes from `from`.
    fn rewire(mut self, to: (&str, &str), from: (&str, &str)) -> Self {
        let wire = self
            .inside()
            .connections
            .iter_mut()
            .find(|c| c.to == port(to.0, to.1))
            .unwrap_or_else(|| panic!("no wire into {to:?}"));
        wire.from = port(from.0, from.1);
        self
    }

    /// Parts and wires added, as a description's JSON.
    fn add(mut self, extra: serde_json::Value) -> Self {
        let extra: CircuitDescription = serde_json::from_value(extra).unwrap();
        let inside = self.inside();
        inside.components.extend(extra.components);
        inside.connections.extend(extra.connections);
        self
    }

    fn fails(self) {
        let report = check(&self.doc, &challenge(self.name));
        assert!(
            matches!(report, Report::Failed { .. }),
            "{}: {report:?}",
            self.name
        );
    }
}

#[test]
fn plausible_wrong_circuits_fail() {
    // A clock gated by load: it loads when load rises while clk is high.
    Mutant::new("06-register")
        .rewire(("ff", "d"), ("D", "out"))
        .rewire(("ff", "clk"), ("g", "out"))
        .add(serde_json::json!({
            "components": [{ "id": "g", "kind": "and" }],
            "connections": [
                { "id": "g1", "from": { "component": "clk", "port": "out" }, "to": { "component": "g", "port": "a" } },
                { "id": "g2", "from": { "component": "load", "port": "out" }, "to": { "component": "g", "port": "b" } },
            ],
        }))
        .fails();

    // Q with its bits in reverse order.
    let flips: Vec<_> = (0..8)
        .map(|i| serde_json::json!({ "id": format!("r{i}"), "from": { "component": "rs", "port": format!("f{i}") }, "to": { "component": "rm", "port": format!("f{}", 7 - i) } }))
        .chain([serde_json::json!({ "id": "rin", "from": { "component": "ff", "port": "q" }, "to": { "component": "rs", "port": "in" } })])
        .collect();
    Mutant::new("07-register8")
        .rewire(("Q", "in"), ("rm", "out"))
        .add(serde_json::json!({
            "components": [
                { "id": "rs", "kind": "split", "fields": [1, 1, 1, 1, 1, 1, 1, 1] },
                { "id": "rm", "kind": "merge", "fields": [1, 1, 1, 1, 1, 1, 1, 1] },
            ],
            "connections": flips,
        }))
        .fails();

    // A clear that reaches bits 0 and 1 only.
    (2..8)
        .fold(Mutant::new("08-counter8"), |m, i| {
            m.rewire(("m", &format!("f{i}")), (&format!("x{i}"), "out"))
        })
        .fails();

    // A zero flag that reads bit 6 twice and never bit 7.
    Mutant::new("09-alu")
        .rewire(("o3", "b"), ("sy", "f6"))
        .fails();
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

// --- Benches (ADR 0034) -----------------------------------------------------------------

fn bench(slot: &str) -> CircuitDescription {
    description(&read(&format!("benches/{slot}.clockyard.json")))
}

fn words(source: &str) -> Vec<u16> {
    words_of(source)
}

fn words_of(source: &str) -> Vec<u16> {
    asm::assemble(source).unwrap_or_else(|e| panic!("{source} assembles: {e:?}"))
}

/// A challenge for the `cpu` slot, as a challenge file would hold it, with `runs` as given.
fn cpu_challenge(runs: serde_json::Value) -> Challenge {
    serde_json::from_value(serde_json::json!({
        "definition": "cpu",
        "inputs": [{ "name": "clk", "width": 1 }, { "name": "instr", "width": 16 }, { "name": "din", "width": 8 }],
        "outputs": [
            { "name": "pc", "width": 8 }, { "name": "addr", "width": 8 }, { "name": "dout", "width": 8 },
            { "name": "we", "width": 1 }, { "name": "out", "width": 8 }, { "name": "halt", "width": 1 },
            { "name": "fetch", "width": 1 }
        ],
        "parts": ["not", "and", "nand", "or", "nor", "xor", "xnor", "dff", "split", "merge", "rom"],
        "runs": runs
    }))
    .expect("a challenge")
}

/// Adds the key to 7, stores it at RAM 16, shows it and halts.
fn add_run(key: u32, total: u32) -> serde_json::Value {
    serde_json::json!({
        "name": format!("Add {key}"),
        "words": words("LDA 0xFF\nADI 7\nSTA 16\nOUT\nHLT"),
        "steps": [
            { "set": { "key": key }, "cycles": 2, "expect": { "halt": 0 } },
            { "cycles": 100, "until": "halt", "expect": { "out": total }, "memory": { "ram": { "16": total, "17": 0 } } }
        ]
    })
}

#[test]
fn the_reference_cpu_passes_runs_on_its_bench_and_the_empty_slot_fails_them() {
    let challenge = cpu_challenge(serde_json::json!([add_run(5, 12), add_run(250, 1)]));
    assert_eq!(
        check_on(&solution("10-cpu"), &challenge, &bench("cpu")),
        Report::Passed { steps: 4 }
    );
    // The bench itself holds the slot empty, as a starter would: it never halts.
    assert_eq!(
        check_on(&bench("cpu"), &challenge, &bench("cpu")),
        Report::Failed {
            run: Some("Add 5".into()),
            step: 1,
            inputs: vec![Reading {
                name: "key".into(),
                value: 5
            }],
            mismatches: vec![
                Mismatch {
                    name: "halt".into(),
                    expected: 1,
                    got: 0
                },
                Mismatch {
                    name: "out".into(),
                    expected: 12,
                    got: 0
                },
                Mismatch {
                    name: "ram[16]".into(),
                    expected: 12,
                    got: 0
                },
            ],
        }
    );
}

#[test]
fn a_run_that_does_not_halt_in_its_cycles_fails_and_a_wrong_byte_is_named() {
    // A loop that never halts: the budget ends the step.
    let spin = cpu_challenge(serde_json::json!([{
        "name": "Spin", "words": words("loop: JMP loop"),
        "steps": [{ "cycles": 50, "until": "halt" }]
    }]));
    assert_eq!(
        check_on(&solution("10-cpu"), &spin, &bench("cpu")),
        Report::Failed {
            run: Some("Spin".into()),
            step: 0,
            inputs: vec![],
            mismatches: vec![Mismatch {
                name: "halt".into(),
                expected: 1,
                got: 0
            }],
        }
    );
    // The second run is the one that fails, and says which byte.
    let wrong = cpu_challenge(serde_json::json!([
        add_run(1, 8),
        { "name": "Store", "words": words("LDI 9\nSTA 3\nHLT"), "steps": [{ "cycles": 20, "until": "halt", "memory": { "ram": { "3": 8 } } }] }
    ]));
    assert_eq!(
        check_on(&solution("10-cpu"), &wrong, &bench("cpu")),
        Report::Failed {
            run: Some("Store".into()),
            step: 0,
            inputs: vec![],
            mismatches: vec![Mismatch {
                name: "ram[3]".into(),
                expected: 8,
                got: 9
            }],
        }
    );
}

#[test]
fn a_bench_check_refuses_what_it_cannot_run_and_says_why() {
    let challenge = cpu_challenge(serde_json::json!([add_run(5, 12)]));
    let solved = solution("10-cpu");
    let cpu_bench = bench("cpu");

    let mut missing = solved.clone();
    missing.definitions.retain(|d| d.id != "cpu");
    assert!(
        refusal(check_on(&missing, &challenge, &cpu_bench))
            .starts_with("The component this challenge checks is missing")
    );

    let mut narrow = solved.clone();
    let cpu = narrow
        .definitions
        .iter_mut()
        .find(|d| d.id == "cpu")
        .unwrap();
    let din = cpu.components.iter_mut().find(|c| c.id == "din").unwrap();
    din.width = Some(4.0);
    assert_eq!(
        refusal(check_on(&narrow, &challenge, &cpu_bench)),
        "Pin din is 4 bits wide; this challenge needs 8 bits."
    );

    // A RAM inside the CPU is not one of the parts allowed.
    let mut with_ram = solved.clone();
    let cpu = with_ram
        .definitions
        .iter_mut()
        .find(|d| d.id == "cpu")
        .unwrap();
    cpu.components.push(sim_core::description::ComponentDesc {
        id: "extra".into(),
        kind: "ram".into(),
        ..Default::default()
    });
    assert_eq!(
        refusal(check_on(&with_ram, &challenge, &cpu_bench)),
        "This challenge allows only these parts: not, and, nand, or, nor, xor, xnor, dff, split, merge, rom. The component uses: ram."
    );

    // Faults of the challenge or bench file, not of the user's circuit.
    let faults = [
        (serde_json::json!([]), "it has no runs"),
        (
            serde_json::json!([{ "name": "Long", "steps": [{ "cycles": 600 }, { "cycles": 401 }] }]),
            "run Long asks for more than 1000 cycles",
        ),
        (
            serde_json::json!([{ "name": "Lamp", "steps": [{ "expect": { "lamp": 1 } }] }]),
            "run Lamp, step 1: the bench has no LED lamp",
        ),
        (
            serde_json::json!([{ "name": "Disk", "steps": [{ "memory": { "disk": { "0": 1 } } }] }]),
            "run Disk, step 1: the bench has no memory disk",
        ),
        (
            serde_json::json!([{ "name": "Far", "steps": [{ "memory": { "ram": { "256": 1 } } }] }]),
            "run Far, step 1: ram has no address 256",
        ),
    ];
    for (runs, what) in faults {
        assert_eq!(
            refusal(check_on(&solved, &cpu_challenge(runs), &cpu_bench)),
            format!("This challenge's bench cannot run: {what}.")
        );
    }
    // What a step sets must be a bench switch, with a value that fits.
    for (set, what) in [
        (
            serde_json::json!({ "out": 1 }),
            "run Set, step 1: out is a led, not a switch or keyboard",
        ),
        (
            serde_json::json!({ "key": 256 }),
            "run Set, step 1: key is 8 bits wide, so 256 does not fit",
        ),
        (
            serde_json::json!({ "knob": 1 }),
            "run Set, step 1: unknown component knob",
        ),
    ] {
        let runs = serde_json::json!([{ "name": "Set", "steps": [{ "set": set }] }]);
        assert_eq!(
            refusal(check_on(&solved, &cpu_challenge(runs), &cpu_bench)),
            format!("This challenge's bench cannot run: {what}.")
        );
    }
    // Words that do not fit the ROM, a run with no steps: the challenge's faults, not the circuit's.
    for (run, what) in [
        (
            serde_json::json!({ "name": "Wide", "words": [70000], "steps": [{ "cycles": 1 }] }),
            "run Wide's words do not fit the program ROM",
        ),
        (
            serde_json::json!({ "name": "Long", "words": vec![0; 257], "steps": [{ "cycles": 1 }] }),
            "run Long's words do not fit the program ROM",
        ),
        (
            serde_json::json!({ "name": "Idle", "steps": [] }),
            "run Idle has no steps",
        ),
    ] {
        assert_eq!(
            refusal(check_on(
                &solved,
                &cpu_challenge(serde_json::json!([run])),
                &cpu_bench
            )),
            format!("This challenge's bench cannot run: {what}.")
        );
    }
    // On the program bench the ROM is the user's component: a run cannot supply words.
    let mut program = cpu_challenge(serde_json::json!([add_run(5, 12)]));
    program.definition = "program".into();
    program.inputs.clear();
    program.outputs.clear();
    assert_eq!(
        refusal(check_on(&bench("program"), &program, &bench("program"))),
        "This challenge's bench cannot run: it has no program ROM."
    );
    // An unknown kind inside the slot is an error in the circuit, not a part to allow.
    let mut unknown = solved.clone();
    let cpu = unknown
        .definitions
        .iter_mut()
        .find(|d| d.id == "cpu")
        .unwrap();
    cpu.components.push(sim_core::description::ComponentDesc {
        id: "odd".into(),
        kind: "flux".into(),
        ..Default::default()
    });
    assert!(
        refusal(check_on(&unknown, &challenge, &cpu_bench))
            .starts_with("The circuit has errors to fix first:")
    );

    // A bench whose CPU is its own has no slot for this challenge.
    assert_eq!(
        refusal(check_on(&solved, &challenge, &bench("program"))),
        "This challenge's bench cannot run: it has no cpu."
    );
}

#[test]
fn the_bench_keeps_its_own_definitions_whatever_the_document_holds() {
    // Challenge 12's shape: `display` is checked, and the CPU is the bench's.
    let challenge: Challenge = serde_json::from_value(serde_json::json!({
        "definition": "display",
        "inputs": [
            { "name": "clk", "width": 1 }, { "name": "addr", "width": 8 },
            { "name": "dout", "width": 8 }, { "name": "we", "width": 1 }
        ],
        "outputs": [{ "name": "sptr", "width": 8 }, { "name": "swe", "width": 1 }],
        "runs": [{
            "name": "Draw",
            "words": words("LDI 7\nSTA 0xFE\nLDI 0x81\nSTA 0xFD\nHLT"),
            "steps": [{ "cycles": 40, "until": "halt", "memory": { "screen": { "7": 129, "0": 0 } } }]
        }]
    }))
    .expect("a challenge");
    let display_bench = bench("display");
    let solved = solution("12-display");
    assert_eq!(
        check_on(&solved, &challenge, &display_bench),
        Report::Passed { steps: 1 }
    );

    // The document's copy of the provided CPU, gutted: the check runs the bench's, so it still passes.
    let mut tampered = solved.clone();
    let cpu = tampered
        .definitions
        .iter_mut()
        .find(|d| d.id == "bench-cpu")
        .unwrap();
    cpu.connections.clear();
    assert_eq!(
        check_on(&tampered, &challenge, &display_bench),
        Report::Passed { steps: 1 }
    );

    // The user's own display, with nothing inside, fails: the screen is never written.
    assert_eq!(
        check_on(&display_bench, &challenge, &display_bench),
        Report::Failed {
            run: Some("Draw".into()),
            step: 0,
            inputs: vec![],
            mismatches: vec![Mismatch {
                name: "screen[7]".into(),
                expected: 129,
                got: 0
            }],
        }
    );
}

#[test]
fn a_challenge_with_runs_is_never_passed_without_its_bench_nor_one_with_no_steps() {
    // The empty slot, checked the way challenges 1 to 9 are: refused, not passed with nothing run.
    let challenge = cpu_challenge(serde_json::json!([add_run(5, 12)]));
    assert_eq!(
        refusal(check(&bench("cpu"), &challenge)),
        "This challenge's bench cannot run: it was not given."
    );
    assert_eq!(
        refusal(check(&bench("cpu"), &cpu_challenge(serde_json::json!([])))),
        "This challenge's bench cannot run: it has no steps."
    );
}

#[test]
fn until_runs_no_cycle_once_its_led_is_lit_and_a_failed_step_reports_what_it_set() {
    // Fetch is lit from the start, so no cycle runs: nothing is stored, though 20 cycles would store 9.
    let early = cpu_challenge(serde_json::json!([{
        "name": "Early", "words": words("LDI 9\nSTA 3\nHLT"),
        "steps": [
            { "cycles": 20, "until": "fetch", "memory": { "ram": { "3": 0 } } },
            { "cycles": 20, "until": "halt", "memory": { "ram": { "3": 9 } } }
        ]
    }]));
    assert_eq!(
        check_on(&solution("10-cpu"), &early, &bench("cpu")),
        Report::Passed { steps: 2 }
    );
    // The step that fails is the one that sets the key: the report has it.
    let wrong = cpu_challenge(serde_json::json!([{
        "name": "Key", "words": words("LDA 0xFF\nOUT\nHLT"),
        "steps": [{ "set": { "key": 3 }, "cycles": 20, "until": "halt", "expect": { "out": 4 } }]
    }]));
    assert_eq!(
        check_on(&solution("10-cpu"), &wrong, &bench("cpu")),
        Report::Failed {
            run: Some("Key".into()),
            step: 0,
            inputs: vec![Reading {
                name: "key".into(),
                value: 3
            }],
            mismatches: vec![Mismatch {
                name: "out".into(),
                expected: 4,
                got: 3
            }],
        }
    );
}

#[test]
fn every_run_holds_its_program_as_assembled_and_names_the_pins_of_its_bench() {
    for name in all() {
        let text = read(&format!("{name}.json"));
        let file: serde_json::Value = serde_json::from_str(&text).expect("valid challenge");
        let c = challenge(&name);
        let Some(slot) = &c.bench else {
            assert!(c.runs.is_empty(), "{name}: runs need a bench");
            continue;
        };
        // The words written out by hand are what the assembler makes of the source beside them.
        for run in file["runs"].as_array().expect("runs") {
            let Some(source) = run["source"].as_str() else {
                continue;
            };
            let words: Vec<u64> = run["words"]
                .as_array()
                .expect("words beside their source")
                .iter()
                .map(|w| w.as_u64().expect("a word"))
                .collect();
            let assembled: Vec<u64> = words_of(source).iter().map(|&w| u64::from(w)).collect();
            assert_eq!(words, assembled, "{name}, run {}", run["name"]);
        }
        // The challenge lists every pin the bench wires to its slot, so a missing one is named as a pin,
        // not as an error on a bench wire the user cannot see.
        let bench = bench(slot);
        let slot = bench
            .definitions
            .iter()
            .find(|d| d.id == c.definition)
            .unwrap_or_else(|| panic!("{name}: the bench has a {}", c.definition));
        let names = |pins: &[sim_core::description::PinDesc]| {
            let mut names: Vec<String> = pins.iter().map(|p| p.name.clone()).collect();
            names.sort();
            names
        };
        let listed = |specs: &[sim_core::check::PinSpec]| {
            let mut names: Vec<String> = specs.iter().map(|p| p.name.clone()).collect();
            names.sort();
            names
        };
        assert_eq!(listed(&c.inputs), names(&slot.inputs), "{name}: inputs");
        assert_eq!(listed(&c.outputs), names(&slot.outputs), "{name}: outputs");
    }
}

/// The reference CPU with the wire into `to` (a part's port inside `cpu`) taken from `from` instead.
fn rewired(to: (&str, &str), from: (&str, &str)) -> CircuitDescription {
    rewire(solution("10-cpu"), to, from)
}

fn rewire(
    mut wrong: CircuitDescription,
    to: (&str, &str),
    from: (&str, &str),
) -> CircuitDescription {
    let port = |(component, port): (&str, &str)| {
        Endpoint::Port(PortRef {
            component: component.into(),
            port: port.into(),
        })
    };
    let cpu = wrong
        .definitions
        .iter_mut()
        .find(|d| d.id == "cpu")
        .unwrap();
    let wire = cpu
        .connections
        .iter_mut()
        .find(|w| w.to == port(to))
        .unwrap_or_else(|| panic!("a wire into {to:?}"));
    wire.from = port(from);
    wrong
}

#[test]
fn a_cpu_with_one_wrong_wire_fails_the_challenge() {
    let c = challenge("10-cpu");
    // What is miswired. `one.out` is the constant 1 inside the CPU. Each passed every run before
    // the run "Flags are kept" and the step past the halt were added, except the first.
    let mutants = [
        // The carry fed from the zero logic.
        (("c", "d"), ("isz", "out")),
        // OUT loads on every execute, or on every cycle.
        (("outr", "en"), ("exec", "out")),
        (("outr", "en"), ("one", "out")),
        // C reloaded by every load, or by every instruction.
        (("c", "en"), ("aen", "out")),
        (("c", "en"), ("exec", "out")),
        // Z reloaded by every instruction; loads that do not set Z.
        (("z", "en"), ("exec", "out")),
        (("z", "en"), ("cen", "out")),
        // The fetch pin stuck at 1, or at 0.
        (("fetch", "in"), ("one", "out")),
        (("fetch", "in"), ("zero", "out")),
    ];
    for (to, from) in mutants {
        let report = report(&rewired(to, from), &c);
        assert!(
            matches!(report, Report::Failed { .. }),
            "{to:?} from {from:?}: {report:?}"
        );
    }
    // A halt that lights but stops nothing: the phase keeps turning, and fetch and execute go on.
    let one = ("one", "out");
    let running = rewire(
        rewire(rewired(("t", "en"), one), ("fetchg", "b"), one),
        ("exec", "b"),
        one,
    );
    let report = report(&running, &c);
    assert!(matches!(report, Report::Failed { .. }), "{report:?}");
}

#[test]
fn the_program_challenge_takes_any_program_that_shows_the_sums_and_its_solution_is_as_assembled() {
    let c = challenge("11-program");
    // The solution's ROM holds its source as assembled.
    let text = read("solutions/11-program.clockyard.json");
    let document: serde_json::Value = serde_json::from_str(&text).expect("a document");
    let rom = document["definitions"]
        .as_array()
        .expect("definitions")
        .iter()
        .find(|d| d["id"] == "program")
        .and_then(|d| {
            d["circuit"]["components"]
                .as_array()?
                .iter()
                .find(|c| c["kind"] == "rom")
        })
        .expect("the program's ROM");
    let data: Vec<u64> = rom["props"]["data"]
        .as_array()
        .expect("words")
        .iter()
        .map(|w| w.as_u64().expect("a word"))
        .collect();
    let assembled = words_of(rom["props"]["source"].as_str().expect("its source"));
    assert_eq!(
        data,
        assembled.iter().map(|&w| u64::from(w)).collect::<Vec<_>>()
    );

    // Another program for the same sums, adding upwards and keeping its numbers elsewhere, passes too.
    let other = "LDA 0xFF\nSTA 0x20\nloop: LDA 0x21\nADI 1\nSTA 0x21\nADD 0x22\nSTA 0x22\nLDA 0x20\nSUB 0x21\nJZ done\nJMP loop\ndone: LDA 0x22\nOUT\nHLT";
    let with = |source: &str| {
        let mut document = solution("11-program");
        let program = document
            .definitions
            .iter_mut()
            .find(|d| d.id == "program")
            .unwrap();
        let rom = program
            .components
            .iter_mut()
            .find(|c| c.kind == "rom")
            .unwrap();
        rom.data = Some(words_of(source).iter().map(|&w| f64::from(w)).collect());
        document
    };
    assert_eq!(
        report(&with(other), &c),
        Report::Passed { steps: steps(&c) }
    );
    // One that shows the key itself fails, at the first key whose sum differs.
    match report(&with("LDA 0xFF\nOUT\nHLT"), &c) {
        Report::Failed { run, .. } => assert_eq!(run.as_deref(), Some("Sum to 2")),
        other => panic!("expected a failed run, got {other:?}"),
    }
    // A component with more than a ROM in it is refused.
    let mut gates = solution("11-program");
    let program = gates
        .definitions
        .iter_mut()
        .find(|d| d.id == "program")
        .unwrap();
    program
        .components
        .push(sim_core::description::ComponentDesc {
            id: "extra".into(),
            kind: "not".into(),
            ..Default::default()
        });
    assert_eq!(
        refusal(report(&gates, &c)),
        "This challenge allows only these parts: rom. The component uses: not."
    );
}

#[test]
fn a_display_with_one_wrong_wire_fails_the_challenge() {
    let c = challenge("12-display");
    let port = |component: &str, port: &str| {
        Endpoint::Port(PortRef {
            component: component.into(),
            port: port.into(),
        })
    };
    // Inside the reference display: `top` is "a store to an address whose top six bits are 1".
    let mutants = [
        // The store strobe ignored: a load from 0xFD draws, and so does every cycle at that address.
        (("top", "b"), ("high", "out")),
        // The top bits ignored: 0x7E moves the pointer and 0x7D draws.
        (("top", "a"), ("we", "out")),
        // The two addresses swapped.
        (("sptren", "b"), ("isfd", "out")),
        // The pointer taken from the address instead of the byte stored.
        (("r", "d"), ("addr", "out")),
        // Bit 0 ignored when drawing: 0xFC draws too.
        (("isfd", "b"), ("n1", "out")),
        // Bit 6 ignored by both: no store but one to 0xBE or 0xBD shows it.
        (("h1", "b"), ("bits", "f7")),
        // Bit 1 ignored when drawing: 0xFF draws too.
        (("isfd", "a"), ("bits", "f0")),
        // The pointer loaded whenever the address is 0xFE, store or not.
        (("sptren", "a"), ("high", "out")),
    ];
    for ((to, to_port), (from, from_port)) in mutants {
        let mut wrong = solution("12-display");
        let display = wrong
            .definitions
            .iter_mut()
            .find(|d| d.id == "display")
            .unwrap();
        let wire = display
            .connections
            .iter_mut()
            .find(|w| w.to == port(to, to_port))
            .unwrap_or_else(|| panic!("a wire into {to}.{to_port}"));
        wire.from = port(from, from_port);
        let report = report(&wrong, &c);
        assert!(
            matches!(report, Report::Failed { .. }),
            "{to}.{to_port} from {from}.{from_port}: {report:?}"
        );
    }
}

#[test]
fn a_part_built_from_a_definition_the_user_added_under_a_bench_id_is_refused() {
    // Add components numbers an ID already taken, so a second copy of a bench's register
    // arrives as `bench-reg8-2`. The check leaves every `bench-` definition of the user's out.
    let c = challenge("12-display");
    let mut document = solution("12-display");
    let mut copy = document
        .definitions
        .iter()
        .find(|d| d.id == "reg8")
        .unwrap()
        .clone();
    copy.id = "bench-reg8-2".into();
    document.definitions.push(copy);
    let display = document
        .definitions
        .iter_mut()
        .find(|d| d.id == "display")
        .unwrap();
    let register = display.components.iter_mut().find(|c| c.id == "r").unwrap();
    register.definition = Some("bench-reg8-2".into());
    let reason = refusal(report(&document, &c));
    assert!(reason.contains("bench-reg8-2"), "{reason}");
}
