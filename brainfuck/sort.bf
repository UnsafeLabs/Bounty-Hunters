:: Character sort in Brainfuck (counting sort)
:: Reads input chars, outputs in ascending ASCII order
::
Allocate 256 counter cells
>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> Expand memory
>+<  Mark end
[
  ,  Read char
  [->+>+<<]>>[-<<+>>]<<  Copy to counter area
  +  Increment count for this char
]
[[->+<]>+<]  Process all counters
