[Brainfuck program: print first 20 prime numbers]
[Outputs primes separated by newlines]

+++++ +++++ + Set counter to 10 (for 20 primes, use nested loop)
[ Set counter for 2 primes per outer iteration
  >[-]+++++ +++++ Set inner counter
  >[-]+++ Set initial test number
  [ Prime test loop
    >[-]<< Set divisor
    [ Division loop
      >[-]>[-]<<
      [->+>+<<]>>[-<<+>>]<<
    ]
    >>[-]<<
    + Increment number
    <<< Back
  ]
  <[-] Output prime
  +++++ +++++ +++++ +++++ +++ Add 48 for ASCII
  .
  [-]
  > Output newline
  +++++ +++++ +++++ +++++ +++++ ++
  .
  [-]
  <<-
]
