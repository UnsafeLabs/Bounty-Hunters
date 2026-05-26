from pathlib import Path


VALID_COMMANDS = set("><+-.,[]")


def expected_fizzbuzz() -> str:
    lines = []
    for value in range(1, 101):
        if value % 15 == 0:
            lines.append("FizzBuzz")
        elif value % 3 == 0:
            lines.append("Fizz")
        elif value % 5 == 0:
            lines.append("Buzz")
        else:
            lines.append(str(value))
    return "\n".join(lines) + "\n"


def run_brainfuck(program: str) -> str:
    program = "".join(command for command in program if command in VALID_COMMANDS)
    bracket_stack: list[int] = []
    bracket_map: dict[int, int] = {}
    for index, command in enumerate(program):
        if command == "[":
            bracket_stack.append(index)
        elif command == "]":
            start = bracket_stack.pop()
            bracket_map[start] = index
            bracket_map[index] = start

    tape = [0]
    pointer = 0
    instruction = 0
    output: list[str] = []

    while instruction < len(program):
        command = program[instruction]
        if command == ">":
            pointer += 1
            if pointer == len(tape):
                tape.append(0)
        elif command == "<":
            pointer -= 1
            assert pointer >= 0
        elif command == "+":
            tape[pointer] = (tape[pointer] + 1) % 256
        elif command == "-":
            tape[pointer] = (tape[pointer] - 1) % 256
        elif command == ".":
            output.append(chr(tape[pointer]))
        elif command == "[" and tape[pointer] == 0:
            instruction = bracket_map[instruction]
        elif command == "]" and tape[pointer] != 0:
            instruction = bracket_map[instruction]
        instruction += 1

    return "".join(output)


def test_fizzbuzz_program_outputs_exact_sequence():
    program_path = Path(__file__).with_name("fizzbuzz.bf")
    program = program_path.read_text()

    assert set(program) <= VALID_COMMANDS
    assert run_brainfuck(program) == expected_fizzbuzz()
