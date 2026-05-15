#!/usr/bin/env python3
"""Verify brainfuck/rot13.bf against representative ROT13 cases."""
from __future__ import annotations

from pathlib import Path

COMMANDS = set("><+-.,[]")
PROGRAM = Path(__file__).with_name("rot13.bf")


def build_bracket_map(code: str) -> dict[int, int]:
    stack: list[int] = []
    bracket_map: dict[int, int] = {}
    for index, command in enumerate(code):
        if command == "[":
            stack.append(index)
        elif command == "]":
            if not stack:
                raise AssertionError(f"unmatched closing bracket at {index}")
            opening = stack.pop()
            bracket_map[opening] = index
            bracket_map[index] = opening
    if stack:
        raise AssertionError(f"unmatched opening bracket(s): {stack}")
    return bracket_map


def run_brainfuck(code: str, stdin: bytes, *, max_steps: int = 10_000_000) -> bytes:
    bracket_map = build_bracket_map(code)
    tape = [0] * 30_000
    pointer = 0
    pc = 0
    input_index = 0
    output = bytearray()
    steps = 0

    while pc < len(code):
        steps += 1
        if steps > max_steps:
            raise AssertionError("program exceeded step limit")

        command = code[pc]
        if command == ">":
            pointer += 1
            if pointer == len(tape):
                tape.append(0)
        elif command == "<":
            pointer -= 1
            if pointer < 0:
                raise AssertionError("data pointer moved before cell 0")
        elif command == "+":
            tape[pointer] = (tape[pointer] + 1) % 256
        elif command == "-":
            tape[pointer] = (tape[pointer] - 1) % 256
        elif command == ".":
            output.append(tape[pointer])
        elif command == ",":
            if input_index < len(stdin):
                tape[pointer] = stdin[input_index]
                input_index += 1
            else:
                tape[pointer] = 0
        elif command == "[" and tape[pointer] == 0:
            pc = bracket_map[pc]
        elif command == "]" and tape[pointer] != 0:
            pc = bracket_map[pc]
        pc += 1

    return bytes(output)


def rot13(data: bytes) -> bytes:
    converted = bytearray()
    for value in data:
        if 65 <= value <= 90:
            converted.append(((value - 65 + 13) % 26) + 65)
        elif 97 <= value <= 122:
            converted.append(((value - 97 + 13) % 26) + 97)
        else:
            converted.append(value)
    return bytes(converted)


def main() -> None:
    raw_code = PROGRAM.read_text(encoding="utf-8")
    invalid = sorted(set(raw_code) - COMMANDS)
    if invalid:
        raise AssertionError(f"invalid Brainfuck command(s): {invalid!r}")
    code = raw_code

    cases = [
        b"",
        b"Hello, World! 123\n",
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZ\n",
        b"abcdefghijklmnopqrstuvwxyz\n",
        b"Uryyb, Jbeyq! 123\n",
        bytes(range(32, 127)) + b"\n",
    ]

    for case in cases:
        expected = rot13(case)
        actual = run_brainfuck(code, case)
        if actual != expected:
            raise AssertionError(f"ROT13 mismatch for {case!r}: {actual!r} != {expected!r}")
        roundtrip = run_brainfuck(code, actual)
        if roundtrip != case:
            raise AssertionError(f"roundtrip mismatch for {case!r}: {roundtrip!r}")

    print(f"verified {len(cases)} ROT13 cases")


if __name__ == "__main__":
    main()
