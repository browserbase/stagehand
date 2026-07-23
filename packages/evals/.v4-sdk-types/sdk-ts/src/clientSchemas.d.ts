/**
 * TypeScript SDK-owned schemas. They extend protocol schemas with SDK-only values such as local/CDP
 * connection options, JavaScript callbacks, and Page instances. Those values are consumed by the
 * SDK and never cross the RPC boundary. Other language SDKs should follow the same pattern around
 * the shared wire params.
 */
import { z } from "zod/v4";
import { Page } from "./page.js";
/** Browserbase source fields exposed by the TS SDK. Stagehand provisions its own extension. */
export declare const BrowserbaseBrowserSourceSchema: z.ZodObject<{
    userMetadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    keepAlive: z.ZodOptional<z.ZodBoolean>;
    proxies: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"browserbase">;
        domainPattern: z.ZodOptional<z.ZodString>;
        geolocation: z.ZodOptional<z.ZodObject<{
            country: z.ZodString;
            city: z.ZodOptional<z.ZodString>;
            state: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"external">;
        server: z.ZodString;
        domainPattern: z.ZodOptional<z.ZodString>;
        username: z.ZodOptional<z.ZodString>;
        password: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "type">>]>>;
    region: z.ZodOptional<z.ZodEnum<{
        "us-west-2": "us-west-2";
        "us-east-1": "us-east-1";
        "eu-central-1": "eu-central-1";
        "ap-southeast-1": "ap-southeast-1";
    }>>;
    timeout: z.ZodOptional<z.ZodNumber>;
    type: z.ZodLiteral<"browserbase">;
    browserSettings: z.ZodOptional<z.ZodObject<{
        advancedStealth: z.ZodOptional<z.ZodBoolean>;
        blockAds: z.ZodOptional<z.ZodBoolean>;
        captchaImageSelector: z.ZodOptional<z.ZodString>;
        captchaInputSelector: z.ZodOptional<z.ZodString>;
        context: z.ZodOptional<z.ZodObject<{
            id: z.ZodString;
            persist: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
        fingerprint: z.ZodOptional<z.ZodObject<{
            browsers: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                chrome: "chrome";
                edge: "edge";
                firefox: "firefox";
                safari: "safari";
            }>>>;
            devices: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                desktop: "desktop";
                mobile: "mobile";
            }>>>;
            httpVersion: z.ZodOptional<z.ZodEnum<{
                1: "1";
                2: "2";
            }>>;
            locales: z.ZodOptional<z.ZodArray<z.ZodString>>;
            operatingSystems: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                android: "android";
                ios: "ios";
                linux: "linux";
                macos: "macos";
                windows: "windows";
            }>>>;
            screen: z.ZodOptional<z.ZodObject<{
                maxHeight: z.ZodOptional<z.ZodNumber>;
                maxWidth: z.ZodOptional<z.ZodNumber>;
                minHeight: z.ZodOptional<z.ZodNumber>;
                minWidth: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        logSession: z.ZodOptional<z.ZodBoolean>;
        os: z.ZodOptional<z.ZodEnum<{
            mobile: "mobile";
            linux: "linux";
            windows: "windows";
            mac: "mac";
            tablet: "tablet";
        }>>;
        recordSession: z.ZodOptional<z.ZodBoolean>;
        solveCaptchas: z.ZodOptional<z.ZodBoolean>;
        verified: z.ZodOptional<z.ZodBoolean>;
        viewport: z.ZodOptional<z.ZodObject<{
            width: z.ZodOptional<z.ZodNumber>;
            height: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const LocalBrowserSourceSchema: z.ZodObject<{
    args: z.ZodOptional<z.ZodArray<z.ZodString>>;
    executablePath: z.ZodOptional<z.ZodString>;
    port: z.ZodOptional<z.ZodNumber>;
    userDataDir: z.ZodOptional<z.ZodString>;
    preserveUserDataDir: z.ZodOptional<z.ZodBoolean>;
    headless: z.ZodOptional<z.ZodBoolean>;
    devtools: z.ZodOptional<z.ZodBoolean>;
    chromiumSandbox: z.ZodOptional<z.ZodBoolean>;
    ignoreDefaultArgs: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodArray<z.ZodString>]>>;
    proxy: z.ZodOptional<z.ZodObject<{
        server: z.ZodString;
        bypass: z.ZodOptional<z.ZodString>;
        username: z.ZodOptional<z.ZodString>;
        password: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    locale: z.ZodOptional<z.ZodString>;
    viewport: z.ZodOptional<z.ZodObject<{
        width: z.ZodNumber;
        height: z.ZodNumber;
    }, z.core.$strip>>;
    deviceScaleFactor: z.ZodOptional<z.ZodNumber>;
    hasTouch: z.ZodOptional<z.ZodBoolean>;
    ignoreHTTPSErrors: z.ZodOptional<z.ZodBoolean>;
    connectTimeoutMs: z.ZodOptional<z.ZodNumber>;
    downloadsPath: z.ZodOptional<z.ZodString>;
    acceptDownloads: z.ZodOptional<z.ZodBoolean>;
    keepAlive: z.ZodOptional<z.ZodBoolean>;
    type: z.ZodLiteral<"local">;
}, z.core.$strict>;
export declare const CdpBrowserSourceSchema: z.ZodObject<{
    type: z.ZodLiteral<"cdp">;
    cdpUrl: z.ZodString;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strict>;
export declare const BrowserSourceSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    userMetadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    keepAlive: z.ZodOptional<z.ZodBoolean>;
    proxies: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"browserbase">;
        domainPattern: z.ZodOptional<z.ZodString>;
        geolocation: z.ZodOptional<z.ZodObject<{
            country: z.ZodString;
            city: z.ZodOptional<z.ZodString>;
            state: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"external">;
        server: z.ZodString;
        domainPattern: z.ZodOptional<z.ZodString>;
        username: z.ZodOptional<z.ZodString>;
        password: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "type">>]>>;
    region: z.ZodOptional<z.ZodEnum<{
        "us-west-2": "us-west-2";
        "us-east-1": "us-east-1";
        "eu-central-1": "eu-central-1";
        "ap-southeast-1": "ap-southeast-1";
    }>>;
    timeout: z.ZodOptional<z.ZodNumber>;
    type: z.ZodLiteral<"browserbase">;
    browserSettings: z.ZodOptional<z.ZodObject<{
        advancedStealth: z.ZodOptional<z.ZodBoolean>;
        blockAds: z.ZodOptional<z.ZodBoolean>;
        captchaImageSelector: z.ZodOptional<z.ZodString>;
        captchaInputSelector: z.ZodOptional<z.ZodString>;
        context: z.ZodOptional<z.ZodObject<{
            id: z.ZodString;
            persist: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
        fingerprint: z.ZodOptional<z.ZodObject<{
            browsers: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                chrome: "chrome";
                edge: "edge";
                firefox: "firefox";
                safari: "safari";
            }>>>;
            devices: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                desktop: "desktop";
                mobile: "mobile";
            }>>>;
            httpVersion: z.ZodOptional<z.ZodEnum<{
                1: "1";
                2: "2";
            }>>;
            locales: z.ZodOptional<z.ZodArray<z.ZodString>>;
            operatingSystems: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                android: "android";
                ios: "ios";
                linux: "linux";
                macos: "macos";
                windows: "windows";
            }>>>;
            screen: z.ZodOptional<z.ZodObject<{
                maxHeight: z.ZodOptional<z.ZodNumber>;
                maxWidth: z.ZodOptional<z.ZodNumber>;
                minHeight: z.ZodOptional<z.ZodNumber>;
                minWidth: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        logSession: z.ZodOptional<z.ZodBoolean>;
        os: z.ZodOptional<z.ZodEnum<{
            mobile: "mobile";
            linux: "linux";
            windows: "windows";
            mac: "mac";
            tablet: "tablet";
        }>>;
        recordSession: z.ZodOptional<z.ZodBoolean>;
        solveCaptchas: z.ZodOptional<z.ZodBoolean>;
        verified: z.ZodOptional<z.ZodBoolean>;
        viewport: z.ZodOptional<z.ZodObject<{
            width: z.ZodOptional<z.ZodNumber>;
            height: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    args: z.ZodOptional<z.ZodArray<z.ZodString>>;
    executablePath: z.ZodOptional<z.ZodString>;
    port: z.ZodOptional<z.ZodNumber>;
    userDataDir: z.ZodOptional<z.ZodString>;
    preserveUserDataDir: z.ZodOptional<z.ZodBoolean>;
    headless: z.ZodOptional<z.ZodBoolean>;
    devtools: z.ZodOptional<z.ZodBoolean>;
    chromiumSandbox: z.ZodOptional<z.ZodBoolean>;
    ignoreDefaultArgs: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodArray<z.ZodString>]>>;
    proxy: z.ZodOptional<z.ZodObject<{
        server: z.ZodString;
        bypass: z.ZodOptional<z.ZodString>;
        username: z.ZodOptional<z.ZodString>;
        password: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    locale: z.ZodOptional<z.ZodString>;
    viewport: z.ZodOptional<z.ZodObject<{
        width: z.ZodNumber;
        height: z.ZodNumber;
    }, z.core.$strip>>;
    deviceScaleFactor: z.ZodOptional<z.ZodNumber>;
    hasTouch: z.ZodOptional<z.ZodBoolean>;
    ignoreHTTPSErrors: z.ZodOptional<z.ZodBoolean>;
    connectTimeoutMs: z.ZodOptional<z.ZodNumber>;
    downloadsPath: z.ZodOptional<z.ZodString>;
    acceptDownloads: z.ZodOptional<z.ZodBoolean>;
    keepAlive: z.ZodOptional<z.ZodBoolean>;
    type: z.ZodLiteral<"local">;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"cdp">;
    cdpUrl: z.ZodString;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strict>], "type">;
/** An LLM callback implemented locally by the SDK consumer. It never crosses the wire. */
export declare const ClientLLMSchema: z.ZodObject<{
    generate: z.ZodFunction<z.ZodTuple<readonly [z.ZodUnion<readonly [z.ZodObject<{
        messages: z.ZodArray<z.ZodObject<{
            role: z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>;
            content: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodBase64;
                mimeType: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"tool_use">;
                id: z.ZodString;
                name: z.ZodString;
                input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"tool_result">;
                toolUseId: z.ZodString;
                content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodBase64;
                    mimeType: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>], "type">>;
                structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
                isError: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strict>], "type">, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodBase64;
                mimeType: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"tool_use">;
                id: z.ZodString;
                name: z.ZodString;
                input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"tool_result">;
                toolUseId: z.ZodString;
                content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodBase64;
                    mimeType: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>], "type">>;
                structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
                isError: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strict>], "type">>]>;
        }, z.core.$strict>>;
        systemPrompt: z.ZodOptional<z.ZodString>;
        temperature: z.ZodOptional<z.ZodNumber>;
        stopSequences: z.ZodOptional<z.ZodArray<z.ZodString>>;
        responseFormat: z.ZodObject<{
            type: z.ZodLiteral<"json_schema">;
            name: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            schema: z.ZodJSONSchema;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        messages: z.ZodArray<z.ZodObject<{
            role: z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>;
            content: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodBase64;
                mimeType: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"tool_use">;
                id: z.ZodString;
                name: z.ZodString;
                input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"tool_result">;
                toolUseId: z.ZodString;
                content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodBase64;
                    mimeType: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>], "type">>;
                structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
                isError: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strict>], "type">, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodBase64;
                mimeType: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"tool_use">;
                id: z.ZodString;
                name: z.ZodString;
                input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"tool_result">;
                toolUseId: z.ZodString;
                content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodBase64;
                    mimeType: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>], "type">>;
                structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
                isError: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strict>], "type">>]>;
        }, z.core.$strict>>;
        systemPrompt: z.ZodOptional<z.ZodString>;
        temperature: z.ZodOptional<z.ZodNumber>;
        stopSequences: z.ZodOptional<z.ZodArray<z.ZodString>>;
        tools: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            title: z.ZodOptional<z.ZodString>;
            icons: z.ZodOptional<z.ZodArray<z.ZodObject<{
                src: z.ZodURL;
                mimeType: z.ZodOptional<z.ZodString>;
                sizes: z.ZodOptional<z.ZodArray<z.ZodString>>;
                theme: z.ZodOptional<z.ZodEnum<{
                    light: "light";
                    dark: "dark";
                }>>;
            }, z.core.$strict>>>;
            description: z.ZodOptional<z.ZodString>;
            inputSchema: z.ZodObject<{
                $schema: z.ZodOptional<z.ZodString>;
                type: z.ZodLiteral<"object">;
                properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodJSONSchema>>>;
                required: z.ZodOptional<z.ZodArray<z.ZodString>>;
            }, z.core.$strict>;
            execution: z.ZodOptional<z.ZodObject<{
                taskSupport: z.ZodOptional<z.ZodEnum<{
                    optional: "optional";
                    required: "required";
                    forbidden: "forbidden";
                }>>;
            }, z.core.$strict>>;
            outputSchema: z.ZodOptional<z.ZodObject<{
                $schema: z.ZodOptional<z.ZodString>;
                type: z.ZodLiteral<"object">;
                properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodJSONSchema>>>;
                required: z.ZodOptional<z.ZodArray<z.ZodString>>;
            }, z.core.$strict>>;
            annotations: z.ZodOptional<z.ZodObject<{
                title: z.ZodOptional<z.ZodString>;
                readOnlyHint: z.ZodOptional<z.ZodBoolean>;
                destructiveHint: z.ZodOptional<z.ZodBoolean>;
                idempotentHint: z.ZodOptional<z.ZodBoolean>;
                openWorldHint: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strict>>;
        }, z.core.$strict>>>;
        toolChoice: z.ZodOptional<z.ZodObject<{
            mode: z.ZodOptional<z.ZodEnum<{
                required: "required";
                auto: "auto";
                none: "none";
            }>>;
        }, z.core.$strict>>;
        responseFormat: z.ZodOptional<z.ZodObject<{
            type: z.ZodLiteral<"text">;
        }, z.core.$strict>>;
    }, z.core.$strict>]>], null>, z.ZodPromise<z.ZodDiscriminatedUnion<[z.ZodObject<{
        role: z.ZodEnum<{
            user: "user";
            assistant: "assistant";
        }>;
        content: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_use">;
            id: z.ZodString;
            name: z.ZodString;
            input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_result">;
            toolUseId: z.ZodString;
            content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodBase64;
                mimeType: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>], "type">>;
            structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
            isError: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>], "type">, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_use">;
            id: z.ZodString;
            name: z.ZodString;
            input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_result">;
            toolUseId: z.ZodString;
            content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodBase64;
                mimeType: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>], "type">>;
            structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
            isError: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>], "type">>]>;
        stopReason: z.ZodOptional<z.ZodString>;
        usage: z.ZodOptional<z.ZodObject<{
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            totalTokens: z.ZodNumber;
            reasoningTokens: z.ZodOptional<z.ZodNumber>;
            cachedInputTokens: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        outputFormat: z.ZodLiteral<"text">;
    }, z.core.$catchall<z.ZodJSONSchema>>, z.ZodObject<{
        role: z.ZodEnum<{
            user: "user";
            assistant: "assistant";
        }>;
        content: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_use">;
            id: z.ZodString;
            name: z.ZodString;
            input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_result">;
            toolUseId: z.ZodString;
            content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodBase64;
                mimeType: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>], "type">>;
            structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
            isError: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>], "type">, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_use">;
            id: z.ZodString;
            name: z.ZodString;
            input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_result">;
            toolUseId: z.ZodString;
            content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodBase64;
                mimeType: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>], "type">>;
            structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
            isError: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>], "type">>]>;
        stopReason: z.ZodOptional<z.ZodString>;
        usage: z.ZodOptional<z.ZodObject<{
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            totalTokens: z.ZodNumber;
            reasoningTokens: z.ZodOptional<z.ZodNumber>;
            cachedInputTokens: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        outputFormat: z.ZodLiteral<"json_schema">;
        structuredContent: z.ZodJSONSchema;
    }, z.core.$catchall<z.ZodJSONSchema>>], "outputFormat">>>;
}, z.core.$strict>;
export declare const StagehandClientActOptionsSchema: z.ZodObject<{
    model: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
        apiKey: z.ZodOptional<z.ZodString>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        modelName: z.ZodUnion<readonly [z.ZodTemplateLiteral<"openai/gpt-4.1" | "openai/gpt-4.1-2025-04-14" | "openai/gpt-4.1-mini" | "openai/gpt-4.1-mini-2025-04-14" | "openai/gpt-4.1-nano" | "openai/gpt-4.1-nano-2025-04-14" | "openai/gpt-4o" | "openai/gpt-4o-2024-05-13" | "openai/gpt-4o-2024-08-06" | "openai/gpt-4o-2024-11-20" | "openai/gpt-4o-audio-preview" | "openai/gpt-4o-audio-preview-2024-12-17" | "openai/gpt-4o-search-preview" | "openai/gpt-4o-search-preview-2025-03-11" | "openai/gpt-4o-mini-search-preview" | "openai/gpt-4o-mini-search-preview-2025-03-11" | "openai/gpt-4o-mini" | "openai/gpt-4o-mini-2024-07-18" | "openai/gpt-3.5-turbo-0125" | "openai/gpt-3.5-turbo" | "openai/gpt-3.5-turbo-1106" | "openai/gpt-5-chat-latest" | "openai/o1" | "openai/o1-2024-12-17" | "openai/o3" | "openai/o3-2025-04-16" | "openai/o3-mini" | "openai/o3-mini-2025-01-31" | "openai/o4-mini" | "openai/o4-mini-2025-04-16" | "openai/gpt-5" | "openai/gpt-5-2025-08-07" | "openai/gpt-5-codex" | "openai/gpt-5-mini" | "openai/gpt-5-mini-2025-08-07" | "openai/gpt-5-nano" | "openai/gpt-5-nano-2025-08-07" | "openai/gpt-5-pro" | "openai/gpt-5-pro-2025-10-06" | "openai/gpt-5.1" | "openai/gpt-5.1-chat-latest" | "openai/gpt-5.1-codex-mini" | "openai/gpt-5.1-codex" | "openai/gpt-5.1-codex-max" | "openai/gpt-5.2" | "openai/gpt-5.2-chat-latest" | "openai/gpt-5.2-pro" | "openai/gpt-5.2-codex" | "openai/gpt-5.3-chat-latest" | "openai/gpt-5.3-codex" | "openai/gpt-5.4" | "openai/gpt-5.4-2026-03-05" | "openai/gpt-5.4-mini" | "openai/gpt-5.4-mini-2026-03-17" | "openai/gpt-5.4-nano" | "openai/gpt-5.4-nano-2026-03-17" | "openai/gpt-5.4-pro" | "openai/gpt-5.4-pro-2026-03-05" | "openai/gpt-5.5" | "openai/gpt-5.5-2026-04-23" | "openai/gpt-5.6" | "openai/gpt-5.6-luna" | "openai/gpt-5.6-sol" | "openai/gpt-5.6-terra">, z.ZodTemplateLiteral<"anthropic/claude-3-haiku-20240307" | "anthropic/claude-haiku-4-5-20251001" | "anthropic/claude-haiku-4-5" | "anthropic/claude-opus-4-0" | "anthropic/claude-opus-4-20250514" | "anthropic/claude-opus-4-1-20250805" | "anthropic/claude-opus-4-1" | "anthropic/claude-opus-4-5" | "anthropic/claude-opus-4-5-20251101" | "anthropic/claude-sonnet-4-0" | "anthropic/claude-sonnet-4-20250514" | "anthropic/claude-sonnet-4-5-20250929" | "anthropic/claude-sonnet-4-5" | "anthropic/claude-sonnet-4-6" | "anthropic/claude-opus-4-6" | "anthropic/claude-opus-4-7" | "anthropic/claude-opus-4-8" | "anthropic/claude-fable-5" | "anthropic/claude-sonnet-5">, z.ZodTemplateLiteral<"google/gemini-2.0-flash" | "google/gemini-2.0-flash-001" | "google/gemini-2.0-flash-lite" | "google/gemini-2.0-flash-lite-001" | "google/gemini-2.5-pro" | "google/gemini-2.5-flash" | "google/gemini-2.5-flash-image" | "google/gemini-2.5-flash-lite" | "google/gemini-2.5-flash-preview-tts" | "google/gemini-2.5-pro-preview-tts" | "google/gemini-2.5-flash-native-audio-latest" | "google/gemini-2.5-flash-native-audio-preview-09-2025" | "google/gemini-2.5-flash-native-audio-preview-12-2025" | "google/gemini-2.5-computer-use-preview-10-2025" | "google/gemini-3-pro-preview" | "google/gemini-3-pro-image-preview" | "google/gemini-3-flash-preview" | "google/gemini-3.1-pro-preview" | "google/gemini-3.1-pro-preview-customtools" | "google/gemini-3.1-flash-image-preview" | "google/gemini-3.1-flash-lite-preview" | "google/gemini-3.1-flash-tts-preview" | "google/gemini-3.5-flash" | "google/gemini-pro-latest" | "google/gemini-flash-latest" | "google/gemini-flash-lite-latest" | "google/deep-research-pro-preview-12-2025" | "google/deep-research-max-preview-04-2026" | "google/deep-research-preview-04-2026" | "google/nano-banana-pro-preview" | "google/aqa" | "google/gemini-robotics-er-1.5-preview" | "google/gemma-3-1b-it" | "google/gemma-3-4b-it" | "google/gemma-3n-e4b-it" | "google/gemma-3n-e2b-it" | "google/gemma-3-12b-it" | "google/gemma-3-27b-it">, z.ZodTemplateLiteral<"groq/gemma2-9b-it" | "groq/llama-3.1-8b-instant" | "groq/llama-3.3-70b-versatile" | "groq/meta-llama/llama-guard-4-12b" | "groq/openai/gpt-oss-120b" | "groq/openai/gpt-oss-20b" | "groq/deepseek-r1-distill-llama-70b" | "groq/meta-llama/llama-4-maverick-17b-128e-instruct" | "groq/meta-llama/llama-4-scout-17b-16e-instruct" | "groq/meta-llama/llama-prompt-guard-2-22m" | "groq/meta-llama/llama-prompt-guard-2-86m" | "groq/moonshotai/kimi-k2-instruct-0905" | "groq/qwen/qwen3-32b" | "groq/llama-guard-3-8b" | "groq/llama3-70b-8192" | "groq/llama3-8b-8192" | "groq/mixtral-8x7b-32768" | "groq/qwen-qwq-32b" | "groq/qwen-2.5-32b" | "groq/deepseek-r1-distill-qwen-32b">, z.ZodTemplateLiteral<"cerebras/llama3.1-8b" | "cerebras/gpt-oss-120b" | "cerebras/qwen-3-235b-a22b-instruct-2507" | "cerebras/qwen-3-235b-a22b-thinking-2507" | "cerebras/zai-glm-4.6" | "cerebras/zai-glm-4.7">]>;
    }, z.core.$strict>, z.ZodObject<{
        apiKey: z.ZodOptional<z.ZodString>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        modelName: z.ZodString;
        baseURL: z.ZodURL;
    }, z.core.$strict>]>>;
    variables: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>, z.ZodObject<{
        value: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
        description: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>]>>>;
    timeout: z.ZodOptional<z.ZodNumber>;
    locator: z.ZodOptional<z.ZodObject<{
        pageIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        title: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        active: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        targetId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        tabId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        frameId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        idx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        frameIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        xpath: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        css: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        reactElementName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        coordinates: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            x: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            y: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            top: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            left: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            bottom: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            right: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        }, z.core.$strict>>>;
        snapshotId: z.ZodOptional<z.ZodNullable<z.ZodUUID>>;
        elementId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    cache: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
        threshold: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>]>>;
    page: z.ZodOptional<z.ZodCustom<Page, Page>>;
}, z.core.$strict>;
export declare const StagehandClientObserveOptionsSchema: z.ZodObject<{
    model: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
        apiKey: z.ZodOptional<z.ZodString>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        modelName: z.ZodUnion<readonly [z.ZodTemplateLiteral<"openai/gpt-4.1" | "openai/gpt-4.1-2025-04-14" | "openai/gpt-4.1-mini" | "openai/gpt-4.1-mini-2025-04-14" | "openai/gpt-4.1-nano" | "openai/gpt-4.1-nano-2025-04-14" | "openai/gpt-4o" | "openai/gpt-4o-2024-05-13" | "openai/gpt-4o-2024-08-06" | "openai/gpt-4o-2024-11-20" | "openai/gpt-4o-audio-preview" | "openai/gpt-4o-audio-preview-2024-12-17" | "openai/gpt-4o-search-preview" | "openai/gpt-4o-search-preview-2025-03-11" | "openai/gpt-4o-mini-search-preview" | "openai/gpt-4o-mini-search-preview-2025-03-11" | "openai/gpt-4o-mini" | "openai/gpt-4o-mini-2024-07-18" | "openai/gpt-3.5-turbo-0125" | "openai/gpt-3.5-turbo" | "openai/gpt-3.5-turbo-1106" | "openai/gpt-5-chat-latest" | "openai/o1" | "openai/o1-2024-12-17" | "openai/o3" | "openai/o3-2025-04-16" | "openai/o3-mini" | "openai/o3-mini-2025-01-31" | "openai/o4-mini" | "openai/o4-mini-2025-04-16" | "openai/gpt-5" | "openai/gpt-5-2025-08-07" | "openai/gpt-5-codex" | "openai/gpt-5-mini" | "openai/gpt-5-mini-2025-08-07" | "openai/gpt-5-nano" | "openai/gpt-5-nano-2025-08-07" | "openai/gpt-5-pro" | "openai/gpt-5-pro-2025-10-06" | "openai/gpt-5.1" | "openai/gpt-5.1-chat-latest" | "openai/gpt-5.1-codex-mini" | "openai/gpt-5.1-codex" | "openai/gpt-5.1-codex-max" | "openai/gpt-5.2" | "openai/gpt-5.2-chat-latest" | "openai/gpt-5.2-pro" | "openai/gpt-5.2-codex" | "openai/gpt-5.3-chat-latest" | "openai/gpt-5.3-codex" | "openai/gpt-5.4" | "openai/gpt-5.4-2026-03-05" | "openai/gpt-5.4-mini" | "openai/gpt-5.4-mini-2026-03-17" | "openai/gpt-5.4-nano" | "openai/gpt-5.4-nano-2026-03-17" | "openai/gpt-5.4-pro" | "openai/gpt-5.4-pro-2026-03-05" | "openai/gpt-5.5" | "openai/gpt-5.5-2026-04-23" | "openai/gpt-5.6" | "openai/gpt-5.6-luna" | "openai/gpt-5.6-sol" | "openai/gpt-5.6-terra">, z.ZodTemplateLiteral<"anthropic/claude-3-haiku-20240307" | "anthropic/claude-haiku-4-5-20251001" | "anthropic/claude-haiku-4-5" | "anthropic/claude-opus-4-0" | "anthropic/claude-opus-4-20250514" | "anthropic/claude-opus-4-1-20250805" | "anthropic/claude-opus-4-1" | "anthropic/claude-opus-4-5" | "anthropic/claude-opus-4-5-20251101" | "anthropic/claude-sonnet-4-0" | "anthropic/claude-sonnet-4-20250514" | "anthropic/claude-sonnet-4-5-20250929" | "anthropic/claude-sonnet-4-5" | "anthropic/claude-sonnet-4-6" | "anthropic/claude-opus-4-6" | "anthropic/claude-opus-4-7" | "anthropic/claude-opus-4-8" | "anthropic/claude-fable-5" | "anthropic/claude-sonnet-5">, z.ZodTemplateLiteral<"google/gemini-2.0-flash" | "google/gemini-2.0-flash-001" | "google/gemini-2.0-flash-lite" | "google/gemini-2.0-flash-lite-001" | "google/gemini-2.5-pro" | "google/gemini-2.5-flash" | "google/gemini-2.5-flash-image" | "google/gemini-2.5-flash-lite" | "google/gemini-2.5-flash-preview-tts" | "google/gemini-2.5-pro-preview-tts" | "google/gemini-2.5-flash-native-audio-latest" | "google/gemini-2.5-flash-native-audio-preview-09-2025" | "google/gemini-2.5-flash-native-audio-preview-12-2025" | "google/gemini-2.5-computer-use-preview-10-2025" | "google/gemini-3-pro-preview" | "google/gemini-3-pro-image-preview" | "google/gemini-3-flash-preview" | "google/gemini-3.1-pro-preview" | "google/gemini-3.1-pro-preview-customtools" | "google/gemini-3.1-flash-image-preview" | "google/gemini-3.1-flash-lite-preview" | "google/gemini-3.1-flash-tts-preview" | "google/gemini-3.5-flash" | "google/gemini-pro-latest" | "google/gemini-flash-latest" | "google/gemini-flash-lite-latest" | "google/deep-research-pro-preview-12-2025" | "google/deep-research-max-preview-04-2026" | "google/deep-research-preview-04-2026" | "google/nano-banana-pro-preview" | "google/aqa" | "google/gemini-robotics-er-1.5-preview" | "google/gemma-3-1b-it" | "google/gemma-3-4b-it" | "google/gemma-3n-e4b-it" | "google/gemma-3n-e2b-it" | "google/gemma-3-12b-it" | "google/gemma-3-27b-it">, z.ZodTemplateLiteral<"groq/gemma2-9b-it" | "groq/llama-3.1-8b-instant" | "groq/llama-3.3-70b-versatile" | "groq/meta-llama/llama-guard-4-12b" | "groq/openai/gpt-oss-120b" | "groq/openai/gpt-oss-20b" | "groq/deepseek-r1-distill-llama-70b" | "groq/meta-llama/llama-4-maverick-17b-128e-instruct" | "groq/meta-llama/llama-4-scout-17b-16e-instruct" | "groq/meta-llama/llama-prompt-guard-2-22m" | "groq/meta-llama/llama-prompt-guard-2-86m" | "groq/moonshotai/kimi-k2-instruct-0905" | "groq/qwen/qwen3-32b" | "groq/llama-guard-3-8b" | "groq/llama3-70b-8192" | "groq/llama3-8b-8192" | "groq/mixtral-8x7b-32768" | "groq/qwen-qwq-32b" | "groq/qwen-2.5-32b" | "groq/deepseek-r1-distill-qwen-32b">, z.ZodTemplateLiteral<"cerebras/llama3.1-8b" | "cerebras/gpt-oss-120b" | "cerebras/qwen-3-235b-a22b-instruct-2507" | "cerebras/qwen-3-235b-a22b-thinking-2507" | "cerebras/zai-glm-4.6" | "cerebras/zai-glm-4.7">]>;
    }, z.core.$strict>, z.ZodObject<{
        apiKey: z.ZodOptional<z.ZodString>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        modelName: z.ZodString;
        baseURL: z.ZodURL;
    }, z.core.$strict>]>>;
    variables: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>, z.ZodObject<{
        value: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
        description: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>]>>>;
    timeout: z.ZodOptional<z.ZodNumber>;
    selector: z.ZodOptional<z.ZodString>;
    ignoreSelectors: z.ZodOptional<z.ZodArray<z.ZodString>>;
    locator: z.ZodOptional<z.ZodObject<{
        pageIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        title: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        active: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        targetId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        tabId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        frameId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        idx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        frameIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        xpath: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        css: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        reactElementName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        coordinates: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            x: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            y: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            top: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            left: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            bottom: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            right: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        }, z.core.$strict>>>;
        snapshotId: z.ZodOptional<z.ZodNullable<z.ZodUUID>>;
        elementId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    cache: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
        threshold: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>]>>;
    page: z.ZodOptional<z.ZodCustom<Page, Page>>;
}, z.core.$strict>;
export declare const StagehandClientExtractOptionsSchema: z.ZodObject<{
    model: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
        apiKey: z.ZodOptional<z.ZodString>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        modelName: z.ZodUnion<readonly [z.ZodTemplateLiteral<"openai/gpt-4.1" | "openai/gpt-4.1-2025-04-14" | "openai/gpt-4.1-mini" | "openai/gpt-4.1-mini-2025-04-14" | "openai/gpt-4.1-nano" | "openai/gpt-4.1-nano-2025-04-14" | "openai/gpt-4o" | "openai/gpt-4o-2024-05-13" | "openai/gpt-4o-2024-08-06" | "openai/gpt-4o-2024-11-20" | "openai/gpt-4o-audio-preview" | "openai/gpt-4o-audio-preview-2024-12-17" | "openai/gpt-4o-search-preview" | "openai/gpt-4o-search-preview-2025-03-11" | "openai/gpt-4o-mini-search-preview" | "openai/gpt-4o-mini-search-preview-2025-03-11" | "openai/gpt-4o-mini" | "openai/gpt-4o-mini-2024-07-18" | "openai/gpt-3.5-turbo-0125" | "openai/gpt-3.5-turbo" | "openai/gpt-3.5-turbo-1106" | "openai/gpt-5-chat-latest" | "openai/o1" | "openai/o1-2024-12-17" | "openai/o3" | "openai/o3-2025-04-16" | "openai/o3-mini" | "openai/o3-mini-2025-01-31" | "openai/o4-mini" | "openai/o4-mini-2025-04-16" | "openai/gpt-5" | "openai/gpt-5-2025-08-07" | "openai/gpt-5-codex" | "openai/gpt-5-mini" | "openai/gpt-5-mini-2025-08-07" | "openai/gpt-5-nano" | "openai/gpt-5-nano-2025-08-07" | "openai/gpt-5-pro" | "openai/gpt-5-pro-2025-10-06" | "openai/gpt-5.1" | "openai/gpt-5.1-chat-latest" | "openai/gpt-5.1-codex-mini" | "openai/gpt-5.1-codex" | "openai/gpt-5.1-codex-max" | "openai/gpt-5.2" | "openai/gpt-5.2-chat-latest" | "openai/gpt-5.2-pro" | "openai/gpt-5.2-codex" | "openai/gpt-5.3-chat-latest" | "openai/gpt-5.3-codex" | "openai/gpt-5.4" | "openai/gpt-5.4-2026-03-05" | "openai/gpt-5.4-mini" | "openai/gpt-5.4-mini-2026-03-17" | "openai/gpt-5.4-nano" | "openai/gpt-5.4-nano-2026-03-17" | "openai/gpt-5.4-pro" | "openai/gpt-5.4-pro-2026-03-05" | "openai/gpt-5.5" | "openai/gpt-5.5-2026-04-23" | "openai/gpt-5.6" | "openai/gpt-5.6-luna" | "openai/gpt-5.6-sol" | "openai/gpt-5.6-terra">, z.ZodTemplateLiteral<"anthropic/claude-3-haiku-20240307" | "anthropic/claude-haiku-4-5-20251001" | "anthropic/claude-haiku-4-5" | "anthropic/claude-opus-4-0" | "anthropic/claude-opus-4-20250514" | "anthropic/claude-opus-4-1-20250805" | "anthropic/claude-opus-4-1" | "anthropic/claude-opus-4-5" | "anthropic/claude-opus-4-5-20251101" | "anthropic/claude-sonnet-4-0" | "anthropic/claude-sonnet-4-20250514" | "anthropic/claude-sonnet-4-5-20250929" | "anthropic/claude-sonnet-4-5" | "anthropic/claude-sonnet-4-6" | "anthropic/claude-opus-4-6" | "anthropic/claude-opus-4-7" | "anthropic/claude-opus-4-8" | "anthropic/claude-fable-5" | "anthropic/claude-sonnet-5">, z.ZodTemplateLiteral<"google/gemini-2.0-flash" | "google/gemini-2.0-flash-001" | "google/gemini-2.0-flash-lite" | "google/gemini-2.0-flash-lite-001" | "google/gemini-2.5-pro" | "google/gemini-2.5-flash" | "google/gemini-2.5-flash-image" | "google/gemini-2.5-flash-lite" | "google/gemini-2.5-flash-preview-tts" | "google/gemini-2.5-pro-preview-tts" | "google/gemini-2.5-flash-native-audio-latest" | "google/gemini-2.5-flash-native-audio-preview-09-2025" | "google/gemini-2.5-flash-native-audio-preview-12-2025" | "google/gemini-2.5-computer-use-preview-10-2025" | "google/gemini-3-pro-preview" | "google/gemini-3-pro-image-preview" | "google/gemini-3-flash-preview" | "google/gemini-3.1-pro-preview" | "google/gemini-3.1-pro-preview-customtools" | "google/gemini-3.1-flash-image-preview" | "google/gemini-3.1-flash-lite-preview" | "google/gemini-3.1-flash-tts-preview" | "google/gemini-3.5-flash" | "google/gemini-pro-latest" | "google/gemini-flash-latest" | "google/gemini-flash-lite-latest" | "google/deep-research-pro-preview-12-2025" | "google/deep-research-max-preview-04-2026" | "google/deep-research-preview-04-2026" | "google/nano-banana-pro-preview" | "google/aqa" | "google/gemini-robotics-er-1.5-preview" | "google/gemma-3-1b-it" | "google/gemma-3-4b-it" | "google/gemma-3n-e4b-it" | "google/gemma-3n-e2b-it" | "google/gemma-3-12b-it" | "google/gemma-3-27b-it">, z.ZodTemplateLiteral<"groq/gemma2-9b-it" | "groq/llama-3.1-8b-instant" | "groq/llama-3.3-70b-versatile" | "groq/meta-llama/llama-guard-4-12b" | "groq/openai/gpt-oss-120b" | "groq/openai/gpt-oss-20b" | "groq/deepseek-r1-distill-llama-70b" | "groq/meta-llama/llama-4-maverick-17b-128e-instruct" | "groq/meta-llama/llama-4-scout-17b-16e-instruct" | "groq/meta-llama/llama-prompt-guard-2-22m" | "groq/meta-llama/llama-prompt-guard-2-86m" | "groq/moonshotai/kimi-k2-instruct-0905" | "groq/qwen/qwen3-32b" | "groq/llama-guard-3-8b" | "groq/llama3-70b-8192" | "groq/llama3-8b-8192" | "groq/mixtral-8x7b-32768" | "groq/qwen-qwq-32b" | "groq/qwen-2.5-32b" | "groq/deepseek-r1-distill-qwen-32b">, z.ZodTemplateLiteral<"cerebras/llama3.1-8b" | "cerebras/gpt-oss-120b" | "cerebras/qwen-3-235b-a22b-instruct-2507" | "cerebras/qwen-3-235b-a22b-thinking-2507" | "cerebras/zai-glm-4.6" | "cerebras/zai-glm-4.7">]>;
    }, z.core.$strict>, z.ZodObject<{
        apiKey: z.ZodOptional<z.ZodString>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        modelName: z.ZodString;
        baseURL: z.ZodURL;
    }, z.core.$strict>]>>;
    timeout: z.ZodOptional<z.ZodNumber>;
    selector: z.ZodOptional<z.ZodString>;
    ignoreSelectors: z.ZodOptional<z.ZodArray<z.ZodString>>;
    screenshot: z.ZodOptional<z.ZodBoolean>;
    locator: z.ZodOptional<z.ZodObject<{
        pageIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        title: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        active: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        targetId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        tabId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        frameId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        idx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        frameIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        xpath: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        css: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        reactElementName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        coordinates: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            x: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            y: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            top: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            left: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            bottom: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            right: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        }, z.core.$strict>>>;
        snapshotId: z.ZodOptional<z.ZodNullable<z.ZodUUID>>;
        elementId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    cache: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
        threshold: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>]>>;
    page: z.ZodOptional<z.ZodCustom<Page, Page>>;
}, z.core.$strict>;
export declare const StagehandClientInitParamsSchema: z.ZodObject<{
    apiKey: z.ZodOptional<z.ZodString>;
    telemetry: z.ZodDefault<z.ZodObject<{
        traces: z.ZodObject<{
            endpoint: z.ZodURL;
            headers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
    }, z.core.$strict>>;
    systemPrompt: z.ZodOptional<z.ZodString>;
    selfHeal: z.ZodOptional<z.ZodBoolean>;
    domSettleTimeoutMs: z.ZodOptional<z.ZodNumber>;
    cache: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
        threshold: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>]>>;
    browser: z.ZodDefault<z.ZodDiscriminatedUnion<[z.ZodObject<{
        userMetadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        keepAlive: z.ZodOptional<z.ZodBoolean>;
        proxies: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"browserbase">;
            domainPattern: z.ZodOptional<z.ZodString>;
            geolocation: z.ZodOptional<z.ZodObject<{
                country: z.ZodString;
                city: z.ZodOptional<z.ZodString>;
                state: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"external">;
            server: z.ZodString;
            domainPattern: z.ZodOptional<z.ZodString>;
            username: z.ZodOptional<z.ZodString>;
            password: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>], "type">>]>>;
        region: z.ZodOptional<z.ZodEnum<{
            "us-west-2": "us-west-2";
            "us-east-1": "us-east-1";
            "eu-central-1": "eu-central-1";
            "ap-southeast-1": "ap-southeast-1";
        }>>;
        timeout: z.ZodOptional<z.ZodNumber>;
        type: z.ZodLiteral<"browserbase">;
        browserSettings: z.ZodOptional<z.ZodObject<{
            advancedStealth: z.ZodOptional<z.ZodBoolean>;
            blockAds: z.ZodOptional<z.ZodBoolean>;
            captchaImageSelector: z.ZodOptional<z.ZodString>;
            captchaInputSelector: z.ZodOptional<z.ZodString>;
            context: z.ZodOptional<z.ZodObject<{
                id: z.ZodString;
                persist: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>;
            fingerprint: z.ZodOptional<z.ZodObject<{
                browsers: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    chrome: "chrome";
                    edge: "edge";
                    firefox: "firefox";
                    safari: "safari";
                }>>>;
                devices: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    desktop: "desktop";
                    mobile: "mobile";
                }>>>;
                httpVersion: z.ZodOptional<z.ZodEnum<{
                    1: "1";
                    2: "2";
                }>>;
                locales: z.ZodOptional<z.ZodArray<z.ZodString>>;
                operatingSystems: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    android: "android";
                    ios: "ios";
                    linux: "linux";
                    macos: "macos";
                    windows: "windows";
                }>>>;
                screen: z.ZodOptional<z.ZodObject<{
                    maxHeight: z.ZodOptional<z.ZodNumber>;
                    maxWidth: z.ZodOptional<z.ZodNumber>;
                    minHeight: z.ZodOptional<z.ZodNumber>;
                    minWidth: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            logSession: z.ZodOptional<z.ZodBoolean>;
            os: z.ZodOptional<z.ZodEnum<{
                mobile: "mobile";
                linux: "linux";
                windows: "windows";
                mac: "mac";
                tablet: "tablet";
            }>>;
            recordSession: z.ZodOptional<z.ZodBoolean>;
            solveCaptchas: z.ZodOptional<z.ZodBoolean>;
            verified: z.ZodOptional<z.ZodBoolean>;
            viewport: z.ZodOptional<z.ZodObject<{
                width: z.ZodOptional<z.ZodNumber>;
                height: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        args: z.ZodOptional<z.ZodArray<z.ZodString>>;
        executablePath: z.ZodOptional<z.ZodString>;
        port: z.ZodOptional<z.ZodNumber>;
        userDataDir: z.ZodOptional<z.ZodString>;
        preserveUserDataDir: z.ZodOptional<z.ZodBoolean>;
        headless: z.ZodOptional<z.ZodBoolean>;
        devtools: z.ZodOptional<z.ZodBoolean>;
        chromiumSandbox: z.ZodOptional<z.ZodBoolean>;
        ignoreDefaultArgs: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodArray<z.ZodString>]>>;
        proxy: z.ZodOptional<z.ZodObject<{
            server: z.ZodString;
            bypass: z.ZodOptional<z.ZodString>;
            username: z.ZodOptional<z.ZodString>;
            password: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        locale: z.ZodOptional<z.ZodString>;
        viewport: z.ZodOptional<z.ZodObject<{
            width: z.ZodNumber;
            height: z.ZodNumber;
        }, z.core.$strip>>;
        deviceScaleFactor: z.ZodOptional<z.ZodNumber>;
        hasTouch: z.ZodOptional<z.ZodBoolean>;
        ignoreHTTPSErrors: z.ZodOptional<z.ZodBoolean>;
        connectTimeoutMs: z.ZodOptional<z.ZodNumber>;
        downloadsPath: z.ZodOptional<z.ZodString>;
        acceptDownloads: z.ZodOptional<z.ZodBoolean>;
        keepAlive: z.ZodOptional<z.ZodBoolean>;
        type: z.ZodLiteral<"local">;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"cdp">;
        cdpUrl: z.ZodString;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strict>], "type">>;
    model: z.ZodOptional<z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodObject<{
        apiKey: z.ZodOptional<z.ZodString>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        modelName: z.ZodUnion<readonly [z.ZodTemplateLiteral<"openai/gpt-4.1" | "openai/gpt-4.1-2025-04-14" | "openai/gpt-4.1-mini" | "openai/gpt-4.1-mini-2025-04-14" | "openai/gpt-4.1-nano" | "openai/gpt-4.1-nano-2025-04-14" | "openai/gpt-4o" | "openai/gpt-4o-2024-05-13" | "openai/gpt-4o-2024-08-06" | "openai/gpt-4o-2024-11-20" | "openai/gpt-4o-audio-preview" | "openai/gpt-4o-audio-preview-2024-12-17" | "openai/gpt-4o-search-preview" | "openai/gpt-4o-search-preview-2025-03-11" | "openai/gpt-4o-mini-search-preview" | "openai/gpt-4o-mini-search-preview-2025-03-11" | "openai/gpt-4o-mini" | "openai/gpt-4o-mini-2024-07-18" | "openai/gpt-3.5-turbo-0125" | "openai/gpt-3.5-turbo" | "openai/gpt-3.5-turbo-1106" | "openai/gpt-5-chat-latest" | "openai/o1" | "openai/o1-2024-12-17" | "openai/o3" | "openai/o3-2025-04-16" | "openai/o3-mini" | "openai/o3-mini-2025-01-31" | "openai/o4-mini" | "openai/o4-mini-2025-04-16" | "openai/gpt-5" | "openai/gpt-5-2025-08-07" | "openai/gpt-5-codex" | "openai/gpt-5-mini" | "openai/gpt-5-mini-2025-08-07" | "openai/gpt-5-nano" | "openai/gpt-5-nano-2025-08-07" | "openai/gpt-5-pro" | "openai/gpt-5-pro-2025-10-06" | "openai/gpt-5.1" | "openai/gpt-5.1-chat-latest" | "openai/gpt-5.1-codex-mini" | "openai/gpt-5.1-codex" | "openai/gpt-5.1-codex-max" | "openai/gpt-5.2" | "openai/gpt-5.2-chat-latest" | "openai/gpt-5.2-pro" | "openai/gpt-5.2-codex" | "openai/gpt-5.3-chat-latest" | "openai/gpt-5.3-codex" | "openai/gpt-5.4" | "openai/gpt-5.4-2026-03-05" | "openai/gpt-5.4-mini" | "openai/gpt-5.4-mini-2026-03-17" | "openai/gpt-5.4-nano" | "openai/gpt-5.4-nano-2026-03-17" | "openai/gpt-5.4-pro" | "openai/gpt-5.4-pro-2026-03-05" | "openai/gpt-5.5" | "openai/gpt-5.5-2026-04-23" | "openai/gpt-5.6" | "openai/gpt-5.6-luna" | "openai/gpt-5.6-sol" | "openai/gpt-5.6-terra">, z.ZodTemplateLiteral<"anthropic/claude-3-haiku-20240307" | "anthropic/claude-haiku-4-5-20251001" | "anthropic/claude-haiku-4-5" | "anthropic/claude-opus-4-0" | "anthropic/claude-opus-4-20250514" | "anthropic/claude-opus-4-1-20250805" | "anthropic/claude-opus-4-1" | "anthropic/claude-opus-4-5" | "anthropic/claude-opus-4-5-20251101" | "anthropic/claude-sonnet-4-0" | "anthropic/claude-sonnet-4-20250514" | "anthropic/claude-sonnet-4-5-20250929" | "anthropic/claude-sonnet-4-5" | "anthropic/claude-sonnet-4-6" | "anthropic/claude-opus-4-6" | "anthropic/claude-opus-4-7" | "anthropic/claude-opus-4-8" | "anthropic/claude-fable-5" | "anthropic/claude-sonnet-5">, z.ZodTemplateLiteral<"google/gemini-2.0-flash" | "google/gemini-2.0-flash-001" | "google/gemini-2.0-flash-lite" | "google/gemini-2.0-flash-lite-001" | "google/gemini-2.5-pro" | "google/gemini-2.5-flash" | "google/gemini-2.5-flash-image" | "google/gemini-2.5-flash-lite" | "google/gemini-2.5-flash-preview-tts" | "google/gemini-2.5-pro-preview-tts" | "google/gemini-2.5-flash-native-audio-latest" | "google/gemini-2.5-flash-native-audio-preview-09-2025" | "google/gemini-2.5-flash-native-audio-preview-12-2025" | "google/gemini-2.5-computer-use-preview-10-2025" | "google/gemini-3-pro-preview" | "google/gemini-3-pro-image-preview" | "google/gemini-3-flash-preview" | "google/gemini-3.1-pro-preview" | "google/gemini-3.1-pro-preview-customtools" | "google/gemini-3.1-flash-image-preview" | "google/gemini-3.1-flash-lite-preview" | "google/gemini-3.1-flash-tts-preview" | "google/gemini-3.5-flash" | "google/gemini-pro-latest" | "google/gemini-flash-latest" | "google/gemini-flash-lite-latest" | "google/deep-research-pro-preview-12-2025" | "google/deep-research-max-preview-04-2026" | "google/deep-research-preview-04-2026" | "google/nano-banana-pro-preview" | "google/aqa" | "google/gemini-robotics-er-1.5-preview" | "google/gemma-3-1b-it" | "google/gemma-3-4b-it" | "google/gemma-3n-e4b-it" | "google/gemma-3n-e2b-it" | "google/gemma-3-12b-it" | "google/gemma-3-27b-it">, z.ZodTemplateLiteral<"groq/gemma2-9b-it" | "groq/llama-3.1-8b-instant" | "groq/llama-3.3-70b-versatile" | "groq/meta-llama/llama-guard-4-12b" | "groq/openai/gpt-oss-120b" | "groq/openai/gpt-oss-20b" | "groq/deepseek-r1-distill-llama-70b" | "groq/meta-llama/llama-4-maverick-17b-128e-instruct" | "groq/meta-llama/llama-4-scout-17b-16e-instruct" | "groq/meta-llama/llama-prompt-guard-2-22m" | "groq/meta-llama/llama-prompt-guard-2-86m" | "groq/moonshotai/kimi-k2-instruct-0905" | "groq/qwen/qwen3-32b" | "groq/llama-guard-3-8b" | "groq/llama3-70b-8192" | "groq/llama3-8b-8192" | "groq/mixtral-8x7b-32768" | "groq/qwen-qwq-32b" | "groq/qwen-2.5-32b" | "groq/deepseek-r1-distill-qwen-32b">, z.ZodTemplateLiteral<"cerebras/llama3.1-8b" | "cerebras/gpt-oss-120b" | "cerebras/qwen-3-235b-a22b-instruct-2507" | "cerebras/qwen-3-235b-a22b-thinking-2507" | "cerebras/zai-glm-4.6" | "cerebras/zai-glm-4.7">]>;
    }, z.core.$strict>, z.ZodObject<{
        apiKey: z.ZodOptional<z.ZodString>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        modelName: z.ZodString;
        baseURL: z.ZodURL;
    }, z.core.$strict>]>, z.ZodObject<{
        generate: z.ZodFunction<z.ZodTuple<readonly [z.ZodUnion<readonly [z.ZodObject<{
            messages: z.ZodArray<z.ZodObject<{
                role: z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>;
                content: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodBase64;
                    mimeType: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"tool_use">;
                    id: z.ZodString;
                    name: z.ZodString;
                    input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"tool_result">;
                    toolUseId: z.ZodString;
                    content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        type: z.ZodLiteral<"text">;
                        text: z.ZodString;
                        annotations: z.ZodOptional<z.ZodObject<{
                            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                                user: "user";
                                assistant: "assistant";
                            }>>>;
                            priority: z.ZodOptional<z.ZodNumber>;
                            lastModified: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>, z.ZodObject<{
                        type: z.ZodLiteral<"image">;
                        data: z.ZodBase64;
                        mimeType: z.ZodString;
                        annotations: z.ZodOptional<z.ZodObject<{
                            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                                user: "user";
                                assistant: "assistant";
                            }>>>;
                            priority: z.ZodOptional<z.ZodNumber>;
                            lastModified: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>], "type">>;
                    structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
                    isError: z.ZodOptional<z.ZodBoolean>;
                }, z.core.$strict>], "type">, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodBase64;
                    mimeType: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"tool_use">;
                    id: z.ZodString;
                    name: z.ZodString;
                    input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"tool_result">;
                    toolUseId: z.ZodString;
                    content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        type: z.ZodLiteral<"text">;
                        text: z.ZodString;
                        annotations: z.ZodOptional<z.ZodObject<{
                            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                                user: "user";
                                assistant: "assistant";
                            }>>>;
                            priority: z.ZodOptional<z.ZodNumber>;
                            lastModified: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>, z.ZodObject<{
                        type: z.ZodLiteral<"image">;
                        data: z.ZodBase64;
                        mimeType: z.ZodString;
                        annotations: z.ZodOptional<z.ZodObject<{
                            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                                user: "user";
                                assistant: "assistant";
                            }>>>;
                            priority: z.ZodOptional<z.ZodNumber>;
                            lastModified: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>], "type">>;
                    structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
                    isError: z.ZodOptional<z.ZodBoolean>;
                }, z.core.$strict>], "type">>]>;
            }, z.core.$strict>>;
            systemPrompt: z.ZodOptional<z.ZodString>;
            temperature: z.ZodOptional<z.ZodNumber>;
            stopSequences: z.ZodOptional<z.ZodArray<z.ZodString>>;
            responseFormat: z.ZodObject<{
                type: z.ZodLiteral<"json_schema">;
                name: z.ZodString;
                description: z.ZodOptional<z.ZodString>;
                schema: z.ZodJSONSchema;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            messages: z.ZodArray<z.ZodObject<{
                role: z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>;
                content: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodBase64;
                    mimeType: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"tool_use">;
                    id: z.ZodString;
                    name: z.ZodString;
                    input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"tool_result">;
                    toolUseId: z.ZodString;
                    content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        type: z.ZodLiteral<"text">;
                        text: z.ZodString;
                        annotations: z.ZodOptional<z.ZodObject<{
                            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                                user: "user";
                                assistant: "assistant";
                            }>>>;
                            priority: z.ZodOptional<z.ZodNumber>;
                            lastModified: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>, z.ZodObject<{
                        type: z.ZodLiteral<"image">;
                        data: z.ZodBase64;
                        mimeType: z.ZodString;
                        annotations: z.ZodOptional<z.ZodObject<{
                            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                                user: "user";
                                assistant: "assistant";
                            }>>>;
                            priority: z.ZodOptional<z.ZodNumber>;
                            lastModified: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>], "type">>;
                    structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
                    isError: z.ZodOptional<z.ZodBoolean>;
                }, z.core.$strict>], "type">, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodBase64;
                    mimeType: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"tool_use">;
                    id: z.ZodString;
                    name: z.ZodString;
                    input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"tool_result">;
                    toolUseId: z.ZodString;
                    content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        type: z.ZodLiteral<"text">;
                        text: z.ZodString;
                        annotations: z.ZodOptional<z.ZodObject<{
                            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                                user: "user";
                                assistant: "assistant";
                            }>>>;
                            priority: z.ZodOptional<z.ZodNumber>;
                            lastModified: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>, z.ZodObject<{
                        type: z.ZodLiteral<"image">;
                        data: z.ZodBase64;
                        mimeType: z.ZodString;
                        annotations: z.ZodOptional<z.ZodObject<{
                            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                                user: "user";
                                assistant: "assistant";
                            }>>>;
                            priority: z.ZodOptional<z.ZodNumber>;
                            lastModified: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>], "type">>;
                    structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
                    isError: z.ZodOptional<z.ZodBoolean>;
                }, z.core.$strict>], "type">>]>;
            }, z.core.$strict>>;
            systemPrompt: z.ZodOptional<z.ZodString>;
            temperature: z.ZodOptional<z.ZodNumber>;
            stopSequences: z.ZodOptional<z.ZodArray<z.ZodString>>;
            tools: z.ZodOptional<z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                title: z.ZodOptional<z.ZodString>;
                icons: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    src: z.ZodURL;
                    mimeType: z.ZodOptional<z.ZodString>;
                    sizes: z.ZodOptional<z.ZodArray<z.ZodString>>;
                    theme: z.ZodOptional<z.ZodEnum<{
                        light: "light";
                        dark: "dark";
                    }>>;
                }, z.core.$strict>>>;
                description: z.ZodOptional<z.ZodString>;
                inputSchema: z.ZodObject<{
                    $schema: z.ZodOptional<z.ZodString>;
                    type: z.ZodLiteral<"object">;
                    properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodJSONSchema>>>;
                    required: z.ZodOptional<z.ZodArray<z.ZodString>>;
                }, z.core.$strict>;
                execution: z.ZodOptional<z.ZodObject<{
                    taskSupport: z.ZodOptional<z.ZodEnum<{
                        optional: "optional";
                        required: "required";
                        forbidden: "forbidden";
                    }>>;
                }, z.core.$strict>>;
                outputSchema: z.ZodOptional<z.ZodObject<{
                    $schema: z.ZodOptional<z.ZodString>;
                    type: z.ZodLiteral<"object">;
                    properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodJSONSchema>>>;
                    required: z.ZodOptional<z.ZodArray<z.ZodString>>;
                }, z.core.$strict>>;
                annotations: z.ZodOptional<z.ZodObject<{
                    title: z.ZodOptional<z.ZodString>;
                    readOnlyHint: z.ZodOptional<z.ZodBoolean>;
                    destructiveHint: z.ZodOptional<z.ZodBoolean>;
                    idempotentHint: z.ZodOptional<z.ZodBoolean>;
                    openWorldHint: z.ZodOptional<z.ZodBoolean>;
                }, z.core.$strict>>;
            }, z.core.$strict>>>;
            toolChoice: z.ZodOptional<z.ZodObject<{
                mode: z.ZodOptional<z.ZodEnum<{
                    required: "required";
                    auto: "auto";
                    none: "none";
                }>>;
            }, z.core.$strict>>;
            responseFormat: z.ZodOptional<z.ZodObject<{
                type: z.ZodLiteral<"text">;
            }, z.core.$strict>>;
        }, z.core.$strict>]>], null>, z.ZodPromise<z.ZodDiscriminatedUnion<[z.ZodObject<{
            role: z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>;
            content: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodBase64;
                mimeType: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"tool_use">;
                id: z.ZodString;
                name: z.ZodString;
                input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"tool_result">;
                toolUseId: z.ZodString;
                content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodBase64;
                    mimeType: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>], "type">>;
                structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
                isError: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strict>], "type">, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodBase64;
                mimeType: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"tool_use">;
                id: z.ZodString;
                name: z.ZodString;
                input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"tool_result">;
                toolUseId: z.ZodString;
                content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodBase64;
                    mimeType: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>], "type">>;
                structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
                isError: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strict>], "type">>]>;
            stopReason: z.ZodOptional<z.ZodString>;
            usage: z.ZodOptional<z.ZodObject<{
                inputTokens: z.ZodNumber;
                outputTokens: z.ZodNumber;
                totalTokens: z.ZodNumber;
                reasoningTokens: z.ZodOptional<z.ZodNumber>;
                cachedInputTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>;
            outputFormat: z.ZodLiteral<"text">;
        }, z.core.$catchall<z.ZodJSONSchema>>, z.ZodObject<{
            role: z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>;
            content: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodBase64;
                mimeType: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"tool_use">;
                id: z.ZodString;
                name: z.ZodString;
                input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"tool_result">;
                toolUseId: z.ZodString;
                content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodBase64;
                    mimeType: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>], "type">>;
                structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
                isError: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strict>], "type">, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodBase64;
                mimeType: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"tool_use">;
                id: z.ZodString;
                name: z.ZodString;
                input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"tool_result">;
                toolUseId: z.ZodString;
                content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodBase64;
                    mimeType: z.ZodString;
                    annotations: z.ZodOptional<z.ZodObject<{
                        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                            user: "user";
                            assistant: "assistant";
                        }>>>;
                        priority: z.ZodOptional<z.ZodNumber>;
                        lastModified: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>], "type">>;
                structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
                isError: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strict>], "type">>]>;
            stopReason: z.ZodOptional<z.ZodString>;
            usage: z.ZodOptional<z.ZodObject<{
                inputTokens: z.ZodNumber;
                outputTokens: z.ZodNumber;
                totalTokens: z.ZodNumber;
                reasoningTokens: z.ZodOptional<z.ZodNumber>;
                cachedInputTokens: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>;
            outputFormat: z.ZodLiteral<"json_schema">;
            structuredContent: z.ZodJSONSchema;
        }, z.core.$catchall<z.ZodJSONSchema>>], "outputFormat">>>;
    }, z.core.$strict>]>>;
    onLog: z.ZodOptional<z.ZodFunction<z.ZodTuple<readonly [z.ZodObject<{
        level: z.ZodEnum<{
            error: "error";
            debug: "debug";
            info: "info";
            warn: "warn";
        }>;
        message: z.ZodString;
        data: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    }, z.core.$strict>], null>, z.ZodVoid>>;
}, z.core.$strict>;
export type ClientLLM = z.infer<typeof ClientLLMSchema>;
export type StagehandClientActOptions = z.input<typeof StagehandClientActOptionsSchema>;
export type StagehandClientObserveOptions = z.input<typeof StagehandClientObserveOptionsSchema>;
export type StagehandClientExtractOptions = z.input<typeof StagehandClientExtractOptionsSchema>;
export type BrowserSource = z.infer<typeof BrowserSourceSchema>;
export type StagehandClientInitParams = z.input<typeof StagehandClientInitParamsSchema>;
export type ResolvedStagehandClientInitParams = z.output<typeof StagehandClientInitParamsSchema>;
