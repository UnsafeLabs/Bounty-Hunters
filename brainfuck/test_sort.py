from __future__ import annotations

from pathlib import Path
import string
import unittest


PROGRAM = Path(__file__).with_name("sort.bf").read_text()
VALID_COMMANDS = set("><+-.,[]")


def _bracket_map(code: str) -> dict[int, int]:
    stack: list[int] = []
    pairs: dict[int, int] = {}
    for index, command in enumerate(code):
        if command == "[":
            stack.append(index)
        elif command == "]":
            if not stack:
                raise AssertionError(f"unmatched closing bracket at {index}")
            start = stack.pop()
            pairs[start] = index
            pairs[index] = start
    if stack:
        raise AssertionError(f"unmatched opening bracket at {stack[-1]}")
    return pairs


def run_brainfuck(code: str, input_text: str) -> str:
    brackets = _bracket_map(code)
    cells = [0] * 256
    pointer = 0
    instruction = 0
    input_index = 0
    input_bytes = input_text.encode("ascii")
    output: list[int] = []

    while instruction < len(code):
        command = code[instruction]
        if command == ">":
            pointer += 1
            if pointer == len(cells):
                cells.extend([0] * len(cells))
        elif command == "<":
            pointer -= 1
            if pointer < 0:
                raise AssertionError("data pointer moved left of cell zero")
        elif command == "+":
            cells[pointer] += 1
        elif command == "-":
            cells[pointer] -= 1
            if cells[pointer] < 0:
                raise AssertionError("cell value became negative")
        elif command == ".":
            output.append(cells[pointer] & 0xFF)
        elif command == ",":
            if input_index < len(input_bytes):
                cells[pointer] = input_bytes[input_index]
            else:
                cells[pointer] = 0
            input_index += 1
        elif command == "[" and cells[pointer] == 0:
            instruction = brackets[instruction]
        elif command == "]" and cells[pointer] != 0:
            instruction = brackets[instruction]
        instruction += 1

    return bytes(output).decode("ascii")


class BrainfuckSortTest(unittest.TestCase):
    def test_program_contains_only_brainfuck_commands(self) -> None:
        self.assertTrue(PROGRAM)
        self.assertLessEqual(set(PROGRAM), VALID_COMMANDS)
        _bracket_map(PROGRAM)

    def test_sort_acceptance_cases(self) -> None:
        fifty_chars = "".join(reversed(string.ascii_letters[:50]))
        cases = {
            "hello world\n": " dehllloorw\n",
            "\n": "\n",
            "a\n": "a\n",
            "banana bandana\n": " aaaaaabbdnnnn\n",
            "~ !A0zz\n": " !0Azz~\n",
            "cba\nzzz": "abc\n",
            f"{fifty_chars}\n": "".join(sorted(fifty_chars)) + "\n",
            fifty_chars: "".join(sorted(fifty_chars)) + "\n",
        }
        for input_text, expected in cases.items():
            with self.subTest(input_text=input_text):
                self.assertEqual(run_brainfuck(PROGRAM, input_text), expected)


if __name__ == "__main__":
    unittest.main()
