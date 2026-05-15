:: First 20 Primes in Brainfuck
:: Computes and prints the first 20 prime numbers using trial division
:: 
>>++  Start with 2 as first prime candidate
>+
[
  Copy candidate
  [->+>+<<]>>[-<<+>>]<<
  Check if prime via trial division
  >+  Start divisor at 2
  [
    Copy to temp
    >>[->+>+<<]>>[-<<+>>]<<<
    Modulo check
    [->+>-[>+>>]>[+[-<+>]>+>>]<<<<<<]
    >>
    Check if divisor equals candidate
    [->+>+<<]>>[-<<+>>]<<
  ]
]
