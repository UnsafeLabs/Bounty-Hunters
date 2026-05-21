[ Decimal to Binary converter in Brainfuck ]
[ Input: ASCII decimal number (e.g. "42")
[ Output: binary representation (e.g. "101010")
[
[ Algorithm:
[ 1. Read all ASCII digits, convert to single integer n
[ 2. If n == 0, output "0" and halt
[ 3. Repeatedly divide n by 2, pushing remainders
[ 4. Pop and output remainders in reverse order (MSB first)

>>>>>+>>>>>+  set flags for digit reading
,                     read first char
[                     while char != 0 (EOF)
  ----- ---           subtract '0' (48) to get digit value
  [                   if digit != 0
    < <<<<            go to accumulator
    [->+>+<<]         duplicate accumulator
    >>[-<<+>>]<<      add to accumulator (accumulator = accumulator * 10 + digit)
    >[-<<<+>>>]<<<    restore original
  ]
  >,                  read next char
]
<<<<<                  go to accumulator

[ Conversion to binary ]
>>>+>+>+               set up counters
<<<<<<
[                       while n != 0
  [->+>+<<]            copy n to work cell
  >
  [->>+<<]             n mod 2 via subtraction loop
  >>[-<<+>>]<<         remainder to cell
  <[->+<]              decrement n
  >
  [                    if n still > 0
    -                  mark
    >[->+<]            restore n
    <
  ]
  >[-<<+>>]<<          move remainder to stack
  <<<<
]
>>>>[.>>>>]             output binary digits

[ Handle zero case - output "0" ]
<<<<<[->+<]            check if original was 0
>>[-]<<                cleanup
