[Brainfuck program: FizzBuzz from 1 to 100]
[Prints numbers 1-100 with FizzBuzz substitutions]

+++++ +++++ Set counter (10x10 for 100)
[
  >+++++ +++++ Set inner counter
  [
    >+ Increment number
    >[-]<<
    [ Fizz check (mod 3)
      >+++[-<->]<
      [ If not divisible
        >+>+<<
      ]
      >[ If divisible
        >+++++ +++++ +++++ + F
        .[-]
        >+++++ +++++ +++++ +++++ +++ i
        .[-]
        >+++++ +++++ +++++ +++++ +++++ ++ z
        .[-]
        >+++++ +++++ +++++ +++++ +++++ +++ z
        .[-]
        <<<<
      ]
    ]
    >[-]
    [ Buzz check (mod 5)
      >+++++[-<->]
      [ If not divisible
        >+>+<<
      ]
      >[ If divisible
        >+++++ +++++ +++++ +++ B
        .[-]
        >+++++ +++++ +++++ +++++ +++++ + u
        .[-]
        >+++++ +++++ +++++ +++++ +++++ +++++ ++ z
        .[-]
        >+++++ +++++ +++++ +++++ +++++ +++++ ++ z
        .[-]
        <<<<
      ]
    ]
    <
    [ Output number if not Fizz or Buzz
      >>[-]<<
    ]
    >[-]<<-
  ]
  <-
]
