import { MatchResult } from "ohm-js";
import grammar, { ArithmeticActionDict, ArithmeticSemantics } from "./arith.ohm-bundle";

export const arithSemantics: ArithSemantics = grammar.createSemantics() as ArithSemantics;

function foldChain(
    this: any,
    first: any,
    operators: any,
    rest: any,
    step: (acc: number, op: string, rhs: number) => number
): number {
    const params = this.args.params as { [name: string]: number };
    let acc = first.calculate(params);
    const n = operators.children.length;
    for (let i = 0; i < n; i++) {
        const op = operators.child(i).sourceString as string;
        const rhs = rest.child(i).calculate(params);
        acc = step(acc, op, rhs);
    }
    return acc;
}

const arithCalc = {
    Expr(e) {
        return e.calculate(this.args.params);
    },

    Add(first, operators, rest) {
        return foldChain.call(this, first, operators, rest, (acc, op, rhs) =>
            op === "+" ? acc + rhs : acc - rhs
        );
    },

    Mul(first, operators, rest) {
        return foldChain.call(this, first, operators, rest, (acc, op, rhs) => {
            if (op === "*") return acc * rhs;
            if (rhs === 0) throw new Error("Division by zero");
            return acc / rhs;
        });
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
