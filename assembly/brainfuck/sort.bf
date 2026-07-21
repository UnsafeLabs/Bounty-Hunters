[Brainfuck program: sort input string alphabetically]
[Reads up to 10 characters and outputs them sorted]

+ Set flag
[ Main loop
  >[-] Clear
  , Read character
  [ If not EOF
    >+ Set marker
    [ Sorting bubble
      <-> Decrement
      >[[-]>+<] Move
      <[->+<] Restore
    ]
    < Back
  ]
  < Back to flag
  - Decrement flag
  *[ If done
    > Output sorted
    . Print
    < Back
  ]
]
