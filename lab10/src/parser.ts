import { MatchResult, Semantics } from 'ohm-js';

import grammar, { FunnierActionDict } from './funnier.ohm-bundle';

import { AnnotatedModule } from './funnier';
import { parseFunny } from '../../lab08';

const getFunnierAst = {
    // write rules here
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
    return parseFunny(source);
}
