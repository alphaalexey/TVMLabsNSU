import { Module, ParameterDef, Statement, Predicate } from 'lab08';


export interface AnnotatedModule extends Module {
    type: "module";
    functions: AnnotatedFunctionDef[];
}

export interface AnnotatedFunctionDef {
    type: "fun";
    name: string;
    parameters: ParameterDef[];
    returns: ParameterDef[];
    locals: ParameterDef[];
    body: Statement;
    
    pre?: Predicate | null;
    post?: Predicate | null;
}
