import { Dict, MatchResult, Semantics } from "ohm-js";
import grammar, { AddMulActionDict } from "./addmul.ohm-bundle";

export const addMulSemantics: AddMulSemantics = grammar.createSemantics() as AddMulSemantics;

const addMulCalc = {
    Expr(e) {
        return e.calculate();
    },

    Add_plus(first, _plus, second) {
        return first.calculate() + second.calculate();
    },

    Mul_times(first, _star, second) {
        return first.calculate() * second.calculate();
    },

    Atom_num(n) {
        return parseInt(n.sourceString, 10);
    },

    Atom_parens(_open, e, _close) {
        return e.calculate();
    },
} satisfies AddMulActionDict<number>;

addMulSemantics.addOperation<number>("calculate()", addMulCalc);

interface AddMulDict extends Dict {
    calculate(): number;
}

interface AddMulSemantics extends Semantics {
    (match: MatchResult): AddMulDict;
}
