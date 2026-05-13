; Spanish comment translation of assembly/tls_record_parser.asm. Code is unchanged; comments are localized.
; tls_record_parser.asm
; Analizador de capas de registros TLS: x86_64 NASM
; Analiza los encabezados de registros TLS y los envía por tipo de contenido
; Compilación: nasm -f elf64 tls_record_parser.asm -o tls_record_parser.o
; ld tls_record_parser.o -o tls_record_parser

section .data
    ; --- Cadenas de aviso e información ---
    msg_banner      db "TLS Record Layer Parser v0.2", 10, 0
    msg_reading     db "Reading TLS record header...", 10, 0
    msg_type        db "Content type: 0x", 0
    msg_version     db "Protocol version: 0x", 0
    msg_length      db "Payload length: ", 0
    msg_newline     db 10, 0

    ; --- Etiquetas de tipo de contenido ---
    lbl_change_cipher   db "ChangeCipherSpec", 10, 0
    lbl_alert           db "Alert", 10, 0
    lbl_handshake       db "Handshake", 10, 0
    lbl_application     db "ApplicationData", 10, 0
    lbl_heartbeat       db "Heartbeat", 10, 0
    lbl_unknown         db "Unknown content type", 10, 0

    ; --- Cadenas de error ---
    err_invalid_type    db "Error: invalid content type in record header", 10, 0
    err_short_read      db "Error: incomplete record header (need 5 bytes)", 10, 0
    err_alert_fatal     db "FATAL ALERT received from peer", 10
    err_alert_warning   db "WARNING: alert received from peer"
    err_truncated       db "Error: record payload truncated", 10, 0

    ; --- Límites de tipo de contenido TLS ---
    TLS_CT_MIN          equ 0x14       ; ChangeCipherSpec
    TLS_CT_MAX          equ 0x18       ; Heartbeat
    TLS_MAX_RECORD_LEN  equ 16384     ; 2^14, per RFC 8446

    ; --- Mesa hexagonal ---
    hex_chars       db "0123456789abcdef"

section .bss
    read_buf        resb 16384 + 5     ; max record + header
    hex_out         resb 8
    payload_buf     resb 16384
    parse_result    resb 64            ; struct for parsed fields

section .text
    global _start

; ===============================================================
; _start - punto de entrada
; ===============================================================
_start:
    ; imprimir pancarta
    lea rdi, [rel msg_banner]
    call print_string

    ; Leer desde stdin a read_buf
    mov rax, 0                  ; sys_read
    mov rdi, 0                  ; fd = stdin
    lea rsi, [rel read_buf]
    mov rdx, 16389              ; 16384 + 5
    syscall

    ; Compruebe que tengamos al menos 5 bytes para el encabezado.
    cmp rax, 5
    jl .err_short
    mov r12, rax                ; r12 = total bytes read

    ; Analizar el encabezado del registro TLS
    lea rsi, [rel read_buf]     ; rsi = pointer to record start
    call parse_tls_record

    ; Salir limpiamente
    mov rax, 60
    xor rdi, rdi
    syscall

.err_short:
    lea rdi, [rel err_short_read]
    call print_string
    mov rax, 60
    mov rdi, 1
    syscall

; ===============================================================
; parse_tls_record
; Entrada: rsi = puntero al encabezado del registro TLS de 5 bytes
; r12 = total de bytes disponibles en el buffer
; Analiza el tipo de contenido, la versión, la longitud y los envíos.
; ===============================================================
parse_tls_record:
    push rbp
    mov rbp, rsp
    push rbx
    push r13
    push r14

    ; --- Byte 0: Tipo de contenido ---
    movzx eax, byte [rsi]
    mov r13d, eax               ; r13 = content type

    ; Validar rango de tipo de contenido
    cmp r13d, TLS_CT_MIN
    jl .invalid_type
    cmp r13d, TLS_CT_MAX
    jle .type_ok                ; BUG: should be jl, not jle -- but wait,
                                ; 0x18 (latido) es válido, por lo que se necesita jle...
                                ; en realidad TLS_CT_MAX es 0x18 y queremos <= 0x18

    ; --- En realidad, la verificación anterior es incorrecta por una razón diferente ---
    ; El tipo de contenido 0x17 es application_data que es VÁLIDO y 0x18
    ; es el latido del corazón. El jle aquí significa que aceptamos hasta E incluyendo
    ; 0x18 que es correcto. Pero vea la verificación del límite INFERIOR a continuación...

.type_ok:
    ; Tipo de contenido de impresión
    push rsi
    lea rdi, [rel msg_type]
    call print_string
    mov edi, r13d
    call print_hex_byte
    lea rdi, [rel msg_newline]
    call print_string
    pop rsi

    ; --- Bytes 1-2: Versión del protocolo (big-endian) ---
    ; La versión TLS es de 2 bytes, orden de bytes de red (big-endian)
    ; por ej. TLS 1,2 = 0x0303, TLS 1,0 = 0x0301
    mov ax, [rsi+1]             ; BUG: loads in little-endian on x86
                                ; Para los bytes de entrada 03 03 esto funciona por coincidencia
                                ; pero 03 01 se leería como 0x0103 en lugar de 0x0301
    movzx r14d, ax              ; r14 = version (incorrectly byte-swapped)

    ; Versión impresa
    push rsi
    lea rdi, [rel msg_version]
    call print_string
    mov edi, r14d
    call print_hex_word
    lea rdi, [rel msg_newline]
    call print_string
    pop rsi

    ; --- Bytes 3-4: Longitud del registro (big-endian) ---
    movzx eax, byte [rsi+3]
    shl eax, 8
    movzx ebx, byte [rsi+4]
    or eax, ebx
    mov r15d, eax               ; r15 = payload length

    ; Longitud de impresión
    push rsi
    lea rdi, [rel msg_length]
    call print_string
    mov edi, r15d
    call print_decimal
    lea rdi, [rel msg_newline]
    call print_string
    pop rsi

    ; La longitud de validación no supera el máximo de TLS
    cmp r15d, TLS_MAX_RECORD_LEN
    ja .invalid_length

    ; --- Leer datos de carga útil ---
    ; ERROR: No se comprueba que r12 (bytes en el búfer) >= r15 + 5
    ; Si el registro afirma tener una gran carga útil pero solo leemos unos pocos
    ; bytes, procesaremos más allá del final de los datos válidos
    lea rdi, [rsi+5]            ; rdi = start of payload
    mov ecx, r15d               ; ecx = payload length

    ; Envío basado en el tipo de contenido
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
    ; La carga útil de ChangeCipherSpec es de 1 byte (valor 0x01)
    jmp .parse_done

.handle_alert:
    push rdi
    lea rdi, [rel lbl_alert]
    call print_string
    pop rdi
    ; Alerta: 2 bytes - nivel (1=advertencia, 2=fatal) + descripción
    cmp ecx, 2
    jl .parse_done
    movzx eax, byte [rdi]      ; alert level
    cmp eax, 2
    je .alert_fatal
    ; Alerta de advertencia
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
    ; Mensaje de apretón de manos: tipo(1) + longitud(3) + cuerpo
    ; Simplemente identifique el byte del tipo de protocolo de enlace
    cmp ecx, 4
    jl .parse_done
    movzx eax, byte [rdi]      ; handshake type
    ; 0x01=ClienteHola, 0x02=ServidorHola, 0x0b=Certificado, etc.
    jmp .parse_done

.handle_application:
    push rdi
    lea rdi, [rel lbl_application]
    call print_string
    pop rdi
    ; Los datos de la aplicación están encriptados, solo informe la longitud
    ; No se realiza ninguna detección de tipo de contenido interno TLS 1.3
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

; ===============================================================
; print_string - escribe una cadena terminada en nulo en la salida estándar
; Entrada: rdi = puntero a cadena
; ===============================================================
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

; ===============================================================
; print_hex_byte: imprime un valor de byte como 2 dígitos hexadecimales
; Entrada: edi = valor de byte (se utilizan 8 bits bajos)
; ===============================================================
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
    ; Escribe 2 caracteres
    mov rax, 1
    mov rdi, 1
    mov rdx, 2
    syscall
    pop rdx
    pop rsi
    ret

; ===============================================================
; print_hex_word: imprime un valor de 16 bits como 4 dígitos hexadecimales
; Entrada: edi = valor de palabra (se utilizan 16 bits bajos)
; ===============================================================
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

; ===============================================================
; print_decimal: imprime un entero sin signo de 32 bits en formato decimal
; Entrada: edi = valor
; ===============================================================
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
    ; Calcular longitud
    lea rdx, [rbp]
    sub rdx, rsi
    ; escribir
    mov rax, 1
    mov rdi, 1
    syscall
    leave
    ret
