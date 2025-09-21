import { c as C, Op, I32 } from "../../wasm";
import { Expr } from "../../lab04";
import { buildOneFunctionModule, Fn } from "./emitHelper";

const { i32, get_local } = C;

export function getVariables(e: Expr): string[] {
    const seen = new Set<string>();
    const out: string[] = [];

    const visit = (node: Expr): void => {
        switch (node.type) {
            case "num":
                return;
            case "var":
                if (!seen.has(node.name)) {
                    seen.add(node.name);
                    out.push(node.name);
                }
                return;
            case "neg":
                visit(node.arg);
                return;
            case "bin":
                visit(node.left);
                visit(node.right);
                return;
        }
    };

    visit(e);
    return out;
}

export async function buildFunction(e: Expr, variables: string[]): Promise<Fn<number>> {
    const exprOp = wasm(e, variables);
    return await buildOneFunctionModule("test", variables.length, [exprOp]);
}

function wasm(e: Expr, args: string[]): Op<I32> {
    switch (e.type) {
        case "num":
            return i32.const(e.value);

        case "var": {
            const idx = args.indexOf(e.name);
            if (idx < 0) {
                throw new WebAssembly.RuntimeError(`Unknown variable: ${e.name}`);
            }
            return get_local(i32, idx);
        }

        case "neg":
            return i32.sub(i32.const(0), wasm(e.arg, args));

        case "bin": {
            const L = wasm(e.left, args);
            const R = wasm(e.right, args);
            switch (e.op) {
                case "+":
                    return i32.add(L, R);
                case "-":
                    return i32.sub(L, R);
                case "*":
                    return i32.mul(L, R);
                case "/":
                    return i32.div_s(L, R);
            }
        }
    }
}
