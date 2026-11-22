//! Gates with 2 to 8 inputs and the push button (ADR 0038), against the rules
//! in `docs/simulation-model.md`.

use serde_json::{Value, json};
use sim_core::{CircuitDescription, Code, Simulator};

const GATES: [&str; 6] = ["and", "nand", "or", "nor", "xor", "xnor"];
const PORTS: [&str; 8] = ["a", "b", "c", "d", "e", "f", "g", "h"];

/// A 1-bit value and its unknown bit: `0`, `1`, `X` (1, 1) or `Z` (0, 1).
type Bit = (u32, u32);
const X: Bit = (1, 1);
const Z: Bit = (0, 1);
const VALUES: [Bit; 4] = [(0, 0), (1, 0), X, Z];

/// The rules, written from the specification rather than the engine: AND
/// `0` if any input is `0`, `1` if all are `1`; OR `1` if any is `1`, `0` if
/// all are `0`; XOR parity, unknown if any input is; `Z` read as `X`;
/// NAND, NOR and XNOR the NOT of those.
fn model(kind: &str, inputs: &[Bit]) -> Bit {
    let unknown = inputs.iter().any(|&(_, u)| u == 1);
    let ones = inputs.iter().filter(|&&b| b == (1, 0)).count();
    let zeros = inputs.iter().filter(|&&b| b == (0, 0)).count();
    let base = match kind {
        "and" | "nand" if zeros > 0 => (0, 0),
        "and" | "nand" if !unknown => (1, 0),
        "or" | "nor" if ones > 0 => (1, 0),
        "or" | "nor" if !unknown => (0, 0),
        "xor" | "xnor" if !unknown => ((ones % 2) as u32, 0),
        _ => X,
    };
    let inverted = matches!(kind, "nand" | "nor" | "xnor");
    match base {
        (v, 0) if inverted => (1 - v, 0),
        other => other,
    }
}

fn describe(value: Value) -> CircuitDescription {
    serde_json::from_value(value).expect("description")
}

fn wire(i: usize, from: (&str, &str), to: (&str, &str)) -> Value {
    json!({
        "id": format!("w{i}"),
        "from": { "component": from.0, "port": from.1 },
        "to": { "component": to.0, "port": to.1 },
    })
}

/// A gate `g` of `n` inputs, each fed by buffer `t{i}` from switch `v{i}`,
/// enabled by buffer `u{i}` passing switch `e{i}` while switch `f{i}` is on:
/// `f` off gives `X`, `e` off gives `Z`, both on give `v`.
fn four_state(kind: &str, n: usize) -> CircuitDescription {
    let mut parts = vec![json!({ "id": "g", "kind": kind, "inputCount": n })];
    let mut wires = Vec::new();
    for (i, port) in PORTS.iter().enumerate().take(n) {
        let [v, e, f, t, u] = ["v", "e", "f", "t", "u"].map(|p| format!("{p}{i}"));
        for id in [&v, &e, &f] {
            parts.push(json!({ "id": id, "kind": "switch" }));
        }
        parts.push(json!({ "id": t, "kind": "tri" }));
        parts.push(json!({ "id": u, "kind": "tri" }));
        for (from, to) in [
            ((&e[..], "out"), (&u[..], "in")),
            ((&f[..], "out"), (&u[..], "en")),
            ((&v[..], "out"), (&t[..], "in")),
            ((&u[..], "out"), (&t[..], "en")),
            ((&t[..], "out"), ("g", *port)),
        ] {
            wires.push(wire(wires.len(), from, to));
        }
    }
    describe(json!({ "components": parts, "connections": wires }))
}

fn out(sim: &Simulator) -> Bit {
    let net = sim.port_nets()["g"]["out"] as usize;
    (sim.nets()[net], sim.unknown()[net])
}

#[test]
fn every_gate_of_two_to_four_inputs_follows_the_rules_for_every_four_state_combination() {
    for kind in GATES {
        for n in 2..=4 {
            let (mut sim, _) = Simulator::load(&four_state(kind, n)).expect("valid");
            for combination in 0..4usize.pow(n as u32) {
                let inputs: Vec<Bit> = (0..n)
                    .map(|i| VALUES[combination / 4usize.pow(i as u32) % 4])
                    .collect();
                let names: Vec<[String; 3]> = (0..n)
                    .map(|i| ["v", "e", "f"].map(|p| format!("{p}{i}")))
                    .collect();
                let mut set = Vec::new();
                for (i, &bit) in inputs.iter().enumerate() {
                    let (v, e, f) = match bit {
                        X => (0, 0, 0),
                        Z => (0, 0, 1),
                        (v, _) => (v, 1, 1),
                    };
                    set.extend([
                        (&names[i][0][..], v),
                        (&names[i][1][..], e),
                        (&names[i][2][..], f),
                    ]);
                }
                sim.set_inputs(&set).expect("switches");
                assert_eq!(out(&sim), model(kind, &inputs), "{kind} of {inputs:?}");
            }
        }
    }
}

/// A gate of `n` inputs at `width`, each fed by switch `s{i}`: two-state throughout.
fn two_state(kind: &str, n: usize, width: u32) -> CircuitDescription {
    let mut parts = vec![json!({ "id": "g", "kind": kind, "inputCount": n, "width": width })];
    let mut wires = Vec::new();
    for (i, port) in PORTS.iter().enumerate().take(n) {
        let s = format!("s{i}");
        parts.push(json!({ "id": s, "kind": "switch", "width": width }));
        wires.push(wire(i, (&s, "out"), ("g", port)));
    }
    describe(json!({ "components": parts, "connections": wires }))
}

#[test]
fn every_gate_of_two_to_eight_inputs_follows_the_rules_on_known_bits() {
    for kind in GATES {
        for n in 2..=8 {
            let mut sim = Simulator::load(&two_state(kind, n, 1)).expect("valid").0;
            let names: Vec<String> = (0..n).map(|i| format!("s{i}")).collect();
            for combination in 0..1u32 << n {
                let set: Vec<(&str, u32)> = names
                    .iter()
                    .enumerate()
                    .map(|(i, s)| (&s[..], combination >> i & 1))
                    .collect();
                sim.set_inputs(&set).expect("switches");
                let inputs: Vec<Bit> = set.iter().map(|&(_, v)| (v, 0)).collect();
                assert_eq!(
                    out(&sim),
                    model(kind, &inputs),
                    "{kind} of {combination:0n$b}"
                );
            }
        }
    }
}

#[test]
fn eight_inputs_at_width_32_combine_bit_by_bit() {
    let words: [u32; 8] = [
        0xFFFF_FFFF,
        0xF0F0_F0F0,
        0xFF00_FF00,
        0xFFFF_0000,
        0x8000_0001,
        0xFFFF_FFFF,
        0x1234_5678,
        0xCCCC_CCCC,
    ];
    let and = words.iter().fold(u32::MAX, |a, w| a & w);
    let or = words.iter().fold(0, |a, w| a | w);
    let xor = words.iter().fold(0, |a, w| a ^ w);
    for (kind, expected) in [
        ("and", and),
        ("nand", !and),
        ("or", or),
        ("nor", !or),
        ("xor", xor),
        ("xnor", !xor),
    ] {
        let mut sim = Simulator::load(&two_state(kind, 8, 32)).expect("valid").0;
        let names: Vec<String> = (0..8).map(|i| format!("s{i}")).collect();
        let set: Vec<(&str, u32)> = names.iter().zip(words).map(|(s, w)| (&s[..], w)).collect();
        sim.set_inputs(&set).expect("switches");
        assert_eq!(out(&sim), (expected, 0), "{kind}");
    }
}

#[test]
fn a_gate_has_ports_a_to_its_input_count_and_two_without_one() {
    let sim = Simulator::load(&describe(json!({
        "components": [
            { "id": "two", "kind": "and" },
            { "id": "five", "kind": "xor", "inputCount": 5 },
            { "id": "n", "kind": "not" },
        ],
        "connections": [],
    })))
    .expect("valid")
    .0;
    let ports = |id: &str| sim.port_nets()[id].keys().cloned().collect::<Vec<_>>();
    assert_eq!(ports("two"), ["a", "b", "out"]);
    assert_eq!(ports("five"), ["a", "b", "c", "d", "e", "out"]);
    assert_eq!(ports("n"), ["in", "out"]);
}

fn codes(parts: Value) -> Vec<Code> {
    let description = describe(json!({
        "components": parts,
        "connections": [],
        "definitions": [{ "id": "d", "components": [], "connections": [], "inputs": [], "outputs": [] }],
    }));
    match Simulator::load(&description) {
        Ok(_) => Vec::new(),
        Err(errors) => errors.into_iter().map(|d| d.code).collect(),
    }
}

#[test]
fn an_input_count_out_of_range_or_on_another_part_is_an_invalid_width() {
    for bad in [json!(1), json!(9), json!(2.5), json!(-2), json!(0)] {
        assert_eq!(
            codes(json!([{ "id": "g", "kind": "and", "inputCount": bad }])),
            [Code::InvalidWidth],
            "{bad}"
        );
    }
    for kind in ["not", "switch", "led", "tri", "dff", "button"] {
        assert_eq!(
            codes(json!([{ "id": "p", "kind": kind, "inputCount": 2 }])),
            [Code::InvalidWidth],
            "{kind}"
        );
    }
    assert_eq!(
        codes(json!([{ "id": "x", "kind": "custom", "definition": "d", "inputCount": 3 }])),
        [Code::InvalidWidth]
    );
    assert_eq!(
        codes(json!([{ "id": "q", "kind": "flux", "inputCount": 3 }])),
        [Code::UnknownKind]
    );
    assert_eq!(
        codes(json!([{ "id": "g", "kind": "nor", "inputCount": 8 }])),
        []
    );
    let message = |count: Value| {
        let description = describe(
            json!({ "components": [{ "id": "g", "kind": "and", "inputCount": count }], "connections": [] }),
        );
        Simulator::load(&description).expect_err("refused")[0]
            .message
            .clone()
    };
    assert!(
        message(json!(9)).contains("input count 9 is not a whole number from 2 to 8"),
        "{}",
        message(json!(9))
    );
    assert!(message(json!(2.5)).contains("input count 2.5"));
}

/// A button `b` wired to an LED, and to flip-flop `q`'s clock, with `d` from switch `s`.
fn button_circuit() -> CircuitDescription {
    describe(json!({
        "components": [
            { "id": "b", "kind": "button" },
            { "id": "s", "kind": "switch" },
            { "id": "q", "kind": "dff" },
            { "id": "l", "kind": "led" },
        ],
        "connections": [
            wire(0, ("b", "out"), ("l", "in")),
            wire(1, ("b", "out"), ("q", "clk")),
            wire(2, ("s", "out"), ("q", "d")),
        ],
    }))
}

fn net(sim: &Simulator, id: &str, port: &str) -> u32 {
    sim.nets()[sim.port_nets()[id][port] as usize]
}

#[test]
fn a_push_button_is_a_one_bit_input_that_clocks_what_it_drives_between_ticks() {
    let mut sim = Simulator::load(&button_circuit()).expect("valid").0;
    assert_eq!(net(&sim, "b", "out"), 0);
    sim.set_input("s", 1).unwrap();
    sim.set_input("b", 1).unwrap();
    // No tick: the press is itself the flip-flop's rising edge.
    assert_eq!(
        (net(&sim, "b", "out"), net(&sim, "q", "q"), sim.time()),
        (1, 1, 0)
    );
    assert!(sim.set_input("b", 2).is_err());
    assert!(codes(json!([{ "id": "b", "kind": "button", "width": 1 }])) == [Code::InvalidWidth]);
}

#[test]
fn a_held_button_is_kept_by_reset_and_by_a_kept_load_and_a_new_one_starts_released() {
    let mut sim = Simulator::load(&button_circuit()).expect("valid").0;
    sim.set_input("b", 1).unwrap();
    sim.reset();
    assert_eq!(net(&sim, "b", "out"), 1);
    let (kept, _) = Simulator::load_keeping(&button_circuit(), &sim).expect("valid");
    assert_eq!(net(&kept, "b", "out"), 1);
    // A switch held on, replaced by a button under the same ID: a part of another kind starts at 0.
    let mut switched = button_circuit();
    switched.components[0].kind = "switch".into();
    let mut on = Simulator::load(&switched).expect("valid").0;
    on.set_input("b", 1).unwrap();
    let (button, _) = Simulator::load_keeping(&button_circuit(), &on).expect("valid");
    assert_eq!(net(&button, "b", "out"), 0);
}

#[test]
fn a_definition_pin_cannot_name_a_button() {
    let description = describe(json!({
        "components": [{ "id": "x", "kind": "custom", "definition": "d" }],
        "connections": [],
        "definitions": [{
            "id": "d",
            "components": [{ "id": "p", "kind": "button" }, { "id": "l", "kind": "led" }],
            "connections": [wire(0, ("p", "out"), ("l", "in"))],
            "inputs": [{ "name": "P", "component": "p" }],
            "outputs": [],
        }],
    }));
    let errors = Simulator::load(&description).expect_err("a button is not a pin");
    assert_eq!(
        errors.into_iter().map(|d| d.code).collect::<Vec<_>>(),
        [Code::InvalidPin]
    );
}
