import { Arith, Bool, Context, init } from "z3-solver";

import { printFuncCall } from "./printFuncCall";
import { AnnotatedModule, AnnotatedFunctionDef } from "../../lab10";
import { Expr, Condition, Predicate } from "../../lab08";

let z3anchor: any;
let z3: Context;

async function initZ3() {
    if (!z3) {
        z3anchor = await init();
        const Z3C = z3anchor.Context;
        z3 = Z3C("main");
    }
}

export function flushZ3() {
    z3anchor = undefined;
}

type VarEnv = Map<string, Arith>;
type ArrayEnv = Map<string, any>;

function encodeExpr(e: Expr, env: VarEnv, _arrEnv: ArrayEnv): Arith {
    switch (e.type) {
        case "num":
            return z3.Int.val(e.value);

        case "var": {
            const v = env.get(e.name);
            if (!v) {
                throw new Error(`Z3: unknown var ${e.name}`);
            }
            return v;
        }

        case "neg": {
            const v = encodeExpr(e.arg, env, _arrEnv);
            return v.neg();
        }

        case "bin": {
            const L = encodeExpr(e.left, env, _arrEnv);
            const R = encodeExpr(e.right, env, _arrEnv);
            switch (e.op) {
                case "+": return L.add(R);
                case "-": return L.sub(R);
                case "*": return L.mul(R);
                case "/": return L.div(R);
            }
        }

        case "funccall":
            throw new Error("Function calls in expressions are not supported in the verifier yet.");

        case "arraccess":
            throw new Error("Array access in expressions is not supported in the verifier yet.");
    }

}

function encodeCondition(
    c: Condition,
    env: VarEnv,
    arrEnv: ArrayEnv
): Bool {
    switch (c.kind) {
        case "true":
            return z3.Bool.val(true);

        case "false":
            return z3.Bool.val(false);

        case "comparison": {
            const L = encodeExpr(c.left, env, arrEnv);
            const R = encodeExpr(c.right, env, arrEnv);
            switch (c.op) {
                case "==": return L.eq(R);
                case "!=": return L.neq(R);
                case ">":  return L.gt(R);
                case "<":  return L.lt(R);
                case ">=": return L.ge(R);
                case "<=": return L.le(R);
            }
        }

        case "not":
            return encodeCondition(c.condition, env, arrEnv).not();

        case "and":
            return encodeCondition(c.left, env, arrEnv)
                .and(encodeCondition(c.right, env, arrEnv));

        case "or":
            return encodeCondition(c.left, env, arrEnv)
                .or(encodeCondition(c.right, env, arrEnv));

        case "implies":
            return encodeCondition(c.left, env, arrEnv)
                .implies(encodeCondition(c.right, env, arrEnv));

        case "paren":
            return encodeCondition(c.inner, env, arrEnv);
    }

}

function encodePredicate(
    p: Predicate,
    env: VarEnv,
    arrEnv: ArrayEnv,
    _formulaDefs: Map<string, Predicate>
): Bool {
    switch (p.kind) {
        case "true":
        case "false":
        case "comparison":
        case "not":
        case "and":
        case "or":
        case "paren":
            return encodeCondition(p as any, env, arrEnv);

        case "quantifier": {
            if (p.varType !== "int") {
                throw new Error("Quantifiers over arrays are not supported in the verifier yet.");
            }

            const v = z3.Int.const(p.varName);
            const extendedEnv = new Map(env);
            extendedEnv.set(p.varName, v);

            const body = encodePredicate(p.body, extendedEnv, arrEnv, _formulaDefs);

            return p.quant === "forall"
                ? z3.ForAll([v], body)
                : z3.Exists([v], body);
        }

        case "formula":
            throw new Error("FormulaRef in annotations is not supported in the verifier yet.");
    }

}

async function verifyFunction(f: AnnotatedFunctionDef) {
    const varEnv: VarEnv = new Map();
    const arrEnv: ArrayEnv = new Map();

    for (const p of f.parameters) {
        if (p.typeName === "int") {
            varEnv.set(p.name, z3.Int.const(p.name));
        } else {
            arrEnv.set(p.name, z3.Array.const(p.name, z3.Int.sort(), z3.Int.sort()));
        }
    }

    for (const r of f.returns) {
        if (r.typeName === "int") {
            varEnv.set(r.name, z3.Int.const(r.name));
        } else {
            arrEnv.set(r.name, z3.Array.const(r.name, z3.Int.sort(), z3.Int.sort()));
        }
    }

    for (const l of f.locals) {
        if (l.typeName === "int") {
            varEnv.set(l.name, z3.Int.const(l.name));
        } else {
            arrEnv.set(l.name, z3.Array.const(l.name, z3.Int.sort(), z3.Int.sort()));
        }
    }

    const pre = f.pre
        ? encodePredicate(f.pre, varEnv, arrEnv, new Map())
        : z3.Bool.val(true);

    const post = f.post
        ? encodePredicate(f.post, varEnv, arrEnv, new Map())
        : z3.Bool.val(true);

    const counterExample = pre.and(post.not());

    const solver = new z3.Solver();
    solver.add(counterExample);
    const res = await solver.check();

    if (res === "sat") {
        const model = await solver.model();
        const msg =
            `Function "${f.name}" does not satisfy its postcondition.\n` +
            printFuncCall(f, model);
        throw new Error(msg);
    }

    if (res === "unknown") {
        throw new Error(`Z3 returned unknown when verifying "${f.name}".`);
    }
}

export async function verifyModule(module: AnnotatedModule) {
    await initZ3();

    for (const f of module.functions) {
        await verifyFunction(f);
    }
}
