Read decimal number from stdin (0-255), output binary MSB first.
Algorithm: read ASCII digits, build number via n=n*10+digit, divide by 2 storing remainders, print remainders in reverse.
,+[ Read digits
  >++++++++ Subtract 48 to convert ASCII to digit
  [<+>-] Add to current value
  <[ Multiply by 10: shift left and add
    >+++++ +++++
    [<+>-]<
    >[-<+>]<
  ]
  Read next
,]
>[-]< Clear accumulator
Convert to binary by repeated division by 2
+[ Divide loop
  >+ Set remainder cell
  <[->>-<<] Divide by 2 using subtract
  >+ Check if >= 2
  [->-< If >= 2
    >+ Set quotient bit
    <-]
  >[<+>-] Add to output array
  <<
  Move to output section
]
Output bits
>[.>]<
