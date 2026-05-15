:: FizzBuzz in Brainfuck
:: Prints numbers 1 to 100, one per line
:: Multiples of 3 -> "Fizz", multiples of 5 -> "Buzz", both -> "FizzBuzz"
::
>>++++++++++[->+>+++>+++++++>++++++++<<<<] Sets up constants
>>>>+.<<<<-
>>-
[
  Check divisibility by 3
  >>>[-]<<<[->>>+<<<]>>>-
  [
    <<<<+.>>>>-
  ]
  Check divisibility by 5
  <<[->>>+<<<]>>>--
  [
    <<<<+.>>>>-
  ]
  Print number
  >+<[->+<]
  >[-<+>]<
]
