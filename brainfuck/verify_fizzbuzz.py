#!/usr/bin/env python3
from pathlib import Path


BF_BYTES = set(b"><+-.,[]")
PROGRAM = Path(__file__).with_name("fizzbuzz.bf")


def expected_output() -> bytes:
    lines = []
    for value in range(1, 101):
        text = ""
        if value % 3 == 0:
            text += "Fizz"
        if value % 5 == 0:
            text += "Buzz"
        lines.append(text or str(value))
    return ("\n".join(lines) + "\n").encode("ascii")


def bracket_map(program: bytes) -> dict[int, int]:
    stack = []
    pairs = {}
    for index, command in enumerate(program):
        if command == ord("["):
            stack.append(index)
        elif command == ord("]"):
            if not stack:
                raise ValueError(f"unmatched ] at byte {index}")
            start = stack.pop()
            pairs[start] = index
            pairs[index] = start
    if stack:
        raise ValueError(f"unmatched [ at byte {stack[-1]}")
    return pairs


def run(program: bytes, stdin: bytes = b"") -> bytes:
    jumps = bracket_map(program)
    tape = [0]
    pointer = 0
    pc = 0
    input_pos = 0
    output = bytearray()

    while pc < len(program):
        command = program[pc]
        if command == ord(">"):
            pointer += 1
            if pointer == len(tape):
                tape.append(0)
        elif command == ord("<"):
            if pointer == 0:
                raise ValueError("data pointer moved left of cell 0")
            pointer -= 1
        elif command == ord("+"):
            tape[pointer] = (tape[pointer] + 1) % 256
        elif command == ord("-"):
            tape[pointer] = (tape[pointer] - 1) % 256
        elif command == ord("."):
            output.append(tape[pointer])
        elif command == ord(","):
            if input_pos >= len(stdin):
                raise ValueError("program attempted to read input")
            tape[pointer] = stdin[input_pos]
            input_pos += 1
        elif command == ord("[") and tape[pointer] == 0:
            pc = jumps[pc]
        elif command == ord("]") and tape[pointer] != 0:
            pc = jumps[pc]
        pc += 1

    return bytes(output)


def main() -> int:
    program = PROGRAM.read_bytes()
    invalid = sorted(set(program) - BF_BYTES)
    if invalid:
        formatted = ", ".join(f"0x{byte:02x}" for byte in invalid)
        raise SystemExit(f"invalid non-Brainfuck byte(s): {formatted}")
    if b"," in program:
        raise SystemExit("program must not read input")

    actual = run(program, b"")
    expected = expected_output()
    if actual != expected:
        raise SystemExit("output mismatch")

    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
