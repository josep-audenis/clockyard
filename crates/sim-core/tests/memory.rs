//! ROM and RAM (ADR 0018): reads, clocked writes, reset, validation, limits.

use serde_json::{Value, json};
use sim_core::{CircuitDescription, Code, Diagnostic, Simulator};

/// "a.q" → a port, "j" → a junction.
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

fn description(value: Value) -> CircuitDescription {
    serde_json::from_value(value).expect("description")
}

fn load(value: Value) -> Simulator {
    Simulator::load(&description(value)).expect("valid").0
}

fn errors(value: Value) -> Vec<Diagnostic> {
    Simulator::load(&description(value)).expect_err("invalid")
}

fn value(sim: &Simulator, component: &str, port: &str) -> u32 {
    sim.nets()[sim.port_nets()[component][port] as usize]
}

#[test]
fn a_rom_reads_the_word_at_its_address_and_zero_past_its_data() {
    let mut sim = load(json!({
        "components": [
            { "id": "a", "kind": "switch", "width": 2 },
            { "id": "r", "kind": "rom", "width": 8, "addressWidth": 2, "data": [5, 6, 7] },
        ],
        "connections": wires(&[("a.out", "r.addr")]),
    }));
    let mut seen = Vec::new();
    for a in 0..4 {
        sim.set_input("a", a).unwrap();
        seen.push(value(&sim, "r", "out"));
    }
    assert_eq!(seen, [5, 6, 7, 0]);
    assert_eq!(sim.memory("r"), Some(&[5, 6, 7, 0][..]));
}

/// A 4-word RAM with a switch on each input.
fn hand_ram() -> Simulator {
    load(json!({
        "components": [
            { "id": "a", "kind": "switch", "width": 2 },
            { "id": "d", "kind": "switch", "width": 8 },
            { "id": "we", "kind": "switch" },
            { "id": "c", "kind": "switch" },
            { "id": "m", "kind": "ram", "width": 8, "addressWidth": 2 },
        ],
        "connections": wires(&[("a.out", "m.addr"), ("d.out", "m.din"), ("we.out", "m.we"), ("c.out", "m.clk")]),
    }))
}

#[test]
fn a_ram_writes_on_a_rising_clock_with_we_and_only_then() {
    let mut sim = hand_ram();
    sim.set_inputs(&[("a", 1), ("d", 42)]).unwrap();
    sim.set_input("c", 1).unwrap();
    assert_eq!(sim.memory("m"), Some(&[0, 0, 0, 0][..]), "we is off");
    sim.set_input("c", 0).unwrap();
    sim.set_input("we", 1).unwrap();
    assert_eq!(sim.memory("m"), Some(&[0, 0, 0, 0][..]), "no edge yet");
    sim.set_input("c", 1).unwrap();
    assert_eq!(sim.memory("m"), Some(&[0, 42, 0, 0][..]));
    assert_eq!(value(&sim, "m", "out"), 42, "reads the word just written");
    sim.set_input("a", 2).unwrap();
    assert_eq!(value(&sim, "m", "out"), 0);
    // Reset clears the cells.
    sim.reset();
    assert_eq!(sim.memory("m"), Some(&[0, 0, 0, 0][..]));
}

#[test]
fn a_ram_writing_what_it_reads_samples_the_state_before_the_edge() {
    // din is NOT out: each cycle the cell flips once. With post-edge data it would flip again and again.
    let mut sim = load(json!({
        "components": [
            { "id": "k", "kind": "clock" },
            { "id": "we", "kind": "switch" },
            { "id": "n", "kind": "not", "width": 8 },
            { "id": "m", "kind": "ram", "width": 8, "addressWidth": 1 },
        ],
        "connections": wires(&[("m.out", "n.in"), ("n.out", "m.din"), ("we.out", "m.we"), ("k.out", "m.clk")]),
    }));
    sim.set_input("we", 1).unwrap();
    assert_eq!(sim.step_cycle(), None);
    assert_eq!(sim.memory("m"), Some(&[0xFF, 0][..]));
    sim.step_cycle();
    assert_eq!(sim.memory("m"), Some(&[0, 0][..]));
}

#[test]
fn reset_clears_ram_and_keeps_rom() {
    let mut sim = load(json!({
        "components": [
            { "id": "k", "kind": "clock" },
            { "id": "we", "kind": "switch" },
            { "id": "r", "kind": "rom", "width": 8, "addressWidth": 1, "data": [9, 8] },
            { "id": "m", "kind": "ram", "width": 8, "addressWidth": 1 },
        ],
        "connections": wires(&[("r.out", "m.din"), ("we.out", "m.we"), ("k.out", "m.clk")]),
    }));
    sim.set_input("we", 1).unwrap();
    sim.step_cycle();
    assert_eq!(sim.memory("m"), Some(&[9, 0][..]));
    sim.reset();
    assert_eq!(sim.memory("m"), Some(&[0, 0][..]));
    assert_eq!(sim.memory("r"), Some(&[9, 8][..]));
}

#[test]
fn memory_props_are_checked() {
    let one = |part: Value| errors(json!({ "components": [part], "connections": [] }));
    let code = |part: Value| one(part)[0].code;
    assert_eq!(
        code(json!({ "id": "r", "kind": "rom", "addressWidth": 17 })),
        Code::InvalidWidth
    );
    assert_eq!(
        code(json!({ "id": "r", "kind": "rom", "addressWidth": 2.5 })),
        Code::InvalidWidth
    );
    assert_eq!(
        code(json!({ "id": "g", "kind": "and", "addressWidth": 4 })),
        Code::InvalidWidth
    );
    assert_eq!(
        code(json!({ "id": "m", "kind": "ram", "data": [1] })),
        Code::InvalidContents
    );
    let wide = one(json!({ "id": "r", "kind": "rom", "width": 8, "data": [256] }));
    assert_eq!(
        (wide[0].code, wide[0].message.contains("0 to 255")),
        (Code::InvalidContents, true)
    );
    let long = one(json!({ "id": "r", "kind": "rom", "addressWidth": 2, "data": [0, 0, 0, 0, 0] }));
    assert_eq!(long[0].code, Code::InvalidContents);
    // Defaults: 8-bit words, 8 address bits, ROM words padded with 0.
    let sim = load(json!({ "components": [{ "id": "r", "kind": "rom" }], "connections": [] }));
    assert_eq!(sim.memory("r").map(<[u32]>::len), Some(256));
}

#[test]
fn memory_words_are_limited_once_components_are_expanded() {
    // Seventeen instances of a definition holding a 64K-word ROM: more than 2^20 words in all.
    let big = json!({
        "id": "big", "components": [{ "id": "r", "kind": "rom", "addressWidth": 16 }],
        "connections": [], "inputs": [], "outputs": [],
    });
    let instances: Vec<Value> = (0..17)
        .map(|i| json!({ "id": format!("i{i}"), "kind": "custom", "definition": "big" }))
        .collect();
    let found = errors(json!({ "components": instances, "connections": [], "definitions": [big] }));
    assert_eq!(
        found.iter().map(|d| d.code).collect::<Vec<_>>(),
        [Code::TooLarge]
    );
}

#[test]
fn a_memory_inside_an_instance_is_read_by_its_elaborated_id() {
    let store = json!({
        "id": "store", "components": [{ "id": "m", "kind": "ram", "addressWidth": 4 }],
        "connections": [], "inputs": [], "outputs": [],
    });
    let sim = load(json!({
        "components": [{ "id": "x", "kind": "custom", "definition": "store" }, { "id": "g", "kind": "not" }],
        "connections": [], "definitions": [store],
    }));
    assert_eq!(sim.memory("x/m").map(<[u32]>::len), Some(16));
    assert_eq!(sim.memory("g"), None);
    assert_eq!(sim.memory("nothing"), None);
}
