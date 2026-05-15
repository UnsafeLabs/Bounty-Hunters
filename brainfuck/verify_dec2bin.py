#!/usr/bin/env python3
from pathlib import Path


BF_CHARS = set(b"><+-.,[]")
CASES = [
    0,
    1,
    2,
    3,
    4,
    5,
    7,
    8,
    9,
    10,
    15,
    16,
    31,
    32,
    42,
    63,
    64,
    99,
    100,
    127,
    128,
    129,
    200,
    254,
    255,
]


def load_program():
    path = Path(__file__).with_name("dec2bin.bf")
    program = path.read_bytes()
    bad = sorted(set(program) - BF_CHARS)
    if bad:
        raise AssertionError(f"non-Brainfuck byte(s) in dec2bin.bf: {bad}")
    return program.decode("ascii")


def build_brackets(program):
    stack = []
    brackets = {}
    for ip, op in enumerate(program):
        if op == "[":
            stack.append(ip)
        elif op == "]":
            if not stack:
                raise AssertionError(f"unmatched ] at instruction {ip}")
            left = stack.pop()
            brackets[left] = ip
            brackets[ip] = left
    if stack:
        raise AssertionError(f"unmatched [ at instruction {stack[-1]}")
    return brackets


def run_bf(program, input_bytes):
    brackets = build_brackets(program)
    tape = [0] * 30000
    ptr = 0
    ip = 0
    inp = 0
    output = bytearray()
    steps = 0
    max_steps = 10_000_000

    while ip < len(program):
        op = program[ip]
        if op == ">":
            ptr += 1
            if ptr == len(tape):
                tape.append(0)
        elif op == "<":
            if ptr == 0:
                raise AssertionError("data pointer moved before start of tape")
            ptr -= 1
        elif op == "+":
            tape[ptr] = (tape[ptr] + 1) & 0xFF
        elif op == "-":
            tape[ptr] = (tape[ptr] - 1) & 0xFF
        elif op == ".":
            output.append(tape[ptr])
        elif op == ",":
            if inp < len(input_bytes):
                tape[ptr] = input_bytes[inp]
                inp += 1
            else:
                tape[ptr] = 10
        elif op == "[":
            if tape[ptr] == 0:
                ip = brackets[ip]
        elif op == "]":
            if tape[ptr] != 0:
                ip = brackets[ip]

        ip += 1
        steps += 1
        if steps > max_steps:
            raise AssertionError("step limit exceeded")

    return bytes(output)


def main():
    program = load_program()
    for n in CASES:
        expected = f"{n:b}\n".encode("ascii")
        for suffix in (b"\n", b""):
            input_bytes = str(n).encode("ascii") + suffix
            got = run_bf(program, input_bytes)
            if got != expected:
                raise AssertionError(
                    f"{input_bytes!r}: got {got!r}, expected {expected!r}"
                )
    print("ok")


if __name__ == "__main__":
    main()
