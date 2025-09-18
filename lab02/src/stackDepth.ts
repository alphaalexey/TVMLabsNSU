import { ReversePolishNotationActionDict } from "./rpn.ohm-bundle";

export const rpnStackDepth = {
    Expr_num(_n) {
        const out = 1;
        const max = 1;
        return { max, out };
    },

    Expr_plus(a, b, _plus) {
        const A = a.stackDepth;
        const B = b.stackDepth;
        const out = A.out + B.out - 1;
        const max = Math.max(A.max, A.out + B.max);
        return { max, out };
    },

    Expr_times(a, b, _star) {
        const A = a.stackDepth;
        const B = b.stackDepth;
        const out = A.out + B.out - 1;
        const max = Math.max(A.max, A.out + B.max);
        return { max, out };
    },
} satisfies ReversePolishNotationActionDict<StackDepth>;

export type StackDepth = { max: number, out: number };
