import { ReversePolishNotationActionDict } from "./rpn.ohm-bundle";

export const rpnCalc = {
    Expr_num(n) {
        return parseInt(n.sourceString, 10);
    },

    Expr_plus(a, b, _plus) {
        return a.calculate() + b.calculate();
    },

    Expr_times(a, b, _star) {
        return a.calculate() * b.calculate();
    }
} satisfies ReversePolishNotationActionDict<number>;
