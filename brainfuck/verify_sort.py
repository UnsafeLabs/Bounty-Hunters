#!/usr/bin/env python3
from pathlib import Path
from random import Random
from string import printable


BF_CHARS = set("><+-.,[]")
ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "sort.bf"


class Op:
    def __init__(self, kind, arg=None):
        self.kind = kind
        self.arg = arg
        self.linear = linear_effect(arg) if kind == "[" else None


def linear_effect(nodes):
    if nodes is None:
        return None
    ptr = 0
    effects = {0: 0}
    for op in nodes:
        if op.kind == ">":
            ptr += op.arg
        elif op.kind == "<":
            ptr -= op.arg
        elif op.kind == "+":
            effects[ptr] = effects.get(ptr, 0) + op.arg
        elif op.kind == "-":
            effects[ptr] = effects.get(ptr, 0) - op.arg
        else:
            return None
    if ptr != 0 or effects.get(0) != -1:
        return None
    return {offset: delta for offset, delta in effects.items() if offset and delta % 256}


def parse(code, index=0):
    nodes = []
    while index < len(code):
        char = code[index]
        if char in "+-<>":
            end = index
            while end < len(code) and code[end] == char:
                end += 1
            nodes.append(Op(char, end - index))
            index = end
        elif char in ".,":
            nodes.append(Op(char))
            index += 1
        elif char == "[":
            body, index = parse(code, index + 1)
            nodes.append(Op("[", body))
        elif char == "]":
            return nodes, index + 1
    return nodes, index


def run_bf(code, input_text):
    program, index = parse(code)
    assert index == len(code)
    data = [0] * 512
    ptr = 0
    input_bytes = [ord(char) for char in input_text]
    input_index = 0
    output = []

    def ensure():
        nonlocal data
        if ptr >= len(data):
            data.extend([0] * len(data))

    def execute(nodes):
        nonlocal ptr, input_index
        for op in nodes:
            if op.kind == ">":
                ptr += op.arg
                ensure()
            elif op.kind == "<":
                ptr -= op.arg
                assert ptr >= 0
            elif op.kind == "+":
                data[ptr] = (data[ptr] + op.arg) & 255
            elif op.kind == "-":
                data[ptr] = (data[ptr] - op.arg) & 255
            elif op.kind == ".":
                output.append(chr(data[ptr]))
            elif op.kind == ",":
                if input_index < len(input_bytes):
                    data[ptr] = input_bytes[input_index]
                    input_index += 1
                else:
                    data[ptr] = 0
            elif op.linear is not None:
                value = data[ptr]
                data[ptr] = 0
                for offset, delta in op.linear.items():
                    target = ptr + offset
                    if target >= len(data):
                        data.extend([0] * (target - len(data) + 1))
                    data[target] = (data[target] + value * delta) & 255
            else:
                while data[ptr]:
                    execute(op.arg)

    execute(program)
    return "".join(output)


def main():
    code = SOURCE.read_text()
    assert code, "sort.bf is empty"
    assert set(code) <= BF_CHARS, "sort.bf contains non-Brainfuck characters"

    rng = Random(654)
    chars = "".join(char for char in printable if char not in "\n\r\t\x0b\x0c")
    random_input = "".join(rng.choice(chars) for _ in range(50)) + "\n"

    tests = [
        ("hello world\n", " dehllloorw\n"),
        ("banana\n", "aaabnn\n"),
        ("  cba  \n", "    abc\n"),
        ("\n", "\n"),
        ("x\n", "x\n"),
        ("mississippi\n", "".join(sorted("mississippi")) + "\n"),
        (random_input, "".join(sorted(random_input[:-1])) + "\n"),
    ]

    for input_text, expected in tests:
        actual = run_bf(code, input_text)
        assert actual == expected, f"{input_text!r}: expected {expected!r}, got {actual!r}"

    print("ok")


if __name__ == "__main__":
    main()
