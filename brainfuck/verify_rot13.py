#!/usr/bin/env python3
from pathlib import Path
from random import Random
from string import printable


BF_BYTES = set(b"><+-.,[]")
PROGRAM = Path(__file__).with_name("rot13.bf")


def load_program():
    code = PROGRAM.read_bytes()
    bad = sorted(set(code) - BF_BYTES)
    if bad:
        raise AssertionError(f"non-Brainfuck bytes found: {bad}")
    return code.decode("ascii")


def jump_table(code):
    stack = []
    jumps = {}
    for pos, op in enumerate(code):
        if op == "[":
            stack.append(pos)
        elif op == "]":
            if not stack:
                raise AssertionError(f"unmatched ] at {pos}")
            start = stack.pop()
            jumps[start] = pos
            jumps[pos] = start
    if stack:
        raise AssertionError(f"unmatched [ at {stack[-1]}")
    return jumps


def run_bf(code, data):
    jumps = jump_table(code)
    tape = [0] * 30000
    ptr = pc = ip = 0
    output = bytearray()

    while pc < len(code):
        if code.startswith("[-]", pc):
            tape[ptr] = 0
            pc += 3
            continue
        if tape[ptr] and code.startswith("[>>>+<[-]<<-]", pc):
            tape[ptr + 3] = (tape[ptr + 3] + tape[ptr]) & 0xFF
            tape[ptr + 2] = 0
            tape[ptr] = 0
            pc += 13
            continue
        if tape[ptr] and code.startswith("[<<<+>>>-]", pc):
            tape[ptr - 3] = (tape[ptr - 3] + tape[ptr]) & 0xFF
            tape[ptr] = 0
            pc += 10
            continue
        if tape[ptr] and code.startswith("[->>>", pc):
            dot = pc + 5
            while dot < len(code) and code[dot] == "+":
                dot += 1
            if code.startswith(".[-]<<<]", dot):
                value = dot - (pc + 5)
                tape[ptr] = 0
                tape[ptr + 3] = value & 0xFF
                output.append(tape[ptr + 3])
                tape[ptr + 3] = 0
                pc = dot + 8
                continue

        op = code[pc]
        if op == ">":
            ptr += 1
            if ptr == len(tape):
                tape.append(0)
        elif op == "<":
            ptr -= 1
            if ptr < 0:
                raise AssertionError("data pointer moved left of zero")
        elif op == "+":
            tape[ptr] = (tape[ptr] + 1) & 0xFF
        elif op == "-":
            tape[ptr] = (tape[ptr] - 1) & 0xFF
        elif op == ".":
            output.append(tape[ptr])
        elif op == ",":
            if ip < len(data):
                tape[ptr] = data[ip]
                ip += 1
            else:
                tape[ptr] = 0
        elif op == "[" and tape[ptr] == 0:
            pc = jumps[pc]
        elif op == "]" and tape[ptr] != 0:
            pc = jumps[pc]
        pc += 1

    return bytes(output)


def rot13(data):
    output = bytearray()
    for byte in data:
        if ord("A") <= byte <= ord("Z"):
            output.append((byte - ord("A") + 13) % 26 + ord("A"))
        elif ord("a") <= byte <= ord("z"):
            output.append((byte - ord("a") + 13) % 26 + ord("a"))
        else:
            output.append(byte)
    return bytes(output)


def check(code, data, expected):
    actual = run_bf(code, data)
    if actual != expected:
        raise AssertionError(f"{data!r}: expected {expected!r}, got {actual!r}")


def main():
    code = load_program()

    check(code, b"Hello, World! 123\n", b"Uryyb, Jbeyq! 123\n")
    check(code, b"A M N Z a m n z", b"N Z A M n z a m")
    check(code, b" 0123456789!?,.;:-_()[]{}\n", b" 0123456789!?,.;:-_()[]{}\n")
    check(code, b"", b"")

    sample = "".join(Random(653).choice(printable[:-6]) for _ in range(80)).encode()
    check(code, run_bf(code, sample), sample)
    check(code, sample, rot13(sample))

    print("ok")


if __name__ == "__main__":
    main()
