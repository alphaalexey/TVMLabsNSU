import { Expr } from "../../lab04";
import { cost } from "./cost";

type Op = '+' | '-' | '*' | '/';
const neg = (e: Expr): Expr => ({ type: 'neg', arg: e });
const bin = (op: Op, l: Expr, r: Expr): Expr => ({ type: 'bin', op, left: l, right: r });

function eq(a: Expr, b: Expr): boolean {
    if (a.type !== b.type) return false;
    switch (a.type) {
        case "num": return b.type === "num" && a.value === b.value;
        case "var": return b.type === "var" && a.name === (b as any).name;
        case "neg": return b.type === "neg" && eq(a.arg, (b as any).arg);
        case "bin":
            return b.type === "bin" &&
                a.op === (b as any).op &&
                eq(a.left, (b as any).left) &&
                eq(a.right, (b as any).right);
    }
}

function encode(e: Expr): string {
    switch (e.type) {
        case "num": return `#${e.value}`;
        case "var": return `$${e.name}`;
        case "neg": return `~(${encode(e.arg)})`;
        case "bin": return `(${encode(e.left)}${e.op}${encode(e.right)})`;
    }
}

type Env = Record<string, Expr>;

function match(pattern: Expr, expr: Expr, env: Env = {}): Env | null {
    switch (pattern.type) {
        case "num":
            return (expr.type === "num" && expr.value === pattern.value) ? env : null;

        case "var": {
            const name = pattern.name;
            const bound = env[name];
            if (!bound) {
                return { ...env, [name]: expr };
            } else {
                return eq(bound, expr) ? env : null;
            }
        }

        case "neg":
            if (expr.type !== "neg") return null;
            return match(pattern.arg, expr.arg, env);

        case "bin":
            if (expr.type !== "bin" || expr.op !== pattern.op) return null;
            const envL = match(pattern.left, expr.left, env);
            return envL ? match(pattern.right, expr.right, envL) : null;
    }
}

function substitute(template: Expr, env: Env): Expr {
    switch (template.type) {
        case "num": return template;
        case "var": {
            const bound = env[template.name];
            return bound ?? template;
        }
        case "neg": return neg(substitute(template.arg, env));
        case "bin": return bin(template.op as Op, substitute(template.left, env), substitute(template.right, env));
    }
}

type Rebuilder = (replacement: Expr) => Expr;
function* contexts(e: Expr): Generator<[Expr, Rebuilder]> {
    yield [e, (r: Expr) => r];

    switch (e.type) {
        case "num":
        case "var":
            return;

        case "neg":
            for (const [sub, rebuild] of contexts(e.arg)) {
                yield [sub, (r: Expr) => rebuild(neg(r))];
            }
            return;

        case "bin":
            for (const [subL, rebuildL] of contexts(e.left)) {
                yield [subL, (r: Expr) => rebuildL(bin(e.op as Op, r, e.right))];
            }
            for (const [subR, rebuildR] of contexts(e.right)) {
                yield [subR, (r: Expr) => rebuildR(bin(e.op as Op, e.left, r))];
            }
            return;
    }
}

export function simplify(e: Expr, identities: [Expr, Expr][]): Expr {
    const seen = new Set<string>();
    const q: Expr[] = [e];
    let best: Expr = e;
    let bestCost = cost(e);

    while (q.length) {
        const cur = q.shift()!;
        const key = encode(cur);
        if (seen.has(key)) continue;
        seen.add(key);

        const c = cost(cur);
        if (c < bestCost) {
            best = cur;
            bestCost = c;
        }

        for (const [lhs, rhs] of identities) {
            for (const [sub, rebuild] of contexts(cur)) {
                const env = match(lhs, sub);
                if (env) {
                    const repl = substitute(rhs, env);
                    const next = rebuild(repl);
                    const k2 = encode(next);
                    if (!seen.has(k2)) q.push(next);
                }
            }
        }
    }

    return best;
}
