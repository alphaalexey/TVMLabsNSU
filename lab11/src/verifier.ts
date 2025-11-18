import { Arith, ArithSort, Bool, Context, init, Model, SMTArray, SMTArraySort } from "z3-solver";

import { printFuncCall } from "./printFuncCall";
import { AnnotatedModule } from "../../lab10";


let z3anchor;
async function initZ3() {
    if (!z3) {
        z3anchor = await init();
        const Z3C = z3anchor.Context;
        z3 = Z3C('main');
    }
}
export function flushZ3() {
    z3anchor = undefined;
}

let z3: Context;

export async function verifyModule(module: AnnotatedModule) {
    await initZ3();
    throw "Not implemented"
}
