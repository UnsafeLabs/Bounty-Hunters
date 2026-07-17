[Brainfuck first 20 primes by trial division]
[Memory layout: num=0, candidate=1, divisor, temp, counter=20, print_temp, ...]

++++++++++[>++++++++++<-]>+        [counter = 101 (output newlines)]
>[-]++++++++++[>+++++++++++<-]>+   [newline = 10]
<<<<++++++++++[>++++++++++<-]>+   [counter = 101]
<<<<<

[outer loop - find 20 primes]
>+                                  [start with candidate = 2]
>>[-]<<                             [clear divisor]

[find_next_prime]
>+                                  [candidate++]
<<[>>+>+<<<-]>>>[<<<+>>>-]         [copy candidate to test]
<[>>+>+<<<-]>>>[<<<+>>>-]          [copy to divisor]
<<<

[check_primality]
>[-]<<                              [clear temp]
[>>[->+>+<<]>>[-<<+>>]<<<-]        [copy divisor]
>>>[<<<+>>>-]                       [restore divisor]
<<[                                 [while divisor > 1]
  >[-]>[-]<<                        [clear temps]
  [>>>>+>+<<<<<-]>>>>[<<<<+>>>>-]  [copy candidate]
  [->+>+<<]>>[-<<+>>]<             [copy divisor]
  <[>-<-]                          [candidate mod divisor]
  >>[<<+>>-]<<<<                    [check remainder]
  [ if remainder = 0 (not prime) ]
  >>>+<[-]                         [mark not prime and exit]
]
>>>[[-]<<<+>>>]                     [if prime, mark it]
<<<<

[if not prime, try next number]
>>>[-]+<<<                          [check if prime]
[ not prime case ]
  >[-]<<                            [continue to next number]
  <<[>>+>+<<<-]>>>[<<<+>>>-]        [restore counter]
>>[ prime case ]
  [output the prime number]
  >>>[-]+<<<<                        [save prime flag]
  
  [convert number to ASCII digits and print]
  >[-]>[-]<<                         [clear output temps]
  [convert to decimal digits - hundreds]
  ++++++++++[<++++++++++>-]<        [100]
  [->-<]>[<++++++++[<+++++++>-]>.>] [print hundreds digit]
  [tens]
  ++++++++++[<++++++++++>-]<        [10]  
  [->-<]>[<+++++++[<++++++++>-]>.>] [print tens digit]
  [ones]
  +++++++[<++++++++>-]<.            [print ones digit]
  
  [-]<++++++++++.[-]                 [print newline]
  <[-]                               [decrement counter]
  >>[-]                              [clear]
>>>[-]<<<                            [clear]
<<<<<

[check if we've found 20 primes]
>>>>>>[-]<<<<<<                      [check counter]
>+<[->-<]>[                          [if counter > 0]
  <<<<+                             [restore and continue]
  >>>>
]
<<<<<                                [loop back]
