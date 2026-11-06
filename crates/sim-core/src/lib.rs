//! Clockyard simulation engine.
//!
//! Phase 1: 1-bit combinational logic. A [`CircuitDescription`] is validated
//! and compiled into a netlist by [`Simulator::load`], then settled with
//! synchronous deltas as described in `docs/simulation-model.md`.

pub mod catalog;
pub mod description;
pub mod sim;

pub use catalog::Kind;
pub use description::{CircuitDescription, Code, Diagnostic, PortRef, Severity};
pub use sim::{PortNets, Simulator};
