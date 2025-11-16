import { Op, I32, Void, c, BufferedEmitter, LocalEntry, Int, ExportEntry } from "../../wasm";
import { Module, Statement, Expr, LValue, Condition } from "../../lab08";

const { i32,
    varuint32,
    get_local, local_entry, set_local, call, if_, void_block, void_loop, br_if, str_ascii, export_entry,
    func_type_m, function_body, type_section, function_section, export_section, code_section } = c;

export async function compileModule<M extends Module>(m: M, name?: string): Promise<WebAssembly.Exports> {
    const typeSection: any[] = [];
    const functionSection: any[] = [];
    const exportSection: ExportEntry[] = [];
    const codeSection: any[] = [];

    const functionIndexMap = new Map<string, number>();

    for (let i = 0; i < m.functions.length; i++) {
        const func = m.functions[i];

        functionIndexMap.set(func.name, i);

        const paramTypes = func.parameters.map(() => i32);
        const returnTypes = func.returns.map(() => i32);

        typeSection.push(c.func_type_m(paramTypes, returnTypes));
        functionSection.push(c.varuint32(i));
        exportSection.push(c.export_entry(c.str_ascii(func.name), c.external_kind.function, c.varuint32(i)));
    }

    for (let i = 0; i < m.functions.length; i++) {
        const func = m.functions[i];

        const allLocals: string[] = [
            ...func.parameters.map(p => p.name),
            ...func.returns.map(r => r.name),
            ...func.locals.map(l => l.name)
        ];

        const localEntries: LocalEntry[] = [
            c.local_entry(c.varuint32(allLocals.length), i32)
        ];

        const bodyOps: (Op<Void> | Op<I32>)[] = compileStatement(func.body, allLocals, functionIndexMap);

        for (const ret of func.returns) {
            const index = allLocals.indexOf(ret.name);
            bodyOps.push(c.get_local(i32, index));
        }

        codeSection.push(c.function_body(localEntries, bodyOps));
    }

    const mod = c.module([
        c.type_section(typeSection),
        c.function_section(functionSection),
        c.export_section(exportSection),
        c.code_section(codeSection)
    ]);
    const emitter = new BufferedEmitter(new ArrayBuffer(mod.z));
    mod.emit(emitter);
    const wasmModule = await WebAssembly.instantiate(emitter.buffer);
    return wasmModule.instance.exports;
}

function compileExpr(expr: Expr, locals: string[], functionIndexMap: Map<string, number>): Op<I32> {
    switch (expr.type) {
        case "num":
            return i32.const(expr.value);
        case "var":
            const index = locals.indexOf(expr.name);
            return c.get_local(i32, index);
        case "neg":
            return i32.mul(i32.const(-1), compileExpr(expr.arg, locals, functionIndexMap));
        case "bin":
            const left = compileExpr(expr.left, locals, functionIndexMap);
            const right = compileExpr(expr.right, locals, functionIndexMap);
            switch (expr.op) {
                case '+': return i32.add(left, right);
                case '-': return i32.sub(left, right);
                case '*': return i32.mul(left, right);
                case '/': return i32.div_s(left, right);
                default: throw new Error("провер бинарную операцию");
            }
        case "funccall":
            const args = expr.args.map(arg => compileExpr(arg, locals, functionIndexMap));
            const funcIndex = functionIndexMap.get(expr.name);
            if (funcIndex === undefined) {
                throw new Error(`unknown function: ${expr.name}`);
            }
            return c.call(i32, c.varuint32(funcIndex), args);
        case "arraccess":
            throw new Error("Array access TODO");
        default:
            console.log(expr);
            throw new Error(`unknown expr type: ${(expr as any).type}`);
    }
}

function compileLValue(lvalue: LValue, locals: string[]): {
    set: (value: Op<I32>) => Op<Void>,
    get: () => Op<I32>
} {
    switch (lvalue.type) {
        case "lvar":
            const index = locals.indexOf(lvalue.name);
            return {
                set: (value: Op<I32>) => c.set_local(index, value),
                get: () => c.get_local(i32, index)
            };
        case "larr":
            const arrayIndex = locals.indexOf(lvalue.name);
            const indexExpr = compileExpr(lvalue.index, locals, new Map());

            const baseAddress = c.get_local(i32, arrayIndex);

            const elementOffset = i32.mul(indexExpr, i32.const(4));
            const elementAddress = i32.add(baseAddress, elementOffset);

            return {
                set: (value: Op<I32>) => {
                    return i32.store(
                        [c.varuint32(4), 0 as any as Int],
                        elementAddress,
                        value
                    );
                },
                get: () => {
                    return i32.load(
                        [c.varuint32(4), 0 as any as Int],
                        elementAddress
                    );
                }
            };
        default:
            throw new Error("неизвестный тип lvalue");
    }
}

function compileCondition(cond: Condition, locals: string[], functionIndexMap: Map<string, number>): Op<I32> {
    switch (cond.kind) {
        case "true":
            return i32.const(1);
        case "false":
            return i32.const(0);
        case "comparison":
            const left = compileExpr(cond.left, locals, functionIndexMap);
            const right = compileExpr(cond.right, locals, functionIndexMap);
            switch (cond.op) {
                case "==": return i32.eq(left, right);
                case "!=": return i32.ne(left, right);
                case ">": return i32.gt_s(left, right);
                case "<": return i32.lt_s(left, right);
                case ">=": return i32.ge_s(left, right);
                case "<=": return i32.le_s(left, right);
                default: throw new Error(`неизвестный оператор сравнения: ${cond.op}`);
            }
        case "not":
            const inside = compileCondition(cond.condition, locals, functionIndexMap);
            return i32.eqz(inside);
        case "and":
            return c.if_(
                i32,
                compileCondition(cond.left, locals, functionIndexMap),
                [compileCondition(cond.right, locals, functionIndexMap)],
                [i32.const(0)]
            );
        case "or":
            return c.if_(
                i32,
                compileCondition(cond.left, locals, functionIndexMap),
                [i32.const(1)],
                [compileCondition(cond.right, locals, functionIndexMap)]
            );
        case "paren":
            return compileCondition(cond.inner, locals, functionIndexMap);
        default:
            console.log(cond);
            throw new Error(`unknown condition: ${cond.kind}`);
    }
}

function compileStatement(stmt: Statement, locals: string[], functionIndexMap: Map<string, number>): Op<Void>[] {
    const ops: Op<Void>[] = [];

    switch (stmt.type) {
        case "block":
            for (const sub of stmt.stmts) {
                ops.push(...compileStatement(sub, locals, functionIndexMap));
            }
            break;

        case "assign":
            const exprValues: Op<I32>[] = [];
            for (const expr of stmt.exprs) {
                exprValues.push(compileExpr(expr, locals, functionIndexMap));
            }

            for (let i = stmt.targets.length - 1; i >= 0; i--) {
                const target = stmt.targets[i];
                const lvalue = compileLValue(target, locals);
                ops.push(lvalue.set(exprValues[i]));
            }
            break;

        case "if":
            const condition2 = compileCondition(stmt.condition, locals, functionIndexMap);
            console.log(condition2);
            const thenOps = compileStatement(stmt.then, locals, functionIndexMap);
            const elseOps = stmt.else ? compileStatement(stmt.else, locals, functionIndexMap) : [];
            const ifOp = c.void_block([c.if_(c.void, condition2, thenOps, elseOps)]);

            ops.push(ifOp);
            break;

        case "while":
            const condition = compileCondition(stmt.condition, locals, functionIndexMap);
            const bodyOps = compileStatement(stmt.body, locals, functionIndexMap);

            const whileLoop =
                c.void_block([
                    c.void_loop([
                        c.br_if(1, i32.eqz(condition)),
                        ...bodyOps,
                        c.br(0)
                    ])
                ]);

            ops.push(whileLoop);
            break;
        default:
            throw new Error("unknown statement");
    }

    return ops;
}

export { FunnyError } from '../../lab08'
