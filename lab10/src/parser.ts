import { MatchResult, Semantics } from 'ohm-js';

import grammar, { FunnierActionDict } from './funnier.ohm-bundle';

import { AnnotatedModule, AnnotatedFunctionDef } from './funnier';
import { ErrorCode, Predicate, checkModule, fail, getFunnyAst, parseOptional } from '../../lab08';

const getFunnierAst = {
    ...getFunnyAst,

    PreSpec(_requires, pred) {
        return pred.parse();
    },

    PostSpec(_ensures, pred) {
        return pred.parse();
    },

    Function(name, _lp, params, _rp, preOpt, retSpec, postOpt, usesOpt, stmt) {
        return {
            ...getFunnyAst["Function"](name, _lp, params, _rp, preOpt, retSpec, postOpt, usesOpt, stmt),

            pre: parseOptional<Predicate | null>(preOpt, null),
            post: parseOptional<Predicate | null>(postOpt, null),
        } as AnnotatedFunctionDef;
    },
} satisfies FunnierActionDict<any>;

export const semantics: FunnySemanticsExt = grammar.Funnier.createSemantics() as FunnySemanticsExt;
semantics.addOperation("parse()", getFunnierAst);
export interface FunnySemanticsExt extends Semantics {
    (match: MatchResult): FunnyActionsExt
}

interface FunnyActionsExt {
    parse(): AnnotatedModule;
}

export function parseFunnier(source: string): AnnotatedModule {
    const match: MatchResult = grammar.Funnier.match(source, "Module");

    if (match.failed()) {
        const m: any = match;
        const pos =
            typeof m.getRightmostFailurePosition === "function"
                ? m.getRightmostFailurePosition()
                : null;

        const message: string =
            m.message ?? "Syntax error in Funny module.";

        fail(ErrorCode.ParseError, message, {
            startLine: pos?.lineNum,
            startCol: pos?.colNum,
        });
    }

    const mod = (semantics as FunnySemanticsExt)(match).parse();
    checkModule(mod);
    return mod;
}
