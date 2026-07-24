import type { LocatorClickParams, LocatorCentroidResult, LocatorDescriptor, LocatorHighlightParams, LocatorScrollToParams, LocatorSelectOptionParams, LocatorSendClickEventParams, LocatorTypeParams } from "../../protocol/types.js";
import type { RPCClient } from "./rpcClient.js";
export declare class Locator {
    readonly rpcClient: RPCClient;
    readonly descriptor: LocatorDescriptor;
    constructor(rpcClient: RPCClient, descriptor: LocatorDescriptor);
    click(options?: LocatorClickParams["options"]): Promise<void>;
    hover(): Promise<void>;
    fill(value: string): Promise<void>;
    count(): Promise<number>;
    isChecked(): Promise<boolean>;
    inputValue(): Promise<string>;
    isVisible(): Promise<boolean>;
    innerText(): Promise<string>;
    innerHtml(): Promise<string>;
    textContent(): Promise<string>;
    scrollTo(percent: LocatorScrollToParams["percent"]): Promise<void>;
    centroid(): Promise<LocatorCentroidResult>;
    highlight(options?: LocatorHighlightParams["options"]): Promise<void>;
    sendClickEvent(options?: LocatorSendClickEventParams["options"]): Promise<void>;
    type(text: string, options?: LocatorTypeParams["options"]): Promise<void>;
    selectOption(values: LocatorSelectOptionParams["values"]): Promise<string[]>;
    first(): Locator;
    nth(index: number): Locator;
}
