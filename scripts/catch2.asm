; Catch 2 (ADR 0036): Catch with single pixels, on Reference CPU 2.
; A block 2 pixels square falls in any of 63 columns; catch it with the paddle, 8 pixels wide,
; which Left and Right move one pixel at a time. A catch scores on HEX and the next block falls
; faster. A miss halts: Reset to play again.
;
; Every pixel is drawn or erased by one routine, toggle, which finds the screen byte and the bit
; through another, locate, and flips the bit. test finds a pixel through locate too.
;
; RAM: 0 paddle's left column, 1 block's column, 2 block's top row, 3 next block's column,
;      4 delay, 5 score, 6 wait count, 7 loop count, 8 column and 9 row for locate,
;      10 and 11 locate's scratch: row * 8, then the bit.

start:  LDI 28
        STA 0           ; the paddle starts at columns 28 to 35
        STA 3           ; and the first block falls above it
        LDI 60
        STA 4           ; DELAY: wait rounds per row
        LDI 31
        STA 9           ; the paddle's row
        LDI 0
        STA 7
paddle: LDA 0           ; draw it: 8 pixels
        ADD 7
        STA 8
        CALL toggle
        LDA 7
        ADI 1
        STA 7
        SBI 8
        JNZ paddle

spawn:  LDA 3           ; a new block at the top, in the next column
        STA 1
        ADI 23          ; next column: + 23, mod 63, so all 63 come in turn
        STA 3
        SBI 63
        JC wrap
        JMP top
wrap:   STA 3
top:    LDI 0
        STA 2
        STA 9
        CALL pair
        LDI 1
        STA 9
        CALL pair

row:    LDA 4           ; wait
        STA 6
wait:   LDA 6
        SBI 1
        STA 6
        JNZ wait
        CALL keys       ; the paddle moves up to two pixels a row
        CALL keys
        LDA 2           ; fall one row: erase the top, draw below the bottom
        STA 9
        CALL pair
        LDA 2
        ADI 2
        STA 9
        CALL pair
        LDA 2
        ADI 1
        STA 2
        SBI 29          ; on rows 29 and 30, just above the paddle: landed
        JNZ row

        LDI 31          ; is the paddle under both of the block's columns?
        STA 9
        LDA 1
        STA 8
        CALL test
        JZ miss
        LDA 1
        ADI 1
        STA 8
        CALL test
        JZ miss
        LDI 29          ; caught: erase the block
        STA 9
        CALL pair
        LDI 30
        STA 9
        CALL pair
        LDA 5           ; score
        ADI 1
        STA 5
        STA 0xFC        ; HEX
        LDA 4           ; faster, down to a delay of 6
        SBI 6
        STA 4
        JNZ spawn
        LDI 6
        STA 4
        JMP spawn
miss:   HLT

; keys: moves the paddle a pixel if Left or Right is held, unless it is at that edge.
keys:   LDA 0xFF        ; Left 0x82, Right 0x83
        SBI 0x82
        JZ left
        SBI 1
        JZ right
        RET
left:   LDA 0
        JZ edge         ; at the left edge
        LDI 31
        STA 9
        LDA 0
        ADI 7           ; erase its rightmost pixel
        STA 8
        CALL toggle
        LDA 0
        SBI 1
        STA 0
        STA 8           ; draw one more on the left
        CALL toggle
edge:   RET
right:  LDA 0
        SBI 56
        JZ edge         ; at the right edge
        LDI 31
        STA 9
        LDA 0
        STA 8           ; erase its leftmost pixel
        CALL toggle
        LDA 0
        ADI 1
        STA 0
        ADI 7           ; draw one more on the right
        STA 8
        CALL toggle
        RET

; pair: toggles the block's two pixels on row RAM[9].
pair:   LDA 1
        STA 8
        CALL toggle
        LDA 1
        ADI 1
        STA 8
        CALL toggle
        RET

; toggle: flips the pixel at column RAM[8], row RAM[9].
toggle: CALL locate
        LDA 11
        XOR 0xFD        ; SDATA
        STA 0xFD
        RET

; test: Z is 1 if the pixel at column RAM[8], row RAM[9] is dark.
test:   CALL locate
        LDA 11
        AND 0xFD
        RET

; locate: SPTR to the byte of the pixel at column RAM[8], row RAM[9], and RAM[11] to its bit.
; The bit is 0x80 shifted right by the column's low three bits, taken one at a time, with NOPs
; where a shift is not done, so it takes the same time whatever the column.
locate: LDA 9
        SHL
        SHL
        SHL
        STA 10          ; row * 8
        LDA 8
        SHR
        SHR
        SHR             ; column / 8
        ADD 10
        STA 0xFE        ; SPTR
        LDI 0x80
        STA 11
        LDA 8
        ANI 4
        JZ no4
        LDA 11
        SHR
        SHR
        SHR
        SHR
        STA 11
        JMP by2
no4:    NOP
        NOP
        NOP
        NOP
        NOP
        NOP
        NOP
by2:    LDA 8
        ANI 2
        JZ no2
        LDA 11
        SHR
        SHR
        STA 11
        JMP by1
no2:    NOP
        NOP
        NOP
        NOP
        NOP
by1:    LDA 8
        ANI 1
        JZ no1
        LDA 11
        SHR
        STA 11
        JMP done
no1:    NOP
        NOP
        NOP
        NOP
done:   RET
