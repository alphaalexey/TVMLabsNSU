import { Arith, Bool, Context, Model, init } from "z3-solver";

import { printFuncCall } from "./printFuncCall";
import {
    AnnotatedModule,
    AnnotatedFunctionDef,
} from "../../lab10";
import {
    Expr,
    Condition,
    Predicate,
    Statement,
    ParameterDef,
    fail,
    ErrorCode,
} from "../../lab08";

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

type IntExpr = Arith;
type BoolExpr = Bool;

type DefinitionalSpec = {
    params: string[];
    resultExpr: Expr;
};

const TRUE_PRED: Predicate = { kind: "true" };
const FALSE_PRED: Predicate = { kind: "false" };

class FunctionVerifier {
    private readonly ctx: Context;
    private readonly module: AnnotatedModule;
    private readonly defSpecs: Map<string, DefinitionalSpec>;

    constructor(ctx: Context, module: AnnotatedModule) {
        this.ctx = ctx;
        this.module = module;
        this.defSpecs = this.buildDefSpecs();
    }

    async verify(): Promise<void> {
        for (const f of this.module.functions) {
            await this.verifyFunction(f);
        }
    }

    private buildDefSpecs(): Map<string, DefinitionalSpec> {
        const specs = new Map<string, DefinitionalSpec>();
        for (const f of this.module.functions) {
            if (f.returns.length !== 1) continue;
            if (!f.post) continue;
            const post = f.post;
            const ret = f.returns[0];
            const def = this.extractDefinitionalSpec(ret, post, f.parameters);
            if (def) specs.set(f.name, def);
        }
        return specs;
    }

    private extractDefinitionalSpec(
        ret: ParameterDef,
        post: Predicate,
        params: ParameterDef[]
    ): DefinitionalSpec | undefined {
        const core = this.stripParens(post);
        if (core.kind !== "comparison") return undefined;
        if (core.op !== "==") return undefined;
        const left = core.left;
        const right = core.right;
        if (left.type === "var" && left.name === ret.name) {
            return {
                params: params.map(p => p.name),
                resultExpr: right,
            };
        }
        if (right.type === "var" && right.name === ret.name) {
            return {
                params: params.map(p => p.name),
                resultExpr: left,
            };
        }
        return undefined;
    }

    private stripParens(p: Predicate): Predicate {
        let cur = p;
        while (cur.kind === "paren") {
            cur = cur.inner;
        }
        return cur;
    }

    private async verifyFunction(f: AnnotatedFunctionDef): Promise<void> {
        const post = f.post ?? TRUE_PRED;
        const pre = f.pre ?? TRUE_PRED;

        const wpResult = this.wpStatement(f, f.body, post);
        const mainVC = this.makeImplies(pre, wpResult.pre);
        const vcs: Predicate[] = [mainVC, ...wpResult.vcs];

        for (const vc of vcs) {
            const inlined = this.inlinePredicate(vc);
            await this.prove(inlined, f);
        }
    }

    private wpStatement(
        f: AnnotatedFunctionDef,
        stmt: Statement,
        post: Predicate
    ): { pre: Predicate; vcs: Predicate[] } {
        switch (stmt.type) {
            case "expr":
                return { pre: post, vcs: [] };

            case "assign": {
                const subs = new Map<string, Expr>();
                for (let i = 0; i < stmt.targets.length; i++) {
                    const target = stmt.targets[i];
                    const expr = stmt.exprs[i];
                    if (target.type === "lvar") {
                        subs.set(target.name, expr);
                    }
                }
                const pre = this.substPredicate(post, subs);
                return { pre, vcs: [] };
            }

            case "block": {
                let current = post;
                const allVcs: Predicate[] = [];
                for (let i = stmt.stmts.length - 1; i >= 0; i--) {
                    const r = this.wpStatement(f, stmt.stmts[i], current);
                    current = r.pre;
                    allVcs.push(...r.vcs);
                }
                return { pre: current, vcs: allVcs };
            }

            case "if": {
                const condPred = this.conditionToPredicate(stmt.condition);
                const thenRes = this.wpStatement(f, stmt.then, post);
                const elseRes = stmt.else
                    ? this.wpStatement(f, stmt.else, post)
                    : { pre: post, vcs: [] };

                const preThen = thenRes.pre;
                const preElse = elseRes.pre;

                const pre = this.makeAnd(
                    this.makeImplies(condPred, preThen),
                    this.makeImplies(this.makeNot(condPred), preElse)
                );

                const vcs = [...thenRes.vcs, ...elseRes.vcs];
                return { pre, vcs };
            }

            case "while": {
                const inv = stmt.invariant ?? TRUE_PRED;
                const condPred = this.conditionToPredicate(stmt.condition);

                const bodyRes = this.wpStatement(f, stmt.body, inv);
                const preBody = bodyRes.pre;

                const vcPreserve = this.makeImplies(
                    this.makeAnd(inv, condPred),
                    preBody
                );
                const vcExit = this.makeImplies(
                    this.makeAnd(inv, this.makeNot(condPred)),
                    post
                );

                const pre = inv;
                const vcs = [vcPreserve, vcExit, ...bodyRes.vcs];
                return { pre, vcs };
            }
        }
    }

    private conditionToPredicate(cond: Condition): Predicate {
        switch (cond.kind) {
            case "true":
            case "false":
            case "comparison":
                return cond as Predicate;

            case "not": {
                const inner = this.conditionToPredicate(cond.condition);
                return this.makeNot(inner);
            }

            case "and": {
                const l = this.conditionToPredicate(cond.left);
                const r = this.conditionToPredicate(cond.right);
                return this.makeAnd(l, r);
            }

            case "or": {
                const l = this.conditionToPredicate(cond.left);
                const r = this.conditionToPredicate(cond.right);
                return this.makeOr(l, r);
            }

            case "implies": {
                const l = this.conditionToPredicate(cond.left);
                const r = this.conditionToPredicate(cond.right);
                return this.makeImplies(l, r);
            }

            case "paren": {
                const inner = this.conditionToPredicate(cond.inner);
                return { kind: "paren", inner };
            }
        }
    }

    private makeAnd(a: Predicate, b: Predicate): Predicate {
        if (a.kind === "true") return b;
        if (b.kind === "true") return a;
        if (a.kind === "false" || b.kind === "false") return FALSE_PRED;
        return { kind: "and", left: a, right: b };
    }

    private makeOr(a: Predicate, b: Predicate): Predicate {
        if (a.kind === "false") return b;
        if (b.kind === "false") return a;
        if (a.kind === "true" || b.kind === "true") return TRUE_PRED;
        return { kind: "or", left: a, right: b };
    }

    private makeNot(a: Predicate): Predicate {
        if (a.kind === "true") return FALSE_PRED;
        if (a.kind === "false") return TRUE_PRED;
        return { kind: "not", predicate: a };
    }

    private makeImplies(a: Predicate, b: Predicate): Predicate {
        return this.makeOr(this.makeNot(a), b);
    }

    private substExpr(expr: Expr, subs: Map<string, Expr>): Expr {
        switch (expr.type) {
            case "num":
                return expr;
            case "var": {
                const r = subs.get(expr.name);
                return r ?? expr;
            }
            case "neg":
                return { type: "neg", arg: this.substExpr(expr.arg, subs) } as Expr;
            case "bin":
                return {
                    type: "bin",
                    op: expr.op,
                    left: this.substExpr(expr.left, subs),
                    right: this.substExpr(expr.right, subs),
                } as Expr;
            case "funccall":
                return {
                    type: "funccall",
                    name: expr.name,
                    args: expr.args.map(e => this.substExpr(e, subs)),
                };
            case "arraccess":
                return {
                    type: "arraccess",
                    name: expr.name,
                    index: this.substExpr(expr.index, subs),
                };
        }
    }

    private substPredicate(pred: Predicate, subs: Map<string, Expr>): Predicate {
        switch (pred.kind) {
            case "true":
            case "false":
                return pred;
            case "comparison":
                return {
                    kind: "comparison",
                    op: pred.op,
                    left: this.substExpr(pred.left, subs),
                    right: this.substExpr(pred.right, subs),
                };
            case "not":
                return {
                    kind: "not",
                    predicate: this.substPredicate(
                        pred.predicate,
                        subs
                    ),
                };
            case "and":
            case "or":
                return {
                    kind: pred.kind,
                    left: this.substPredicate(pred.left, subs),
                    right: this.substPredicate(pred.right, subs),
                };
            case "paren":
                return this.substPredicate(
                    pred.inner,
                    subs
                );
            case "quantifier":
            case "formula":
                return pred;
        }
    }

    private inlineExpr(expr: Expr): Expr {
        switch (expr.type) {
            case "num":
            case "var":
                return expr;
            case "neg":
                return { type: "neg", arg: this.inlineExpr(expr.arg) } as any;
            case "bin":
                return {
                    type: "bin",
                    op: expr.op,
                    left: this.inlineExpr(expr.left),
                    right: this.inlineExpr(expr.right),
                } as any;
            case "arraccess":
                return {
                    type: "arraccess",
                    name: expr.name,
                    index: this.inlineExpr(expr.index),
                };
            case "funccall": {
                const spec = this.defSpecs.get(expr.name);
                const inlinedArgs = expr.args.map(a => this.inlineExpr(a));
                if (!spec) {
                    return {
                        type: "funccall",
                        name: expr.name,
                        args: inlinedArgs,
                    };
                }
                const subs = new Map<string, Expr>();
                for (let i = 0; i < spec.params.length; i++) {
                    subs.set(spec.params[i], inlinedArgs[i]);
                }
                return this.substExpr(spec.resultExpr, subs);
            }
        }
    }

    private inlinePredicate(pred: Predicate): Predicate {
        switch (pred.kind) {
            case "true":
            case "false":
                return pred;
            case "comparison":
                return {
                    kind: "comparison",
                    op: pred.op,
                    left: this.inlineExpr(pred.left),
                    right: this.inlineExpr(pred.right),
                };
            case "not":
                return {
                    kind: "not",
                    predicate: this.inlinePredicate(
                        pred.predicate
                    ),
                };
            case "and":
            case "or":
                return {
                    kind: pred.kind,
                    left: this.inlinePredicate(pred.left),
                    right: this.inlinePredicate(pred.right),
                };
            case "paren":
                return this.inlinePredicate(
                    pred.inner
                );
            case "quantifier":
            case "formula":
                return pred;
        }
    }

    private varName(f: AnnotatedFunctionDef, name: string): string {
        return f.name + "_" + name;
    }

    private resolveVar(f: AnnotatedFunctionDef, name: string, scope: Map<string, any>): any {
        if (scope.has(name)) {
            return scope.get(name);
        }
        return this.ctx.Int.const(this.varName(f, name));
    }

    private exprToZ3(f: AnnotatedFunctionDef, expr: Expr, scope: Map<string, any> = new Map()): IntExpr {
        switch (expr.type) {
            case "num":
                return this.ctx.Int.val(expr.value);
            case "var":
                return this.resolveVar(f, expr.name, scope);
            case "neg":
                return this.ctx.Int.val(0).sub(this.exprToZ3(f, expr.arg, scope));
            case "bin": {
                const l = this.exprToZ3(f, expr.left, scope);
                const r = this.exprToZ3(f, expr.right, scope);
                switch (expr.op) {
                    case "+": return l.add(r);
                    case "-": return l.sub(r);
                    case "*": return l.mul(r);
                    case "/": return l.div(r);
                }
            }
            case "funccall": {
                const argSorts = expr.args.map(() => this.ctx.Int.sort());
                const retSort = this.ctx.Int.sort();

                const func = this.ctx.Function.declare(expr.name, ...argSorts, retSort);

                const z3Args = expr.args.map(arg => this.exprToZ3(f, arg, scope));
                return func.call(...z3Args);
            }
            case "arraccess": {
                const arr = this.ctx.Array.const(this.varName(f, expr.name), this.ctx.Int.sort(), this.ctx.Int.sort());
                const idx = this.exprToZ3(f, expr.index, scope);
                return arr.select(idx);
            }
        }
    }

    private predicateToZ3(f: AnnotatedFunctionDef, pred: Predicate, scope: Map<string, any> = new Map()): BoolExpr {
        switch (pred.kind) {
            case "true": return this.ctx.Bool.val(true);
            case "false": return this.ctx.Bool.val(false);
            case "comparison": {
                const l = this.exprToZ3(f, pred.left, scope);
                const r = this.exprToZ3(f, pred.right, scope);
                switch (pred.op) {
                    case "==": return l.eq(r);
                    case "!=": return this.ctx.Not(l.eq(r));
                    case ">": return l.gt(r);
                    case "<": return l.lt(r);
                    case ">=": return l.ge(r);
                    case "<=": return l.le(r);
                }
            }
            case "not":
                return this.ctx.Not(this.predicateToZ3(f, pred.predicate, scope));
            case "and":
                return this.ctx.And(this.predicateToZ3(f, pred.left, scope), this.predicateToZ3(f, pred.right, scope));
            case "or":
                return this.ctx.Or(this.predicateToZ3(f, pred.left, scope), this.predicateToZ3(f, pred.right, scope));
            case "paren":
                return this.predicateToZ3(f, pred.inner, scope);

            case "quantifier": {
                const z3Var = this.ctx.Int.const(pred.varName);

                const newScope = new Map(scope);
                newScope.set(pred.varName, z3Var);

                const body = this.predicateToZ3(f, pred.body, newScope);

                if (pred.quant === "forall") {
                    return this.ctx.ForAll([z3Var], body);
                } else {
                    return this.ctx.Exists([z3Var], body);
                }
            }

            case "formula": {
                const argSorts = pred.parameters.map(() => this.ctx.Int.sort());
                const func = this.ctx.Function.declare(pred.name, ...argSorts, this.ctx.Bool.sort());

                const args = pred.parameters.map(p => this.resolveVar(f, p.name, scope));

                return func.call(...args);
            }
        }
    }

    private async prove(vc: Predicate, f: AnnotatedFunctionDef): Promise<void> {
        const solver = new this.ctx.Solver();
        const formula = this.predicateToZ3(f, vc, new Map());
        solver.add(this.ctx.Not(formula));
        let res: string;
        try {
            res = await solver.check();
        } catch (e: any) {
            const msg = e instanceof Error ? e.message : String(e);
            fail(ErrorCode.VerificationError, `Z3 error while verifying function "${f.name}": ${msg}`);
        }

        if (res === "unsat") return;

        if (res === "unknown") {
            fail(ErrorCode.VerificationError, `Z3 returned "unknown" while verifying function "${f.name}".`);
        }

        const model: Model = solver.model();
        const msg = printFuncCall(this.ctx, f, model);
        fail(ErrorCode.VerificationError, `Verification failed for function "${f.name}".\n${msg}`);
    }
}

export async function verifyModule(module: AnnotatedModule) {
    await initZ3();
    const verifier = new FunctionVerifier(z3, module);
    await verifier.verify();
}
