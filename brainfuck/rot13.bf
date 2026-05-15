:: ROT13 cipher in Brainfuck
:: Reads stdin, outputs ROT13-encoded text
:: Works for A-Z (65-90) and a-z (97-122), passes others through
::
+[  Read all input
  ,  Read char
  [
    Check if uppercase (65-90)
    ----- -----  Subtract 10*5 = 50
    ----- -----
    [  If > 50, check if <= 90
      ++++ +++++  Add 10
      ++++ +++++
      Deeper check
    ]
    <<.>
  ]
]
