[decimal to binary - reads 0-255, prints binary]
[memory: input, temp, bit, counter]

+[>,----------]                   [read until newline]
<[++++++++++<<[>+>+<<-]>>[<<+>>-]<-]  [convert to number]

>[-]>[-]>[-]<<<                   [init work area]
[->+>+<<]>>[-<<+>>]<<             [copy number]

>++++++++++[<++++++++++>-]<       [store 100]
>[<->-]<[                          [if >= 100]
  >+++++[<++++++>-]<              [add '1' to output]
  >[-]<<<<[>>>+>+<<<<-]           [subtract 100]
  >>>>[<<<<+>>>>-]<<<-
]
>++++++++++[<++++++++++>-]<        [store 10]
>[<->-]<[                          [if >= 10]
  >++++++++[<+++++++>-]<          [add '1' to output]  
  >[-]<<<<[>>>+>+<<<<-]           [subtract 10]
  >>>>[<<<<+>>>>-]<<<-
]
>+++++++[<++++++++>-]<            [store '0']
>[-]<
<<[                                [convert remainder to binary]
  [->+>+<<]>[-<+>]>               [divide by 2]
  [-<+>]<+<                        [store remainder]
  [<]>[-]>[>]>+<[<]               [increment bit counter]
  >[>]<-<[<]>                     [dec temp]
]
>[>]<[                            [output bits MSB first]
  [-]
  >+++++++[<++++++++>-]<.         [print '0' or '1']
  <
]
[-]++++++++++.[-]                  [newline]
