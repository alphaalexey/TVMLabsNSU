import { ReversePolishNotationActionDict } from "./rpn.ohm-bundle";

const join = (A: StackDepth, B: StackDepth): StackDepth => ({
    out: A.out + B.out - 1,
    max: Math.max(A.max, A.out + B.max),
});

const binary =
    (f: (A: StackDepth, B: StackDepth) => StackDepth) =>
        (a: any, b: any, _tok?: any): StackDepth =>
            f(a.stackDepth, b.stackDepth);

const leaf = (): StackDepth => ({ max: 1, out: 1 });

export const rpnStackDepth = {
    Expr_num(_n) {
        return leaf();
    },

    Expr_plus: binary(join),

    Expr_times: binary(join),
} satisfies ReversePolishNotationActionDict<StackDepth>;

export type StackDepth = { max: number, out: number };
