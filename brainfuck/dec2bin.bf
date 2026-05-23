) Read decimal number from stdin (ASCII digits, terminated by newline)
) Convert to binary and print as 0/1 characters

+[->,<]+++++++++.  Read all input digits
<+[->>+<<]>>+<     Move to end of input
[->-<]>            Find last digit

) Main conversion loop
+[                 For each digit
  [-<+>]           Copy to workspace
  <++++++++++      Subtract 10 to check if done
  >[               If not done
    -<->           Decrement and continue
    <++++++++++>   Add 10 back
  ]
  <
]>