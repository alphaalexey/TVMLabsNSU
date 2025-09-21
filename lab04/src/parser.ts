import { MatchResult } from 'ohm-js';
import { arithGrammar, ArithmeticActionDict, ArithmeticSemantics, SyntaxError } from '../../lab03';
import { Expr } from './ast';

export const getExprAst: ArithmeticActionDict<Expr> = {
    Expr(e) {
        return e.parse();
    },

    Add(first, operators, rest) {
        let acc: Expr = first.parse();
        const n = operators.children.length;
        for (let i = 0; i < n; i++) {
            const op = operators.child(i).sourceString as '+' | '-';
            const rhs: Expr = rest.child(i).parse();
            acc = { type: 'bin', op, left: acc, right: rhs };
        }
        return acc;
    },

    Mul(first, operators, rest) {
        let acc: Expr = first.parse();
        const n = operators.children.length;
        for (let i = 0; i < n; i++) {
            const op = operators.child(i).sourceString as '*' | '/';
            const rhs: Expr = rest.child(i).parse();
            acc = { type: 'bin', op, left: acc, right: rhs };
        }
        return acc;
    },

    Unary_neg(_minus, u) {
        return { type: 'neg', arg: u.parse() } as Expr;
    },

    Atom_num(n) {
        return { type: 'num', value: parseInt(n.sourceString, 10) } as Expr;
    },

    Atom_var(v) {
        return { type: 'var', name: v.sourceString } as Expr;
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
