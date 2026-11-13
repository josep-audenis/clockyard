//! Devices (ADR 0021): a seven-segment display, a pixel screen and a keyboard,
//! each reusing behaviour the engine already has.

use serde_json::{Value, json};
use sim_core::{CircuitDescription, Code, Diagnostic, Simulator};

fn description(value: Value) -> CircuitDescription {
    serde_json::from_value(value).expect("description")
}

fn load(value: Value) -> Simulator {
    let (sim, warnings) = Simulator::load(&description(value)).expect("valid");
    assert_eq!(warnings, vec![]);
    sim
}

fn errors(value: Value) -> Vec<Diagnostic> {
    Simulator::load(&description(value)).expect_err("invalid")
}

fn wire(id: &str, from: (&str, &str), to: (&str, &str)) -> Value {
    json!({
        "id": id,
        "from": { "component": from.0, "port": from.1 },
        "to": { "component": to.0, "port": to.1 },
    })
}

fn value(sim: &Simulator, component: &str, port: &str) -> u32 {
    sim.nets()[sim.port_nets()[component][port] as usize]
}

#[test]
fn a_keyboard_drives_an_eight_bit_code_like_a_switch() {
    let mut sim = load(json!({
        "components": [
            { "id": "k", "kind": "keyboard" },
            { "id": "s", "kind": "seg7" },
        ],
        "connections": [wire("w", ("k", "out"), ("s", "seg"))],
    }));
    assert_eq!(value(&sim, "s", "seg"), 0, "no key held");
    sim.set_input("k", 0x41).unwrap();
    assert_eq!(value(&sim, "s", "seg"), 0x41);
    sim.set_inputs(&[("k", 0x83)]).unwrap();
    assert_eq!(value(&sim, "s", "seg"), 0x83, "an arrow");
    let err = sim.set_input("k", 256).unwrap_err();
    assert!(err.contains("8 bits"), "{err}");
    // A seven-segment display is not an input.
    assert!(
        sim.set_input("s", 1)
            .unwrap_err()
            .contains("not a switch or keyboard")
    );
}

#[test]
fn seg7_and_keyboard_are_eight_bits_and_take_no_width() {
    for kind in ["seg7", "keyboard"] {
        let found = errors(json!({
            "components": [{ "id": "p", "kind": kind, "width": 8 }],
            "connections": [],
        }));
        assert_eq!(found[0].code, Code::InvalidWidth, "{kind}");
    }
    // An 8-bit display cannot take a 4-bit signal.
    let found = errors(json!({
        "components": [
            { "id": "a", "kind": "switch", "width": 4 },
            { "id": "s", "kind": "seg7" },
        ],
        "connections": [wire("w", ("a", "out"), ("s", "seg"))],
    }));
    assert_eq!(found[0].code, Code::WidthMismatch);
}

#[test]
fn a_screen_is_a_ram_whose_words_are_the_picture() {
    let mut sim = load(json!({
        "components": [
            { "id": "a", "kind": "switch", "width": 7 },
            { "id": "d", "kind": "switch", "width": 8 },
            { "id": "we", "kind": "switch" },
            { "id": "c", "kind": "switch" },
            { "id": "m", "kind": "screen", "width": 8, "addressWidth": 7 },
        ],
        "connections": [
            wire("w0", ("a", "out"), ("m", "addr")),
            wire("w1", ("d", "out"), ("m", "din")),
            wire("w2", ("we", "out"), ("m", "we")),
            wire("w3", ("c", "out"), ("m", "clk")),
        ],
    }));
    assert_eq!(
        sim.memory("m").map(<[u32]>::len),
        Some(128),
        "32 × 32 pixels"
    );
    sim.set_inputs(&[("a", 5), ("d", 0x81), ("we", 1)]).unwrap();
    sim.set_input("c", 1).unwrap();
    assert_eq!(sim.memory("m").unwrap()[5], 0x81);
    assert_eq!(value(&sim, "m", "out"), 0x81, "reads back like a RAM");
    sim.reset();
    assert!(sim.memory("m").unwrap().iter().all(|&w| w == 0));
}
