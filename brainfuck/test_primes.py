from pathlib import Path
import unittest


VALID_COMMANDS = set("><+-.,[]")
EXPECTED_OUTPUT = "\n".join(
    [
        "2",
        "3",
        "5",
        "7",
        "11",
        "13",
        "17",
        "19",
        "23",
        "29",
        "31",
        "37",
        "41",
        "43",
        "47",
        "53",
        "59",
        "61",
        "67",
        "71",
    ]
) + "\n"


def run_brainfuck(code, max_steps=50_000_000):
    bracket_stack = []
    bracket_map = {}
    for index, command in enumerate(code):
        if command == "[":
            bracket_stack.append(index)
        elif command == "]":
            start = bracket_stack.pop()
            bracket_map[start] = index
            bracket_map[index] = start
    if bracket_stack:
        raise AssertionError("Unmatched '[' in Brainfuck program")

    cells = [0] * 30_000
    pointer = 0
    output = []
    ip = 0
    steps = 0

    while ip < len(code):
        command = code[ip]
        if command == ">":
            pointer += 1
        elif command == "<":
            pointer -= 1
            if pointer < 0:
                raise AssertionError("Pointer moved before cell zero")
        elif command == "+":
            cells[pointer] = (cells[pointer] + 1) & 0xFF
        elif command == "-":
            cells[pointer] = (cells[pointer] - 1) & 0xFF
        elif command == ".":
            output.append(chr(cells[pointer]))
        elif command == ",":
            cells[pointer] = 0
        elif command == "[" and cells[pointer] == 0:
            ip = bracket_map[ip]
        elif command == "]" and cells[pointer] != 0:
            ip = bracket_map[ip]

        ip += 1
        steps += 1
        if steps > max_steps:
            raise AssertionError("Brainfuck program exceeded the step limit")

    return "".join(output)


class PrimesBrainfuckTest(unittest.TestCase):
    def test_program_uses_only_brainfuck_commands(self):
        code = Path(__file__).with_name("primes.bf").read_text(encoding="ascii").strip()
        self.assertTrue(code)
        self.assertLessEqual(set(code), VALID_COMMANDS)

    def test_program_prints_the_first_twenty_primes(self):
        code = Path(__file__).with_name("primes.bf").read_text(encoding="ascii").strip()
        self.assertEqual(run_brainfuck(code), EXPECTED_OUTPUT)


if __name__ == "__main__":
    unittest.main()
