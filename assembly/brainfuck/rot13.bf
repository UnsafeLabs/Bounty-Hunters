[Brainfuck program: ROT13 cipher]
[Reads input and prints ROT13-encoded output]
[Handles both uppercase (A-Z) and lowercase (a-z)]

+[ Read loop
  [-]
  , Read character
  [ If not EOF
    [ Check if uppercase (A-Z)
      >+++++ +++++ + Set 65
      <[->-<] Subtract
      >+ Add 1
      <[->>+>+<<<]>>>
      Check if less than 26
      <<[->>-<<]>>
      [ If uppercase
        <<<+>-> Add 13
        [->>+<<]>>>
        +++++ +++++ +++++ + Add 65
        . Output
        <<< Zero
      ]
    ]
    [ Check if lowercase (a-z)
      >+++++ +++++ +++++ +[->---<] Set 97
      <[->-<] Subtract
      >+ Add 1
      <[->>+>+<<<]>>>
      Check if less than 26
      <<[->>-<<]>>
      [ If lowercase
        <<<+>-> Add 13
        [->>+<<]>>>
        +++++ +++++ +++++ +++++ +++++ + Add 97
        . Output
        <<< Zero
      ]
    ]
    <[-] Clear
  ]
  < Back
]
