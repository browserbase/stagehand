export type EncodedId = `${number}-${number}`;

export type InitScriptSource<Arg> = string | { content: string } | ((arg: Arg) => unknown);
