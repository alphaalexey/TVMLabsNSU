import { MatchResult } from "ohm-js";
import grammar, { ArithmeticActionDict, ArithmeticSemantics } from "./arith.ohm-bundle";

export const arithSemantics: ArithSemantics = grammar.createSemantics() as ArithSemantics;

const arithCalc = {
    Expr(e) {
        return e.calculate(this.args.params);
    },

    Add(first, operators, rest) {
        const base = first.calculate(this.args.params);
        return operators.children
            .map((_, i) => [operators.child(i).sourceString, rest.child(i).calculate(this.args.params)])
            .reduce((acc, [op, rhs]) => op === '+' ? acc + rhs : acc - rhs, base);
    },

    Mul(first, operators, rest) {
        const base = first.calculate(this.args.params);
        return operators.children
            .map((_, i) => [operators.child(i).sourceString, rest.child(i).calculate(this.args.params)])
            .reduce((acc, [op, rhs]) => {
                if (op === '*') return acc * rhs;
                if (rhs === 0) throw new Error('Division by zero');
                return acc / rhs;
            }, base);
    },

    Unary_neg(_minus, u) {
        return -u.calculate(this.args.params);
    },

    Atom_num(n) {
        return parseInt(n.sourceString, 10);
    },

    Atom_var(v) {
        const name = v.sourceString;
        if (!(name in this.args.params)) {
            return NaN;
        }
        return this.args.params[name];
    },

    Atom_parens(_open, e, _close) {
        return e.calculate(this.args.params);
    },
} satisfies ArithmeticActionDict<number | undefined>;

arithSemantics.addOperation<number>("calculate(params)", arithCalc);

export interface ArithActions {
    calculate(params: { [name: string]: number }): number;
}

export interface ArithSemantics extends ArithmeticSemantics {
    (match: MatchResult): ArithActions;
}
