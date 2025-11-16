import { getExprAst } from '../../lab04';
import * as ast from './funny';
import { ErrorCode, FunnyError } from './funny';

import grammar, { FunnyActionDict } from './funny.ohm-bundle';

import { MatchResult, Semantics } from 'ohm-js';

function collectList<T>(node: any): T[] {
    return node.asIteration().children.map((c: any) => c.parse() as T);
}

type FunEnv = Record<string, ast.FunctionDef>;
type VarEnv = Set<string>;

type PosInfo = {
    startLine?: number;
    startCol?: number;
    endLine?: number;
    endCol?: number;
};

function fail(code: ErrorCode, message: string, pos: PosInfo = {}): never {
    const { startLine, startCol, endLine, endCol } = pos;
    throw new FunnyError(message, code, startLine, startCol, endCol, endLine);
}

function declareVar(env: VarEnv, name: string, what: string): void {
    if (env.has(name)) {
        fail(
            ErrorCode.Redeclaration,
            `Redeclaration of ${what} "${name}".`
        );
    }
    env.add(name);
}

function ensureBothSingle(
    leftCount: number,
    rightCount: number,
    code: ErrorCode,
    message: string
): void {
    if (leftCount !== 1 || rightCount !== 1) {
        fail(code, message);
    }
}

function ensureSingleValue(
    count: number,
    code: ErrorCode,
    message: string
): void {
    if (count !== 1) {
        fail(code, message);
    }
}

function ensureArgCount(
    name: string,
    expected: number,
    actual: number
): void {
    if (actual !== expected) {
        fail(
            ErrorCode.ArgumentCount,
            `Argument count mismatch when calling "${name}": got ${actual}, expected ${expected}.`
        );
    }
}

function parseOptionalNode<T>(node: any): T | null {
    return node.children.length > 0
        ? (node.child(0).parse() as T)
        : null;
}

function parseOptionalList<T>(node: any): T[] {
    return node.children.length > 0
        ? (node.child(0).parse() as T[])
        : [];
}

function checkModule(mod: ast.Module): void {
    const funEnv: FunEnv = Object.create(null);

    for (const fn of mod.functions) {
        if (funEnv[fn.name]) {
            fail(ErrorCode.DuplicateFunction, `Duplicate function "${fn.name}".`);
        }
        funEnv[fn.name] = fn;
    }

    for (const fn of mod.functions) {
        checkFunction(fn, funEnv);
    }
}

function checkFunction(fn: ast.FunctionDef, funEnv: FunEnv): void {
    const env: VarEnv = new Set<string>();

    for (const p of fn.parameters) {
        declareVar(env, p.name, "parameter");
    }

    for (const r of fn.returns) {
        declareVar(env, r.name, "return value");
    }

    for (const l of fn.locals) {
        declareVar(env, l.name, "local variable");
    }

    checkStmt(fn.body, env, funEnv);
}

function checkStmt(stmt: ast.Statement, env: VarEnv, funEnv: FunEnv): void {
    switch (stmt.type) {
        case "assign": {
            for (const lv of stmt.targets) {
                checkLValue(lv, env, funEnv);
            }

            let produced = 0;
            for (const ex of stmt.exprs) {
                produced += checkExpr(ex, env, funEnv);
            }
            const needed = stmt.targets.length;
            if (produced !== needed) {
                fail(ErrorCode.AssignArity, `Assignment arity mismatch: ${needed} target(s) but ${produced} value(s) on right-hand side.`);
            }
            return;
        }

        case "block":
            for (const s of stmt.stmts) {
                checkStmt(s, env, funEnv);
            }
            return;

        case "if":
            checkCondition(stmt.condition, env, funEnv);
            checkStmt(stmt.then, env, funEnv);
            if (stmt.else) {
                checkStmt(stmt.else, env, funEnv);
            }
            return;

        case "while":
            checkCondition(stmt.condition, env, funEnv);
            checkStmt(stmt.body, env, funEnv);
            return;

        case "expr":
            checkExpr(stmt.expr, env, funEnv);
            return;
    }
}

function checkLValue(lv: ast.LValue, env: VarEnv, funEnv: FunEnv): void {
    switch (lv.type) {
        case "lvar":
            if (!env.has(lv.name)) {
                fail(ErrorCode.AssignUndeclaredVar, `Assignment to undeclared variable "${lv.name}".`);
            }
            return;

        case "larr":
            if (!env.has(lv.name)) {
                fail(ErrorCode.AssignUndeclaredArray, `Assignment to undeclared array "${lv.name}".`);
            }
            checkExpr(lv.index, env, funEnv);
            return;
    }
}

function checkFuncCall(
    call: ast.FuncCallExpr,
    env: VarEnv,
    funEnv: FunEnv
): number {
    const { name, args } = call;

    if (name === "length") {
        ensureArgCount("length", 1, args.length);

        const argCount = checkExpr(args[0], env, funEnv);
        ensureSingleValue(
            argCount,
            ErrorCode.ArgumentMultiValue,
            "Function arguments must be single-valued."
        );

        return 1;
    }

    const fn = funEnv[name];
    if (!fn) {
        fail(
            ErrorCode.UnknownFunction,
            `Call to unknown function "${name}".`
        );
    }

    ensureArgCount(name, fn.parameters.length, args.length);

    for (const a of args) {
        const c = checkExpr(a, env, funEnv);
        ensureSingleValue(
            c,
            ErrorCode.ArgumentMultiValue,
            "Function arguments must be single-valued."
        );
    }

    return fn.returns.length;
}

function checkExpr(e: ast.Expr, env: VarEnv, funEnv: FunEnv): number {
    switch (e.type) {
        case "num":
            return 1;

        case "var":
            if (!env.has(e.name)) {
                fail(
                    ErrorCode.UseUndeclaredVar,
                    `Use of undeclared variable "${e.name}".`
                );
            }
            return 1;

        case "neg":
            return checkExpr(e.arg, env, funEnv);

        case "bin": {
            const lCount = checkExpr(e.left, env, funEnv);
            const rCount = checkExpr(e.right, env, funEnv);
            ensureBothSingle(
                lCount,
                rCount,
                ErrorCode.OperatorMultiValue,
                "Operators can only be applied to single-valued expressions."
            );
            return 1;
        }

        case "funccall":
            return checkFuncCall(e, env, funEnv);

        case "arraccess": {
            if (!env.has(e.name)) {
                fail(
                    ErrorCode.AccessUndeclaredArray,
                    `Access to undeclared array "${e.name}".`
                );
            }
            const idxCount = checkExpr(e.index, env, funEnv);
            ensureSingleValue(
                idxCount,
                ErrorCode.ArrayIndexMultiValue,
                "Array index expression must produce exactly one value."
            );
            return 1;
        }
    }
}

function checkCondition(
    cond: ast.Condition,
    env: VarEnv,
    funEnv: FunEnv
): void {
    switch (cond.kind) {
        case "true":
        case "false":
            return;

        case "comparison": {
            const lCount = checkExpr(cond.left, env, funEnv);
            const rCount = checkExpr(cond.right, env, funEnv);
            ensureBothSingle(
                lCount,
                rCount,
                ErrorCode.ComparisonMultiValue,
                "Comparison operands must be single-valued."
            );
            return;
        }

        case "not":
            checkCondition(cond.condition, env, funEnv);
            return;

        case "and":
        case "or":
        case "implies":
            checkCondition(cond.left, env, funEnv);
            checkCondition(cond.right, env, funEnv);
            return;

        case "paren":
            checkCondition(cond.inner, env, funEnv);
            return;
    }
}

function foldLogicalChain<T>(
    first: any,
    rest: any,
    makeNode: (left: T, right: T) => T
): T {
    let node = first.parse() as T;
    for (const r of rest.children) {
        const rhs = r.parse() as T;
        node = makeNode(node, rhs);
    }
    return node;
}

function repeatPrefix<T>(
    nots: any,
    base: any,
    makeNode: (inner: T) => T
): T {
    let node = base.parse() as T;
    for (let i = 0; i < nots.children.length; i++) {
        node = makeNode(node);
    }
    return node;
}

function makeComparisonNode(
    leftNode: any,
    rightNode: any,
    op: ast.ComparisonCond["op"]
): ast.ComparisonCond {
    return {
        kind: "comparison",
        left: leftNode.parse() as ast.Expr,
        op,
        right: rightNode.parse() as ast.Expr,
    };
}

export const getFunnyAst = {
    ...(getExprAst as any),

    Module(funcs) {
        const functions = funcs.children.map(
            (f: any) => f.parse() as ast.FunctionDef
        );
        const mod: ast.Module = {
            type: "module",
            functions,
        };
        return mod;
    },

    Function(name, _lp, params, _rp, _preOpt, retSpec, _postOpt, usesOpt, stmt) {
        const fun: ast.FunctionDef = {
            type: "fun",
            name: name.sourceString,
            parameters: params.parse() as ast.ParameterDef[],
            returns: retSpec.parse() as ast.ParameterDef[],
            locals: parseOptionalList<ast.ParameterDef>(usesOpt),
            body: stmt.parse() as ast.Statement,
        };
        return fun;
    },

    UsesSpec(_uses, params) {
        return params.parse() as ast.ParameterDef[];
    },

    RetSpec_list(_returns, params) {
        return params.parse() as ast.ParameterDef[];
    },

    RetSpec_void(_returns, _void) {
        return [] as ast.ParameterDef[];
    },

    ParamList(list) {
        return collectList<ast.ParameterDef>(list);
    },

    ParamListNonEmpty(list) {
        return collectList<ast.ParameterDef>(list);
    },

    Param(name, _colon, _type) {
        const p: ast.ParameterDef = {
            type: "param",
            name: name.sourceString,
        };
        return p;
    },

    Type_array(_int, _brackets) {
        return "int[]" as const;
    },

    Type_int(_int) {
        return "int" as const;
    },

    ArgList(list) {
        return collectList<ast.Expr>(list);
    },

    Block(_lb, stmts, _rb) {
        return {
            type: "block",
            stmts: stmts.children.map((s: any) => s.parse() as ast.Statement),
        } as ast.BlockStmt;
    },

    Stmt_expr(e, _semi) {
        return {
            type: "expr",
            expr: e.parse() as ast.Expr,
        } as ast.ExprStmt;
    },

    While(_while, _lp, cond, _rp, invOpt, body) {
        return {
            type: "while",
            condition: cond.parse() as ast.Condition,
            invariant: parseOptionalNode<ast.Predicate>(invOpt),
            body: body.parse() as ast.Statement,
        } as ast.WhileStmt;
    },

    InvariantSpec(_inv, pred) {
        return pred.parse() as ast.Predicate;
    },

    If(_if, _lp, cond, _rp, thenStmt, _elseKwOpt, elseStmtOpt) {
        return {
            type: "if",
            condition: cond.parse() as ast.Condition,
            then: thenStmt.parse() as ast.Statement,
            else: parseOptionalNode<ast.Statement>(elseStmtOpt),
        } as ast.IfStmt;
    },

    Assign_tuple(lvalues, _eq, exprs, _semi) {
        return {
            type: "assign",
            targets: lvalues.parse() as ast.LValue[],
            exprs: exprs.parse() as ast.Expr[],
        } as ast.AssignStmt;
    },

    Assign_simple(lvalue, _eq, expr, _semi) {
        return {
            type: "assign",
            targets: [lvalue.parse() as ast.LValue],
            exprs: [expr.parse() as ast.Expr],
        } as ast.AssignStmt;
    },

    LValueList(list) {
        return collectList<ast.LValue>(list);
    },

    ExprList(list) {
        return collectList<ast.Expr>(list);
    },

    LValue_array(arr) {
        const access = arr.parse() as ast.ArrAccessExpr;
        return {
            type: "larr",
            name: access.name,
            index: access.index,
        } as ast.ArrLValue;
    },

    LValue_var(name) {
        return {
            type: "lvar",
            name: name.sourceString,
        } as ast.VarLValue;
    },

    FunctionCall(name, _lp, argsNode, _rp) {
        return {
            type: "funccall",
            name: name.sourceString,
            args: argsNode.parse() as ast.Expr[],
        } as ast.FuncCallExpr;
    },

    ArrayAccess(name, _lb, index, _rb) {
        return {
            type: "arraccess",
            name: name.sourceString,
            index: index.parse() as ast.Expr,
        } as ast.ArrAccessExpr;
    },

    ImplyCond_imply(orCond, _arrow, rest) {
        return {
            kind: "implies",
            left: orCond.parse() as ast.Condition,
            right: rest.parse() as ast.Condition,
        } as ast.ImpliesCond;
    },

    OrCond(first, _ops, rest) {
        return foldLogicalChain<ast.Condition>(first, rest, (left, right) => ({
            kind: "or",
            left,
            right,
        } as ast.OrCond));
    },

    AndCond(first, _ops, rest) {
        return foldLogicalChain<ast.Condition>(first, rest, (left, right) => ({
            kind: "and",
            left,
            right,
        } as ast.AndCond));
    },

    NotCond(nots, atom) {
        return repeatPrefix<ast.Condition>(nots, atom, (condition) => ({
            kind: "not",
            condition,
        } as ast.NotCond));
    },

    AtomCond_true(_t) {
        return { kind: "true" } as ast.TrueCond;
    },

    AtomCond_false(_f) {
        return { kind: "false" } as ast.FalseCond;
    },

    AtomCond_paren(_lp, cond, _rp) {
        return {
            kind: "paren",
            inner: cond.parse() as ast.Condition,
        } as ast.ParenCond;
    },

    Comparison_eq(left, _op, right) {
        return makeComparisonNode(left, right, "==");
    },

    Comparison_neq(left, _op, right) {
        return makeComparisonNode(left, right, "!=");
    },

    Comparison_ge(left, _op, right) {
        return makeComparisonNode(left, right, ">=");
    },

    Comparison_le(left, _op, right) {
        return makeComparisonNode(left, right, "<=");
    },

    Comparison_gt(left, _op, right) {
        return makeComparisonNode(left, right, ">");
    },

    Comparison_lt(left, _op, right) {
        return makeComparisonNode(left, right, "<");
    },

    ImplyPred_imply(orPred, _arrow, rest) {
        const left = orPred.parse() as ast.Predicate;
        const right = rest.parse() as ast.Predicate;

        const notLeft: ast.NotPred = {
            kind: "not",
            predicate: left,
        };
        return {
            kind: "or",
            left: notLeft,
            right,
        } as ast.OrPred;
    },

    OrPred(first, _ops, rest) {
        return foldLogicalChain<ast.Predicate>(first, rest, (left, right) => ({
            kind: "or",
            left,
            right,
        } as ast.OrPred));
    },

    AndPred(first, _ops, rest) {
        return foldLogicalChain<ast.Predicate>(first, rest, (left, right) => ({
            kind: "and",
            left,
            right,
        } as ast.AndPred));
    },

    NotPred(nots, atom) {
        return repeatPrefix<ast.Predicate>(nots, atom, (predicate) => ({
            kind: "not",
            predicate,
        } as ast.NotPred));
    },

    AtomPred_true(_t) {
        return { kind: "true" } as ast.TrueCond;
    },

    AtomPred_false(_f) {
        return { kind: "false" } as ast.FalseCond;
    },

    AtomPred_paren(_lp, pred, _rp) {
        return {
            kind: "paren",
            inner: pred.parse() as ast.Predicate,
        } as ast.ParenPred;
    },

    Quantifier(qTok, _lp, paramNode, _bar, body, _rp) {
        const quant = qTok.sourceString as "forall" | "exists";
        const identNode = paramNode.child(0);
        const typeNode = paramNode.child(2);
        const varName = identNode.sourceString;
        const varType = typeNode.parse() as "int" | "int[]";
        return {
            kind: "quantifier",
            quant,
            varName,
            varType,
            body: body.parse() as ast.Predicate,
        } as ast.Quantifier;
    },

    FormulaRef(name, _lp, params, _rp) {
        return {
            kind: "formula",
            name: name.sourceString,
            parameters: params.parse() as ast.ParameterDef[],
        } as ast.FormulaRef;
    },
} satisfies FunnyActionDict<any>;

export const semantics: FunnySemanticsExt = grammar.Funny.createSemantics() as FunnySemanticsExt;
semantics.addOperation("parse()", getFunnyAst);

export interface FunnySemanticsExt extends Semantics {
    (match: MatchResult): FunnyActionsExt;
}
interface FunnyActionsExt {
    parse(): ast.Module;
}

export function parseFunny(source: string): ast.Module {
    const match: MatchResult = grammar.Funny.match(source, "Module");
    if (match.failed()) {
        const m: any = match;
        let startLine: number | undefined;
        let startCol: number | undefined;

        if (typeof m.getRightmostFailurePosition === "function") {
            const pos = m.getRightmostFailurePosition();
            if (pos) {
                startLine = pos.lineNum;
                startCol = pos.colNum;
            }
        }

        const message: string = m.message ?? "Syntax error in Funny module.";
        fail(ErrorCode.ParseError, message, { startLine, startCol });
    }

    const mod = (semantics as FunnySemanticsExt)(match).parse();
    checkModule(mod);
    return mod;
}
