#!/usr/bin/env python3
from pathlib import Path


ALLOWED = set(b"><+-.,[]")
EXPECTED = "\n".join(
    str(n) for n in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71)
) + "\n"


def run_bf(code: bytes, max_steps: int = 100_000_000) -> bytes:
    jumps = {}
    stack = []
    for pc, op in enumerate(code):
        if op == ord("["):
            stack.append(pc)
        elif op == ord("]"):
            if not stack:
                raise ValueError("unmatched ]")
            start = stack.pop()
            jumps[start] = pc
            jumps[pc] = start
    if stack:
        raise ValueError("unmatched [")

    tape = bytearray(30_000)
    ptr = 0
    pc = 0
    steps = 0
    out = bytearray()

    while pc < len(code):
        op = code[pc]
        if op == ord(">"):
            ptr += 1
            if ptr == len(tape):
                tape.append(0)
        elif op == ord("<"):
            if ptr == 0:
                raise ValueError("negative tape pointer")
            ptr -= 1
        elif op == ord("+"):
            tape[ptr] = (tape[ptr] + 1) & 0xFF
        elif op == ord("-"):
            tape[ptr] = (tape[ptr] - 1) & 0xFF
        elif op == ord("."):
            out.append(tape[ptr])
        elif op == ord(","):
            raise ValueError("program attempted to read input")
        elif op == ord("[") and tape[ptr] == 0:
            pc = jumps[pc]
        elif op == ord("]") and tape[ptr] != 0:
            pc = jumps[pc]
        pc += 1
        steps += 1
        if steps > max_steps:
            raise TimeoutError("step limit exceeded")
    return bytes(out)


def main() -> None:
    code = Path(__file__).with_name("primes.bf").read_bytes()
    bad = set(code) - ALLOWED
    if bad:
        raise SystemExit(f"invalid Brainfuck byte(s): {sorted(bad)!r}")
    output = run_bf(code)
    if output != EXPECTED.encode("ascii"):
        raise SystemExit(f"unexpected output: {output!r}")
    print("ok")


if __name__ == "__main__":
    main()
