import { MatchResult } from 'ohm-js';
import { arithGrammar, ArithmeticActionDict, ArithmeticSemantics, SyntaxError } from '../../lab03';
import { Expr } from './ast';

export const getExprAst: ArithmeticActionDict<Expr> = {
    Expr(e) {
        return e.parse();
    },

    Add(first, operators, rest) {
        const base: Expr = first.parse();
        return operators.children
            .map((_, i) => [operators.child(i).sourceString as '+' | '-', rest.child(i).parse() as Expr] as const)
            .reduce<Expr>((left, [op, right]) => ({ type: 'bin', op, left, right }), base);
    },

    Mul(first, operators, rest) {
        const base: Expr = first.parse();
        return operators.children
            .map((_, i) => [operators.child(i).sourceString as '*' | '/', rest.child(i).parse() as Expr] as const)
            .reduce<Expr>((left, [op, right]) => ({ type: 'bin', op, left, right }), base);
    },

    Atom_num(n) {
        return { type: 'num', value: parseInt(n.sourceString, 10) } as Expr;
    },

    Atom_var(v) {
        return { type: 'var', name: v.sourceString } as Expr;
    },

    Atom_unary_minus(_minus, a) {
        return { type: 'neg', arg: a.parse() } as Expr;
    },

    Atom_parens(_open, e, _close) {
        return e.parse() as Expr;
    },
};

export const semantics = arithGrammar.createSemantics();

semantics.addOperation<Expr>('parse()', getExprAst);

export interface ArithSemanticsExt extends ArithmeticSemantics {
    (match: MatchResult): ArithActionsExt;
}

export interface ArithActionsExt {
    parse(): Expr;
}

export function parseExpr(source: string): Expr {
    const match = arithGrammar.match(source, 'Expr');
    if (match.failed()) {
        const msg = (match as any).message ?? 'Syntax error while parsing expression.';
        throw new SyntaxError(msg);
    }
    return (semantics as ArithSemanticsExt)(match).parse();
}
