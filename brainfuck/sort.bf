[Brainfuck bubble sort - reads chars, sorts ascending, outputs]
[Memory: input chars in array 10+, sorted in place]

,[>,]                              [read all chars into array]
<[<]                               [go to start]
>+                                 [flag for pass]

[sort loop]
<[                                [while unsorted]
  >>
  [->>+>+<<<]>>>[-<<<+>>>]<<      [copy current to temp]
  <<[->>>>>>>>+>+<<<<<<<<<]>>>>>>>>[-<<<<<<<<<+>>>>>>>>>]<<<<<<<< [copy next]
  >>>[-]<[-]<<<                   [compare]
  
  [if current > next, swap]
  >>>[-]+<[-]                     [swap flag]
  <<[                             [if current > next]
    >>>[-]                        [clear flag]
    <<<<<<[->>>>>>+>+<<<<<<<]>>>>>>>[-<<<<<<<+>>>>>>>]  [swap]
    >>>>>>>>[-<<<<<<<<+>>>>>>>>]<<<<<<<<
  ]
  <<<<<[                          [if not swapped]
    >>>>>+                        [mark pass complete]
  ]
  >>
]
<<<<[<]                           [go to start]
>[>.][-]                          [output sorted chars]
[-]++++++++++.[-]                  [newline]
