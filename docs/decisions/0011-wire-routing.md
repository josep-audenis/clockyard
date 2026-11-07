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
   - a port is left and entered horizontally, away from its part;
   - part bodies (their ports included) and junctions are never crossed; a
     wire only touches the port or junction it ends at;
   - each bend costs extra, and running along, turning on or ending on another
     net's wire costs much more, so nets stay visibly apart; a plain
     perpendicular crossing is allowed (crossings never connect);
   - the search is bounded to the ends' box plus a margin, and not attempted
     when that box is larger than 40,000 cells; then, or when it finds
     nothing, the old half-way route is used. One wire therefore never costs
     more than one 40,000-cell search, however far apart a file places its
     parts.

   Routes are geometry only. Connectivity still comes from wire ends.
2. **User-shaped wires.** Dragging a wire segment moves it sideways; the wire
   then keeps its interior bend points in an optional `bends` list (grid
   points). A segment that ends at a port or junction gains a short stub so the
   end stays put and still leaves a port horizontally, and the segment next to
   a port's stub cannot be dragged back over that port. A shape is kept only
   while it has at most 64 bends, the most a file may hold. When an end moves, the
   wire is made orthogonal again by inserting corners; when both ends move
   together (a group drag), the bends move with them. **Reset route** in the
   inspector removes `bends`. Each drag and each reset is one undo step.
3. **Format.** `bends` is an optional field of a wire in format v2, so files
   without it are unchanged and no migration is needed. A build that predates
   it drops the field on import and routes the wire automatically.

## Consequences

- Wires avoid bodies and each other without user effort, and can be shaped by
  hand when the automatic choice is not wanted.
- Every change re-routes every automatic wire, including on each step of a
  drag. Measured in Node: about 100 ms for a deliberately tangled grid of 100
  gates and 180 long wires, a few tens of ms at the size of the Phase 2 4-bit
  adder. Incremental routing is the next step if that becomes noticeable.
- Earlier wires get first choice of grid lines, so adding a wire never moves an
  older one, but deleting one may let later wires straighten.
