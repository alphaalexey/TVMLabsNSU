import { desiredMark } from "../../desiredMark.json";
import { test as testJs } from '@jest/globals';
export type DesiredMark = 3|4|5|"5+";
export const toRank = (m: DesiredMark): number => (m === "5+" ? 6 : m);

export function test<T extends any[], R>(name: string, testMark: DesiredMark, fn:(...args:T)=>R, expected: ResultOrException<R>, ...args:T): void
{
    if (toRank(desiredMark as DesiredMark) >= toRank(testMark))
    {
        if(typeof expected === "function") 
        {
            if(isConstructor(expected)) // exception case
                testJs(name, async () => await expect(async () => (await fn(...args))).rejects.toThrow(expected));
            else // deferred value case
                testJs(name, async () => expect(await fn(...args)).toEqual((expected as Function)()));
        }
        else
            testJs(name, async () => expect(await fn(...args)).toEqual(expected));
    }
    else
        testJs.skip(name, ()=>{});
};
type F<R> = ()=>R; 
type ResultOrException<R> = ExceptionType | Awaited<R> | F<Awaited<R>>;

interface ExceptionType {
    new(...args: any[]): any;
}

const handler={construct(){return handler}} //Must return ANY object, so reuse one
const isConstructor= (x:any): x is ExceptionType => {
    try{
        return !!(new (new Proxy(x, handler))())
    }catch(e){
        return false
    }
}