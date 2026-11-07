# 0011. Grid routing and user-shaped wires

- Status: Accepted
- Date: 2026-11-07

## Context

Wires were drawn with one bend on the column half-way between their ends
(ADR 0010 added junction columns). A feedback wire from a gate's output back to
an earlier gate's input therefore ran straight through both bodies, hidden
under them, and along other wires: a NOT feeding an AND, with the AND's output
fed back to the NOT, drew the feedback wire on top of the forward one and
seemed to end on the AND's left edge. The user had no way to move a wire except
by adding junctions.

## Decision

1. **Automatic routes** are found on the grid by A* search, per wire, in
   document order:
   - a port is left and entered straight out from the side of its part it
     sits on (up or down too, once parts can be rotated);
   - part bodies (their ports included) and junctions are never crossed; a
     wire only touches the port or junction it ends at;
   - a route never runs along another net's wire, nor bends or ends on one,
     so separate nets never look joined; it may only cross one straight
     through (crossings never connect), at a small cost; each bend costs a
     little more;
   - the search is bounded to the ends' box plus a margin of 8 cells, then 24
     when nothing fits, and not attempted when that box is larger than 40,000
     cells. Then, or when nothing fits either, the old half-way route is used,
     and only then can a wire touch another net, cross a part or meet a
     junction (rare: an exhaustive check of two-wire layouts found none). One wire therefore never
     costs more than two 40,000-cell searches, however far apart a file places
     its parts.

   Routes are geometry only. Connectivity still comes from wire ends.
2. **User-shaped wires.** Dragging a wire segment moves it sideways; the wire
   then keeps its interior bend points in an optional `bends` list (grid
   points). A segment that ends at a port or junction gains a short stub so the
   end stays put and still leaves the port straight out, and the segment next
   to a port's stub cannot be dragged back over that port. Shaped wires are the
   user's choice and may touch other nets; automatic ones keep away from them. A shape is kept only
   while it has at most 64 bends, the most a file may hold. When an end moves, the
   wire is made orthogonal again by inserting corners; when both ends move
   together (a group drag or rotation), the bends move with them; a shaped
   wire with only one end in a rotated selection is routed automatically
   again, since its old shape would cut back across the turned part. **Reset route** in the
   inspector removes `bends`. Each drag and each reset is one undo step.
3. **Only what an edit touches is routed again.** After any edit (a release,
   a delete, an undo, a rotation), a wire keeps its route when it is unchanged,
   its parts and junctions have not moved or turned, its net still has the same
   wires, and no part or junction that moved or appeared lies on its route.
   The rest are routed, avoiding the kept routes. Kept routes may be longer
   than a fresh route would be, since something in their way may be gone;
   opening a file routes everything afresh. **While dragging** a part,
   junction or segment, the wires the drag does not touch keep the routes they
   had when it started, and on release the edit is compared with the circuit
   from before the drag, so the result does not depend on the path of the
   drag. Escape, or a cancelled pointer, puts the drag back where it started.
4. **Format.** `bends` is an optional field of a wire in format v2, so files
   without it are unchanged and no migration is needed. A build that predates
   it drops the field on import and routes the wire automatically.

## Consequences

- Wires avoid bodies and each other without user effort, and can be shaped by
  hand when the automatic choice is not wanted.
- Measured on a deliberately tangled grid of 100 gates and 180 long wires: a
  full route (opening the file) takes about 55 ms warm in Node; an edit that
  touches a few wires, 1 to 3 ms. In headless Chromium, with drawing, a
  release, a delete, an undo or a rotation takes about 45 to 65 ms from key or
  button to painted frame (two frames alone are about 19 ms), against about
  220 ms for a release when every edit re-routed everything. The search reuses
  its arrays between wires and stops at once when a port's first cell outside
  is taken.
- Earlier wires get first choice of grid lines, so adding a wire never moves an
  older one, but deleting one may let later wires straighten.
