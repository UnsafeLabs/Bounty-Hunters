Calculate first 20 prime numbers
Uses trial division: for each n, test divisibility by all smaller numbers

>>>+ Set initial candidate = 2
[
  Copy candidate for testing
  [>>+>+<<<-]>>>
  [<<<+>>>-]
  <<
  Set divisor = 2
  >++<
  [ Test loop
    >>[->+>+<<]>>[-<<+>>]<<< Div mod
    [->+>-[>+>>]>[+[-<+>]>+>>]<<<<<<]
    >>[  If remainder != 0
      <<[->+<]> Divisible check
    ]
    >[-]< Clear temp
    <<+ Increment divisor
    >> Check if divisor >= candidate
    [->+>+<<]>>[-<<+>>]<<
  ]
]
