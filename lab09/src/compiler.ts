import { Op, I32, Void, c, BufferedEmitter, LocalEntry, VarUint32, ExportEntry, FunctionBody, FuncType } from "../../wasm";
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
type FunReturnCountMap = Map<string, number>;

interface CompileContext {
    locals: LocalEnv;
    functionIndexMap: FunIndexMap;
    functionReturnCounts: FunReturnCountMap;
    tempStart: number;
    tempCount: number;
}

type CompiledLValue = {
    set(value: Op<I32>): Op<Void>;
    get(): Op<I32>;
};

export async function compileModule<M extends Module>(m: M, name?: string): Promise<WebAssembly.Exports> {
    const typeSectionEntries: FuncType[] = [];
    const functionSectionEntries: VarUint32[] = [];
    const exportSectionEntries: ExportEntry[] = [];
    const codeSectionEntries: FunctionBody[] = [];

    const functionIndexMap: FunIndexMap = new Map();
    const functionReturnCounts: FunReturnCountMap = new Map();

    for (let i = 0; i < m.functions.length; i++) {
        const func = m.functions[i];
        functionIndexMap.set(func.name, i);
        functionReturnCounts.set(func.name, func.returns.length);

        const paramTypes = func.parameters.map(() => i32);
        const returnTypes = func.returns.map(() => i32);

        typeSectionEntries.push(func_type_m(paramTypes, returnTypes));
        functionSectionEntries.push(varuint32(i));
        exportSectionEntries.push(
            export_entry(str_ascii(func.name), c.external_kind.function, varuint32(i))
        );
    }

    const memoryLimits = c.resizable_limits(varuint32(1));
    const memorySection = c.memory_section([memoryLimits]);
    exportSectionEntries.push(
        export_entry(str_ascii("memory"), c.external_kind.memory, varuint32(0))
    );

    for (let i = 0; i < m.functions.length; i++) {
        const func = m.functions[i];

        const paramCount = func.parameters.length;
        const returnNames = func.returns.map(r => r.name);
        const localNames = func.locals.map(l => l.name);

        const maxTupleSize = computeMaxTupleSize(func.body);
        const tempNames = Array.from({ length: maxTupleSize }, (_, idx) => `$t${idx}`);

        const realLocalNames = [...returnNames, ...localNames, ...tempNames];

        const localEnv: LocalEnv = new Map();

        func.parameters.forEach((p, idx) => {
            localEnv.set(p.name, idx);
        });

        realLocalNames.forEach((name, idx) => {
            localEnv.set(name, paramCount + idx);
        });

        const realLocalCount = realLocalNames.length;
        const localEntries: LocalEntry[] =
            realLocalCount > 0
                ? [local_entry(varuint32(realLocalCount), i32)]
                : [];

        const ctx: CompileContext = {
            locals: localEnv,
            functionIndexMap,
            functionReturnCounts,
            tempStart: paramCount + returnNames.length + localNames.length,
            tempCount: maxTupleSize,
        };

        const bodyOps: (Op<Void> | Op<I32>)[] = compileStatement(func.body, ctx);

        for (const r of func.returns) {
            const idx = getLocalIndex(localEnv, r.name);
            bodyOps.push(get_local(i32, idx));
        }

        codeSectionEntries.push(function_body(localEntries, bodyOps));
    }

    const mod = c.module([
        type_section(typeSectionEntries),
        function_section(functionSectionEntries),
        memorySection,
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

function computeMaxTupleSize(stmt: Statement): number {
    let maxSize = 0;

    function visit(s: Statement): void {
        switch (s.type) {
            case "assign":
                if (s.targets.length > maxSize) {
                    maxSize = s.targets.length;
                }
                return;
            case "block":
                for (const sub of s.stmts) {
                    visit(sub);
                }
                return;
            case "if":
                visit(s.then);
                if (s.else) {
                    visit(s.else);
                }
                return;
            case "while":
                visit(s.body);
                return;
            case "expr":
                return;
        }
    }

    visit(stmt);
    return maxSize;
}

function compileArrayAddress(name: string, indexExpr: Expr, ctx: CompileContext): Op<I32> {
    const baseIndex = getLocalIndex(ctx.locals, name);
    const base = get_local(i32, baseIndex);
    const idx = compileExpr(indexExpr, ctx);
    const scaled = i32.mul(idx, i32.const(4));
    const offset = i32.add(i32.const(4), scaled);
    return i32.add(base, offset);
}

function compileExpr(expr: Expr, ctx: CompileContext): Op<I32> {
    switch (expr.type) {
        case "num":
            return i32.const(expr.value);

        case "var": {
            const index = getLocalIndex(ctx.locals, expr.name);
            return get_local(i32, index);
        }

        case "neg":
            return i32.sub(i32.const(0), compileExpr(expr.arg, ctx));

        case "bin": {
            const left = compileExpr(expr.left, ctx);
            const right = compileExpr(expr.right, ctx);
            switch (expr.op) {
                case "+": return i32.add(left, right);
                case "-": return i32.sub(left, right);
                case "*": return i32.mul(left, right);
                case "/": return i32.div_s(left, right);
            }
        }

        case "funccall": {
            if (expr.name === "length") {
                if (expr.args.length !== 1) {
                    throw new WebAssembly.RuntimeError(`length expects 1 argument, got ${expr.args.length}`);
                }
                const arrPtr = compileExpr(expr.args[0], ctx);
                return c.i32.load(c.align32, arrPtr);
            }

            const args = expr.args.map(arg => compileExpr(arg, ctx));
            const funcIndex = ctx.functionIndexMap.get(expr.name);
            if (funcIndex === undefined) {
                throw new WebAssembly.RuntimeError(`Unknown function: ${expr.name}`);
            }
            return call(i32, varuint32(funcIndex), args);
        }

        case "arraccess": {
            const addr = compileArrayAddress(expr.name, expr.index, ctx);
            return c.i32.load(c.align32, addr);
        }
    }
}

function compileLValue(lvalue: LValue, ctx: CompileContext): CompiledLValue {
    switch (lvalue.type) {
        case "lvar": {
            const index = getLocalIndex(ctx.locals, lvalue.name);
            return {
                set: (value: Op<I32>) => set_local(index, value),
                get: () => get_local(i32, index),
            };
        }

        case "larr": {
            return {
                set: (value: Op<I32>) => {
                    const addr = compileArrayAddress(lvalue.name, lvalue.index, ctx);
                    return c.i32.store(c.align32, addr, value);
                },
                get: () => {
                    const addr = compileArrayAddress(lvalue.name, lvalue.index, ctx);
                    return c.i32.load(c.align32, addr);
                },
            };
        }
    }
}

function getExpressionValueCount(expr: Expr, ctx: CompileContext): number {
    if (expr.type === "funccall" && expr.name !== "length") {
        const count = ctx.functionReturnCounts.get(expr.name);
        if (count !== undefined) {
            return count;
        }
    }
    return 1;
}

function compileCondition(cond: Condition, ctx: CompileContext): Op<I32> {
    switch (cond.kind) {
        case "true":
            return i32.const(1);

        case "false":
            return i32.const(0);

        case "comparison": {
            const left = compileExpr(cond.left, ctx);
            const right = compileExpr(cond.right, ctx);
            switch (cond.op) {
                case "==": return i32.eq(left, right);
                case "!=": return i32.ne(left, right);
                case ">": return i32.gt_s(left, right);
                case "<": return i32.lt_s(left, right);
                case ">=": return i32.ge_s(left, right);
                case "<=": return i32.le_s(left, right);
            }
        }

        case "not": {
            const inner = compileCondition(cond.condition, ctx);
            return i32.eqz(inner);
        }

        case "and":
            return if_(
                i32,
                compileCondition(cond.left, ctx),
                [compileCondition(cond.right, ctx)],
                [i32.const(0)],
            );

        case "or":
            return if_(
                i32,
                compileCondition(cond.left, ctx),
                [i32.const(1)],
                [compileCondition(cond.right, ctx)],
            );

        case "implies":
            return if_(
                i32,
                compileCondition(cond.left, ctx),
                [compileCondition(cond.right, ctx)],
                [i32.const(1)],
            );

        case "paren":
            return compileCondition(cond.inner, ctx);
    }
}

function compileAssignment(stmt: Statement & { type: "assign" }, ctx: CompileContext): Op<Void>[] {
    const ops: Op<Void>[] = [];

    if (stmt.targets.length === 1 && stmt.exprs.length === 1 && getExpressionValueCount(stmt.exprs[0], ctx) === 1) {
        const value = compileExpr(stmt.exprs[0], ctx);
        const lvalue = compileLValue(stmt.targets[0], ctx);
        ops.push(lvalue.set(value));
        return ops;
    }

    const totalValues = stmt.targets.length;
    if (totalValues > ctx.tempCount) {
        throw new Error("Not enough temporaries allocated for tuple assignment.");
    }

    let valueIndex = 0;
    for (let i = 0; i < stmt.exprs.length; i++) {
        const expr = stmt.exprs[i];
        const count = getExpressionValueCount(expr, ctx);
        const tempIndex = ctx.tempStart + valueIndex;
        const value = compileExpr(expr, ctx);
        ops.push(set_local(tempIndex, value));

        valueIndex += count;
    }

    for (let i = 0; i < stmt.targets.length; i++) {
        const target = stmt.targets[i];
        const lvalue = compileLValue(target, ctx);
        const tempIndex = ctx.tempStart + i;
        const tempValue = get_local(i32, tempIndex);
        ops.push(lvalue.set(tempValue));
    }

    return ops;
}

function compileStatement(stmt: Statement, ctx: CompileContext): Op<Void>[] {
    const ops: Op<Void>[] = [];

    switch (stmt.type) {
        case "block":
            for (const sub of stmt.stmts) {
                ops.push(...compileStatement(sub, ctx));
            }
            break;

        case "assign":
            ops.push(...compileAssignment(stmt, ctx));
            break;

        case "if": {
            const condOp = compileCondition(stmt.condition, ctx);
            const thenOps = compileStatement(stmt.then, ctx);
            const elseOps = stmt.else ? compileStatement(stmt.else, ctx) : [];
            ops.push(
                void_block([
                    if_(c.void, condOp, thenOps, elseOps),
                ])
            );
            break;
        }

        case "while": {
            const bodyOps = compileStatement(stmt.body, ctx);

            ops.push(
                void_block([
                    void_loop([
                        br_if(1, i32.eqz(compileCondition(stmt.condition, ctx))),
                        ...bodyOps,
                        c.br(0),
                    ]),
                ])
            );
            break;
        }

        case "expr":
            compileExpr(stmt.expr, ctx);
            break;
    }

    return ops;
}

export { FunnyError } from "../../lab08";
