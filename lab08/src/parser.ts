import { getExprAst } from '../../lab04';
import * as ast from './funny';
import { ErrorCode, FunnyError } from './funny';

import grammar, { FunnyActionDict } from './funny.ohm-bundle';

import { MatchResult, Semantics } from 'ohm-js';

function collectList<T>(node: any): T[] {
    const it = node.asIteration();
    const result: T[] = [];
    for (const child of it.children) {
        result.push(child.parse());
    }
    return result;
}

type FunEnv = Record<string, ast.FunctionDef>;
type VarEnv = Set<string>;

type PosInfo = {
    startLine?: number;
    startCol?: number;
    endLine?: number;
    endCol?: number;
};

function fail(code: string, message: string, pos: PosInfo = {}): never {
    throw new FunnyError(
        message,
        code,
        pos.startLine,
        pos.startCol,
        pos.endCol,
        pos.endLine
    );
}

function checkModule(mod: ast.Module): void {
    const funEnv: FunEnv = Object.create(null);

    for (const fn of mod.functions) {
        if (funEnv[fn.name]) {
            fail("E_DUPLICATE_FUNCTION", `Duplicate function '${fn.name}'.`);
        }
        funEnv[fn.name] = fn;
    }

    for (const fn of mod.functions) {
        checkFunction(fn, funEnv);
    }
}

function checkFunction(fn: ast.FunctionDef, funEnv: FunEnv): void {
    const env: VarEnv = new Set<string>();

    const add = (name: string, what: string) => {
        if (env.has(name)) {
            fail("E_REDECLARATION", `Redeclaration of ${what} '${name}'.`);
        }
        env.add(name);
    };

    for (const p of fn.parameters) {
        add(p.name, "parameter");
    }

    for (const r of fn.returns) {
        add(r.name, "return value");
    }

    for (const l of fn.locals) {
        add(l.name, "local variable");
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
                fail(
                    "E_ASSIGN_ARITY",
                    `Assignment arity mismatch: ${needed} target(s) but ${produced} value(s) on right-hand side.`
                );
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
                fail(
                    "E_ASSIGN_UNDECLARED_VAR",
                    `Assignment to undeclared variable '${lv.name}'.`
                );
            }
            return;

        case "larr":
            if (!env.has(lv.name)) {
                fail(
                    "E_ASSIGN_UNDECLARED_ARRAY",
                    `Assignment to undeclared array '${lv.name}'.`
                );
            }
            checkExpr(lv.index, env, funEnv);
            return;
    }
}

function checkExpr(e: ast.Expr, env: VarEnv, funEnv: FunEnv): number {
    switch (e.type) {
        case "num":
            return 1;

        case "var":
            if (!env.has(e.name)) {
                fail(
                    "E_USE_UNDECLARED_VAR",
                    `Use of undeclared variable '${e.name}'.`
                );
            }
            return 1;

        case "neg":
            return checkExpr(e.arg, env, funEnv);

        case "bin": {
            const lCount = checkExpr(e.left, env, funEnv);
            const rCount = checkExpr(e.right, env, funEnv);
            if (lCount !== 1 || rCount !== 1) {
                fail(
                    "E_OPERATOR_MULTI_VALUE",
                    "Operators can only be applied to single-valued expressions."
                );
            }
            return 1;
        }

        case "funccall": {
            if (e.name === "length") {
                if (e.args.length !== 1) {
                    fail(
                        "E_ARGUMENT_COUNT",
                        `Argument count mismatch when calling 'length': got ${e.args.length}, expected 1.`
                    );
                }

                const argCount = checkExpr(e.args[0], env, funEnv);
                if (argCount !== 1) {
                    fail(
                        "E_ARGUMENT_MULTI_VALUE",
                        "Function arguments must be single-valued."
                    );
                }

                return 1;
            }

            const fn = funEnv[e.name];
            if (!fn) {
                fail(
                    "E_UNKNOWN_FUNCTION",
                    `Call to unknown function '${e.name}'.`
                );
            }

            if (e.args.length !== fn.parameters.length) {
                fail(
                    "E_ARGUMENT_COUNT",
                    `Argument count mismatch when calling '${e.name}': got ${e.args.length}, expected ${fn.parameters.length}.`
                );
            }

            const argCounts = e.args.map((a) => checkExpr(a, env, funEnv));
            for (const c of argCounts) {
                if (c !== 1) {
                    fail(
                        "E_ARGUMENT_MULTI_VALUE",
                        "Function arguments must be single-valued."
                    );
                }
            }

            return fn.returns.length;
        }

        case "arraccess":
            if (!env.has(e.name)) {
                fail(
                    "E_ACCESS_UNDECLARED_ARRAY",
                    `Access to undeclared array '${e.name}'.`
                );
            }
            const idxCount = checkExpr(e.index, env, funEnv);
            if (idxCount !== 1) {
                fail(
                    "E_ARRAY_INDEX_MULTI_VALUE",
                    "Array index expression must produce exactly one value."
                );
            }
            return 1;
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
            if (lCount !== 1 || rCount !== 1) {
                fail(
                    "E_COMPARISON_MULTI_VALUE",
                    "Comparison operands must be single-valued."
                );
            }
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

export const getFunnyAst = {
    ...(getExprAst as any),

    Module(funcs) {
        const functions = funcs.children.map((f: any) => f.parse() as ast.FunctionDef);
        const mod: ast.Module = {
            type: "module",
            functions,
        };
        return mod;
    },

    Function(name, _lp, params, _rp, _preOpt, retSpec, _postOpt, usesOpt, stmt) {
        let parameters: ast.ParameterDef[] = [];
        parameters = params.parse() as ast.ParameterDef[];

        const returns = retSpec.parse() as ast.ParameterDef[];

        let locals: ast.ParameterDef[] = [];
        if (usesOpt.children.length > 0) {
            locals = usesOpt.child(0).parse() as ast.ParameterDef[];
        }

        const fun: ast.FunctionDef = {
            type: "fun",
            name: name.sourceString,
            parameters,
            returns,
            locals,
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
        const node: ast.BlockStmt = {
            type: "block",
            stmts: stmts.children.map((s: any) => s.parse() as ast.Statement),
        };
        return node;
    },

    Stmt_expr(e, _semi) {
        return {
            type: "expr",
            expr: e.parse() as ast.Expr,
        } as ast.ExprStmt;
    },

    While(_while, _lp, cond, _rp, invOpt, body) {
        let invariant: ast.Predicate | null = null;
        if (invOpt.children.length > 0) {
            invariant = invOpt.child(0).parse() as ast.Predicate;
        }
        const node: ast.WhileStmt = {
            type: "while",
            condition: cond.parse() as ast.Condition,
            invariant,
            body: body.parse() as ast.Statement,
        };
        return node;
    },

    InvariantSpec(_inv, pred) {
        return pred.parse() as ast.Predicate;
    },

    If(_if, _lp, cond, _rp, thenStmt, elseKwOpt, elseStmtOpt) {
        let elseBranch: ast.Statement | null = null;
        if (elseStmtOpt.children.length > 0) {
            elseBranch = elseStmtOpt.child(0).parse() as ast.Statement;
        }
        const node: ast.IfStmt = {
            type: "if",
            condition: cond.parse() as ast.Condition,
            then: thenStmt.parse() as ast.Statement,
            else: elseBranch,
        };
        return node;
    },

    Assign_tuple(lvalues, _eq, exprs, _semi) {
        const node: ast.AssignStmt = {
            type: "assign",
            targets: lvalues.parse() as ast.LValue[],
            exprs: exprs.parse() as ast.Expr[],
        };
        return node;
    },

    Assign_simple(lvalue, _eq, expr, _semi) {
        const node: ast.AssignStmt = {
            type: "assign",
            targets: [lvalue.parse() as ast.LValue],
            exprs: [expr.parse() as ast.Expr],
        };
        return node;
    },

    LValueList(list) {
        return collectList<ast.LValue>(list);
    },

    ExprList(list) {
        return collectList<ast.Expr>(list);
    },

    LValue_array(arr) {
        const nameNode = arr.child(0);
        const indexNode = arr.child(2);
        const node: ast.ArrLValue = {
            type: "larr",
            name: nameNode.sourceString,
            index: indexNode.parse() as ast.Expr,
        };
        return node;
    },

    LValue_var(name) {
        const node: ast.VarLValue = {
            type: "lvar",
            name: name.sourceString,
        };
        return node;
    },

    FunctionCall(name, _lp, argsOpt, _rp) {
        let args: ast.Expr[] = [];
        if (argsOpt.children.length > 0) {
            args = argsOpt.parse() as ast.Expr[];
        }
        const node: ast.FuncCallExpr = {
            type: "funccall",
            name: name.sourceString,
            args,
        };
        return node;
    },

    ArrayAccess(name, _lb, index, _rb) {
        return {
            type: "arraccess",
            name: name.sourceString,
            index: index.parse() as ast.Expr,
        } as ast.ArrAccessExpr;
    },

    ImplyCond_imply(orCond, _arrow, rest) {
        const left = orCond.parse() as ast.Condition;
        const right = rest.parse() as ast.Condition;
        const node: ast.ImpliesCond = {
            kind: "implies",
            left,
            right,
        };
        return node;
    },

    OrCond(first, _ops, rest) {
        let node = first.parse() as ast.Condition;
        for (const r of rest.children) {
            const rhs = r.parse() as ast.Condition;
            node = {
                kind: "or",
                left: node,
                right: rhs,
            } as ast.OrCond;
        }
        return node;
    },

    AndCond(first, _ops, rest) {
        let node = first.parse() as ast.Condition;
        for (const r of rest.children) {
            const rhs = r.parse() as ast.Condition;
            node = {
                kind: "and",
                left: node,
                right: rhs,
            } as ast.AndCond;
        }
        return node;
    },

    NotCond(nots, atom) {
        let node = atom.parse() as ast.Condition;
        for (let i = 0; i < nots.children.length; i++) {
            node = {
                kind: "not",
                condition: node,
            } as ast.NotCond;
        }
        return node;
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
        return {
            kind: "comparison",
            left: left.parse() as ast.Expr,
            op: "==" as const,
            right: right.parse() as ast.Expr,
        } as ast.ComparisonCond;
    },

    Comparison_neq(left, _op, right) {
        return {
            kind: "comparison",
            left: left.parse() as ast.Expr,
            op: "!=" as const,
            right: right.parse() as ast.Expr,
        } as ast.ComparisonCond;
    },

    Comparison_ge(left, _op, right) {
        return {
            kind: "comparison",
            left: left.parse() as ast.Expr,
            op: ">=" as const,
            right: right.parse() as ast.Expr,
        } as ast.ComparisonCond;
    },

    Comparison_le(left, _op, right) {
        return {
            kind: "comparison",
            left: left.parse() as ast.Expr,
            op: "<=" as const,
            right: right.parse() as ast.Expr,
        } as ast.ComparisonCond;
    },

    Comparison_gt(left, _op, right) {
        return {
            kind: "comparison",
            left: left.parse() as ast.Expr,
            op: ">" as const,
            right: right.parse() as ast.Expr,
        } as ast.ComparisonCond;
    },

    Comparison_lt(left, _op, right) {
        return {
            kind: "comparison",
            left: left.parse() as ast.Expr,
            op: "<" as const,
            right: right.parse() as ast.Expr,
        } as ast.ComparisonCond;
    },

    ImplyPred_imply(orPred, _arrow, rest) {
        const left = orPred.parse() as ast.Predicate;
        const right = rest.parse() as ast.Predicate;

        const notLeft: ast.NotPred = {
            kind: "not",
            predicate: left,
        };
        const node: ast.OrPred = {
            kind: "or",
            left: notLeft,
            right,
        };
        return node;
    },

    OrPred(first, _ops, rest) {
        let node = first.parse() as ast.Predicate;
        for (const r of rest.children) {
            const rhs = r.parse() as ast.Predicate;
            node = {
                kind: "or",
                left: node,
                right: rhs,
            } as ast.OrPred;
        }
        return node;
    },

    AndPred(first, _ops, rest) {
        let node = first.parse() as ast.Predicate;
        for (const r of rest.children) {
            const rhs = r.parse() as ast.Predicate;
            node = {
                kind: "and",
                left: node,
                right: rhs,
            } as ast.AndPred;
        }
        return node;
    },

    NotPred(nots, atom) {
        let node = atom.parse() as ast.Predicate;
        for (let i = 0; i < nots.children.length; i++) {
            node = {
                kind: "not",
                predicate: node,
            } as ast.NotPred;
        }
        return node;
    },

    AtomPred_true(_t) {
        return { kind: "true" } as ast.TrueCond;
    },

    AtomPred_false(_f) {
        return { kind: "false" } as ast.FalseCond;
    },

    AtomPred_paren(_lp, pred, _rp) {
        const node: ast.ParenPred = {
            kind: "paren",
            inner: pred.parse() as ast.Predicate,
        };
        return node;
    },

    Quantifier(qTok, _lp, paramNode, _bar, body, _rp) {
        const quant = qTok.sourceString as "forall" | "exists";
        const identNode = paramNode.child(0);
        const typeNode = paramNode.child(2);
        const varName = identNode.sourceString;
        const varType = typeNode.parse() as "int" | "int[]";
        const node: ast.Quantifier = {
            kind: "quantifier",
            quant,
            varName,
            varType,
            body: body.parse() as ast.Predicate,
        };
        return node;
    },

    FormulaRef(name, _lp, paramsOpt, _rp) {
        let parameters: ast.ParameterDef[] = [];
        if (paramsOpt.children.length > 0) {
            parameters = paramsOpt.parse() as ast.ParameterDef[];
        }
        const node: ast.FormulaRef = {
            kind: "formula",
            name: name.sourceString,
            parameters,
        };
        return node;
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
        fail("E_PARSE_ERROR", message, { startLine, startCol });
    }

    const mod = (semantics as FunnySemanticsExt)(match).parse();
    checkModule(mod);
    return mod;
}
