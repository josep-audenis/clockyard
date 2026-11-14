; Catch (ADR 0023): blocks fall in 8 lanes; catch them with the paddle.
; Left and Right move the paddle. A catch scores on HEX and the next block
; falls faster. A miss halts: Reset to play again.
;
; RAM: 0 paddle lane, 1 block address, 2 next lane, 3 delay, 4 score, 5 count, 6 scratch.
; Screen byte = row * 8 + lane; row 31 (bytes 248-255) holds the paddle.

start:  LDI 3
        STA 0           ; the paddle starts in lane 3
        STA 2           ; and the first block falls above it
        LDI 100         ; DELAY: wait loops per step
        STA 3
        LDI 251         ; draw the paddle: row 31, lane 3
        STA 0xFE
        LDI 0xFF
        STA 0xFD

spawn:  LDA 2           ; a new block at the top of its lane
        STA 1
        STA 0xFE
        LDI 0x3C
        STA 0xFD
        LDA 2           ; next lane: + 5, mod 8, so all 8 come in turn
        ADI 5
        SBI 8
        JC lane
        ADI 8
lane:   STA 2

loop:   LDA 3           ; wait
        STA 5
wait:   LDA 5
        SBI 1
        STA 5
        JZ keys
        JMP wait

keys:   LDA 0xFF        ; Left 0x82, Right 0x83
        SBI 0x82
        JZ left
        SBI 1
        JZ right
        JMP fall

left:   LDA 0
        JZ fall         ; at the left edge
        ADI 248         ; erase the paddle
        STA 0xFE
        LDI 0
        STA 0xFD
        LDA 0
        SBI 1
        STA 0
        JMP paddle

right:  LDA 0
        SBI 7
        JZ fall         ; at the right edge
        LDA 0
        ADI 248         ; erase the paddle
        STA 0xFE
        LDI 0
        STA 0xFD
        LDA 0
        ADI 1
        STA 0

paddle: ADI 248         ; draw the paddle in its new lane
        STA 0xFE
        LDI 0xFF
        STA 0xFD

fall:   LDA 1           ; erase the block
        STA 0xFE
        LDI 0
        STA 0xFD
        LDA 1           ; one row down
        ADI 8
        STA 1
        STA 0xFE
        SBI 248
        JC land         ; it reached row 31
        LDI 0x3C
        STA 0xFD
        JMP loop

land:   LDA 0xFD        ; the paddle's byte there, or 0
        JZ miss
        LDA 4           ; caught: score
        ADI 1
        STA 4
        STA 0xFC
        LDA 3           ; and fall faster, down to a delay of 20
        SBI 8
        STA 6
        SBI 20
        JC faster
        JMP spawn
faster: LDA 6
        STA 3
        JMP spawn

miss:   LDI 0x3C        ; show where it landed, and stop
        STA 0xFD
        HLT
