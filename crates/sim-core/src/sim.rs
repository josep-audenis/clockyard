//! Compile a circuit description into a netlist and settle it with
//! synchronous deltas (`docs/simulation-model.md`, ADR 0006).

use std::collections::BTreeMap;

use crate::catalog::{Kind, Port, mask};
use crate::description::{CircuitDescription, Code, Diagnostic, Endpoint, Shape};
use crate::elaborate::{elaborate, lift, top};

/// Net 0 is never driven: unconnected inputs read it as 0.
const GROUND: u32 = 0;

/// Component ID → port name → net index.
pub type PortNets = BTreeMap<String, BTreeMap<String, u32>>;

/// A compiled circuit and its current signal values.
///
/// Parts are indexed in ascending document ID order, so the same description
/// always compiles to the same indices. Parts compile to primitives (ADR 0014),
/// each with one output: primitive `p` drives net `p + 1`.
#[derive(Debug)]
pub struct Simulator {
    ids: Vec<String>,
    kinds: Vec<Kind>,
    prims: Vec<Prim>,
    /// Net → the primitives reading it, each once.
    fanout: Vec<Vec<u32>>,
    nets: Vec<u32>,
    wire_nets: BTreeMap<String, u32>,
    wire_widths: BTreeMap<String, u32>,
    port_nets: PortNets,
    /// Primitives still dirty when the last settle hit its delta limit; the
    /// next settle resumes them, so a live loop is reported until it resolves.
    unsettled: Vec<u32>,
    /// Virtual time in ticks, one per half clock period: low at even ticks (ADR 0017).
    time: u64,
    /// The clock primitives, set to the clock's level on each tick.
    clocks: Vec<u32>,
    /// Whether any primitive holds state (a flip-flop or RAM), so settles need a snapshot.
    stateful: bool,
    /// Net values as the current settle started: the pre-edge state flip-flops sample.
    snapshot: Vec<u32>,
}

/// What a primitive computes. A split compiles to one `Field` per field; an
/// LED, which drives nothing, to no primitive.
#[derive(Debug)]
enum Op {
    Switch,
    Gate(Kind),
    Field {
        shift: u32,
    },
    Merge {
        shifts: Vec<u32>,
    },
    /// The global clock's level, set on each tick.
    Clock,
    /// Inputs `d`, `clk`; outputs its state. `clk_was` is the clock value it last saw.
    Dff {
        clk_was: bool,
    },
    /// Input `addr`; outputs the word there (ADR 0018).
    Rom {
        words: Vec<u32>,
    },
    /// Inputs `addr`, `din`, `we`, `clk`; outputs the cell at `addr`, written on a rising `clk`.
    Ram {
        cells: Vec<u32>,
        clk_was: bool,
    },
}

#[derive(Debug)]
struct Prim {
    op: Op,
    /// Net read by each input.
    inputs: Vec<u32>,
    /// The output's width, as a mask every result is cut to.
    mask: u32,
    /// The part it came from, named in diagnostics.
    part: u32,
    /// A switch's user-set value, a clock's level, or a flip-flop's stored value.
    state: u32,
}

/// A node of the connection graph: a part's port (part, slot) or a junction.
#[derive(Clone, Copy)]
enum End {
    Port(usize, usize),
    /// `true` for a custom component's pin, with that pin's width.
    Junction(bool, Option<u32>),
}

/// A runtime diagnostic with its IDs lifted to top-level IDs.
fn lift_one(diagnostic: Diagnostic) -> Diagnostic {
    lift(vec![diagnostic]).remove(0)
}

/// Union-find root of `node`, halving paths on the way.
pub(crate) fn find(parent: &mut [usize], mut node: usize) -> usize {
    while parent[node] != node {
        parent[node] = parent[parent[node]];
        node = parent[node];
    }
    node
}

/// "wire w0 connects" or "wires w0, w1 connect".
pub(crate) fn wires_verb(wires: &[String], verb: &str) -> String {
    let (s, verb_s) = if wires.len() == 1 {
        ("", "s")
    } else {
        ("s", "")
    };
    format!("wire{s} {} {verb}{verb_s}", wires.join(", "))
}

/// "1 bit" or "8 bits".
pub(crate) fn bits(width: u32) -> String {
    format!("{width} bit{}", if width == 1 { "" } else { "s" })
}

/// "wires w1, w2 connect ports of different widths: `a.out` is 8 bits, `l.in` is 1 bit",
/// naming one port for each width found.
pub(crate) fn width_mismatch(wires: &[String], ports: &[(String, u32)]) -> String {
    let found: Vec<String> = ports
        .iter()
        .map(|(port, width)| format!("`{port}` is {}", bits(*width)))
        .collect();
    format!(
        "{} ports of different widths: {}",
        wires_verb(wires, "connect"),
        found.join(", ")
    )
}

/// One net as joined by wires: its output and input ports (part, slot), wires,
/// and the first port of each width it joins.
#[derive(Default)]
struct Group<'a> {
    outputs: Vec<(usize, usize)>,
    inputs: Vec<(usize, usize)>,
    widths: Vec<(u32, usize, usize)>,
    wires: Vec<&'a str>,
    /// Reaches a custom component's pin: with no output, a pin left unconnected.
    pin: bool,
    /// The width of a pin it reaches, for a net with no port to take one from.
    pin_width: Option<u32>,
}

impl Simulator {
    /// Validates and compiles `description`, then settles it from all-zero
    /// nets. Returns the simulator with warnings (unconnected inputs, an
    /// unstable initial settle), or the validation errors.
    pub fn load(
        description: &CircuitDescription,
    ) -> Result<(Simulator, Vec<Diagnostic>), Vec<Diagnostic>> {
        // Custom components are flattened first (ADR 0012); diagnostics name top-level IDs.
        let flat = elaborate(description)?;
        match Self::compile(&flat) {
            Ok((sim, warnings)) => Ok((sim, lift(warnings))),
            Err(errors) => Err(lift(errors)),
        }
    }

    fn compile(
        description: &CircuitDescription,
    ) -> Result<(Simulator, Vec<Diagnostic>), Vec<Diagnostic>> {
        let mut errors = Vec::new();

        let mut sorted: Vec<_> = description.components.iter().collect();
        sorted.sort_by(|a, b| a.id.cmp(&b.id));
        let mut ids = Vec::new();
        let mut kinds = Vec::new();
        let mut ports: Vec<Vec<Port>> = Vec::new();
        let mut shapes: Vec<Shape> = Vec::new();
        for (i, component) in sorted.iter().enumerate() {
            if i > 0 && sorted[i - 1].id == component.id {
                let message = format!("component ID {} is used more than once", component.id);
                errors.push(Diagnostic::error(
                    Code::DuplicateId,
                    message,
                    vec![component.id.clone()],
                ));
            } else if let Some(kind) = Kind::from_name(&component.kind) {
                let shape = component
                    .shape()
                    .expect("shapes are checked level by level before compiling");
                ids.push(component.id.clone());
                kinds.push(kind);
                ports.push(kind.ports(&shape));
                shapes.push(shape);
            } else {
                let message = format!("{} has unknown kind '{}'", component.id, component.kind);
                errors.push(Diagnostic::error(
                    Code::UnknownKind,
                    message,
                    vec![component.id.clone()],
                ));
            }
        }
        // Graph nodes: every port of every part, then every junction.
        let mut ends = Vec::new();
        let mut base = Vec::new();
        for (c, part_ports) in ports.iter().enumerate() {
            base.push(ends.len());
            ends.extend((0..part_ports.len()).map(|slot| End::Port(c, slot)));
        }
        let mut junctions = BTreeMap::new();
        for junction in &description.junctions {
            let id = junction.id.as_str();
            if junctions.contains_key(id) || ids.binary_search(&junction.id).is_ok() {
                let message = format!("junction ID {id} is used more than once");
                errors.push(Diagnostic::error(
                    Code::DuplicateId,
                    message,
                    vec![id.into()],
                ));
            } else {
                junctions.insert(id, ends.len());
                ends.push(End::Junction(junction.pin, junction.width));
            }
        }
        // Wire errors against unknown components would only repeat these.
        if !errors.is_empty() {
            return Err(errors);
        }

        let resolve = |wire: &str, end: &Endpoint| -> Result<usize, Diagnostic> {
            let port = match end {
                Endpoint::Port(port) => port,
                Endpoint::Junction { junction } => {
                    return junctions.get(junction.as_str()).copied().ok_or_else(|| {
                        let message = format!("wire {wire} references unknown junction {junction}");
                        Diagnostic::error(Code::UnknownJunction, message, vec![wire.into()])
                    });
                }
            };
            let Ok(c) = ids.binary_search(&port.component) else {
                let message = format!(
                    "wire {wire} references unknown component {}",
                    port.component
                );
                return Err(Diagnostic::error(
                    Code::UnknownComponent,
                    message,
                    vec![wire.into()],
                ));
            };
            match ports[c].iter().position(|p| p.name == port.port) {
                Some(slot) => Ok(base[c] + slot),
                None => {
                    let message = format!(
                        "wire {wire}: {} {} has no port '{}'",
                        kinds[c].name(),
                        port.component,
                        port.port
                    );
                    Err(Diagnostic::error(
                        Code::UnknownPort,
                        message,
                        vec![wire.into(), port.component.clone()],
                    ))
                }
            }
        };

        // Join every port and junction that a wire connects (ADR 0010).
        let mut parent: Vec<usize> = (0..ends.len()).collect();
        let mut joined = Vec::new();
        let mut wire_ids = std::collections::BTreeSet::new();
        for wire in &description.connections {
            if !wire_ids.insert(wire.id.as_str()) {
                let message = format!("wire ID {} is used more than once", wire.id);
                errors.push(Diagnostic::error(
                    Code::DuplicateId,
                    message,
                    vec![wire.id.clone()],
                ));
                continue;
            }
            match (resolve(&wire.id, &wire.from), resolve(&wire.id, &wire.to)) {
                (Ok(a), Ok(b)) => {
                    let (ra, rb) = (find(&mut parent, a), find(&mut parent, b));
                    parent[ra] = rb;
                    joined.push((wire.id.as_str(), a));
                }
                (from, to) => errors.extend([from.err(), to.err()].into_iter().flatten()),
            }
        }
        if !errors.is_empty() {
            return Err(errors);
        }
        // Same-named junctions on one sheet are one net (ADR 0015). A flattened junction's sheet is
        // its instance path; keyed as a pair, a main-sheet "i1/x" never meets instance i1's "x".
        let mut labels: BTreeMap<(&str, &str), Vec<&str>> = BTreeMap::new();
        for junction in &description.junctions {
            if let Some(name) = junction.name.as_deref().filter(|n| !n.is_empty()) {
                let sheet = junction.id.rsplit_once('/').map_or("", |(path, _)| path);
                labels.entry((sheet, name)).or_default().push(&junction.id);
            }
        }
        for same in labels.values() {
            for id in &same[1..] {
                let (ra, rb) = (
                    find(&mut parent, junctions[same[0]]),
                    find(&mut parent, junctions[id]),
                );
                parent[ra] = rb;
            }
        }

        let mut groups: BTreeMap<usize, Group> = BTreeMap::new();
        for (wire, node) in &joined {
            let root = find(&mut parent, *node);
            groups.entry(root).or_default().wires.push(wire);
        }
        // Nets are checked in order of their first port or junction, never of
        // which way a wire was drawn, so diagnostics come out in a stable order.
        let mut order = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for (node, end) in ends.iter().enumerate() {
            let root = find(&mut parent, node);
            // Ports no wire touches stay alone: an output drives nothing, an input reads 0.
            let Some(group) = groups.get_mut(&root) else {
                continue;
            };
            if seen.insert(root) {
                order.push(root);
            }
            match *end {
                End::Port(c, slot) => {
                    let port = &ports[c][slot];
                    if group.widths.iter().all(|w| w.0 != port.width) {
                        group.widths.push((port.width, c, slot));
                    }
                    if port.output {
                        group.outputs.push((c, slot));
                    } else {
                        group.inputs.push((c, slot));
                    }
                }
                End::Junction(pin, width) => {
                    group.pin |= pin;
                    group.pin_width = group.pin_width.or(width);
                }
            }
        }

        // Every output port drives a net of its own, in part and slot order;
        // inputs read ground until a group gives them their driver's net.
        let mut net_count = 1;
        let mut port_net: Vec<Vec<u32>> = Vec::new();
        for part_ports in &ports {
            let mut nets = Vec::new();
            for port in part_ports {
                if port.output {
                    nets.push(net_count);
                    net_count += 1;
                } else {
                    nets.push(GROUND);
                }
            }
            port_net.push(nets);
        }

        let mut wire_nets = BTreeMap::new();
        let mut wire_widths = BTreeMap::new();
        for root in order {
            let group = &groups[&root];
            let mut wires: Vec<String> = group.wires.iter().map(|w| (*w).to_string()).collect();
            wires.sort();
            if group.widths.len() > 1 {
                let named: Vec<(String, u32)> = group
                    .widths
                    .iter()
                    .map(|&(width, c, slot)| (format!("{}.{}", ids[c], ports[c][slot].name), width))
                    .collect();
                let message = width_mismatch(&wires, &named);
                let mut culprits = wires;
                culprits.extend(group.widths.iter().map(|&(_, c, _)| ids[c].clone()));
                errors.push(Diagnostic::error(Code::WidthMismatch, message, culprits));
                continue;
            }
            let net = match (group.outputs.as_slice(), group.inputs.as_slice()) {
                ([(driver, slot)], _) => port_net[*driver][*slot],
                // A dangling branch: its input (if any) stays unconnected and reads 0.
                ([], []) | ([], [_]) => GROUND,
                // A pin left unconnected (an instance input outside, an output inside): its readers
                // read 0. Inputs joined with nothing driving them were caught level by level already.
                ([], _) if group.pin => GROUND,
                ([], _) => {
                    let message = format!(
                        "{} inputs and nothing drives them",
                        wires_verb(&wires, "connect")
                    );
                    errors.push(Diagnostic::error(Code::InputToInput, message, wires));
                    continue;
                }
                (_, []) => {
                    let count = match group.outputs.len() {
                        2 => "two".to_string(),
                        n => n.to_string(),
                    };
                    let message = format!("{} {count} outputs", wires_verb(&wires, "connect"));
                    errors.push(Diagnostic::error(Code::OutputToOutput, message, wires));
                    continue;
                }
                (_, [(reader, slot), ..]) => {
                    let message = format!(
                        "input {}.{} has more than one driver",
                        ids[*reader], ports[*reader][*slot].name
                    );
                    let mut culprits: Vec<String> =
                        group.inputs.iter().map(|(c, _)| ids[*c].clone()).collect();
                    culprits.dedup();
                    culprits.extend(wires);
                    errors.push(Diagnostic::error(Code::MultipleDrivers, message, culprits));
                    continue;
                }
            };
            for &(reader, slot) in &group.inputs {
                port_net[reader][slot] = net;
            }
            // A net with no port takes a pin's width, or is 1 bit if it reaches only plain junctions.
            let width = group
                .widths
                .first()
                .map(|w| w.0)
                .or(group.pin_width)
                .unwrap_or(1);
            wire_widths.extend(wires.iter().map(|w| (w.clone(), width)));
            wire_nets.extend(wires.into_iter().map(|w| (w, net)));
        }
        if !errors.is_empty() {
            return Err(errors);
        }

        // Warnings are per part port, so a split's `in` warns once, not once per field.
        let mut warnings = Vec::new();
        let mut port_nets = PortNets::new();
        for (c, part_ports) in ports.iter().enumerate() {
            let mut named = BTreeMap::new();
            for (port, &net) in part_ports.iter().zip(&port_net[c]) {
                if !port.output && net == GROUND {
                    let message =
                        format!("input {}.{} is unconnected and reads 0", ids[c], port.name);
                    warnings.push(Diagnostic::warning(
                        Code::UnconnectedInput,
                        message,
                        vec![ids[c].clone()],
                    ));
                }
                named.insert(port.name.to_string(), net);
            }
            port_nets.insert(ids[c].clone(), named);
        }

        // A name no other junction on its sheet carries: probably a typo that leaves a net cut.
        for ((_, name), same) in &labels {
            if let [id] = same.as_slice() {
                let message = format!("label `{name}` joins nothing else on this sheet");
                warnings.push(Diagnostic::warning(
                    Code::UnmatchedLabel,
                    message,
                    vec![(*id).to_string()],
                ));
            }
        }

        // Primitives in the order their output nets were numbered above.
        let mut prims = Vec::new();
        for (c, &kind) in kinds.iter().enumerate() {
            let nets = &port_net[c];
            let mut add = |op, inputs: &[u32], slot: usize| {
                debug_assert_eq!(nets[slot] as usize, prims.len() + 1);
                prims.push(Prim {
                    op,
                    inputs: inputs.to_vec(),
                    mask: mask(ports[c][slot].width),
                    part: c as u32,
                    state: 0,
                });
            };
            match kind {
                Kind::Led => {}
                Kind::Switch => add(Op::Switch, &[], 0),
                Kind::Clock => add(Op::Clock, &[], 0),
                Kind::Dff => add(Op::Dff { clk_was: false }, &nets[..2], 2),
                // ADR 0018: a ROM's words padded to its size; a RAM's cells start at 0.
                Kind::Rom => {
                    let mut words = shapes[c].data.clone();
                    words.resize(1 << shapes[c].address, 0);
                    add(Op::Rom { words }, &nets[..1], 1);
                }
                Kind::Ram => {
                    let cells = vec![0; 1 << shapes[c].address];
                    add(
                        Op::Ram {
                            cells,
                            clk_was: false,
                        },
                        &nets[..4],
                        4,
                    );
                }
                Kind::Split => {
                    let mut shift = 0;
                    for (i, width) in shapes[c].fields.iter().enumerate() {
                        add(Op::Field { shift }, &nets[..1], 1 + i);
                        shift += width;
                    }
                }
                Kind::Merge => {
                    let n = shapes[c].fields.len();
                    let shifts = shapes[c]
                        .fields
                        .iter()
                        .scan(0, |shift, width| {
                            *shift += width;
                            Some(*shift - width)
                        })
                        .collect();
                    add(Op::Merge { shifts }, &nets[..n], n);
                }
                gate => {
                    let n = gate.inputs().len();
                    add(Op::Gate(gate), &nets[..n], n);
                }
            }
        }
        let mut fanout = vec![Vec::new(); net_count as usize];
        for (p, prim) in prims.iter().enumerate() {
            for &net in &prim.inputs {
                if net != GROUND && fanout[net as usize].last() != Some(&(p as u32)) {
                    fanout[net as usize].push(p as u32);
                }
            }
        }

        let count = prims.len() as u32;
        let clocks = (0..count)
            .filter(|&p| matches!(prims[p as usize].op, Op::Clock))
            .collect();
        let stateful = prims
            .iter()
            .any(|p| matches!(p.op, Op::Dff { .. } | Op::Ram { .. }));
        let mut sim = Simulator {
            ids,
            kinds,
            prims,
            fanout,
            nets: vec![0; net_count as usize],
            wire_nets,
            wire_widths,
            port_nets,
            unsettled: Vec::new(),
            time: 0,
            clocks,
            stateful,
            snapshot: Vec::new(),
        };
        sim.presettle();
        warnings.extend(sim.settle((0..count).collect()));
        Ok((sim, warnings))
    }

    /// Before the first settle, gives every primitive that cannot reach a
    /// feedback loop its settled value, in topological order. Otherwise the
    /// all-zero start sends a wave down each chain, one delta per gate: on a
    /// chain of n gates that is n²/2 evaluations.
    ///
    /// Results are unchanged, whatever values these primitives start with:
    /// no loop (nor anything feeding one) reads them, so loops see exactly
    /// the same deltas; and loop-free logic forgets its starting values after
    /// at most one delta per primitive, well inside the delta limit, so from
    /// then on every net matches the plain all-zero settle delta by delta.
    /// This needs `eval` to be pure while settling: a primitive whose state
    /// changes during a settle (a future flip-flop) must count as a loop here.
    /// Any settle from all-zero nets (a future reset too) should call it first.
    fn presettle(&mut self) {
        // Peel primitives whose readers are all peeled, from the sinks back:
        // what remains can reach a loop.
        let mut readers: Vec<usize> = (0..self.prims.len())
            .map(|p| self.fanout[p + 1].len())
            .collect();
        // A flip-flop's value changes while settling, so it counts as part of a loop (ADR 0017).
        let pure = |p: usize| !matches!(self.prims[p].op, Op::Dff { .. } | Op::Ram { .. });
        let mut peeled: Vec<usize> = (0..readers.len())
            .filter(|&p| readers[p] == 0 && pure(p))
            .collect();
        let mut next = 0;
        while let Some(&p) = peeled.get(next) {
            next += 1;
            let inputs = &self.prims[p].inputs;
            for (slot, &net) in inputs.iter().enumerate() {
                // `fanout` lists a primitive once per net, however many inputs read it.
                if net == GROUND || inputs[..slot].contains(&net) {
                    continue;
                }
                // Every net but ground is the output of primitive `net - 1`.
                let d = net as usize - 1;
                readers[d] -= 1;
                if readers[d] == 0 && pure(d) {
                    peeled.push(d);
                }
            }
        }
        for &p in peeled.iter().rev() {
            self.nets[p + 1] = self.eval(p);
        }
    }

    /// Sets a switch to `value` and settles. Refuses a value wider than the
    /// switch. Returns an `Unstable` diagnostic if the circuit did not settle.
    pub fn set_input(&mut self, component: &str, value: u32) -> Result<Option<Diagnostic>, String> {
        self.set_inputs(&[(component, value)])
    }

    /// Sets several switches and settles once, as if they changed together:
    /// a flip-flop clocked by one of them samples the others' old values, in
    /// whatever order they are given (ADR 0017). Nothing is set if any value
    /// is refused.
    pub fn set_inputs(&mut self, values: &[(&str, u32)]) -> Result<Option<Diagnostic>, String> {
        let targets = values
            .iter()
            .map(|&(component, value)| Ok((self.switch_prim(component, value)?, value)))
            .collect::<Result<Vec<_>, String>>()?;
        for &(p, value) in &targets {
            self.prims[p].state = value;
        }
        let dirty = targets.iter().map(|&(p, _)| p as u32).collect();
        Ok(self.settle(dirty).map(lift_one))
    }

    /// The primitive of switch `component`, if `value` fits it.
    fn switch_prim(&self, component: &str, value: u32) -> Result<usize, String> {
        let c = self
            .ids
            .binary_search_by(|id| id.as_str().cmp(component))
            .map_err(|_| format!("unknown component {component}"))?;
        if self.kinds[c] != Kind::Switch {
            return Err(format!(
                "{component} is a {}, not a switch",
                self.kinds[c].name()
            ));
        }
        let p = self.port_nets[component]["out"] as usize - 1;
        let mask = self.prims[p].mask;
        if value > mask {
            let width = bits(mask.count_ones());
            return Err(format!(
                "{component} is {width} wide, so {value} does not fit"
            ));
        }
        Ok(p)
    }

    /// Current value of every net, cut to its width. Net 0 is ground.
    pub fn nets(&self) -> &[u32] {
        &self.nets
    }

    /// Wire ID → net index, for coloring wires.
    pub fn wire_nets(&self) -> &BTreeMap<String, u32> {
        &self.wire_nets
    }

    /// Wire ID → width of its net. Undriven wires share ground (net 0), so a
    /// wire's width cannot be read from its net index.
    pub fn wire_widths(&self) -> &BTreeMap<String, u32> {
        &self.wire_widths
    }

    pub fn port_nets(&self) -> &PortNets {
        &self.port_nets
    }

    /// Net index → the top-level part that drives it, `None` for ground.
    /// Primitive `p` drives net `p + 1`; a part inside an instance is reported
    /// as the instance (ADR 0016).
    pub fn net_drivers(&self) -> Vec<Option<&str>> {
        let driver = |p: &Prim| Some(top(&self.ids[p.part as usize]));
        std::iter::once(None)
            .chain(self.prims.iter().map(driver))
            .collect()
    }

    fn eval(&self, p: usize) -> u32 {
        let prim = &self.prims[p];
        let input = |i: usize| prim.inputs.get(i).map_or(0, |&net| self.nets[net as usize]);
        let value = match &prim.op {
            Op::Switch | Op::Clock | Op::Dff { .. } => prim.state,
            Op::Rom { words } => words.get(input(0) as usize).copied().unwrap_or(0),
            Op::Ram { cells, .. } => cells.get(input(0) as usize).copied().unwrap_or(0),
            Op::Gate(kind) => kind.gate(input(0), input(1)),
            Op::Field { shift } => input(0) >> shift,
            Op::Merge { shifts } => shifts
                .iter()
                .enumerate()
                .fold(0, |value, (i, shift)| value | input(i) << shift),
        };
        value & prim.mask
    }

    /// A flip-flop that sees `clk` at 1 after a 0 takes `d` from the net values
    /// the settle started from, never from this edge's new data (ADR 0017).
    fn clock_edge(&mut self, p: usize) {
        let prim = &mut self.prims[p];
        let before = |slot: usize| self.snapshot[prim.inputs[slot] as usize];
        match &mut prim.op {
            Op::Dff { clk_was } => {
                let clk = self.nets[prim.inputs[1] as usize] == 1;
                if clk && !*clk_was {
                    prim.state = before(0) & prim.mask;
                }
                *clk_was = clk;
            }
            // A RAM writes `din` at `addr` when `we` was set, all three as the settle started (ADR 0018).
            Op::Ram { cells, clk_was } => {
                let clk = self.nets[prim.inputs[3] as usize] == 1;
                if clk
                    && !*clk_was
                    && before(2) == 1
                    && let Some(cell) = cells.get_mut(before(0) as usize)
                {
                    *cell = before(1) & prim.mask;
                }
                *clk_was = clk;
            }
            _ => {}
        }
    }

    /// The words of ROM or RAM `component`, by elaborated ID (`instance/ram`
    /// inside an instance), or `None` if it is not a memory (ADR 0018).
    pub fn memory(&self, component: &str) -> Option<&[u32]> {
        let c = self
            .ids
            .binary_search_by(|id| id.as_str().cmp(component))
            .ok()?;
        self.prims
            .iter()
            .find(|p| p.part as usize == c)
            .and_then(|p| match &p.op {
                Op::Rom { words } => Some(words.as_slice()),
                Op::Ram { cells, .. } => Some(cells.as_slice()),
                _ => None,
            })
    }

    /// Advances the clock `count` ticks, settling after each. Stops at the
    /// first tick that does not settle and returns its diagnostic.
    pub fn tick(&mut self, count: u64) -> Option<Diagnostic> {
        if self.clocks.is_empty() {
            // Nothing changes, except a loop still oscillating: resumed and reported on the first tick, as
            // any settle does, so time stops there whatever `count` was.
            if self.unsettled.is_empty() || count == 0 {
                self.time = self.time.saturating_add(count);
                return None;
            }
            self.time = self.time.saturating_add(1);
            return self.settle(Vec::new()).map(lift_one);
        }
        for _ in 0..count {
            self.time = self.time.saturating_add(1);
            let level = (self.time % 2) as u32;
            for &p in &self.clocks {
                self.prims[p as usize].state = level;
            }
            if let Some(d) = self.settle(self.clocks.clone()) {
                return Some(lift_one(d));
            }
        }
        None
    }

    /// One clock cycle: ticks until the clock has risen once and is low again
    /// (2 ticks from low, 3 from high).
    pub fn step_cycle(&mut self) -> Option<Diagnostic> {
        self.tick(if self.time.is_multiple_of(2) { 2 } else { 3 })
    }

    /// Flip-flops, the clock and time back to 0, switch values kept; then
    /// settles from all-zero nets as a load does.
    pub fn reset(&mut self) -> Option<Diagnostic> {
        self.time = 0;
        self.unsettled.clear();
        self.nets.fill(0);
        for prim in &mut self.prims {
            match &mut prim.op {
                Op::Clock => prim.state = 0,
                Op::Dff { clk_was } => {
                    prim.state = 0;
                    *clk_was = false;
                }
                Op::Ram { cells, clk_was } => {
                    cells.fill(0);
                    *clk_was = false;
                }
                _ => {}
            }
        }
        self.presettle();
        let all = (0..self.prims.len() as u32).collect();
        self.settle(all).map(lift_one)
    }

    /// Virtual time in ticks; the cycle counter is `(time + 1) / 2`.
    pub fn time(&self) -> u64 {
        self.time
    }

    /// Runs deltas until no net changes, bounded so oscillation cannot hang.
    fn settle(&mut self, mut dirty: Vec<u32>) -> Option<Diagnostic> {
        // Acyclic circuits settle in at most depth + 1 <= primitives + 1 deltas.
        let limit = self.prims.len() + 64;
        dirty.append(&mut self.unsettled);
        if self.stateful {
            self.snapshot.clone_from(&self.nets);
        }
        let mut changed = Vec::new();
        for _ in 0..limit {
            dirty.sort_unstable();
            dirty.dedup();
            if dirty.is_empty() {
                return None;
            }
            if self.stateful {
                for &p in &dirty {
                    self.clock_edge(p as usize);
                }
            }
            // Every dirty primitive reads the same snapshot; writes apply after.
            let writes: Vec<(usize, u32)> = dirty
                .iter()
                .map(|&p| (p as usize + 1, self.eval(p as usize)))
                .collect();
            dirty.clear();
            changed.clear();
            for (net, value) in writes {
                if self.nets[net] != value {
                    self.nets[net] = value;
                    changed.push(net);
                    dirty.extend_from_slice(&self.fanout[net]);
                }
            }
        }
        if dirty.is_empty() {
            return None;
        }
        // Name each part once, however many of its primitives were still changing.
        let mut parts: Vec<u32> = changed
            .iter()
            .map(|&net| self.prims[net - 1].part)
            .collect();
        parts.sort_unstable();
        parts.dedup();
        let culprits = parts
            .iter()
            .map(|&c| self.ids[c as usize].clone())
            .collect();
        self.unsettled = dirty;
        let message = format!("circuit did not settle within {limit} deltas: oscillating loop");
        Some(Diagnostic::error(Code::Unstable, message, culprits))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::description::{ComponentDesc, Connection, JunctionDesc, PortRef, Severity};

    /// "component.port", or a bare junction ID.
    fn end(spec: &str) -> Endpoint {
        match spec.split_once('.') {
            Some((component, port)) => Endpoint::Port(PortRef {
                component: component.into(),
                port: port.into(),
            }),
            None => Endpoint::Junction {
                junction: spec.into(),
            },
        }
    }

    /// Components as (id, kind); wires as ("from.port", "to.port") or junction IDs,
    /// with IDs w0, w1, …. Junctions are declared with `with_junctions`.
    fn circuit(components: &[(&str, &str)], wires: &[(&str, &str)]) -> CircuitDescription {
        CircuitDescription {
            junctions: Vec::new(),
            definitions: Vec::new(),
            components: components
                .iter()
                .map(|(id, kind)| ComponentDesc {
                    id: (*id).into(),
                    kind: (*kind).into(),
                    ..Default::default()
                })
                .collect(),
            connections: wires
                .iter()
                .enumerate()
                .map(|(i, (from, to))| Connection {
                    id: format!("w{i}"),
                    from: end(from),
                    to: end(to),
                })
                .collect(),
        }
    }

    fn load(description: &CircuitDescription) -> Simulator {
        let (sim, warnings) = Simulator::load(description).expect("valid circuit");
        assert_eq!(warnings, vec![]);
        sim
    }

    fn value(sim: &Simulator, component: &str, port: &str) -> u32 {
        sim.nets()[sim.port_nets()[component][port] as usize]
    }

    fn codes(result: Result<(Simulator, Vec<Diagnostic>), Vec<Diagnostic>>) -> Vec<Code> {
        result
            .expect_err("invalid circuit")
            .iter()
            .map(|d| d.code)
            .collect()
    }

    fn and_demo() -> CircuitDescription {
        circuit(
            &[("a", "switch"), ("b", "switch"), ("g", "and"), ("l", "led")],
            &[("a.out", "g.a"), ("b.out", "g.b"), ("g.out", "l.in")],
        )
    }

    #[test]
    fn switches_and_led_follow_all_four_combinations() {
        let mut sim = load(&and_demo());
        for (a, b, led) in [(0, 0, 0), (0, 1, 0), (1, 0, 0), (1, 1, 1), (0, 1, 0)] {
            assert_eq!(sim.set_input("a", a), Ok(None));
            assert_eq!(sim.set_input("b", b), Ok(None));
            assert_eq!(value(&sim, "l", "in"), led, "a={a} b={b}");
            // Every wire carries its driver's value.
            assert_eq!(sim.nets()[sim.wire_nets()["w2"] as usize], led);
        }
    }

    #[test]
    fn cascade_with_fan_out() {
        // y = (a XOR b) AND a = a AND NOT b; `a` fans out to the XOR, the AND and an LED.
        let mut sim = load(&circuit(
            &[
                ("a", "switch"),
                ("b", "switch"),
                ("x", "xor"),
                ("y", "and"),
                ("la", "led"),
                ("ly", "led"),
            ],
            &[
                ("a.out", "x.a"),
                ("b.out", "x.b"),
                ("x.out", "y.a"),
                ("a.out", "y.b"),
                ("a.out", "la.in"),
                ("y.out", "ly.in"),
            ],
        ));
        for (a, b) in [(0, 0), (1, 0), (1, 1), (0, 1), (1, 0)] {
            sim.set_input("a", a).unwrap();
            sim.set_input("b", b).unwrap();
            assert_eq!(value(&sim, "la", "in"), a);
            assert_eq!(value(&sim, "ly", "in"), a & (b ^ 1), "a={a} b={b}");
        }
    }

    #[test]
    fn identities_hold() {
        let mut sim = load(&circuit(
            &[
                ("x", "switch"),
                ("one", "switch"),
                ("n1", "not"),
                ("n2", "not"),
                ("xx", "xor"),
                ("x1", "and"),
            ],
            &[
                ("x.out", "n1.in"),
                ("n1.out", "n2.in"),
                ("x.out", "xx.a"),
                ("x.out", "xx.b"),
                ("x.out", "x1.a"),
                ("one.out", "x1.b"),
            ],
        ));
        sim.set_input("one", 1).unwrap();
        for x in [0, 1, 0] {
            sim.set_input("x", x).unwrap();
            assert_eq!(value(&sim, "n2", "out"), x, "NOT(NOT x) = x");
            assert_eq!(value(&sim, "xx", "out"), 0, "x XOR x = 0");
            assert_eq!(value(&sim, "x1", "out"), x, "x AND 1 = x");
        }
    }

    #[test]
    fn compiled_result_ignores_listing_order_and_wire_direction() {
        let forward = and_demo();
        let mut reversed = and_demo();
        reversed.components.reverse();
        for wire in &mut reversed.connections {
            std::mem::swap(&mut wire.from, &mut wire.to);
        }
        let (mut a, mut b) = (load(&forward), load(&reversed));
        for sim in [&mut a, &mut b] {
            sim.set_input("a", 1).unwrap();
            sim.set_input("b", 1).unwrap();
        }
        assert_eq!(a.nets(), b.nets());
        assert_eq!(a.port_nets(), b.port_nets());
        assert_eq!(a.wire_nets(), b.wire_nets());
    }

    #[test]
    fn lone_not_settles_high_and_warns_about_its_input() {
        let (sim, warnings) = Simulator::load(&circuit(&[("n", "not")], &[])).unwrap();
        assert_eq!(value(&sim, "n", "out"), 1);
        assert_eq!(value(&sim, "n", "in"), 0);
        assert_eq!(warnings.len(), 1);
        assert_eq!(
            (warnings[0].severity, warnings[0].code),
            (Severity::Warning, Code::UnconnectedInput)
        );
    }

    #[test]
    fn oscillator_is_reported_not_hung() {
        let (mut sim, warnings) = Simulator::load(&circuit(
            &[("n", "not"), ("s", "switch")],
            &[("n.out", "n.in")],
        ))
        .unwrap();
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].code, Code::Unstable);
        assert_eq!(warnings[0].ids, vec!["n".to_string()]);
        // The engine keeps working, and the loop, still live, is reported again.
        let again = sim.set_input("s", 1).unwrap().expect("still unstable");
        assert_eq!(
            (again.code, again.ids),
            (Code::Unstable, vec!["n".to_string()])
        );
    }

    #[test]
    fn an_unrelated_input_does_not_hide_a_live_loop() {
        // o = NAND(en, o) oscillates while en = 1; t is unrelated.
        let mut sim = load(&circuit(
            &[("en", "switch"), ("o", "nand"), ("t", "switch")],
            &[("en.out", "o.a"), ("o.out", "o.b")],
        ));
        let unstable = |r: Result<Option<Diagnostic>, String>| r.unwrap().map(|d| d.code);
        assert_eq!(unstable(sim.set_input("en", 1)), Some(Code::Unstable));
        assert_eq!(unstable(sim.set_input("t", 1)), Some(Code::Unstable));
        // Disabling the loop settles it consistently: NAND(0, x) = 1.
        assert_eq!(unstable(sim.set_input("en", 0)), None);
        assert_eq!(value(&sim, "o", "out"), 1);
        assert_eq!(value(&sim, "o", "b"), 1);
    }

    #[test]
    fn an_input_can_settle_a_loop_left_unstable_by_load() {
        // o = NOR(s, o) oscillates from the all-zero start; s = 1 makes it stable.
        let (mut sim, warnings) = Simulator::load(&circuit(
            &[("s", "switch"), ("o", "nor")],
            &[("s.out", "o.a"), ("o.out", "o.b")],
        ))
        .unwrap();
        assert_eq!(warnings[0].code, Code::Unstable);
        assert_eq!(sim.set_input("s", 1), Ok(None));
        assert_eq!(value(&sim, "o", "out"), 0);
    }

    #[test]
    fn stable_feedback_holds_its_value() {
        // OR with its output fed back: once set, stays set.
        let mut sim = load(&circuit(
            &[("s", "switch"), ("o", "or")],
            &[("s.out", "o.a"), ("o.out", "o.b")],
        ));
        assert_eq!(value(&sim, "o", "out"), 0);
        assert_eq!(sim.set_input("s", 1), Ok(None));
        assert_eq!(value(&sim, "o", "out"), 1);
        assert_eq!(sim.set_input("s", 0), Ok(None));
        assert_eq!(value(&sim, "o", "out"), 1);
    }

    #[test]
    fn a_glitch_into_a_loop_on_load_is_still_latched() {
        // From all-zero, g = n1 AND NOT n1 pulses high for one delta and the OR
        // latch o keeps it. Settled values alone would leave o at 0.
        let (sim, _) = Simulator::load(&circuit(
            &[
                ("n1", "not"),
                ("n2", "not"),
                ("g", "and"),
                ("o", "or"),
                ("l", "led"),
            ],
            &[
                ("n1.out", "n2.in"),
                ("n1.out", "g.a"),
                ("n2.out", "g.b"),
                ("g.out", "o.a"),
                ("o.out", "o.b"),
                ("o.out", "l.in"),
            ],
        ))
        .unwrap();
        assert_eq!(value(&sim, "g", "out"), 0);
        assert_eq!(value(&sim, "l", "in"), 1);
    }

    #[test]
    fn a_long_chain_loads_in_linear_time() {
        // Settling it delta by delta from all-zero took ~48 s (release) at this length.
        let n = 95_000;
        let name = |i: usize| format!("n{i}");
        let port = |i: usize, port: &str| {
            Endpoint::Port(PortRef {
                component: name(i),
                port: port.into(),
            })
        };
        let description = CircuitDescription {
            components: (0..n)
                .map(|i| ComponentDesc {
                    id: name(i),
                    kind: "not".into(),
                    ..Default::default()
                })
                .collect(),
            connections: (1..n)
                .map(|i| Connection {
                    id: format!("w{i}"),
                    from: port(i - 1, "out"),
                    to: port(i, "in"),
                })
                .collect(),
            ..Default::default()
        };
        let start = std::time::Instant::now();
        let (sim, _) = Simulator::load(&description).unwrap();
        let elapsed = start.elapsed();
        assert_eq!(value(&sim, &name(0), "out"), 1);
        assert_eq!(value(&sim, &name(n - 1), "out"), 0);
        // Quadratic loading took ~48 s in release, far longer in debug; linear
        // takes ~1 s in debug, so slow machines keep plenty of room.
        let bound = if cfg!(debug_assertions) { 20 } else { 2 };
        assert!(elapsed.as_secs() < bound, "load took {elapsed:?}");
    }

    #[test]
    fn duplicate_wire_ids_are_rejected() {
        let mut description = circuit(
            &[("a", "switch"), ("b", "switch"), ("g", "and")],
            &[("a.out", "g.a"), ("b.out", "g.b")],
        );
        description.connections[1].id = "w0".into();
        assert_eq!(
            codes(Simulator::load(&description)),
            vec![Code::DuplicateId]
        );
    }

    #[test]
    fn invalid_components_are_rejected() {
        let result = Simulator::load(&circuit(
            &[("a", "switch"), ("a", "led"), ("z", "flux")],
            &[],
        ));
        assert_eq!(codes(result), vec![Code::DuplicateId, Code::UnknownKind]);
    }

    #[test]
    fn invalid_wires_are_rejected() {
        let parts = [("a", "switch"), ("b", "switch"), ("g", "and"), ("l", "led")];
        let cases = [
            (("a.out", "nope.in"), Code::UnknownComponent),
            (("a.out", "g.c"), Code::UnknownPort),
            (("a.out", "b.out"), Code::OutputToOutput),
            (("g.a", "l.in"), Code::InputToInput),
        ];
        for (wire, code) in cases {
            assert_eq!(
                codes(Simulator::load(&circuit(&parts, &[wire]))),
                vec![code],
                "{wire:?}"
            );
        }
        let two_drivers = circuit(&parts, &[("a.out", "g.a"), ("b.out", "g.a")]);
        let errors = Simulator::load(&two_drivers).unwrap_err();
        assert_eq!(errors[0].code, Code::MultipleDrivers);
        assert_eq!(errors[0].ids, vec!["g", "w0", "w1"]);
    }

    #[test]
    fn duplicate_wire_from_same_output_is_allowed() {
        let (sim, _) = Simulator::load(&circuit(
            &[("a", "switch"), ("l", "led")],
            &[("a.out", "l.in"), ("a.out", "l.in")],
        ))
        .expect("redundant wire is valid");
        assert_eq!(sim.wire_nets()["w0"], sim.wire_nets()["w1"]);
    }

    #[test]
    fn set_input_rejects_non_switches() {
        let mut sim = load(&and_demo());
        assert!(sim.set_input("g", 1).is_err());
        assert!(sim.set_input("missing", 1).is_err());
    }

    fn with_junctions(mut description: CircuitDescription, ids: &[&str]) -> CircuitDescription {
        description.junctions = ids
            .iter()
            .map(|id| JunctionDesc {
                id: (*id).into(),
                ..Default::default()
            })
            .collect();
        description
    }

    #[test]
    fn a_junction_fans_one_output_out_and_every_wire_reports_its_net() {
        // a ─ j ─┬─ g.a
        //        └─ g.b   (and the LED reads g)
        let description = with_junctions(
            circuit(
                &[("a", "switch"), ("g", "and"), ("l", "led")],
                &[
                    ("a.out", "j"),
                    ("j", "g.a"),
                    ("g.b", "j"),
                    ("g.out", "l.in"),
                ],
            ),
            &["j"],
        );
        let mut sim = load(&description);
        for a in [0, 1] {
            sim.set_input("a", a).unwrap();
            assert_eq!(value(&sim, "l", "in"), a, "a AND a = a");
            for wire in ["w0", "w1", "w2"] {
                assert_eq!(sim.nets()[sim.wire_nets()[wire] as usize], a, "{wire}");
            }
        }
    }

    #[test]
    fn junctions_chain_and_a_dangling_branch_reads_zero() {
        // a ─ j1 ─ j2 ─ l, plus a stub j2 ─ j3 and an input n.in on its own branch j4.
        let description = with_junctions(
            circuit(
                &[("a", "switch"), ("l", "led"), ("n", "not"), ("m", "led")],
                &[
                    ("a.out", "j1"),
                    ("j1", "j2"),
                    ("j2", "l.in"),
                    ("j2", "j3"),
                    ("n.in", "j4"),
                    ("n.out", "m.in"),
                ],
            ),
            &["j1", "j2", "j3", "j4"],
        );
        let (mut sim, warnings) = Simulator::load(&description).expect("valid circuit");
        assert_eq!(
            warnings
                .iter()
                .map(|d| (d.code, d.ids.clone()))
                .collect::<Vec<_>>(),
            vec![(Code::UnconnectedInput, vec!["n".to_string()])]
        );
        assert_eq!(sim.wire_nets()["w4"], GROUND);
        sim.set_input("a", 1).unwrap();
        assert_eq!(value(&sim, "l", "in"), 1);
        assert_eq!(
            sim.nets()[sim.wire_nets()["w3"] as usize],
            1,
            "the stub is on a's net"
        );
        assert_eq!(value(&sim, "m", "in"), 1, "NOT of an unconnected input");
    }

    #[test]
    fn nets_joined_through_junctions_are_checked_as_a_whole() {
        let parts = [("a", "switch"), ("b", "switch"), ("g", "and"), ("l", "led")];
        let cases = [
            (
                vec![("a.out", "j"), ("j", "b.out")],
                Code::OutputToOutput,
                vec!["w0", "w1"],
            ),
            (
                vec![("g.a", "j"), ("j", "l.in")],
                Code::InputToInput,
                vec!["w0", "w1"],
            ),
            (
                vec![("a.out", "j"), ("b.out", "k"), ("j", "g.a"), ("k", "g.a")],
                Code::MultipleDrivers,
                vec!["g", "w0", "w1", "w2", "w3"],
            ),
            (vec![("a.out", "gone")], Code::UnknownJunction, vec!["w0"]),
        ];
        for (wires, code, ids) in cases {
            let description = with_junctions(circuit(&parts, &wires), &["j", "k"]);
            let errors = Simulator::load(&description).unwrap_err();
            assert_eq!(
                errors
                    .iter()
                    .map(|d| (d.code, d.ids.clone()))
                    .collect::<Vec<_>>(),
                vec![(code, ids.iter().map(|id| id.to_string()).collect())],
                "{wires:?}"
            );
        }
        // Errors come out in the same order whichever way each wire was drawn.
        let forward = circuit(&parts, &[("b.out", "g.out"), ("g.a", "l.in")]);
        let backward = circuit(&parts, &[("g.out", "b.out"), ("l.in", "g.a")]);
        assert_eq!(
            codes(Simulator::load(&forward)),
            codes(Simulator::load(&backward))
        );
        assert_eq!(
            codes(Simulator::load(&forward)),
            vec![Code::OutputToOutput, Code::InputToInput] // b.out is an earlier port than g.a
        );

        let clash = with_junctions(circuit(&parts, &[]), &["j", "j", "g"]);
        assert_eq!(
            codes(Simulator::load(&clash)),
            vec![Code::DuplicateId, Code::DuplicateId]
        );
    }
}
