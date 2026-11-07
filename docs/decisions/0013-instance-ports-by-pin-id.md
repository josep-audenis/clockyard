# 0013. Instance ports are named by their pin part's ID

- Status: Accepted
- Date: 2026-11-07
- Amends: ADR 0012 (pins, file format)

## Context

ADR 0012 named an instance's ports by its pins' labels, and wires to an
instance stored those names. Relabelling a pin inside a definition therefore
broke every wire to that pin on every instance. Rewriting those wires when a
label changes does not hold up either: the main circuit's and other sheets'
undo histories still hold the old names, and an export taken while the
definition's sheet is open would mix old and new.

## Decision

- An instance's port is named by its pin part's ID (the switch or LED inside
  the definition), which never changes. The label is only shown: on the chip,
  next to the port. Pin order and layout are unchanged.
- File format version 4. A version 3 file is migrated on load: each wire end
  on an instance has its port rewritten from the pin's label to that pin
  part's ID.
- Port naming needs no engine change: the editor already lists each pin as
  `{ name, component }`, and now sends the part ID as the name.
- Every switch and LED of a definition is a pin; labels are only shown. A
  blank label shows an unnamed port and a repeated one shows twice, with no
  error, since neither affects wiring. Make component still asks for
  labelled, distinct pins so a new chip is readable.
- Deleting a pin leaves wires to it pointing at a port that no longer exists;
  the engine reports `unknownPort` on each such wire. Undoing the deletion on
  the definition's sheet restores the part, with the same ID, so those wires
  work again.

## Consequences

- Relabelling pins is free and safe; Make component still asks for labelled,
  distinct pins, so chips stay readable.
- Port names in files are opaque IDs, so a hand-written file must use them.
