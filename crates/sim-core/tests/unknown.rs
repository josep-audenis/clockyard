//! Unknown values (ADR 0035, step 2): what parts do with `X`, clocks that
//! may or may not have risen, and loops that settle to `X`. Until the
//! tri-state buffer exists, the only source of `X` is a loop that does not
//! settle: `x = NAND(en, x)` is a known 1 while `en` is 0, and `X` once it is 1.

use serde_json::{Value, json};
use sim_core::{CircuitDescription, Code, Simulator};

/// "a.q" → a port.
fn end(spec: &str) -> Value {
    let (component, port) = spec.split_once('.').expect("a port");
    json!({ "component": component, "port": port })
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

/// Loads parts and wires, with the `X` source `x` and its switch `en` added.
fn load(mut parts: Vec<Value>, list: &[(&str, &str)]) -> Simulator {
    parts.push(json!({ "id": "en", "kind": "switch" }));
    parts.push(json!({ "id": "x", "kind": "nand" }));
    let mut all = vec![("en.out", "x.a"), ("x.out", "x.b")];
    all.extend_from_slice(list);
    let description: CircuitDescription =
        serde_json::from_value(json!({ "components": parts, "connections": wires(&all) }))
            .expect("description");
    let (sim, warnings) = Simulator::load(&description).expect("valid");
    assert!(
        warnings.iter().all(|d| !d.is_error()),
        "loads settled: {warnings:?}"
    );
    sim
}

fn part(id: &str, kind: &str) -> Value {
    json!({ "id": id, "kind": kind })
}

fn wide(id: &str, kind: &str, width: u32) -> Value {
    json!({ "id": id, "kind": kind, "width": width })
}

/// A port's value and its unknown bits.
fn bits(sim: &Simulator, component: &str, port: &str) -> (u32, u32) {
    let net = sim.port_nets()[component][port] as usize;
    (sim.nets()[net], sim.unknown()[net])
}

const X: (u32, u32) = (1, 1);

/// Turns the `X` source on: the settle that finds the loop reports it.
fn unknown(sim: &mut Simulator) {
    let report = sim.set_input("en", 1).unwrap().expect("the loop");
    assert_eq!((report.code, report.is_error()), (Code::Unstable, true));
    // It names the loop, and with it whatever was still following the loop when the limit came.
    assert!(report.ids.contains(&"x".to_string()), "{:?}", report.ids);
    assert_eq!(bits(sim, "x", "out"), X);
}

/// Sets a switch; a warning that the loop's `X` remains is expected, an error is not.
fn set(sim: &mut Simulator, switch: &str, value: u32) {
    let report = sim.set_input(switch, value).unwrap();
    assert!(report.is_none_or(|d| !d.is_error()), "{switch} = {value}");
}

#[test]
fn a_gate_is_no_more_unknown_than_its_inputs_force() {
    let mut sim = load(
        vec![
            part("s", "switch"),
            part("and", "and"),
            part("nand", "nand"),
            part("or", "or"),
            part("nor", "nor"),
            part("xor", "xor"),
            part("xnor", "xnor"),
            part("not", "not"),
            // Beside the loop, and not reading it.
            part("p", "switch"),
            part("far", "not"),
        ],
        &[
            ("x.out", "and.a"),
            ("s.out", "and.b"),
            ("x.out", "nand.a"),
            ("s.out", "nand.b"),
            ("x.out", "or.a"),
            ("s.out", "or.b"),
            ("x.out", "nor.a"),
            ("s.out", "nor.b"),
            ("x.out", "xor.a"),
            ("s.out", "xor.b"),
            ("x.out", "xnor.a"),
            ("s.out", "xnor.b"),
            ("x.out", "not.in"),
            ("p.out", "far.in"),
        ],
    );
    unknown(&mut sim);
    let read = |sim: &Simulator| {
        ["and", "nand", "or", "nor", "xor", "xnor", "not"].map(|g| bits(sim, g, "out"))
    };
    // With 0: AND is 0 and NAND 1 whatever the other input is.
    assert_eq!(read(&sim), [(0, 0), (1, 0), X, X, X, X, X]);
    set(&mut sim, "s", 1);
    // With 1: OR is 1 and NOR 0.
    assert_eq!(read(&sim), [X, X, (1, 0), (0, 0), X, X, X]);
    // Logic that does not read the loop keeps its values, and follows its switch.
    assert_eq!(bits(&sim, "far", "out"), (1, 0));
    set(&mut sim, "p", 1);
    assert_eq!(bits(&sim, "far", "out"), (0, 0));
    // The loop broken, everything is known again and the warning goes.
    assert_eq!(sim.set_input("en", 0), Ok(None));
    assert_eq!(
        read(&sim),
        [(1, 0), (0, 0), (1, 0), (0, 0), (0, 0), (1, 0), (0, 0)]
    );
    assert!(sim.unknown().iter().all(|&u| u == 0));
}

#[test]
fn an_unknown_bit_stays_one_bit_through_buses_merges_and_splits() {
    let mut sim = load(
        vec![
            wide("t", "switch", 3),
            json!({ "id": "m", "kind": "merge", "fields": [1, 3] }),
            wide("n", "not", 4),
            json!({ "id": "sp", "kind": "split", "fields": [1, 3] }),
        ],
        &[
            ("x.out", "m.f0"),
            ("t.out", "m.f1"),
            ("m.out", "n.in"),
            ("n.out", "sp.in"),
        ],
    );
    set(&mut sim, "t", 0b101);
    unknown(&mut sim);
    assert_eq!(bits(&sim, "m", "out"), (0b1011, 0b0001));
    assert_eq!(bits(&sim, "n", "out"), (0b0101, 0b0001));
    assert_eq!(bits(&sim, "sp", "f0"), X);
    assert_eq!(bits(&sim, "sp", "f1"), (0b010, 0));
}

/// A flip-flop `f` on `d`, clocked by `clk = AND(x, c)`: a known 0 while `c` is 0, `x` while it is 1.
fn clocked() -> Simulator {
    load(
        vec![
            part("c", "switch"),
            part("clk", "and"),
            part("d", "switch"),
            part("f", "dff"),
            part("c2", "switch"),
            part("g", "dff"),
        ],
        &[
            ("x.out", "clk.a"),
            ("c.out", "clk.b"),
            ("d.out", "f.d"),
            ("clk.out", "f.clk"),
            // g samples the loop itself, on a clock that is always known.
            ("x.out", "g.d"),
            ("c2.out", "g.clk"),
        ],
    )
}

#[test]
fn a_clock_that_may_have_risen_leaves_only_the_bits_sampling_would_not_change() {
    let mut sim = clocked();
    set(&mut sim, "d", 1);
    set(&mut sim, "c", 1);
    set(&mut sim, "c", 0);
    assert_eq!(bits(&sim, "f", "q"), (1, 0), "a certain edge");
    unknown(&mut sim);
    assert_eq!(bits(&sim, "clk", "out"), (0, 0), "AND with 0");
    assert_eq!(bits(&sim, "f", "q"), (1, 0));
    // The clock unknown after 0: it may have risen, but d equals what is stored.
    set(&mut sim, "c", 1);
    assert_eq!(bits(&sim, "clk", "out"), X);
    assert_eq!(bits(&sim, "f", "q"), (1, 0));
    // Data that moves under an unknown clock: sampled or not, nobody knows.
    set(&mut sim, "d", 0);
    assert_eq!(bits(&sim, "f", "q"), X);
    // A known 0 after unknown is no edge, and neither is the loop coming to rest. The warning goes with the
    // loop's own X: the flip-flop was not part of the loop, and holds its X without one.
    set(&mut sim, "c", 0);
    assert_eq!(sim.set_input("en", 0), Ok(None));
    assert_eq!(bits(&sim, "f", "q"), X);
    // A certain edge loads known data, and nothing is unknown any more.
    assert_eq!(sim.set_input("c", 1), Ok(None));
    assert_eq!(bits(&sim, "f", "q"), (0, 0));
}

#[test]
fn a_certain_edge_stores_unknown_data_as_x() {
    let mut sim = clocked();
    unknown(&mut sim);
    set(&mut sim, "c2", 1);
    assert_eq!(bits(&sim, "g", "q"), X);
    // It keeps it when the loop is broken, until an edge loads known data.
    set(&mut sim, "c2", 0);
    set(&mut sim, "en", 0);
    assert_eq!(bits(&sim, "g", "q"), X);
    set(&mut sim, "c2", 1);
    assert_eq!(bits(&sim, "g", "q"), (1, 0));
}

#[test]
fn a_clock_that_settles_unknown_at_a_load_or_a_reset_counts_once_and_what_follows_settles() {
    // o = NOR(dis, o) oscillates from the start. It clocks a register with feedback: d1 = NOT q0, d0 = q1.
    // One possible edge makes bit 1 X (0 against 1); what follows makes d0 X, and so bit 0.
    let description: CircuitDescription = serde_json::from_value(json!({
        "components": [
            part("dis", "switch"), part("o", "nor"), part("f1", "dff"), part("f0", "dff"), part("n", "not"),
        ],
        "connections": wires(&[
            ("dis.out", "o.a"), ("o.out", "o.b"),
            ("o.out", "f1.clk"), ("o.out", "f0.clk"),
            ("f0.q", "n.in"), ("n.out", "f1.d"), ("f1.q", "f0.d"),
        ]),
    }))
    .unwrap();
    let (mut sim, warnings) = Simulator::load(&description).expect("valid");
    assert_eq!(
        warnings.iter().map(|d| d.code).collect::<Vec<_>>(),
        [Code::Unstable]
    );
    let state = |sim: &Simulator| [bits(sim, "f1", "q"), bits(sim, "f0", "q")];
    assert_eq!(state(&sim), [X, X]);
    assert_eq!(sim.reset().map(|d| d.code), Some(Code::Unstable));
    assert_eq!(state(&sim), [X, X]);
    // The clock at rest, known 0 after unknown: no edge, so the register holds its X.
    set(&mut sim, "dis", 1);
    assert_eq!(bits(&sim, "o", "out"), (0, 0));
    assert_eq!(state(&sim), [X, X]);
    // Reset with the clock at rest: everything known.
    assert_eq!(sim.reset(), None);
    assert_eq!(state(&sim), [(0, 0), (0, 0)]);
}

/// A 4-word RAM `m` with a switch on each input, clocked by `clk = AND(x, c)`.
fn ram() -> Simulator {
    load(
        vec![
            part("c", "switch"),
            part("clk", "and"),
            wide("a", "switch", 2),
            wide("d", "switch", 8),
            part("we", "switch"),
            json!({ "id": "m", "kind": "ram", "width": 8, "addressWidth": 2 }),
        ],
        &[
            ("x.out", "clk.a"),
            ("c.out", "clk.b"),
            ("clk.out", "m.clk"),
            ("a.out", "m.addr"),
            ("d.out", "m.din"),
            ("we.out", "m.we"),
        ],
    )
}

#[test]
fn a_ram_write_that_cannot_be_known_marks_the_cell_it_may_have_reached() {
    let mut sim = ram();
    assert_eq!(
        sim.memory_unknown("m"),
        Some(&[][..]),
        "empty while all is known"
    );
    sim.set_inputs(&[("a", 1), ("d", 0xF0)]).unwrap();
    unknown(&mut sim);
    // The clock unknown with we at 0: nothing can have been written.
    set(&mut sim, "c", 1);
    assert_eq!(sim.memory_unknown("m"), Some(&[][..]));
    // we raised under that clock: the cell is 0 or 0xF0, so the bits that differ are X.
    set(&mut sim, "we", 1);
    assert_eq!(sim.memory("m"), Some(&[0, 0xF0, 0, 0][..]));
    assert_eq!(sim.memory_unknown("m"), Some(&[0, 0xF0, 0, 0][..]));
    assert_eq!(bits(&sim, "m", "out"), (0xF0, 0xF0));
    // The address moved while we is still 1: that cell too. Then we at 0: no more.
    set(&mut sim, "a", 2);
    set(&mut sim, "we", 0);
    set(&mut sim, "a", 3);
    assert_eq!(sim.memory_unknown("m"), Some(&[0, 0xF0, 0xF0, 0][..]));
    // Reset clears the cells, and with we at 0 the unknown clock writes nothing.
    assert_eq!(sim.reset().map(|d| d.code), Some(Code::Unstable));
    assert_eq!(sim.memory("m"), Some(&[0, 0, 0, 0][..]));
    assert_eq!(sim.memory_unknown("m"), Some(&[][..]));
}

#[test]
fn an_unknown_address_reads_all_x_and_a_write_there_reaches_every_cell() {
    let mut sim = load(
        vec![
            part("hi", "switch"),
            json!({ "id": "addr", "kind": "merge", "fields": [1, 1] }),
            part("c", "switch"),
            wide("d", "switch", 8),
            part("we", "switch"),
            json!({ "id": "m", "kind": "ram", "width": 8, "addressWidth": 2 }),
            json!({ "id": "r", "kind": "rom", "width": 8, "addressWidth": 2, "data": [1, 2, 3, 4] }),
        ],
        &[
            ("x.out", "addr.f0"),
            ("hi.out", "addr.f1"),
            ("addr.out", "m.addr"),
            ("addr.out", "r.addr"),
            ("c.out", "m.clk"),
            ("d.out", "m.din"),
            ("we.out", "m.we"),
        ],
    );
    assert_eq!(
        bits(&sim, "r", "out"),
        (2, 0),
        "address 1 while the loop rests at 1"
    );
    sim.set_inputs(&[("d", 5), ("we", 1)]).unwrap();
    unknown(&mut sim);
    assert_eq!(bits(&sim, "r", "out"), (0xFF, 0xFF));
    assert_eq!(bits(&sim, "m", "out"), (0xFF, 0xFF));
    // A certain edge, but where it wrote is unknown: every cell is 0 or 5.
    set(&mut sim, "c", 1);
    assert_eq!(sim.memory("m"), Some(&[5; 4][..]));
    assert_eq!(sim.memory_unknown("m"), Some(&[5; 4][..]));
    assert_eq!(
        sim.memory_unknown("r"),
        Some(&[][..]),
        "a ROM is always known"
    );
    assert_eq!(sim.memory_unknown("hi"), None);
}

#[test]
fn a_latch_released_from_both_inputs_at_once_is_unknown_until_one_decides() {
    // q = NOR(r, qn), qn = NOR(s, q). From all zeros it races already.
    let description: CircuitDescription = serde_json::from_value(json!({
        "components": [part("s", "switch"), part("r", "switch"), part("q", "nor"), part("qn", "nor")],
        "connections": wires(&[("r.out", "q.a"), ("qn.out", "q.b"), ("s.out", "qn.a"), ("q.out", "qn.b")]),
    }))
    .unwrap();
    let (mut sim, warnings) = Simulator::load(&description).expect("valid");
    assert_eq!(warnings[0].code, Code::Unstable);
    let latch = |sim: &Simulator| [bits(sim, "q", "out"), bits(sim, "qn", "out")];
    assert_eq!(latch(&sim), [X, X]);
    assert_eq!(sim.set_inputs(&[("s", 1), ("r", 1)]), Ok(None));
    assert_eq!(latch(&sim), [(0, 0), (0, 0)]);
    let race = sim
        .set_inputs(&[("s", 0), ("r", 0)])
        .unwrap()
        .expect("a race");
    assert_eq!(
        (race.code, race.ids),
        (Code::Unstable, vec!["q".to_string(), "qn".to_string()])
    );
    assert_eq!(latch(&sim), [X, X]);
    assert_eq!(sim.set_input("s", 1), Ok(None));
    assert_eq!(latch(&sim), [(1, 0), (0, 0)]);
}

#[test]
fn run_until_does_not_take_a_net_leaving_x_for_a_rise() {
    // g = NAND(k, g): a known 1 while the clock is low, X while it is high. The LED is on g.
    let description: CircuitDescription = serde_json::from_value(json!({
        "components": [part("k", "clock"), part("g", "nand"), part("l", "led")],
        "connections": wires(&[("k.out", "g.a"), ("g.out", "g.b"), ("g.out", "l.in")]),
    }))
    .unwrap();
    let mut sim = Simulator::load(&description).expect("valid").0;
    let led = sim.port_nets()["l"]["in"];
    let first = sim.tick_until(10, led);
    assert_eq!((first.ticks, first.rose), (1, false));
    assert_eq!(first.unstable.map(|d| d.code), Some(Code::Unstable));
    assert_eq!(bits(&sim, "g", "out"), X);
    // Tick 2 takes it from X to a known 1, which is not a rise; tick 3 does not settle again.
    let second = sim.tick_until(10, led);
    assert_eq!((second.ticks, second.rose), (2, false));
    assert_eq!(second.unstable.map(|d| d.code), Some(Code::Unstable));
}
