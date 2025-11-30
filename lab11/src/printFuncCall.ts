import { FunctionDef } from "../../lab08";
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
    const getValue = (name: string, typeName: "int" | "int[]"): string => {
        try {
            const expr = mkVarExpr(ctx, f, name, typeName);
            const v = model.eval(expr, true);
            return v.toString();
        } catch {
            return "?";
        }
    };

    const argExprs = f.parameters.map(
        p => `${p.name}=${getValue(p.name, p.typeName)}`
    );
    const argsText = argExprs.join(", ");

    const resExprs = f.returns.map(
        r => `${r.name}=${getValue(r.name, r.typeName)}`
    );
    const resultsText = resExprs.join(", ");

    let text = `${f.name}(${argsText}) => [${resultsText}]`;

    for (const v of f.locals) {
        text += `\n  ${v.name}=${getValue(v.name, v.typeName)}`;
    }

    return text;
}
