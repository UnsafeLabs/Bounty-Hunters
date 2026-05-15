Read decimal number from stdin, convert to binary
Uses repeated division by 2, stores bits, prints MSB first

>>>>>>>>>> Reserve space for bits
+[>,] Read digits
<[ Reverse and convert
  [->>+<<] Bump to workspace
  >+++++++[<-------->-] Subtract '0' 
]
Multiply-accumulate to build number
<<+[->>+<<]>>[<<+>>-] Initial shift
Number now in accumulator
[ Build binary representation
  ->>+>>+ Divide by 2
  <+[->+>-[>+>>]>[+[-<+>]>+>>]<<<<<<]
  Store remainder
  <<<+[->>>+<<<]>>>
]
Print binary digits
<[->.<] Clear and output
[-]<. Print final '0' or '1'
