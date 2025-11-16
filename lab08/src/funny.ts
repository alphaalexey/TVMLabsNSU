import * as arith from "../../lab04";

export const enum ErrorCode {
    ParseError = 'E_PARSE_ERROR',
    DuplicateFunction = 'E_DUPLICATE_FUNCTION',
    Redeclaration = 'E_REDECLARATION',
    AssignArity = 'E_ASSIGN_ARITY',
    AssignUndeclaredVar = 'E_ASSIGN_UNDECLARED_VAR',
    AssignUndeclaredArray = 'E_ASSIGN_UNDECLARED_ARRAY',
    UseUndeclaredVar = 'E_USE_UNDECLARED_VAR',
    OperatorMultiValue = 'E_OPERATOR_MULTI_VALUE',
    UnknownFunction = 'E_UNKNOWN_FUNCTION',
    ArgumentCount = 'E_ARGUMENT_COUNT',
    ArgumentMultiValue = 'E_ARGUMENT_MULTI_VALUE',
    AccessUndeclaredArray = 'E_ACCESS_UNDECLARED_ARRAY',
    ArrayIndexMultiValue = 'E_ARRAY_INDEX_MULTI_VALUE',
    ComparisonMultiValue = 'E_COMPARISON_MULTI_VALUE',
}

export class FunnyError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly startLine?: number,
        public readonly startCol?: number,
        public readonly endCol?: number,
        public readonly endLine?: number) {
        super(message);
    }
}

export interface Module {
    type: "module";
    functions: FunctionDef[];
}

export interface FunctionDef {
    type: "fun";
    name: string;
    parameters: ParameterDef[];
    returns: ParameterDef[];
    locals: ParameterDef[];
    body: Statement;
}

export interface ParameterDef {
    type: "param";
    name: string;
}

export type Statement =
    | AssignStmt
    | BlockStmt
    | IfStmt
    | WhileStmt
    | ExprStmt;

export type LValue = VarLValue | ArrLValue;

export interface VarLValue {
    type: "lvar";
    name: string;
}

export interface ArrLValue {
    type: "larr";
    name: string;
    index: Expr;
}

export interface AssignStmt {
    type: "assign";
    targets: LValue[];
    exprs: Expr[];
}

export interface BlockStmt {
    type: "block";
    stmts: Statement[];
}

export interface IfStmt {
    type: "if";
    condition: Condition;
    then: Statement;
    else: Statement | null;
}

export interface WhileStmt {
    type: "while";
    condition: Condition;
    invariant: Predicate | null;
    body: Statement;
}

export interface ExprStmt {
    type: "expr";
    expr: Expr;
}

export type Expr = arith.Expr | FuncCallExpr | ArrAccessExpr;

export interface FuncCallExpr {
    type: "funccall";
    name: string;
    args: Expr[];
}

export interface ArrAccessExpr {
    type: "arraccess";
    name: string;
    index: Expr;
}

export type Condition =
    | TrueCond
    | FalseCond
    | ComparisonCond
    | NotCond
    | AndCond
    | OrCond
    | ImpliesCond
    | ParenCond;

export interface TrueCond {
    kind: "true";
}

export interface FalseCond {
    kind: "false";
}

export interface ComparisonCond {
    kind: "comparison";
    left: Expr;
    op: "==" | "!=" | ">" | "<" | ">=" | "<=";
    right: Expr;
}

export interface NotCond {
    kind: "not";
    condition: Condition;
}

export interface AndCond {
    kind: "and";
    left: Condition;
    right: Condition;
}

export interface OrCond {
    kind: "or";
    left: Condition;
    right: Condition;
}

export interface ImpliesCond {
    kind: "implies";
    left: Condition;
    right: Condition;
}

export interface ParenCond {
    kind: "paren";
    inner: Condition;
}

export type Predicate =
    | Quantifier
    | FormulaRef
    | FalseCond
    | TrueCond
    | ComparisonCond
    | NotPred
    | AndPred
    | OrPred
    | ParenPred;

export interface Quantifier {
    kind: "quantifier";
    quant: "forall" | "exists";
    varName: string;
    varType: "int" | "int[]";
    body: Predicate;
}

export interface FormulaRef {
    kind: "formula";
    name: string;
    parameters: ParameterDef[];
}

export interface NotPred {
    kind: "not";
    predicate: Predicate;
}

export interface AndPred {
    kind: "and";
    left: Predicate;
    right: Predicate;
}

export interface OrPred {
    kind: "or";
    left: Predicate;
    right: Predicate;
}

export interface ParenPred {
    kind: "paren";
    inner: Predicate;
}
