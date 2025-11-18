import { parseVerifyAndCompile } from "../src";
import { flushZ3 } from '../src/verifier';
import { testFilesInFolderAsync } from "./testFilesInFolderAsync";


describe('11. Testing the correct samples', () => {
    testFilesInFolderAsync("./lab10/samples", parseVerifyAndCompile);
});
describe('11. Testing the incorrect samples', () => {
    testFilesInFolderAsync("./lab11/samples", parseVerifyAndCompile);
});

afterAll(() => flushZ3())
