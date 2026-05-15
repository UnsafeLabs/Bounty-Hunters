:: Decimal to binary in Brainfuck
:: Reads decimal from stdin, outputs binary representation
::
Read digits
+[>,]  Read all chars
Convert decimal
<[  Process each digit
  [->+>+<<]>>[-<<+>>]<<
  Subtract '0' (48)
  >---- ----<
]
Multiply-accumulate
[[->+>+<<]>>[-<<+>>]<<]
Convert to binary
[->+>-[>+>>]>[+[-<+>]>+>>]<<<<<<]
Print
