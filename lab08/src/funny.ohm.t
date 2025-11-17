Funny <: Arithmetic {
  Module
    = Function+

  Function
    = ident "(" ParamList ")" PreSpec? RetSpec PostSpec? UsesSpec? Stmt

  PreSpec
    = "requires" Predicate
  
  PostSpec
    = "ensures" Predicate

  RetSpec
    = "returns" ParamListNonEmpty -- list
    | "returns" "void"            -- void

  UsesSpec
    = "uses" ParamList

  ParamList
    = ListOf<Param, ",">

  ParamListNonEmpty
    = NonemptyListOf<Param, ",">

  Param
    = ident ":" Type

  Type
    = "int" "[]"  -- array
    | "int"       -- int

  ArgList
    = ListOf<Expr, ",">

  Block
    = "{" Stmt* "}"

  Stmt
    = Assign   -- assign
    | Block    -- block
    | While    -- while
    | If       -- if
    | Expr ";" -- expr

  While
    = "while" "(" Condition ")" InvariantSpec? Stmt

  InvariantSpec
    = "invariant" Predicate

  If
    = "if" "(" Condition ")" Stmt ("else" Stmt)?

  Assign
    = LValueList "=" ExprList ";"  -- tuple
    | LValue "=" Expr ";"          -- simple

  LValueList
    = ListOf<LValue, ",">

  ExprList
    = ListOf<Expr, ",">

  LValue
    = ArrayAccess                  -- array
    | ident                        -- var

  Atom
    := FunctionCall
     | ArrayAccess
     | ...

  FunctionCall
    = ident "(" ArgList ")"

  ArrayAccess
    = ident "[" Expr "]"

  Condition
    = ImplyCond

  ImplyCond
    = OrCond "->" ImplyCond        -- imply
    | OrCond

  OrCond
    = AndCond ("or" AndCond)*

  AndCond
    = NotCond ("and" NotCond)*

  NotCond
    = ("not")* AtomCond

  AtomCond
    = "true"                       -- true
    | "false"                      -- false
    | Comparison                   -- comparison
    | "(" Condition ")"            -- paren

  Comparison
    = Expr "==" Expr               -- eq
    | Expr "!=" Expr               -- neq
    | Expr ">=" Expr               -- ge
    | Expr "<=" Expr               -- le
    | Expr ">"  Expr               -- gt
    | Expr "<"  Expr               -- lt

  Predicate
    = ImplyPred

  ImplyPred
    = OrPred "->" ImplyPred        -- imply
    | OrPred

  OrPred
    = AndPred ("or" AndPred)*

  AndPred
    = NotPred ("and" NotPred)*

  NotPred
    = ("not")* AtomPred

  AtomPred
    = Quantifier                   -- quantifier
    | FormulaRef                   -- formulaRef
    | "true"                       -- true
    | "false"                      -- false
    | Comparison                   -- comparison
    | "(" Predicate ")"            -- paren

  Quantifier
    = ("forall" | "exists")
      "(" Param "|" Predicate ")"

  FormulaRef
    = ident "(" ParamList ")"

  ident = variable

  space += lineComment | blockComment
  lineComment  = "//" (~"\n" any)* ("\n" | end)
  blockComment = "/*" (~"*/" any)* "*/"
}
