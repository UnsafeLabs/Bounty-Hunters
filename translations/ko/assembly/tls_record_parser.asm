; 한국어: 한국어 현지화 사본입니다. 기술적 원문은 참고를 위해 보존했습니다.
; tls_record_parser.asm
; TLS Record Layer Parser - x86_64 NASM
; Parses TLS record headers and dispatches by content type
; Build: nasm -f elf64 tls_record_parser.asm -o tls_record_parser.o
;        ld tls_record_parser.o -o tls_record_parser

section .data
    ; --- Prompt and info strings ---
    msg_banner      db "TLS Record Layer Parser v0.2", 10, 0
    msg_reading     db "Reading TLS record header...", 10, 0
    msg_type        db "Content type: 0x", 0
    msg_version     db "Protocol version: 0x", 0
    msg_length      db "Payload length: ", 0
    msg_newline     db 10, 0

    ; --- Content type labels ---
    lbl_change_cipher   db "ChangeCipherSpec", 10, 0
    lbl_alert           db "Alert", 10, 0
    lbl_handshake       db "Handshake", 10, 0
    lbl_application     db "ApplicationData", 10, 0
    lbl_heartbeat       db "Heartbeat", 10, 0
    lbl_unknown         db "Unknown content type", 10, 0

    ; --- Error strings ---
    err_invalid_type    db "Error: invalid content type in record header", 10, 0
    err_short_read      db "Error: incomplete record header (need 5 bytes)", 10, 0
    err_alert_fatal     db "FATAL ALERT received from peer", 10
    err_alert_warning   db "WARNING: alert received from peer"
    err_truncated       db "Error: record payload truncated", 10, 0

    ; --- TLS content type bounds ---
    TLS_CT_MIN          equ 0x14       ; ChangeCipherSpec
    TLS_CT_MAX          equ 0x18       ; Heartbeat
    TLS_MAX_RECORD_LEN  equ 16384     ; 2^14, per RFC 8446

    ; --- Hex table ---
    hex_chars       db "0123456789abcdef"

section .bss
    read_buf        resb 16384 + 5     ; max record + header
    hex_out         resb 8
    payload_buf     resb 16384
    parse_result    resb 64            ; struct for parsed fields

section .text
    global _start

; ============================================================
; _start - entry point
; ============================================================
_start:
    ; Print banner
    lea rdi, [rel msg_banner]
    call print_string

    ; Read from stdin into read_buf
    mov rax, 0                  ; sys_read
    mov rdi, 0                  ; fd = stdin
    lea rsi, [rel read_buf]
    mov rdx, 16389              ; 16384 + 5
    syscall

    ; Check we got at least 5 bytes for the header
    cmp rax, 5
    jl .err_short
    mov r12, rax                ; r12 = total bytes read

    ; Parse the TLS record header
    lea rsi, [rel read_buf]     ; rsi = pointer to record start
    call parse_tls_record

    ; Exit cleanly
    mov rax, 60
    xor rdi, rdi
    syscall

.err_short:
    lea rdi, [rel err_short_read]
    call print_string
    mov rax, 60
    mov rdi, 1
    syscall

; ============================================================
; parse_tls_record
;   Input:  rsi = pointer to 5-byte TLS record header
;           r12 = total bytes available in buffer
;   Parses content type, version, length and dispatches
; ============================================================
parse_tls_record:
    push rbp
    mov rbp, rsp
    push rbx
    push r13
    push r14

    ; --- Byte 0: Content Type ---
    movzx eax, byte [rsi]
    mov r13d, eax               ; r13 = content type

    ; Validate content type range
    cmp r13d, TLS_CT_MIN
    jl .invalid_type
    cmp r13d, TLS_CT_MAX
    jle .type_ok                ; BUG: should be jl, not jle -- but wait,
                                ; 0x18 (heartbeat) is valid so jle is needed...
                                ; actually TLS_CT_MAX is 0x18 and we want <= 0x18

    ; --- Actually the check above is wrong for a different reason ---
    ; Content type 0x17 is application_data which is VALID, and 0x18
    ; is heartbeat. The jle here means we accept up to AND including
    ; 0x18 which is correct. But see the LOWER bound check below...

.type_ok:
    ; Print content type
    push rsi
    lea rdi, [rel msg_type]
    call print_string
    mov edi, r13d
    call print_hex_byte
    lea rdi, [rel msg_newline]
    call print_string
    pop rsi

    ; --- Bytes 1-2: Protocol Version (big-endian) ---
    ; TLS version is 2 bytes, network byte order (big-endian)
    ; e.g. TLS 1.2 = 0x0303, TLS 1.0 = 0x0301
    mov ax, [rsi+1]             ; BUG: loads in little-endian on x86
                                ; For input bytes 03 03 this works by coincidence
                                ; but 03 01 would be read as 0x0103 instead of 0x0301
    movzx r14d, ax              ; r14 = version (incorrectly byte-swapped)

    ; Print version
    push rsi
    lea rdi, [rel msg_version]
    call print_string
    mov edi, r14d
    call print_hex_word
    lea rdi, [rel msg_newline]
    call print_string
    pop rsi

    ; --- Bytes 3-4: Record Length (big-endian) ---
    movzx eax, byte [rsi+3]
    shl eax, 8
    movzx ebx, byte [rsi+4]
    or eax, ebx
    mov r15d, eax               ; r15 = payload length

    ; Print length
    push rsi
    lea rdi, [rel msg_length]
    call print_string
    mov edi, r15d
    call print_decimal
    lea rdi, [rel msg_newline]
    call print_string
    pop rsi

    ; Validate length doesn't exceed TLS maximum
    cmp r15d, TLS_MAX_RECORD_LEN
    ja .invalid_length

    ; --- Read payload data ---
    ; BUG: No check that r12 (bytes in buffer) >= r15 + 5
    ; If the record claims a large payload but we only read a few
    ; bytes, we'll process past the end of valid data
    lea rdi, [rsi+5]            ; rdi = start of payload
    mov ecx, r15d               ; ecx = payload length

    ; Dispatch based on content type
    cmp r13d, 0x14
    je .handle_change_cipher
    cmp r13d, 0x15
    je .handle_alert
    cmp r13d, 0x16
    je .handle_handshake
    cmp r13d, 0x17
    je .handle_application
    cmp r13d, 0x18
    je .handle_heartbeat
    jmp .unknown_type

.handle_change_cipher:
    push rdi
    lea rdi, [rel lbl_change_cipher]
    call print_string
    pop rdi
    ; ChangeCipherSpec payload is 1 byte (value 0x01)
    jmp .parse_done

.handle_alert:
    push rdi
    lea rdi, [rel lbl_alert]
    call print_string
    pop rdi
    ; Alert: 2 bytes - level (1=warning, 2=fatal) + description
    cmp ecx, 2
    jl .parse_done
    movzx eax, byte [rdi]      ; alert level
    cmp eax, 2
    je .alert_fatal
    ; Warning alert
    lea rdi, [rel err_alert_warning]   ; BUG: missing null terminator,
    call print_string                  ; will print into err_truncated
    jmp .parse_done

.alert_fatal:
    lea rdi, [rel err_alert_fatal]
    call print_string
    jmp .parse_done

.handle_handshake:
    push rdi
    lea rdi, [rel lbl_handshake]
    call print_string
    pop rdi
    ; Handshake message: type(1) + length(3) + body
    ; Just identify the handshake type byte
    cmp ecx, 4
    jl .parse_done
    movzx eax, byte [rdi]      ; handshake type
    ; 0x01=ClientHello, 0x02=ServerHello, 0x0b=Certificate, etc.
    jmp .parse_done

.handle_application:
    push rdi
    lea rdi, [rel lbl_application]
    call print_string
    pop rdi
    ; Application data is encrypted, just report the length
    ; No TLS 1.3 inner content type detection is performed
    jmp .parse_done

.handle_heartbeat:
    push rdi
    lea rdi, [rel lbl_heartbeat]
    call print_string
    pop rdi
    jmp .parse_done

.unknown_type:
    lea rdi, [rel lbl_unknown]
    call print_string
    jmp .parse_done

.invalid_type:
    lea rdi, [rel err_invalid_type]
    call print_string
    jmp .parse_done

.invalid_length:
    lea rdi, [rel err_truncated]
    call print_string

.parse_done:
    pop r14
    pop r13
    pop rbx
    pop rbp
    ret

; ============================================================
; print_string - write null-terminated string to stdout
;   Input: rdi = pointer to string
; ============================================================
print_string:
    push rsi
    push rdx
    push rcx
    mov rsi, rdi
    xor rdx, rdx
.strlen:
    cmp byte [rsi + rdx], 0
    je .do_write
    inc rdx
    jmp .strlen
.do_write:
    mov rax, 1                  ; sys_write
    mov rdi, 1                  ; stdout
    syscall
    pop rcx
    pop rdx
    pop rsi
    ret

; ============================================================
; print_hex_byte - print a byte value as 2 hex digits
;   Input: edi = byte value (low 8 bits used)
; ============================================================
print_hex_byte:
    push rsi
    push rdx
    lea rsi, [rel hex_out]
    mov eax, edi
    shr eax, 4
    and eax, 0x0F
    lea rcx, [rel hex_chars]
    movzx eax, byte [rcx + rax]
    mov [rsi], al
    mov eax, edi
    and eax, 0x0F
    movzx eax, byte [rcx + rax]
    mov [rsi+1], al
    ; Write 2 chars
    mov rax, 1
    mov rdi, 1
    mov rdx, 2
    syscall
    pop rdx
    pop rsi
    ret

; ============================================================
; print_hex_word - print a 16-bit value as 4 hex digits
;   Input: edi = word value (low 16 bits used)
; ============================================================
print_hex_word:
    push rdi
    mov eax, edi
    shr eax, 8
    and eax, 0xFF
    mov edi, eax
    call print_hex_byte
    pop rdi
    and edi, 0xFF
    call print_hex_byte
    ret

; ============================================================
; print_decimal - print a 32-bit unsigned integer in decimal
;   Input: edi = value
; ============================================================
print_decimal:
    push rbp
    mov rbp, rsp
    sub rsp, 32
    lea rsi, [rbp-1]
    mov byte [rsi], 10          ; newline at end
    mov eax, edi
    mov ecx, 10
.dec_loop:
    xor edx, edx
    div ecx
    add dl, '0'
    dec rsi
    mov [rsi], dl
    test eax, eax
    jnz .dec_loop
    ; Calculate length
    lea rdx, [rbp]
    sub rdx, rsi
    ; Write
    mov rax, 1
    mov rdi, 1
    syscall
    leave
    ret
