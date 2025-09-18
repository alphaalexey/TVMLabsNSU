import { MatchResult } from "ohm-js";
import { addMulSemantics } from "./calculate";
import grammar from "./addmul.ohm-bundle";

export function evaluate(content: string): number {
    return calculate(parse(content));
}

export class SyntaxError extends Error { }

function parse(content: string): MatchResult {
    const match = grammar.match(content, "Expr");
    if (match.failed()) {
        const msg = (match as any).message ?? "Syntax error while parsing expression.";
        throw new SyntaxError(msg);
    }
    return match;
}

function calculate(expression: MatchResult): number {
    return addMulSemantics(expression).calculate();
}
