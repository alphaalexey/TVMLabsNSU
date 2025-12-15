import { FunctionDef, Statement, Expr, Condition } from "../../lab08";
import { Context, Model } from "z3-solver";

function mkVarExpr(
    ctx: Context,
    f: FunctionDef,
    varName: string,
    typeName: "int" | "int[]"
) {
    const fullName = `${f.name}_${varName}`;

    if (typeName === "int[]") {
        return ctx.Array.const(fullName, ctx.Int.sort(), ctx.Int.sort());
    }

    return ctx.Int.const(fullName);
}

export function printFuncCall(ctx: Context, f: FunctionDef, model: Model): string {
    const env = new Map<string, any>();
    const getValue = (name: string, typeName: "int" | "int[]"): string => {
        const e = env.get(name) ?? mkVarExpr(ctx, f, name, typeName);
        return model.eval(e, true).toString();
    };

    for (const p of f.parameters) env.set(p.name, mkVarExpr(ctx, f, p.name, p.typeName));

    const exprToZ3 = (e: Expr): any => {
        switch (e.type) {
            case "num": return ctx.Int.val(e.value);
            case "var": return env.get(e.name) ?? mkVarExpr(ctx, f, e.name, "int");
            case "neg": return ctx.Int.val(0).sub(exprToZ3(e.arg));
            case "bin": {
                const l = exprToZ3(e.left), r = exprToZ3(e.right);
                if (e.op === "+") return l.add(r);
                if (e.op === "-") return l.sub(r);
                if (e.op === "*") return l.mul(r);
                return l.div(r);
            }
            default:
                return mkVarExpr(ctx, f, "__unknown", "int");
        }
    };

    const condToZ3 = (c: Condition): any => {
        switch (c.kind) {
            case "true": return ctx.Bool.val(true);
            case "false": return ctx.Bool.val(false);
            case "comparison": {
                const l = exprToZ3(c.left), r = exprToZ3(c.right);
                if (c.op === "==") return l.eq(r);
                if (c.op === "!=") return ctx.Not(l.eq(r));
                if (c.op === ">") return l.gt(r);
                if (c.op === "<") return l.lt(r);
                if (c.op === ">=") return l.ge(r);
                return l.le(r);
            }
            case "not": return ctx.Not(condToZ3(c.condition));
            case "and": return ctx.And(condToZ3(c.left), condToZ3(c.right));
            case "or": return ctx.Or(condToZ3(c.left), condToZ3(c.right));
            case "implies": return ctx.Or(ctx.Not(condToZ3(c.left)), condToZ3(c.right));
            case "paren": return condToZ3(c.inner);
        }
    };

    const evalBool = (c: Condition): boolean => model.eval(condToZ3(c), true).toString() === "true";

    const exec = (s: Statement) => {
        switch (s.type) {
            case "expr": return;
            case "block": for (const st of s.stmts) exec(st); return;
            case "assign": {
                const rhs = s.exprs.map(exprToZ3);
                s.targets.forEach((t, i) => { if (t.type === "lvar") env.set(t.name, rhs[i]); });
                return;
            }
            case "if":
                if (evalBool(s.condition)) exec(s.then);
                else if (s.else) exec(s.else);
                return;
            case "while": {
                let steps = 0;
                while (evalBool(s.condition)) {
                    if (++steps > 10_000) break;
                    exec(s.body);
                }
                return;
            }
        }
    };

    exec(f.body);

    const argsText = f.parameters.map(p => `${p.name}=${getValue(p.name, p.typeName)}`).join(", ");
    const resultsText = f.returns.map(r => `${r.name}=${getValue(r.name, r.typeName)}`).join(", ");

    let text = `${f.name}(${argsText}) => [${resultsText}]`;

    for (const v of f.locals) {
        text += `\n  ${v.name}=${getValue(v.name, v.typeName)}`;
    }

    return text;
}
