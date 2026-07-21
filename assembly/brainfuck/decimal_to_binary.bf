[Brainfuck program: decimal to binary]
[Reads a decimal number from input and prints its binary representation]
[Assumes single-digit input for simplicity, uses ASCII '0'-'9']

[-] Clear cell 0
, Read input character
>++++ ++++ ++
<[->-<] Subtract 48 (ASCII '0') to get numeric value
> Go to cell 1
[ If not zero
  >[-]>[-]>[-]<<< Clear cells 2,3,4
  ++ Set divisor to 2 in cell 2
  [ Divide loop
    >[-] Clear cell 3
    >+ Set cell 4 to 1
    <[->>+>+<<<] Copy cell 2 to cells 3 and 4
    >>>[-<<<+>>>]<< Move cell 4 back
    [->>>+<<<] Move cell 3 to cell 6 for remainder
    <[->+>+<<]>>[-<<+>>]<< Copy cell 2
    [->>>[-]<<<] Zero if divisible
    >>>[[-]<<<+>>>]<< Copy remainder
  ]
  >[->+<] Move remainder
  >++++ ++++ ++ Add 48
  . Output remainder as ASCII
  <[-]<<< Back
]
>[-]<< Go back
