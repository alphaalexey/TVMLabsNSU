import { Op, I32, Void, c, BufferedEmitter, LocalEntry, Int, VarUint32, ExportEntry, FunctionBody, FuncType } from "../../wasm";
import { Module, Statement, Expr, LValue, Condition } from "../../lab08";

const {
    i32,
    varuint32,
    get_local,
    local_entry,
    set_local,
    call,
    if_,
    void_block,
    void_loop,
    br_if,
    str_ascii,
    export_entry,
    func_type_m,
    function_body,
    type_section,
    function_section,
    export_section,
    code_section,
} = c;

type LocalEnv = Map<string, number>;
type FunIndexMap = Map<string, number>;

export async function compileModule<M extends Module>(m: M, name?: string): Promise<WebAssembly.Exports> {
    const typeSectionEntries: FuncType[] = [];
    const functionSectionEntries: VarUint32[] = [];
    const exportSectionEntries: ExportEntry[] = [];
    const codeSectionEntries: FunctionBody[] = [];

    const functionIndexMap: FunIndexMap = new Map();

    for (let i = 0; i < m.functions.length; i++) {
        const func = m.functions[i];

        functionIndexMap.set(func.name, i);

        const paramTypes = func.parameters.map(() => i32);
        const returnTypes = func.returns.map(() => i32);

        typeSectionEntries.push(func_type_m(paramTypes, returnTypes));
        functionSectionEntries.push(varuint32(i));
        exportSectionEntries.push(
            export_entry(str_ascii(func.name), c.external_kind.function, varuint32(i))
        );
    }

    for (let i = 0; i < m.functions.length; i++) {
        const func = m.functions[i];

        const paramCount = func.parameters.length;
        const returnNames = func.returns.map(r => r.name);
        const localNames = func.locals.map(l => l.name);
        const realLocalNames = [...returnNames, ...localNames];

        const localEnv: LocalEnv = new Map();

        func.parameters.forEach((p, idx) => {
            localEnv.set(p.name, idx);
        });

        realLocalNames.forEach((name, idx) => {
            localEnv.set(name, paramCount + idx);
        });

        const localEntries: LocalEntry[] =
            realLocalNames.length > 0
                ? [local_entry(varuint32(realLocalNames.length), i32)]
                : [];

        const bodyOps: (Op<Void> | Op<I32>)[] =
            compileStatement(func.body, localEnv, functionIndexMap);

        for (const r of func.returns) {
            const idx = localEnv.get(r.name);
            if (idx === undefined) {
                throw new Error(`Internal compiler error: unknown return variable "${r.name}".`);
            }
            bodyOps.push(get_local(i32, idx));
        }

        codeSectionEntries.push(function_body(localEntries, bodyOps));
    }

    const mod = c.module([
        type_section(typeSectionEntries),
        function_section(functionSectionEntries),
        export_section(exportSectionEntries),
        code_section(codeSectionEntries),
    ]);

    const emitter = new BufferedEmitter(new ArrayBuffer(mod.z));
    mod.emit(emitter);
    const wasmModule = await WebAssembly.instantiate(emitter.buffer);
    return wasmModule.instance.exports;
}

function getLocalIndex(env: LocalEnv, name: string): number {
    const idx = env.get(name);
    if (idx === undefined) {
        throw new WebAssembly.RuntimeError(`Unknown variable: ${name}`);
    }
    return idx;
}

function compileExpr(expr: Expr, locals: LocalEnv, functionIndexMap: FunIndexMap): Op<I32> {
    switch (expr.type) {
        case "num":
            return i32.const(expr.value);

        case "var": {
            const index = getLocalIndex(locals, expr.name);
            return get_local(i32, index);
        }

        case "neg":
            return i32.sub(i32.const(0), compileExpr(expr.arg, locals, functionIndexMap));

        case "bin": {
            const left = compileExpr(expr.left, locals, functionIndexMap);
            const right = compileExpr(expr.right, locals, functionIndexMap);
            switch (expr.op) {
                case "+": return i32.add(left, right);
                case "-": return i32.sub(left, right);
                case "*": return i32.mul(left, right);
                case "/": return i32.div_s(left, right);
                default:
                    throw new Error(`Unknown binary operator ${expr.op}`);
            }
        }

        case "funccall": {
            const args = expr.args.map(arg => compileExpr(arg, locals, functionIndexMap));
            const funcIndex = functionIndexMap.get(expr.name);
            if (funcIndex === undefined) {
                throw new WebAssembly.RuntimeError(`Unknown function: ${expr.name}`);
            }
            return call(i32, varuint32(funcIndex), args);
        }

        case "arraccess":
            throw new Error("Array access is not supported in the code generator yet.");

        default: {
            const _never: never = expr as never;
            throw new Error(`Unknown expression node ${( _never as any).type}`);
        }
    }
}

type CompiledLValue = {
    set(value: Op<I32>): Op<Void>;
    get(): Op<I32>;
};

function compileLValue(lvalue: LValue, locals: LocalEnv, functionIndexMap: FunIndexMap): CompiledLValue {
    switch (lvalue.type) {
        case "lvar": {
            const index = getLocalIndex(locals, lvalue.name);
            return {
                set: (value: Op<I32>) => set_local(index, value),
                get: () => get_local(i32, index),
            };
        }

        case "larr": {
            const arrayIndex = getLocalIndex(locals, lvalue.name);
            const indexExpr = compileExpr(lvalue.index, locals, functionIndexMap);

            const baseAddress = get_local(i32, arrayIndex);
            const elementOffset = i32.mul(indexExpr, i32.const(4));
            const elementAddress = i32.add(baseAddress, elementOffset);

            return {
                set: (value: Op<I32>) =>
                    i32.store(
                        [varuint32(4), 0 as any as Int],
                        elementAddress,
                        value
                    ),
                get: () =>
                    i32.load(
                        [varuint32(4), 0 as any as Int],
                        elementAddress
                    ),
            };
        }

        default: {
            const _never: never = lvalue as never;
            throw new Error(`Unknown lvalue node ${( _never as any).type}`);
        }
    }
}

function compileCondition(cond: Condition, locals: LocalEnv, functionIndexMap: FunIndexMap): Op<I32> {
    switch (cond.kind) {
        case "true":
            return i32.const(1);

        case "false":
            return i32.const(0);

        case "comparison": {
            const left = compileExpr(cond.left, locals, functionIndexMap);
            const right = compileExpr(cond.right, locals, functionIndexMap);
            switch (cond.op) {
                case "==": return i32.eq(left, right);
                case "!=": return i32.ne(left, right);
                case ">":  return i32.gt_s(left, right);
                case "<":  return i32.lt_s(left, right);
                case ">=": return i32.ge_s(left, right);
                case "<=": return i32.le_s(left, right);
                default:
                    throw new Error(`Unknown comparison operator ${cond.op}`);
            }
        }

        case "not": {
            const inner = compileCondition(cond.condition, locals, functionIndexMap);
            return i32.eqz(inner);
        }

        case "and":
            return if_(
                i32,
                compileCondition(cond.left, locals, functionIndexMap),
                [compileCondition(cond.right, locals, functionIndexMap)],
                [i32.const(0)],
            );

        case "or":
            return if_(
                i32,
                compileCondition(cond.left, locals, functionIndexMap),
                [i32.const(1)],
                [compileCondition(cond.right, locals, functionIndexMap)],
            );

        case "implies":
            return if_(
                i32,
                compileCondition(cond.left, locals, functionIndexMap),
                [compileCondition(cond.right, locals, functionIndexMap)],
                [i32.const(1)],
            );

        case "paren":
            return compileCondition(cond.inner, locals, functionIndexMap);

        default: {
            const _never: never = cond as never;
            throw new Error(`Unknown condition node ${( _never as any).kind}`);
        }
    }
}

function compileStatement(stmt: Statement, locals: LocalEnv, functionIndexMap: FunIndexMap): Op<Void>[] {
    const ops: Op<Void>[] = [];

    switch (stmt.type) {
        case "block":
            for (const sub of stmt.stmts) {
                ops.push(...compileStatement(sub, locals, functionIndexMap));
            }
            break;

        case "assign": {
            const exprValues: Op<I32>[] =
                stmt.exprs.map(e => compileExpr(e, locals, functionIndexMap));

            for (let i = stmt.targets.length - 1; i >= 0; i--) {
                const target = stmt.targets[i];
                const lvalue = compileLValue(target, locals, functionIndexMap);
                ops.push(lvalue.set(exprValues[i]));
            }
            break;
        }

        case "if": {
            const condOp = compileCondition(stmt.condition, locals, functionIndexMap);
            const thenOps = compileStatement(stmt.then, locals, functionIndexMap);
            const elseOps = stmt.else ? compileStatement(stmt.else, locals, functionIndexMap) : [];
            ops.push(
                void_block([
                    if_(c.void, condOp, thenOps, elseOps),
                ])
            );
            break;
        }

        case "while": {
            const bodyOps = compileStatement(stmt.body, locals, functionIndexMap);

            ops.push(
                void_block([
                    void_loop([
                        br_if(1, i32.eqz(compileCondition(stmt.condition, locals, functionIndexMap))),
                        ...bodyOps,
                        c.br(0),
                    ]),
                ])
            );
            break;
        }

        case "expr":
            break;

        default: {
            const _never: never = stmt as never;
            throw new Error(`Unknown statement node ${( _never as any).type}`);
        }
    }

    return ops;
}

export { FunnyError } from "../../lab08";
