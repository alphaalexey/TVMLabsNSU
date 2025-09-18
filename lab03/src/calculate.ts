import { MatchResult } from "ohm-js";
import grammar, { ArithmeticActionDict, ArithmeticSemantics } from "./arith.ohm-bundle";

export const arithSemantics: ArithSemantics = grammar.createSemantics() as ArithSemantics;

const arithCalc = {
    Expr(e) {
        return e.calculate(this.args.params);
    },

    Add(first, operators, rest) {
        let acc = first.calculate(this.args.params);
        const n = operators.children.length;
        for (let i = 0; i < n; i++) {
            const op = operators.child(i).sourceString;
            const rhs = rest.child(i).calculate(this.args.params);
            acc = op === "+" ? acc + rhs : acc - rhs;
        }
        return acc;
    },

    Mul(first, operators, rest) {
        let acc = first.calculate(this.args.params);
        const n = operators.children.length;
        for (let i = 0; i < n; i++) {
            const op = operators.child(i).sourceString;
            const rhs = rest.child(i).calculate(this.args.params);
            if (op === "*")
                acc *= rhs;
            else if (rhs === 0) {
                throw new Error("Division by zero");
            } else {
                acc /= rhs;
            }
        }
        return acc;
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
    }
} satisfies ArithmeticActionDict<number | undefined>;

arithSemantics.addOperation<number>("calculate(params)", arithCalc);

export interface ArithActions {
    calculate(params: { [name: string]: number }): number;
}

export interface ArithSemantics extends ArithmeticSemantics {
    (match: MatchResult): ArithActions;
}
