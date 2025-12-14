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
    z3 = undefined as any;
}

type IntExpr = Arith;
type BoolExpr = Bool;
type AssignExpr = Extract<Statement, { type: "assign" }>;
type FuncCallExpr = Extract<Expr, { type: "funccall" }>;

type DefinitionalSpec = {
    params: string[];
    resultExpr: Expr;
};

const TRUE_PRED: Predicate = { kind: "true" };
const FALSE_PRED: Predicate = { kind: "false" };

class FunctionVerifier {
    private readonly ctx: Context;
    private readonly module: AnnotatedModule;
    private readonly funMap: Map<string, AnnotatedFunctionDef>;
    private readonly defSpecs: Map<string, DefinitionalSpec>;

    private funcDecl = new Map<string, any>();

    constructor(ctx: Context, module: AnnotatedModule) {
        this.ctx = ctx;
        this.module = module;
        this.funMap = new Map(module.functions.map(f => [f.name, f]));
        this.defSpecs = this.buildDefSpecs();
    }

    async verify(): Promise<void> {
        for (const f of this.module.functions) {
            await this.verifyFunction(f);
        }
    }

    private buildDefSpecs(): Map<string, DefinitionalSpec> {
        return new Map(
            this.module.functions.flatMap(f => {
                if (f.returns.length !== 1 || !f.post) return [];
                const def = this.extractDefinitionalSpec(f.returns[0], f.post, f.parameters);
                return def ? [[f.name, def] as const] : [];
            })
        );
    }

    private extractDefinitionalSpec(ret: ParameterDef, post: Predicate, params: ParameterDef[]) {
        let core = post;
        while (core.kind === "paren") core = core.inner;
        if (core.kind !== "comparison" || core.op !== "==") return;

        const isRet = (e: Expr) => e.type === "var" && e.name === ret.name;
        const paramsNames = params.map(p => p.name);

        if (isRet(core.left)) return { params: paramsNames, resultExpr: core.right };
        if (isRet(core.right)) return { params: paramsNames, resultExpr: core.left };
    }

    private async verifyFunction(f: AnnotatedFunctionDef): Promise<void> {
        const post = f.post ?? TRUE_PRED;
        const pre = f.pre ?? TRUE_PRED;

        const { pre: wpPre, vcs } = this.wpStatement(f, f.body, post);

        for (const vc of [wpPre, ...vcs]) {
            await this.prove(this.makeImplies(pre, vc), f);
        }
    }

    private getFunc(name: string, arity: number, ret: "int" | "bool") {
        const key = `${name}/${arity}/${ret}`;
        return (this.funcDecl.get(key) ?? this.funcDecl.set(key,
            this.ctx.Function.declare(
                name,
                ...Array.from({ length: arity }, () => this.ctx.Int.sort()),
                ret === "int" ? this.ctx.Int.sort() : this.ctx.Bool.sort()
            )
        ).get(key));
    }

    private forEachCallInExpr(e: Expr, cb: (c: FuncCallExpr) => void): void {
        if (e.type === "funccall") cb(e);

        const kids: Expr[] =
            e.type === "funccall" ? e.args :
                e.type === "bin" ? [e.left, e.right] :
                    e.type === "neg" ? [e.arg] :
                        e.type === "arraccess" ? [e.index] :
                            [];

        kids.forEach(k => this.forEachCallInExpr(k, cb));
    }

    private forEachCallInPred(p: Predicate, cb: (c: FuncCallExpr) => void): void {
        if (p.kind === "comparison") {
            this.forEachCallInExpr(p.left, cb);
            this.forEachCallInExpr(p.right, cb);
            return;
        }

        const kids: Predicate[] =
            p.kind === "and" || p.kind === "or" ? [p.left, p.right] :
                p.kind === "not" ? [p.predicate] :
                    p.kind === "paren" ? [p.inner] :
                        p.kind === "quantifier" ? [p.body] :
                            [];

        kids.forEach(k => this.forEachCallInPred(k, cb));
    }

    private subsForCall(callee: AnnotatedFunctionDef, call: FuncCallExpr): Map<string, Expr> {
        return new Map(callee.parameters.map((p, i) => [p.name, call.args[i]] as const));
    }

    private guardCallPreconditions(pred: Predicate): Predicate {
        switch (pred.kind) {
            case "comparison": {
                let guarded: Predicate = pred;
                for (const side of [pred.left, pred.right]) {
                    this.forEachCallInExpr(side, (c) => {
                        const callee = this.funMap.get(c.name);
                        if (!callee) return;
                        const pre = callee.pre ?? TRUE_PRED;
                        guarded = this.makeAnd(this.substPredicate(pre, this.subsForCall(callee, c)), guarded);
                    });
                }
                return guarded;
            }
            case "and":
            case "or":
                return { kind: pred.kind, left: this.guardCallPreconditions(pred.left), right: this.guardCallPreconditions(pred.right) };
            case "not":
                return { kind: "not", predicate: this.guardCallPreconditions(pred.predicate) };
            case "paren":
                return this.guardCallPreconditions(pred.inner);
            case "quantifier":
                return { ...pred, body: this.guardCallPreconditions(pred.body) };
            default:
                return pred;
        }
    }

    private subsFromAssign(s: AssignExpr): Map<string, Expr> {
        return new Map(
            s.targets.flatMap((t, i) => (t.type === "lvar" ? [[t.name, s.exprs[i]] as const] : []))
        );
    }

    private substAll(vcs: Predicate[], subs: Map<string, Expr>): Predicate[] {
        if (subs.size === 0) return vcs;
        return vcs.map(vc => this.substPredicate(vc, subs));
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
                return { pre: this.substPredicate(post, this.subsFromAssign(stmt)), vcs: [] };
            }

            case "block": {
                let current = post;
                let allVcs: Predicate[] = [];

                for (let i = stmt.stmts.length - 1; i >= 0; i--) {
                    const s = stmt.stmts[i];

                    const r = this.wpStatement(f, s, current);
                    current = r.pre;

                    if (s.type === "assign") {
                        allVcs = this.substAll(allVcs, this.subsFromAssign(s));
                    }

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

                return { pre, vcs: [...thenRes.vcs, ...elseRes.vcs] };
            }

            case "while": {
                const inv = stmt.invariant ?? TRUE_PRED;
                const condPred = this.conditionToPredicate(stmt.condition);

                const bodyResInv = this.wpStatement(f, stmt.body, inv);
                const vcPreserve = this.makeImplies(
                    this.makeAnd(inv, condPred),
                    bodyResInv.pre
                );

                const postAfterBody = this.makeAnd(
                    inv,
                    this.makeImplies(this.makeNot(condPred), post)
                );
                const bodyResExit = this.wpStatement(f, stmt.body, postAfterBody);
                const vcOneStepExit = this.makeImplies(
                    this.makeAnd(inv, condPred),
                    bodyResExit.pre
                );

                const vcExit = this.makeImplies(
                    this.makeAnd(inv, this.makeNot(condPred)),
                    post
                );

                return {
                    pre: inv,
                    vcs: [
                        vcPreserve,
                        vcOneStepExit,
                        vcExit,
                        ...bodyResInv.vcs,
                        ...bodyResExit.vcs,
                    ],
                };
            }
        }
    }

    private conditionToPredicate(c: Condition): Predicate {
        switch (c.kind) {
            case "implies":
                return this.makeImplies(this.conditionToPredicate(c.left), this.conditionToPredicate(c.right));
            case "not":
                return this.makeNot(this.conditionToPredicate(c.condition));
            case "and":
                return this.makeAnd(this.conditionToPredicate(c.left), this.conditionToPredicate(c.right));
            case "or":
                return this.makeOr(this.conditionToPredicate(c.left), this.conditionToPredicate(c.right));
            case "paren":
                return this.conditionToPredicate(c.inner);
            default:
                return c as Predicate;
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

    private rewriteExpr(
        expr: Expr,
        opts: {
            var?: (name: string) => Expr | undefined;
            call?: (name: string, args: Expr[]) => Expr | undefined;
        }
    ): Expr {
        switch (expr.type) {
            case "num":
                return expr;

            case "var": {
                const r = opts.var?.(expr.name);
                return r ?? expr;
            }

            case "neg":
                return { type: "neg", arg: this.rewriteExpr(expr.arg, opts) } as Expr;

            case "bin":
                return {
                    type: "bin",
                    op: expr.op,
                    left: this.rewriteExpr(expr.left, opts),
                    right: this.rewriteExpr(expr.right, opts),
                } as Expr;

            case "arraccess":
                return {
                    type: "arraccess",
                    name: expr.name,
                    index: this.rewriteExpr(expr.index, opts),
                };

            case "funccall": {
                const args = expr.args.map(a => this.rewriteExpr(a, opts));
                const replaced = opts.call?.(expr.name, args);
                return (
                    replaced ?? {
                        type: "funccall",
                        name: expr.name,
                        args,
                    }
                );
            }
        }
    }

    private rewritePredicate(
        pred: Predicate,
        bound: Set<string>,
        mapExpr: (e: Expr, bound: Set<string>) => Expr
    ): Predicate {
        switch (pred.kind) {
            case "true":
            case "false":
            case "formula":
                return pred;

            case "comparison":
                return {
                    kind: "comparison",
                    op: pred.op,
                    left: mapExpr(pred.left, bound),
                    right: mapExpr(pred.right, bound),
                };

            case "not":
                return {
                    kind: "not",
                    predicate: this.rewritePredicate(pred.predicate, bound, mapExpr),
                };

            case "and":
            case "or":
                return {
                    kind: pred.kind,
                    left: this.rewritePredicate(pred.left, bound, mapExpr),
                    right: this.rewritePredicate(pred.right, bound, mapExpr),
                };

            case "paren":
                return this.rewritePredicate(pred.inner, bound, mapExpr);

            case "quantifier": {
                const innerBound = new Set(bound);
                innerBound.add(pred.varName);
                return {
                    kind: "quantifier",
                    quant: pred.quant,
                    varName: pred.varName,
                    varType: pred.varType,
                    body: this.rewritePredicate(pred.body, innerBound, mapExpr),
                };
            }
        }
    }

    private substExpr(expr: Expr, subs: Map<string, Expr>): Expr {
        return this.rewriteExpr(expr, { var: (name) => subs.get(name) });
    }

    private substPredicate(pred: Predicate, subs: Map<string, Expr>): Predicate {
        return this.rewritePredicate(pred, new Set(), (e, bound) =>
            this.rewriteExpr(e, {
                var: (name) => (bound.has(name) ? undefined : subs.get(name)),
            })
        );
    }

    private inlineExpr(expr: Expr): Expr {
        return this.rewriteExpr(expr, {
            call: (name, args) => {
                const spec = this.defSpecs.get(name);
                if (!spec) return undefined;

                const subs = new Map<string, Expr>();
                for (let i = 0; i < spec.params.length; i++) {
                    subs.set(spec.params[i], args[i]);
                }
                return this.substExpr(spec.resultExpr, subs);
            },
        });
    }

    private varName(f: AnnotatedFunctionDef, name: string): string {
        return f.name + "_" + name;
    }

    private exprKey(e: Expr): string {
        switch (e.type) {
            case "num":
                return `#${e.value}`;
            case "var":
                return `$${e.name}`;
            case "neg":
                return `(-${this.exprKey(e.arg)})`;
            case "bin":
                return `(${this.exprKey(e.left)}${e.op}${this.exprKey(e.right)})`;
            case "arraccess":
                return `${e.name}[${this.exprKey(e.index)}]`;
            case "funccall":
                return `${e.name}(${e.args.map(a => this.exprKey(a)).join(",")})`;
        }
    }

    private resolveVar(f: AnnotatedFunctionDef, name: string, scope: Map<string, any>): any {
        return scope.get(name) ?? this.ctx.Int.const(this.varName(f, name));
    }

    private exprToZ3(f: AnnotatedFunctionDef, expr: Expr, scope: Map<string, any> = new Map()): IntExpr {
        expr = this.inlineExpr(expr);
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
                const func = this.getFunc(expr.name, expr.args.length, "int");
                return func.call(...expr.args.map(a => this.exprToZ3(f, a, scope)));
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
                const func = this.getFunc(pred.name, pred.parameters.length, "bool");
                return func.call(...pred.parameters.map(p => this.resolveVar(f, p.name, scope)));
            }
        }
    }

    private contractInstancesForVC(vc: Predicate): Predicate[] {
        const seen = new Set<string>();
        const inst: Predicate[] = [];

        this.forEachCallInPred(vc, (c) => {
            const key = this.exprKey(c);
            if (seen.has(key)) return;
            seen.add(key);

            const callee = this.funMap.get(c.name);
            if (!callee) return;
            if (callee.returns.length !== 1) return;
            if (!callee.post) return;

            const pre = callee.pre ?? TRUE_PRED;
            const post = callee.post;

            const subs = this.subsForCall(callee, c);
            subs.set(callee.returns[0].name, c);

            const preI = this.substPredicate(pre, subs);
            const postI = this.substPredicate(post, subs);
            const guardedPost = this.guardCallPreconditions(postI);

            inst.push(this.makeImplies(preI, guardedPost));
        });

        return inst;
    }

    private async prove(vc: Predicate, f: AnnotatedFunctionDef): Promise<void> {
        const solver = new this.ctx.Solver();
        const scope = new Map<string, any>();
        const guarded = this.guardCallPreconditions(vc);
        for (const a of this.contractInstancesForVC(guarded)) {
            solver.add(this.predicateToZ3(f, a, scope));
        }

        const formula = this.predicateToZ3(f, guarded, scope);
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
