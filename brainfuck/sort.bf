Sort characters from stdin using counting sort
Allocates 256 buckets, counts frequencies, outputs sorted

>>>>>>>>>>>>>>>> Allocate bucket area
+[ Read until EOF
  ,[ Process character
    > Go to bucket
    + Increment bucket
    < Back
  ]
]
<<<<<<<<<<<<<<<< Back to first bucket
[ For each bucket
  [ Print all occurrences
    . Output character
    - Decrement count
  ]
  > Next bucket
  + Increment character value
  <<<<<<<<<<<<<<<<
  [->>>>>>>>>>>>>>+<<<<<<<<<<<<<<<<]
  >>>>>>>>>>>>>>>
]
