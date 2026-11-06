# Clockyard — Master Project Brief & Engineering Instructions

> Source document for the project. Derived docs: [architecture](architecture.md),
> [simulation model](simulation-model.md), [roadmap](roadmap.md),
> [decisions](decisions/). Where they make a concrete choice the brief leaves
> open, the derived doc or ADR wins; material deviations from the brief are
> recorded as ADRs.

- **Working name:** Clockyard
- **Tagline:** Build computers from their very first pulse.
- **Project type:** Open-source, browser-based digital logic and computer-building sandbox
- **License:** MIT OR Apache-2.0
- **Primary technologies:** TypeScript, React, Rust, WebAssembly, PixiJS
- **Backend:** None. Entirely client-side.

## 1. Project Overview

We are building Clockyard, an interactive, browser-based digital logic simulator and computer construction sandbox.

The goal is to let users design digital circuits, combine simple logic gates into increasingly complex hardware components, construct functioning programmable computers, and eventually write programs that execute on the hardware they have built.

Clockyard should combine three experiences:

1. **Digital logic playground:** The accessibility and immediate feedback of connecting gates and watching signals propagate.
2. **Computer engineering simulator:** Correct behavior for sequential circuits, clocks, registers, buses, memory, ALUs, and programmable processors.
3. **Computer-building sandbox/game:** A satisfying, hands-on environment for inventing digital machines, learning how computers work, and experimenting with increasingly sophisticated designs.

The central product promise is:

> Build a computer from elementary logic gates, program it, and watch your own hardware execute instructions.

We want the depth of a genuine digital computer simulation without turning the application into an intimidating professional electronic design automation suite.

The product should feel like a thoughtfully designed sandbox: playful, responsive, technically credible, visually distinctive, and deeply satisfying.

### Inspirations

Research and understand the conceptual strengths of:

- Sebastian Lague's Digital Logic Sim.
- Turing Complete.
- Nand2Tetris.
- Logisim Evolution.
- Ben Eater's breadboard computer.
- Zachtronics-style engineering puzzles.
- Factorio's satisfying construction and systems thinking.

These are references for understanding interaction patterns, educational progression, simulation concepts, and product quality.

Do not copy their proprietary code, artwork, branding, or interfaces. Build an original product and architecture.

### Fundamental principles

- Everything runs locally in the user's browser.
- No backend, user accounts, external databases, or cloud execution.
- The actual simulation engine must be implemented in Rust.
- Compile the simulation engine to WebAssembly for browser execution.
- Use TypeScript for the application, editor, interactions, and rendering.
- Keep the simulation engine separate from the UI.
- Build the core simulation architecture ourselves rather than wrapping an existing complete logic simulator.
- Reuse mature libraries for supporting concerns such as UI, rendering, testing, and storage.
- Favor a coherent, reliable engine over a large feature checklist.
- Build incrementally, always maintaining a working application.
- Design for long-term expansion without implementing every anticipated feature immediately.
- The end product should be impressive both technically and visually.

## 2. Product Vision

### 2.1 Digital Playground

Users should be able to create circuits through an intuitive visual editor.

Eventually support:

- Input switches and push buttons.
- Output LEDs and indicators.
- NOT, AND, NAND, OR, NOR, XOR, and XNOR.
- Multi-input gates where applicable.
- Wires, junctions, and signal routing.
- Logic probes.
- Custom reusable components.
- Different component sizes and orientations.
- Bus connections and splitters.
- Labels and annotations.
- Component grouping and organization.

Signals should change as the circuit is evaluated.

Users should immediately understand what is happening inside their designs.

For example, connecting two switches to an AND gate and then an LED should provide instant visual feedback when changing either switch.

### 2.2 Hardware Workshop

Users should eventually be able to build functional sequential hardware.

Planned hardware features include:

- Clock sources.
- D flip-flops.
- Latches.
- Registers.
- Binary counters.
- Multiplexers and demultiplexers.
- Decoders.
- Adders and subtractors.
- Arithmetic logic units.
- RAM and ROM.
- Control units.
- Program counters.
- Multi-bit data buses.
- Tri-state outputs.
- Hardware signal inspection.
- Simulation stepping and debugging.

These components should follow well-defined digital logic semantics.

A sequential circuit must update correctly according to clock edges, rather than relying on arbitrary UI refresh timing.

### 2.3 Computer Lab

The long-term objective is to allow users to build complete programmable computers.

Examples:

- A minimal accumulator-based 8-bit CPU.
- A more advanced 8-bit processor with several registers.
- A simple 16-bit processor.
- Custom instruction sets.
- Memory-mapped output devices.
- LED matrices and character displays.
- Small programs and games executing on simulated hardware.

Eventually, users should be able to open a program editor, assemble a program, load it into their computer's ROM or memory, and execute it.

As the program runs, users should be able to inspect:

- Current program counter.
- Current instruction.
- Register values.
- ALU operations.
- Memory contents.
- Clock cycles.
- Active control signals.
- Output devices.

**Critical architectural constraint:** When simulating a user-built CPU, the CPU should operate through the actual simulated components and connections. Do not secretly substitute an unrelated software CPU emulator.

High-level RAM and ROM components are acceptable abstractions. The processor's behavior must nevertheless emerge from its connected control logic and datapath.

### 2.4 Sandbox and Game Modes

Eventually provide two complementary experiences.

**Sandbox Mode** — An unrestricted environment where users can create and experiment with arbitrary circuits.

**Challenge Mode** — A guided set of engineering challenges.

Example progression:

1. Create an inverter.
2. Build XOR from NAND gates.
3. Construct a half adder.
4. Construct a full adder.
5. Build an 8-bit adder.
6. Store one bit of information.
7. Build a register.
8. Create a counter.
9. Design an ALU.
10. Build a basic programmable CPU.
11. Run a small program.
12. Connect a visual output device.

Challenge completion should eventually rely on automated behavioral tests, not simply detecting particular components.

The gameplay system is a future phase. Do not implement it during the initial MVP.

## 3. Technical Architecture

### 3.1 Proposed Stack

**Frontend**

- React.
- TypeScript with strict type checking.
- Vite.
- PixiJS for the interactive circuit canvas.
- A lightweight state-management solution such as Zustand, if justified.
- A small, coherent UI component system.
- CSS variables/design tokens for theming.

**Simulation**

- Rust.
- WebAssembly.
- wasm-bindgen for JavaScript interoperation.
- Web Workers for asynchronous simulation execution.

**Storage**

- IndexedDB for local project storage.
- JSON-based project import/export initially.
- Versioned project file formats.
- Optional PWA offline caching later.

**Development**

- pnpm for frontend package management.
- Cargo for Rust.
- Vitest for TypeScript tests.
- Rust's built-in testing tools for the simulation engine.
- Playwright for selected browser integration tests.
- ESLint and TypeScript checking.
- rustfmt and Clippy.
- GitHub Actions for CI.

Prefer established, maintained libraries compatible with current stable releases. Verify APIs and dependency compatibility before implementation rather than relying on outdated examples.

Do not introduce dependencies merely because they are popular.

### 3.2 Separation of Responsibilities

The frontend owns:

- Canvas rendering.
- Component positioning.
- Wire visualization.
- User input.
- Selection.
- Editing interactions.
- Menus and toolbars.
- Undo/redo.
- Project persistence.
- Design-document state.
- Visual representation of simulation results.

The Rust engine owns:

- Compiled circuit representation.
- Signal state.
- Logic evaluation.
- Propagation.
- Event scheduling.
- Clock semantics.
- Sequential component state.
- Simulation time.
- Error detection for invalid or unstable circuits.
- Memory evaluation where applicable.
- Deterministic execution.

Do not implement a second independent simulation engine in TypeScript.

For simple previews, rendering may read cached state, but the Rust engine remains the source of truth for actual simulation behavior.

### 3.3 Proposed Repository Organization

Use a clear, maintainable monorepo.

Suggested structure:

```
clockyard/
├── apps/
│   └── web/
│       ├── src/
│       │   ├── app/
│       │   ├── editor/
│       │   ├── canvas/
│       │   ├── components/
│       │   ├── simulation/
│       │   ├── storage/
│       │   ├── styles/
│       │   └── workers/
│       └── package.json
│
├── crates/
│   ├── sim-core/
│   │   └── src/
│   │       ├── circuit/
│   │       ├── logic/
│   │       ├── simulation/
│   │       └── lib.rs
│   │
│   └── sim-wasm/
│       └── src/
│           └── lib.rs
│
├── examples/
├── docs/
│   ├── architecture.md
│   ├── simulation-model.md
│   ├── roadmap.md
│   └── decisions/
│
├── LICENSE-MIT
├── LICENSE-APACHE
├── CONTRIBUTING.md
└── README.md
```

This is a proposed architecture, not a requirement to create every directory immediately.

Start minimal and introduce directories as code actually requires them.

The pure Rust core should not depend on DOM APIs or browser-specific functionality.

The WASM crate should function as a thin adapter that exposes the Rust engine to TypeScript.

This separation is intentional: it allows native Rust testing, benchmarking, and possible future use of the simulation engine outside the browser.

## 4. Circuit Representation

One of the most important architectural decisions is how circuits are represented.

We need two distinct concepts.

### 4.1 Editable Circuit Document

The document model represents the user's design.

It describes:

- Component instances.
- Component types or definition references.
- Stable unique IDs.
- Positions.
- Orientations.
- Input/output ports.
- Port widths.
- Wire connections.
- Junctions.
- Component properties.
- Custom component definitions.
- Labels and annotations.
- Project metadata.
- Document format version.

This model should remain understandable and serializable.

The UI should be able to edit a circuit document without requiring the simulation engine to understand visual coordinates.

### 4.2 Compiled Simulation Netlist

The simulation engine should operate on a compiled representation of the circuit.

The compiler or elaboration step transforms editable circuits into an efficient graph of components, ports, nets, and connections.

For example:

```
Editable document
       |
       v
Validate connections
       |
       v
Resolve component definitions
       |
       v
Resolve nets and pin connections
       |
       v
Elaborate custom components
       |
       v
Compiled simulation representation
       |
       v
Rust simulation engine
```

Keep the distinction between the visual design and its electrical connectivity explicit.

Two wires crossing visually should not automatically imply an electrical connection. Junction semantics must be unambiguous.

Invalid port directions or incompatible signal widths should produce understandable validation errors.

### 4.3 Custom Components

Long-term support reusable custom components created from existing circuits.

For example, users should eventually be able to build a full adder from gates, define its input/output ports, save it as a reusable component, and instantiate it within another circuit.

Custom component definitions should be distinct from instances.

Multiple instances of a stateful custom chip must maintain separate runtime states.

The architecture should support nested component definitions without allowing recursive definitions that cannot be elaborated.

For initial implementations, elaborating hierarchical circuits into a flat simulation netlist is acceptable.

Later, optimized hierarchical or compiled components may be introduced for performance.

## 5. Simulation Engine

The simulator is the technical heart of Clockyard.

Invest in correctness, determinism, and testability before attempting extreme optimization.

### 5.1 Signal Model

Initially implement binary logic:

- `0`
- `1`

The early MVP only needs single-bit signals.

However, design the architecture so that it can later support multi-bit signals and four-state digital logic:

- `0`: Logic low.
- `1`: Logic high.
- `X`: Unknown or conflicting.
- `Z`: High impedance.

Do not prematurely implement a complete four-state digital simulator.

When multi-driver signals are eventually supported, define explicit resolution semantics. Never let the result depend arbitrarily on which component executes last.

### 5.2 Logic Evaluation

The initial combinational engine must support:

- Gate truth tables.
- Fan-out.
- Correct propagation through multiple levels.
- Re-evaluation after input changes.
- Stable circuit evaluation.
- Deterministic results.

Prefer an event-driven or change-driven evaluation strategy.

Example:

```
Input changes
    |
    v
Schedule affected components
    |
    v
Evaluate their outputs
    |
    v
Schedule downstream components
    |
    v
Repeat until settled
```

Do not continuously evaluate every gate unnecessarily.

For acyclic combinational networks, topological ordering is a valid optimization.

For feedback networks, implement explicit handling rather than assuming every circuit is acyclic.

The engine must never freeze indefinitely when encountering an oscillating or unstable combinational loop.

Use a bounded settling process and report instability appropriately. Later four-state logic may represent certain unknown states using `X`.

### 5.3 Clocked Components

Sequential logic is essential for the long-term product.

The eventual simulation model must distinguish combinational propagation from sequential state updates.

For rising-edge-triggered registers:

1. Settle relevant combinational logic.
2. Capture all register inputs using the pre-edge state.
3. Update all triggered registers simultaneously.
4. Propagate resulting output changes.
5. Settle the circuit again.

This prevents sequential behavior from depending on iteration order.

The engine should eventually support:

- Rising-edge triggers.
- Falling-edge triggers.
- Clock enables.
- Reset semantics.
- Independent clock sources where practical.
- Clock stepping.

Keep virtual simulation time separate from real-world time.

A simulated 1 MHz clock does not require JavaScript timers to fire one million times per second.

Instead, advance virtual clock events in batches and control how frequently the UI is updated.

### 5.4 Execution Controls

The intended UI eventually supports:

- Run.
- Pause.
- Reset.
- Single simulation event step.
- Single clock cycle step.
- Adjustable execution speed.
- Signal probing.
- Clock cycle counters.
- Waveform visualization.

Maintain deterministic results regardless of rendering frame rate.

### 5.5 Simulation Boundaries

Rust should own the internal simulation state.

A TypeScript command interface might conceptually offer operations such as:

```
loadCircuit(document)
setInput(componentId, value)
runUntilSettled()
stepClock()
runCycles(count)
reset()
getSnapshot()
```

These are conceptual operations, not mandatory final method signatures.

Prefer batching commands and returning changed signal states rather than making expensive JavaScript-to-WASM calls for every gate.

Eventually, compact binary or typed-array interfaces may be beneficial.

Begin with a simple, reliable interface and optimize only where measurements justify it.

### 5.6 Error Handling

Handle malformed designs gracefully.

Examples:

- Unconnected inputs.
- Incompatible signal widths.
- Multiple conflicting drivers.
- Invalid component configurations.
- Missing custom component definitions.
- Oscillating combinational loops.
- Corrupt project files.
- Excessive circuit complexity.
- Unsupported document versions.

Errors should not crash the application.

Clearly separate document validation errors from runtime simulation errors.

## 6. Rendering and Circuit Editor

The editor is as important to the product experience as the simulation engine.

### 6.1 Rendering Strategy

Use PixiJS for the interactive circuit canvas.

React should manage application-level interfaces, but avoid using thousands of React DOM elements to represent individual canvas objects.

The rendering engine must eventually support:

- Smooth panning.
- Smooth zooming.
- Component dragging.
- Multi-selection.
- Wires.
- Port hit-testing.
- Hover states.
- Selection indicators.
- Active/inactive signal colors.
- Grid rendering.
- Grid snapping.
- Contextual overlays.

Support high-DPI displays.

Do not redraw everything unnecessarily when only a few signals change.

Start with straightforward rendering, then introduce batching and caching if profiling demonstrates the need.

### 6.2 Editor Interaction Model

Prioritize natural interaction.

A reasonable initial workflow:

1. Select a component from the library.
2. Place it on the canvas.
3. Drag components to reposition them.
4. Connect output ports to input ports.
5. Click input switches to toggle them.
6. Observe resulting signal changes.
7. Select and delete components or connections.
8. Pan and zoom around the circuit.

As the editor matures, support:

- Box selection.
- Copy/paste.
- Duplicate.
- Undo/redo.
- Keyboard shortcuts.
- Component rotation.
- Wire routing.
- Alignment aids.
- Component search.
- Custom chips.
- Buses.
- Inspector panels.

Undo/redo should operate on editing actions, not on every simulated signal change.

### 6.3 Wires and Buses

In the first milestone, straightforward point-to-point connections are acceptable.

Long term, wires should support:

- Orthogonal segments.
- Junctions.
- Routing and editing.
- Shared nets.
- Multi-bit buses.
- Splitters and combiners.
- Connection labels.
- Signal visualization.

A 16-bit register should not require the user to manually draw sixteen separate visible wires for every connection.

Represent bus width explicitly in the data model.

Provide readable visual conventions for bus widths and signal values.

### 6.4 Visual Design

Clockyard should have its own recognizable visual identity.

Avoid generic AI-generated dashboard aesthetics.

Desired qualities:

- Precision.
- Clarity.
- Elegance.
- Technical sophistication.
- Playfulness without looking childish.
- Excellent interaction feedback.
- Visual consistency.

Use a limited, thoughtful color palette.

Differentiate active and inactive signals clearly.

Use subtle animation to communicate changes without becoming distracting.

The application's main area should feel like a physical workbench for digital machines.

Suggested desktop layout:

```
+-------------------------------------------+
| Logo   Project   Run  Pause  Step  Save   |
+---------+----------------------+----------+
|         |                      |          |
| Parts   |                      |Inspector |
|         |                      |          |
| Gates   |    Infinite Canvas   |Details   |
| Inputs  |                      |          |
| Outputs |                      |          |
| Chips   |                      |          |
|         |                      |          |
+---------+----------------------+----------+
| Simulation status / events / clock        |
+-------------------------------------------+
```

This is a conceptual layout. Improve it when there is a better UX solution.

Favor a polished functional editor over decorative complexity.

Desktop-first is acceptable. The product should remain accessible on smaller screens without promising a fully touch-optimized mobile editor in the first release.

## 7. Local Storage and Project Files

Clockyard must work without any backend.

Support local persistence.

Initially:

- Import a project file.
- Export a project file.
- Serialize the circuit document.
- Reload and reconstruct the circuit.
- Validate imported data.

Later:

- IndexedDB project library.
- Autosave.
- Project previews.
- Example templates.
- Recent projects.
- Backup/export functionality.

Use an explicit document schema version.

Do not serialize unstable internal Rust pointers or transient simulation data as the authoritative document format.

Document files should be portable across machines.

Where possible, loading older project versions should be supported through explicit migrations.

PWA support may eventually make the application installable and available offline after the required files have been cached.

No user data should need to leave the browser.

## 8. Roadmap and Implementation Phases

The following phases define the intended development sequence.

Do not build everything simultaneously.

Each phase must produce a working, demonstrable result.

### PHASE 0 — Foundation

**Goal:** Establish the repository and prove browser-to-WASM communication.

Tasks:

- Initialize the monorepo.
- Set up React, TypeScript, and Vite.
- Set up a Rust workspace.
- Create the pure simulation core crate.
- Create the WASM adapter crate.
- Configure wasm-bindgen and compilation.
- Integrate WASM into the frontend.
- Set up the initial application shell.
- Set up testing and linting.
- Add MIT and Apache-2.0 licenses.
- Create README and architecture documentation.

Initial experiment:

- Implement a Rust AND gate evaluator.
- Call it from the browser through WASM.
- Display the result in the UI.

Acceptance criteria:

- The frontend builds.
- The Rust core builds and passes tests.
- WASM loads successfully.
- Browser-to-Rust communication works.
- The application can run without backend services.
- One documented command starts the development environment.

Avoid building a large abstraction framework at this stage.

### PHASE 1 — First Playable Circuit Editor

**Goal:** Build the first genuinely useful version of Clockyard.

Scope:

- Interactive canvas.
- Pan and zoom.
- Basic gate placement.
- Input switches.
- Output LEDs.
- NOT, AND, NAND, OR, NOR, XOR.
- Component dragging.
- Simple wire connections.
- Component selection and deletion.
- Correct combinational simulation.
- Active/inactive wire visualization.
- Project import/export.
- Initial keyboard shortcuts.

Build a minimal but functional editor capable of creating basic combinational circuits.

The first implementation may support only one-bit signals, simple wire routing, and a small number of components.

Acceptance criteria — a user can:

1. Open Clockyard.
2. Place two switches.
3. Place an AND gate.
4. Place an LED.
5. Connect the components.
6. Toggle either switch.
7. Observe the correct LED output.
8. Move components without breaking connections.
9. Save the design.
10. Reload it successfully.

Also verify a circuit containing multiple cascaded gates and fan-out.

This is the first public-demo-worthy milestone.

Do not advance merely because individual gates pass unit tests. The complete interaction must work in the browser.

### PHASE 2 — Proper Circuit Construction

**Goal:** Make larger combinational circuits pleasant to build.

Planned additions:

- More complete editing tools.
- Undo/redo.
- Copy/paste.
- Wire routing improvements.
- Explicit junction semantics.
- Named connections.
- Multi-bit signals.
- Bus splitters.
- Component properties.
- Custom reusable components.
- Nested circuit definitions.
- Better validation.
- Example circuits.

**Target demonstration:** Build a functional 4-bit adder using smaller reusable components.

Users should be able to define a full adder and instantiate it repeatedly.

Correctly handle custom components with multiple inputs and outputs.

Validate hierarchical elaboration and component-instance separation.

This phase establishes the foundations required for sophisticated computers.

### PHASE 3 — Clocks and Sequential Logic

**Goal:** Support hardware with memory and time-dependent behavior.

Implement:

- Deterministic virtual time.
- Clock components.
- Rising-edge-triggered D flip-flops.
- Register primitives.
- Reset behavior.
- Run/pause/step controls.
- Bounded event processing.
- Sequential simulation tests.
- Basic clock visualization.
- Clock cycle tracking.

Later add:

- Counters.
- More flip-flop types.
- Simple RAM/ROM.
- Waveform inspector.
- Expanded signal states.
- More advanced timing options.

**Target demonstration:** Build a clocked 8-bit counter that can be paused, reset, and advanced one cycle at a time.

All edge-triggered components must sample consistently.

The result must be deterministic and independent of browser frame timing.

### PHASE 4 — Programmable 8-bit Computer

**Goal:** Make the project's central vision real.

Build a reference CPU using the same simulation system available to users.

Start with a deliberately simple architecture.

Possible characteristics:

- 8-bit data width.
- Small address space.
- Accumulator register.
- Program counter.
- Instruction register.
- ALU.
- Control unit.
- ROM.
- RAM.
- Output register.

Define a minimal instruction set.

For example:

```
LDI 5
ADD 3
OUT
HLT
```

The exact instruction encoding and architecture should be designed before implementation.

Introduce:

- Assembly editor.
- Basic assembler.
- Program loading.
- Instruction execution.
- Register inspection.
- Memory inspection.
- Single-cycle stepping.
- Basic breakpoints if feasible.

**Target demonstration:** Execute a small assembly program on a simulated processor built from Clockyard components and display the result on an output device.

Distinguish between a clock cycle and an instruction step. A single instruction may require multiple clock cycles.

The CPU must run through the actual simulated hardware graph.

Test instructions against an independent reference specification, which can be implemented in native Rust tests.

### PHASE 5 — Computer-Building Sandbox

**Goal:** Turn Clockyard from a simulator into a compelling, complete product.

Potential features:

- Guided hardware construction challenges.
- Automated circuit evaluation.
- Component blueprints.
- Bundled computer designs.
- Example CPUs.
- Memory-mapped peripherals.
- Seven-segment displays.
- LED matrices.
- Keyboard input.
- Character or pixel displays.
- More complex instruction sets.
- Improved waveform tools.
- Performance optimization.
- Browser-based sharing through portable files or encoded URLs.
- More educational material.

The aspirational demonstration is running a small game on a processor designed inside Clockyard.

Do not commit to a particular game or instruction set before the previous phases are technically sound.

## 9. Performance Philosophy

Clockyard should eventually support complex circuits, but correctness and usability come first.

Key principles:

- Keep the simulation loop separate from React rendering.
- Use Rust for computation-heavy simulation.
- Avoid frequent fine-grained WASM boundary crossings.
- Prefer event-driven signal evaluation.
- Minimize redundant propagation.
- Keep component IDs and connections stable.
- Optimize compiled netlist representation where appropriate.
- Use efficient data structures.
- Avoid unnecessary allocations in hot paths.
- Keep the UI responsive during long simulations.
- Benchmark actual workloads before optimizing.

Initial performance work should include repeatable benchmarks for:

- Cascaded gates.
- High fan-out circuits.
- Large combinational circuits.
- Clocked registers.
- Counters.
- Repeated simulation steps.

Eventually test circuits containing thousands or tens of thousands of components.

Treat those as performance goals requiring measurement, not guaranteed MVP capabilities.

A Web Worker should host the simulation engine for substantial workloads, avoiding main-thread blocking.

Do not add complex multithreading, SharedArrayBuffer dependencies, or cross-origin isolation requirements unless profiling and browser compatibility justify them.

## 10. Testing Requirements

Testing is particularly important because Clockyard is a simulator.

A circuit that produces subtly incorrect results is worse than one that clearly reports unsupported behavior.

### Rust Unit Tests

Test:

- Every gate truth table.
- Cascaded gate propagation.
- Fan-out.
- Input toggling.
- Evaluation order independence.
- Invalid graph handling.
- Feedback and oscillation handling.
- Reset behavior.
- Sequential register sampling.
- Clock transitions.
- Custom component elaboration.
- Multiple instances of stateful components.
- Signal width validation.
- Memory semantics when implemented.

### Property-Based Tests

Where valuable, test logical invariants.

Examples:

- `NOT(NOT(x)) == x`
- `XOR(x, x) == 0`
- `AND(x, 1) == x`
- An N-bit adder matches modular integer addition.
- Equivalent circuits produce equivalent results.

Use appropriate Rust testing libraries if they provide meaningful value.

### Frontend Tests

Test:

- Document editing.
- Component creation.
- Connection creation.
- Deletion behavior.
- Undo/redo when introduced.
- Project serialization.
- Import validation.
- Simulation worker communication.
- Component inspector behavior.

### End-to-End Tests

Use Playwright for important browser workflows.

At minimum, automate the fundamental switch-to-gate-to-LED interaction.

Later cover project export/import and clock stepping.

### Performance Tests

Create reproducible benchmark circuits and document results.

Do not claim that Rust/WASM is faster than TypeScript without a relevant benchmark.

## 11. What Not to Build Initially

Avoid these common scope mistakes:

- No backend.
- No accounts or authentication.
- No multiplayer.
- No cloud database.
- No marketplace.
- No social network.
- No transistor-level analog simulation.
- No professional PCB design.
- No full Verilog or VHDL implementation.
- No custom GPU rendering framework.
- No advanced physical timing analysis in the first versions.
- No fully featured CPU before sequential circuits work.
- No elaborate plugin system.
- No complete game campaign during the MVP.
- No premature event-sourcing architecture.
- No microservices.
- No custom framework replacing React or PixiJS.
- No unnecessary abstractions built solely for hypothetical future features.

Supporting libraries are encouraged where they save time without surrendering ownership of the simulation engine.

We want a technically original project, not a project that needlessly reimplements every piece of software infrastructure.

## 12. Product Quality Standards

The application must be more than a technical proof of concept.

Every milestone should have:

1. A working interactive demonstration.
2. Clear controls.
3. Useful feedback.
4. Correct simulation behavior.
5. Automated tests.
6. Reasonable error handling.
7. Documentation.
8. A coherent visual design.

Avoid placeholder interactions that appear functional but do nothing.

Avoid visual-only components that are not connected to the simulation.

Do not hardcode expected outputs for demonstration circuits.

Demo circuits must execute through the real engine.

Favor a small number of genuinely usable capabilities over dozens of superficial features.

Pay attention to:

- Smooth canvas manipulation.
- Readable labels.
- Consistent spacing.
- Port alignment.
- Accurate hit targets.
- Keyboard usability.
- Helpful error states.
- Useful empty states.
- Responsive interaction.
- Undoable user actions.

The application should feel increasingly professional with each phase.

## 13. Open-Source Requirements

Clockyard is intended to be a public, community-friendly open-source project.

Use MIT OR Apache-2.0 licensing, unless the project owner changes this decision.

Include the appropriate complete official license texts.

Use clear license declarations in relevant package manifests.

Ensure dependencies and bundled assets have compatible licenses.

Provide:

- A clear README.
- Setup instructions.
- Build instructions.
- Contribution guidelines.
- Architecture overview.
- Simulation model documentation.
- Roadmap.
- Examples.
- Tests.
- CI configuration.

The README should explain the project in language accessible to developers and people interested in computer architecture.

Document the distinction between the editable circuit representation and the executable simulation model.

Keep the public API of the Rust core clean enough that it could eventually become an independently usable library.

Do not publish packages or deploy anything without explicit authorization.

## 14. Engineering Workflow

You are acting as the lead software engineer and technical architect for Clockyard.

Your responsibility is to implement a reliable product incrementally, not merely generate a large amount of code.

Follow these rules:

### Before major implementation

- Inspect the existing repository.
- Understand the current state.
- Identify existing conventions.
- Determine which milestone is in progress.
- Identify relevant constraints and risks.
- Reuse existing code where appropriate.
- Avoid unnecessary rewrites.

For a new repository, establish the smallest viable foundation.

### During implementation

- Work in small, coherent increments.
- Keep changes focused.
- Implement real functionality.
- Write tests alongside the simulation engine.
- Maintain strict typing.
- Prefer explicit data models.
- Use meaningful names.
- Avoid excessive abstraction.
- Do not mix canvas rendering with simulation semantics.
- Do not duplicate Rust simulation logic in TypeScript.
- Keep documentation aligned with actual behavior.
- Clearly report unsupported behavior rather than hiding it.

### After each meaningful increment

- Run relevant tests.
- Run TypeScript checking.
- Run Rust checks.
- Build the WASM integration where relevant.
- Verify the browser experience when possible.
- Fix regressions.
- Summarize what works.
- Identify limitations.
- Update milestone progress.

Do not claim a feature is complete merely because code was written. It must meet its acceptance criteria.

### Decision-making principles

Optimize for the long-term quality of the product, while limiting immediate scope.

When choosing between architectures, prefer solutions that are:

- Easy to understand.
- Easy to test.
- Deterministic.
- Performant enough for current needs.
- Extensible without excessive complexity.
- Compatible with static browser deployment.

Introduce complexity when a concrete requirement justifies it.

Maintain a lightweight architecture decision record for significant choices.

If an implementation choice deviates materially from this brief, document the reasoning.

## 15. Initial Assignment

Begin with Phase 0 and the smallest useful vertical slice of Phase 1.

Do not attempt to implement the entire roadmap immediately.

Your initial work should cover:

### Step 1 — Analyze and Plan

Inspect the repository, if present.

Research the current, compatible APIs of the selected tools.

Propose a concrete minimal architecture covering:

- React application.
- PixiJS canvas.
- Rust core.
- WASM adapter.
- Web Worker communication.
- Circuit document representation.
- Simulation state representation.
- Initial gate evaluation.
- Testing.

Make reasonable decisions autonomously. Raise questions only where a missing decision would materially block implementation.

### Step 2 — Establish the Foundation

Set up the frontend and Rust workspace.

Implement the initial pure Rust simulation engine with a small set of logic gates and proper tests.

Expose a minimal WebAssembly interface.

Demonstrate correct browser-to-WASM communication.

### Step 3 — Implement the First Vertical Slice

Create a functional circuit editor supporting:

- Basic component placement.
- Two input switches.
- One AND gate.
- One LED.
- Connectable ports.
- Wire rendering.
- Interactive input toggling.
- Simulation execution through Rust/WASM.
- Visual output updates.

Keep this minimal.

The objective is to validate the complete system from user interaction to visual rendering, through the actual Rust simulation engine.

Do not build a fake simulation in React for this step.

### Step 4 — Validate

Demonstrate:

```
Switch A ──┐
           ├── AND ── LED
Switch B ──┘
```

Expected outputs:

```
A=0, B=0 -> LED=0
A=0, B=1 -> LED=0
A=1, B=0 -> LED=0
A=1, B=1 -> LED=1
```

Validate all four input combinations.

Verify that visual state matches the Rust engine result.

Check that canvas interactions remain responsive.

### Step 5 — Report

At the end of the initial implementation, provide:

- Implemented functionality.
- Files and major modules created.
- Architectural decisions.
- Tests executed and results.
- Build/run instructions.
- Known limitations.
- Recommended next implementation increment.

Do not introduce unrelated features to make the project appear more complete.

## 16. Definition of Success

The first release of Clockyard succeeds when someone can open a browser, build a functioning logic circuit, interact with its inputs, watch its outputs change correctly, and save the result.

The next major success is building reusable combinational components.

The next is supporting real clocked sequential hardware.

The defining long-term success is constructing a functioning programmable CPU, writing a program for it, and observing execution within the user's actual circuit.

Throughout development, preserve the same fundamental promise:

> Clockyard is a place where computers are not black boxes. Every operation can be explored, understood, constructed, and ultimately programmed.

Start small. Build the real engine. Make the interactions satisfying. Keep the architecture clean. Expand only when the previous layer works reliably.
