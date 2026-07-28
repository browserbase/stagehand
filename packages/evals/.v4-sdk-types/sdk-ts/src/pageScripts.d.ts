export type InitScriptSource<Arg> = string | {
    path?: string;
    content?: string;
} | ((arg: Arg) => unknown);
export declare function normalizeEvaluationExpression<R, Arg>(expression: string | ((arg: Arg) => R | Promise<R>), arg?: Arg): string;
export declare function normalizeInitScriptSource<Arg>(script: InitScriptSource<Arg>, arg?: Arg, caller?: string): Promise<string>;
