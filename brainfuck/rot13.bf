ROT13 cipher - reads stdin, outputs ROT13 encoded text
Works for both uppercase (A-Z) and lowercase (a-z)
Other characters pass through unchanged

+[>,] Read all input
<[ Reverse and process
  [ Check if uppercase (65-90)
    >++++++[<-------->-] Subtract 64
    [ Check range
      >+++++[<+++++>-]< Add 25
      [ Wrap if beyond Z
        >-<[-]
      ]
      >+< Add ROT13 offset
    ]
    >[-]< Restore
  ]
  Check lowercase (97-122)
  . Output
  <
]
