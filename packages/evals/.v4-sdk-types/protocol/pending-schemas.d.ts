import { z } from "zod/v4";
export { ActOptionsSchema, ActResultDataSchema, ActResultSchema, ActionSchema, AzureEntraIdAuthSchema, AzureModelProviderOptionsSchema, AzureProviderOptionsSchema, BrowserbaseBrowserSettingsSchema, BrowserbaseContextSchema, BrowserbaseFingerprintSchema, BrowserbaseFingerprintScreenSchema, BrowserbaseProxyConfigSchema, BrowserbaseProxyGeolocationSchema, BrowserbaseRegionSchema, BrowserbaseSessionCreateParamsSchema, BrowserbaseViewportSchema, CustomModelConfigSchema, ExtractOptionsSchema, ExtractResultSchema, ExternalProxyConfigSchema, GoogleServiceAccountAuthSchema, GoogleServiceAccountCredentialsSchema, LocatorCoordinatesSchema, LocatorSchema, ModelConfigSchema, ModelNameSchema, ModelProviderSchema, KnownModelConfigSchema, ObserveOptionsSchema, ObserveResultSchema, PageLocatorSchema, ProxyConfigSchema, StagehandMetricsSchema, VariablePrimitiveSchema, VariableValueSchema, VariablesSchema, VertexModelProviderOptionsSchema, VertexProviderOptionsSchema, } from "./schemas.ts";
export declare const ApiKeyAuthSchema: z.ZodObject<{
    type: z.ZodLiteral<"apiKey">;
    apiKey: z.ZodString;
}, z.core.$strict>;
export declare const OpenAIClientOptionsSchema: z.ZodObject<{
    baseURL: z.ZodOptional<z.ZodString>;
    organization: z.ZodOptional<z.ZodString>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    auth: z.ZodObject<{
        type: z.ZodLiteral<"apiKey">;
        apiKey: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const AnthropicClientOptionsSchema: z.ZodObject<{
    baseURL: z.ZodOptional<z.ZodString>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    auth: z.ZodObject<{
        type: z.ZodLiteral<"apiKey">;
        apiKey: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const ThinkingEffortSchema: z.ZodEnum<{
    none: "none";
    low: "low";
    medium: "medium";
    high: "high";
    xhigh: "xhigh";
    max: "max";
}>;
export declare const V3FunctionNameSchema: z.ZodEnum<{
    ACT: "ACT";
    EXTRACT: "EXTRACT";
    OBSERVE: "OBSERVE";
}>;
export declare const ClipboardOptionsSchema: z.ZodObject<{
    locator: z.ZodOptional<z.ZodObject<{
        pageIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        title: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        active: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        targetId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        tabId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        frameId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
}, z.core.$strict>;
export declare const ClipboardPasteOptionsSchema: z.ZodObject<{
    locator: z.ZodOptional<z.ZodObject<{
        pageIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        title: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        active: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        targetId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        tabId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        frameId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    shortcut: z.ZodOptional<z.ZodEnum<{
        "ControlOrMeta+V": "ControlOrMeta+V";
        "Meta+V": "Meta+V";
        "Control+V": "Control+V";
    }>>;
}, z.core.$strict>;
export declare const defaultExtractSchema: z.ZodObject<{
    extraction: z.ZodString;
}, z.core.$strip>;
export declare const pageTextSchema: z.ZodObject<{
    pageText: z.ZodString;
}, z.core.$strip>;
export declare const HistoryEntrySchema: z.ZodObject<{
    method: z.ZodEnum<{
        act: "act";
        extract: "extract";
        observe: "observe";
        navigate: "navigate";
    }>;
    parameters: z.ZodUnknown;
    result: z.ZodUnknown;
    timestamp: z.ZodString;
}, z.core.$strict>;
/** Browser launch options for local browsers */
export declare const LocalBrowserLaunchOptionsSchema: z.ZodObject<{
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
}, z.core.$strict>;
export declare const ModelAuthSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"apiKey">;
    apiKey: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"googleServiceAccount">;
    credentials: z.ZodObject<{
        type: z.ZodOptional<z.ZodLiteral<"service_account">>;
        projectId: z.ZodOptional<z.ZodString>;
        privateKeyId: z.ZodOptional<z.ZodString>;
        privateKey: z.ZodString;
        clientEmail: z.ZodString;
        clientId: z.ZodOptional<z.ZodString>;
        authUri: z.ZodOptional<z.ZodURL>;
        tokenUri: z.ZodOptional<z.ZodURL>;
        authProviderX509CertUrl: z.ZodOptional<z.ZodURL>;
        clientX509CertUrl: z.ZodOptional<z.ZodURL>;
        universeDomain: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    scopes: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    projectId: z.ZodOptional<z.ZodString>;
    universeDomain: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"azureEntraId">;
    token: z.ZodString;
}, z.core.$strict>], "type">;
export declare const ModelProviderOptionsSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"vertex">;
    options: z.ZodObject<{
        project: z.ZodString;
        location: z.ZodString;
        baseURL: z.ZodOptional<z.ZodURL>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"azure">;
    options: z.ZodObject<{
        resourceName: z.ZodOptional<z.ZodString>;
        baseURL: z.ZodOptional<z.ZodURL>;
        apiVersion: z.ZodOptional<z.ZodString>;
        useDeploymentBasedUrls: z.ZodOptional<z.ZodBoolean>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strict>;
}, z.core.$strict>], "type">;
export declare const LLMToolSchema: z.ZodObject<{
    type: z.ZodNonOptional<z.ZodLiteral<"function">>;
    name: z.ZodNonOptional<z.ZodString>;
    description: z.ZodNonOptional<z.ZodString>;
    parameters: z.ZodNonOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export declare const ClientOptionsBaseSchema: z.ZodObject<{
    provider: z.ZodOptional<z.ZodEnum<{
        openai: "openai";
        anthropic: "anthropic";
        google: "google";
        groq: "groq";
        cerebras: "cerebras";
    }>>;
    auth: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"apiKey">;
        apiKey: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"googleServiceAccount">;
        credentials: z.ZodObject<{
            type: z.ZodOptional<z.ZodLiteral<"service_account">>;
            projectId: z.ZodOptional<z.ZodString>;
            privateKeyId: z.ZodOptional<z.ZodString>;
            privateKey: z.ZodString;
            clientEmail: z.ZodString;
            clientId: z.ZodOptional<z.ZodString>;
            authUri: z.ZodOptional<z.ZodURL>;
            tokenUri: z.ZodOptional<z.ZodURL>;
            authProviderX509CertUrl: z.ZodOptional<z.ZodURL>;
            clientX509CertUrl: z.ZodOptional<z.ZodURL>;
            universeDomain: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        scopes: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
        projectId: z.ZodOptional<z.ZodString>;
        universeDomain: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"azureEntraId">;
        token: z.ZodString;
    }, z.core.$strict>], "type">>;
    providerOptions: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"vertex">;
        options: z.ZodObject<{
            project: z.ZodString;
            location: z.ZodString;
            baseURL: z.ZodOptional<z.ZodURL>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"azure">;
        options: z.ZodObject<{
            resourceName: z.ZodOptional<z.ZodString>;
            baseURL: z.ZodOptional<z.ZodURL>;
            apiVersion: z.ZodOptional<z.ZodString>;
            useDeploymentBasedUrls: z.ZodOptional<z.ZodBoolean>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
    }, z.core.$strict>], "type">>;
    baseURL: z.ZodOptional<z.ZodString>;
    organization: z.ZodOptional<z.ZodString>;
    thinkingBudget: z.ZodOptional<z.ZodNumber>;
    thinkingEffort: z.ZodOptional<z.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        max: "max";
    }>>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    reasoningEffort: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const ClientOptionsSchema: z.ZodDefault<z.ZodObject<{
    provider: z.ZodOptional<z.ZodEnum<{
        openai: "openai";
        anthropic: "anthropic";
        google: "google";
        groq: "groq";
        cerebras: "cerebras";
    }>>;
    auth: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"apiKey">;
        apiKey: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"googleServiceAccount">;
        credentials: z.ZodObject<{
            type: z.ZodOptional<z.ZodLiteral<"service_account">>;
            projectId: z.ZodOptional<z.ZodString>;
            privateKeyId: z.ZodOptional<z.ZodString>;
            privateKey: z.ZodString;
            clientEmail: z.ZodString;
            clientId: z.ZodOptional<z.ZodString>;
            authUri: z.ZodOptional<z.ZodURL>;
            tokenUri: z.ZodOptional<z.ZodURL>;
            authProviderX509CertUrl: z.ZodOptional<z.ZodURL>;
            clientX509CertUrl: z.ZodOptional<z.ZodURL>;
            universeDomain: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        scopes: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
        projectId: z.ZodOptional<z.ZodString>;
        universeDomain: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"azureEntraId">;
        token: z.ZodString;
    }, z.core.$strict>], "type">>;
    providerOptions: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"vertex">;
        options: z.ZodObject<{
            project: z.ZodString;
            location: z.ZodString;
            baseURL: z.ZodOptional<z.ZodURL>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"azure">;
        options: z.ZodObject<{
            resourceName: z.ZodOptional<z.ZodString>;
            baseURL: z.ZodOptional<z.ZodURL>;
            apiVersion: z.ZodOptional<z.ZodString>;
            useDeploymentBasedUrls: z.ZodOptional<z.ZodBoolean>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
    }, z.core.$strict>], "type">>;
    baseURL: z.ZodOptional<z.ZodString>;
    organization: z.ZodOptional<z.ZodString>;
    thinkingBudget: z.ZodOptional<z.ZodNumber>;
    thinkingEffort: z.ZodOptional<z.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        max: "max";
    }>>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    reasoningEffort: z.ZodOptional<z.ZodString>;
}, z.core.$strict>>;
export declare const ApiKeyClientOptionsSchema: z.ZodObject<{
    provider: z.ZodOptional<z.ZodEnum<{
        openai: "openai";
        anthropic: "anthropic";
        google: "google";
        groq: "groq";
        cerebras: "cerebras";
    }>>;
    providerOptions: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"vertex">;
        options: z.ZodObject<{
            project: z.ZodString;
            location: z.ZodString;
            baseURL: z.ZodOptional<z.ZodURL>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"azure">;
        options: z.ZodObject<{
            resourceName: z.ZodOptional<z.ZodString>;
            baseURL: z.ZodOptional<z.ZodURL>;
            apiVersion: z.ZodOptional<z.ZodString>;
            useDeploymentBasedUrls: z.ZodOptional<z.ZodBoolean>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
    }, z.core.$strict>], "type">>;
    baseURL: z.ZodOptional<z.ZodString>;
    organization: z.ZodOptional<z.ZodString>;
    thinkingBudget: z.ZodOptional<z.ZodNumber>;
    thinkingEffort: z.ZodOptional<z.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        max: "max";
    }>>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    reasoningEffort: z.ZodOptional<z.ZodString>;
    auth: z.ZodObject<{
        type: z.ZodLiteral<"apiKey">;
        apiKey: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const VertexClientOptionsSchema: z.ZodObject<{
    provider: z.ZodOptional<z.ZodEnum<{
        openai: "openai";
        anthropic: "anthropic";
        google: "google";
        groq: "groq";
        cerebras: "cerebras";
    }>>;
    baseURL: z.ZodOptional<z.ZodString>;
    organization: z.ZodOptional<z.ZodString>;
    thinkingBudget: z.ZodOptional<z.ZodNumber>;
    thinkingEffort: z.ZodOptional<z.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        max: "max";
    }>>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    reasoningEffort: z.ZodOptional<z.ZodString>;
    auth: z.ZodObject<{
        type: z.ZodLiteral<"googleServiceAccount">;
        credentials: z.ZodObject<{
            type: z.ZodOptional<z.ZodLiteral<"service_account">>;
            projectId: z.ZodOptional<z.ZodString>;
            privateKeyId: z.ZodOptional<z.ZodString>;
            privateKey: z.ZodString;
            clientEmail: z.ZodString;
            clientId: z.ZodOptional<z.ZodString>;
            authUri: z.ZodOptional<z.ZodURL>;
            tokenUri: z.ZodOptional<z.ZodURL>;
            authProviderX509CertUrl: z.ZodOptional<z.ZodURL>;
            clientX509CertUrl: z.ZodOptional<z.ZodURL>;
            universeDomain: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        scopes: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
        projectId: z.ZodOptional<z.ZodString>;
        universeDomain: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    providerOptions: z.ZodObject<{
        type: z.ZodLiteral<"vertex">;
        options: z.ZodObject<{
            project: z.ZodString;
            location: z.ZodString;
            baseURL: z.ZodOptional<z.ZodURL>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const AzureApiKeyClientOptionsSchema: z.ZodObject<{
    provider: z.ZodOptional<z.ZodEnum<{
        openai: "openai";
        anthropic: "anthropic";
        google: "google";
        groq: "groq";
        cerebras: "cerebras";
    }>>;
    baseURL: z.ZodOptional<z.ZodString>;
    organization: z.ZodOptional<z.ZodString>;
    thinkingBudget: z.ZodOptional<z.ZodNumber>;
    thinkingEffort: z.ZodOptional<z.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        max: "max";
    }>>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    reasoningEffort: z.ZodOptional<z.ZodString>;
    auth: z.ZodObject<{
        type: z.ZodLiteral<"apiKey">;
        apiKey: z.ZodString;
    }, z.core.$strict>;
    providerOptions: z.ZodObject<{
        type: z.ZodLiteral<"azure">;
        options: z.ZodObject<{
            resourceName: z.ZodOptional<z.ZodString>;
            baseURL: z.ZodOptional<z.ZodURL>;
            apiVersion: z.ZodOptional<z.ZodString>;
            useDeploymentBasedUrls: z.ZodOptional<z.ZodBoolean>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const AzureEntraClientOptionsSchema: z.ZodObject<{
    provider: z.ZodOptional<z.ZodEnum<{
        openai: "openai";
        anthropic: "anthropic";
        google: "google";
        groq: "groq";
        cerebras: "cerebras";
    }>>;
    baseURL: z.ZodOptional<z.ZodString>;
    organization: z.ZodOptional<z.ZodString>;
    thinkingBudget: z.ZodOptional<z.ZodNumber>;
    thinkingEffort: z.ZodOptional<z.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        max: "max";
    }>>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    reasoningEffort: z.ZodOptional<z.ZodString>;
    auth: z.ZodObject<{
        type: z.ZodLiteral<"azureEntraId">;
        token: z.ZodString;
    }, z.core.$strict>;
    providerOptions: z.ZodObject<{
        type: z.ZodLiteral<"azure">;
        options: z.ZodObject<{
            resourceName: z.ZodOptional<z.ZodString>;
            baseURL: z.ZodOptional<z.ZodURL>;
            apiVersion: z.ZodOptional<z.ZodString>;
            useDeploymentBasedUrls: z.ZodOptional<z.ZodBoolean>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const AISDKApiKeyProviderSchema: z.ZodEnum<{
    openai: "openai";
    anthropic: "anthropic";
    google: "google";
    groq: "groq";
    cerebras: "cerebras";
}>;
export declare const ApiKeyResolvedProviderClientOptionsSchema: z.ZodObject<{
    provider: z.ZodEnum<{
        openai: "openai";
        anthropic: "anthropic";
        google: "google";
        groq: "groq";
        cerebras: "cerebras";
    }>;
    clientOptions: z.ZodObject<{
        provider: z.ZodOptional<z.ZodEnum<{
            openai: "openai";
            anthropic: "anthropic";
            google: "google";
            groq: "groq";
            cerebras: "cerebras";
        }>>;
        providerOptions: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"vertex">;
            options: z.ZodObject<{
                project: z.ZodString;
                location: z.ZodString;
                baseURL: z.ZodOptional<z.ZodURL>;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"azure">;
            options: z.ZodObject<{
                resourceName: z.ZodOptional<z.ZodString>;
                baseURL: z.ZodOptional<z.ZodURL>;
                apiVersion: z.ZodOptional<z.ZodString>;
                useDeploymentBasedUrls: z.ZodOptional<z.ZodBoolean>;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>;
        }, z.core.$strict>], "type">>;
        baseURL: z.ZodOptional<z.ZodString>;
        organization: z.ZodOptional<z.ZodString>;
        thinkingBudget: z.ZodOptional<z.ZodNumber>;
        thinkingEffort: z.ZodOptional<z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            max: "max";
        }>>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        reasoningEffort: z.ZodOptional<z.ZodString>;
        auth: z.ZodObject<{
            type: z.ZodLiteral<"apiKey">;
            apiKey: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const AzureResolvedProviderClientOptionsSchema: z.ZodObject<{
    provider: z.ZodLiteral<"azure">;
    clientOptions: z.ZodUnion<readonly [z.ZodObject<{
        provider: z.ZodOptional<z.ZodEnum<{
            openai: "openai";
            anthropic: "anthropic";
            google: "google";
            groq: "groq";
            cerebras: "cerebras";
        }>>;
        baseURL: z.ZodOptional<z.ZodString>;
        organization: z.ZodOptional<z.ZodString>;
        thinkingBudget: z.ZodOptional<z.ZodNumber>;
        thinkingEffort: z.ZodOptional<z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            max: "max";
        }>>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        reasoningEffort: z.ZodOptional<z.ZodString>;
        auth: z.ZodObject<{
            type: z.ZodLiteral<"apiKey">;
            apiKey: z.ZodString;
        }, z.core.$strict>;
        providerOptions: z.ZodObject<{
            type: z.ZodLiteral<"azure">;
            options: z.ZodObject<{
                resourceName: z.ZodOptional<z.ZodString>;
                baseURL: z.ZodOptional<z.ZodURL>;
                apiVersion: z.ZodOptional<z.ZodString>;
                useDeploymentBasedUrls: z.ZodOptional<z.ZodBoolean>;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        provider: z.ZodOptional<z.ZodEnum<{
            openai: "openai";
            anthropic: "anthropic";
            google: "google";
            groq: "groq";
            cerebras: "cerebras";
        }>>;
        baseURL: z.ZodOptional<z.ZodString>;
        organization: z.ZodOptional<z.ZodString>;
        thinkingBudget: z.ZodOptional<z.ZodNumber>;
        thinkingEffort: z.ZodOptional<z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            max: "max";
        }>>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        reasoningEffort: z.ZodOptional<z.ZodString>;
        auth: z.ZodObject<{
            type: z.ZodLiteral<"azureEntraId">;
            token: z.ZodString;
        }, z.core.$strict>;
        providerOptions: z.ZodObject<{
            type: z.ZodLiteral<"azure">;
            options: z.ZodObject<{
                resourceName: z.ZodOptional<z.ZodString>;
                baseURL: z.ZodOptional<z.ZodURL>;
                apiVersion: z.ZodOptional<z.ZodString>;
                useDeploymentBasedUrls: z.ZodOptional<z.ZodBoolean>;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>;
        }, z.core.$strict>;
    }, z.core.$strict>]>;
}, z.core.$strict>;
export declare const VertexResolvedProviderClientOptionsSchema: z.ZodObject<{
    provider: z.ZodLiteral<"vertex">;
    clientOptions: z.ZodObject<{
        provider: z.ZodOptional<z.ZodEnum<{
            openai: "openai";
            anthropic: "anthropic";
            google: "google";
            groq: "groq";
            cerebras: "cerebras";
        }>>;
        baseURL: z.ZodOptional<z.ZodString>;
        organization: z.ZodOptional<z.ZodString>;
        thinkingBudget: z.ZodOptional<z.ZodNumber>;
        thinkingEffort: z.ZodOptional<z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            max: "max";
        }>>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        reasoningEffort: z.ZodOptional<z.ZodString>;
        auth: z.ZodObject<{
            type: z.ZodLiteral<"googleServiceAccount">;
            credentials: z.ZodObject<{
                type: z.ZodOptional<z.ZodLiteral<"service_account">>;
                projectId: z.ZodOptional<z.ZodString>;
                privateKeyId: z.ZodOptional<z.ZodString>;
                privateKey: z.ZodString;
                clientEmail: z.ZodString;
                clientId: z.ZodOptional<z.ZodString>;
                authUri: z.ZodOptional<z.ZodURL>;
                tokenUri: z.ZodOptional<z.ZodURL>;
                authProviderX509CertUrl: z.ZodOptional<z.ZodURL>;
                clientX509CertUrl: z.ZodOptional<z.ZodURL>;
                universeDomain: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>;
            scopes: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
            projectId: z.ZodOptional<z.ZodString>;
            universeDomain: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        providerOptions: z.ZodObject<{
            type: z.ZodLiteral<"vertex">;
            options: z.ZodObject<{
                project: z.ZodString;
                location: z.ZodString;
                baseURL: z.ZodOptional<z.ZodURL>;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>;
        }, z.core.$strict>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const OllamaResolvedProviderClientOptionsSchema: z.ZodObject<{
    provider: z.ZodLiteral<"ollama">;
    clientOptions: z.ZodObject<{
        provider: z.ZodOptional<z.ZodEnum<{
            openai: "openai";
            anthropic: "anthropic";
            google: "google";
            groq: "groq";
            cerebras: "cerebras";
        }>>;
        auth: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"apiKey">;
            apiKey: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"googleServiceAccount">;
            credentials: z.ZodObject<{
                type: z.ZodOptional<z.ZodLiteral<"service_account">>;
                projectId: z.ZodOptional<z.ZodString>;
                privateKeyId: z.ZodOptional<z.ZodString>;
                privateKey: z.ZodString;
                clientEmail: z.ZodString;
                clientId: z.ZodOptional<z.ZodString>;
                authUri: z.ZodOptional<z.ZodURL>;
                tokenUri: z.ZodOptional<z.ZodURL>;
                authProviderX509CertUrl: z.ZodOptional<z.ZodURL>;
                clientX509CertUrl: z.ZodOptional<z.ZodURL>;
                universeDomain: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>;
            scopes: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
            projectId: z.ZodOptional<z.ZodString>;
            universeDomain: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"azureEntraId">;
            token: z.ZodString;
        }, z.core.$strict>], "type">>;
        providerOptions: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"vertex">;
            options: z.ZodObject<{
                project: z.ZodString;
                location: z.ZodString;
                baseURL: z.ZodOptional<z.ZodURL>;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"azure">;
            options: z.ZodObject<{
                resourceName: z.ZodOptional<z.ZodString>;
                baseURL: z.ZodOptional<z.ZodURL>;
                apiVersion: z.ZodOptional<z.ZodString>;
                useDeploymentBasedUrls: z.ZodOptional<z.ZodBoolean>;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>;
        }, z.core.$strict>], "type">>;
        baseURL: z.ZodOptional<z.ZodString>;
        organization: z.ZodOptional<z.ZodString>;
        thinkingBudget: z.ZodOptional<z.ZodNumber>;
        thinkingEffort: z.ZodOptional<z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            max: "max";
        }>>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        reasoningEffort: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const ResolvedProviderClientOptionsSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    provider: z.ZodEnum<{
        openai: "openai";
        anthropic: "anthropic";
        google: "google";
        groq: "groq";
        cerebras: "cerebras";
    }>;
    clientOptions: z.ZodObject<{
        provider: z.ZodOptional<z.ZodEnum<{
            openai: "openai";
            anthropic: "anthropic";
            google: "google";
            groq: "groq";
            cerebras: "cerebras";
        }>>;
        providerOptions: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"vertex">;
            options: z.ZodObject<{
                project: z.ZodString;
                location: z.ZodString;
                baseURL: z.ZodOptional<z.ZodURL>;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"azure">;
            options: z.ZodObject<{
                resourceName: z.ZodOptional<z.ZodString>;
                baseURL: z.ZodOptional<z.ZodURL>;
                apiVersion: z.ZodOptional<z.ZodString>;
                useDeploymentBasedUrls: z.ZodOptional<z.ZodBoolean>;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>;
        }, z.core.$strict>], "type">>;
        baseURL: z.ZodOptional<z.ZodString>;
        organization: z.ZodOptional<z.ZodString>;
        thinkingBudget: z.ZodOptional<z.ZodNumber>;
        thinkingEffort: z.ZodOptional<z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            max: "max";
        }>>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        reasoningEffort: z.ZodOptional<z.ZodString>;
        auth: z.ZodObject<{
            type: z.ZodLiteral<"apiKey">;
            apiKey: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    provider: z.ZodLiteral<"azure">;
    clientOptions: z.ZodUnion<readonly [z.ZodObject<{
        provider: z.ZodOptional<z.ZodEnum<{
            openai: "openai";
            anthropic: "anthropic";
            google: "google";
            groq: "groq";
            cerebras: "cerebras";
        }>>;
        baseURL: z.ZodOptional<z.ZodString>;
        organization: z.ZodOptional<z.ZodString>;
        thinkingBudget: z.ZodOptional<z.ZodNumber>;
        thinkingEffort: z.ZodOptional<z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            max: "max";
        }>>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        reasoningEffort: z.ZodOptional<z.ZodString>;
        auth: z.ZodObject<{
            type: z.ZodLiteral<"apiKey">;
            apiKey: z.ZodString;
        }, z.core.$strict>;
        providerOptions: z.ZodObject<{
            type: z.ZodLiteral<"azure">;
            options: z.ZodObject<{
                resourceName: z.ZodOptional<z.ZodString>;
                baseURL: z.ZodOptional<z.ZodURL>;
                apiVersion: z.ZodOptional<z.ZodString>;
                useDeploymentBasedUrls: z.ZodOptional<z.ZodBoolean>;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        provider: z.ZodOptional<z.ZodEnum<{
            openai: "openai";
            anthropic: "anthropic";
            google: "google";
            groq: "groq";
            cerebras: "cerebras";
        }>>;
        baseURL: z.ZodOptional<z.ZodString>;
        organization: z.ZodOptional<z.ZodString>;
        thinkingBudget: z.ZodOptional<z.ZodNumber>;
        thinkingEffort: z.ZodOptional<z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            max: "max";
        }>>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        reasoningEffort: z.ZodOptional<z.ZodString>;
        auth: z.ZodObject<{
            type: z.ZodLiteral<"azureEntraId">;
            token: z.ZodString;
        }, z.core.$strict>;
        providerOptions: z.ZodObject<{
            type: z.ZodLiteral<"azure">;
            options: z.ZodObject<{
                resourceName: z.ZodOptional<z.ZodString>;
                baseURL: z.ZodOptional<z.ZodURL>;
                apiVersion: z.ZodOptional<z.ZodString>;
                useDeploymentBasedUrls: z.ZodOptional<z.ZodBoolean>;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>;
        }, z.core.$strict>;
    }, z.core.$strict>]>;
}, z.core.$strict>, z.ZodObject<{
    provider: z.ZodLiteral<"vertex">;
    clientOptions: z.ZodObject<{
        provider: z.ZodOptional<z.ZodEnum<{
            openai: "openai";
            anthropic: "anthropic";
            google: "google";
            groq: "groq";
            cerebras: "cerebras";
        }>>;
        baseURL: z.ZodOptional<z.ZodString>;
        organization: z.ZodOptional<z.ZodString>;
        thinkingBudget: z.ZodOptional<z.ZodNumber>;
        thinkingEffort: z.ZodOptional<z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            max: "max";
        }>>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        reasoningEffort: z.ZodOptional<z.ZodString>;
        auth: z.ZodObject<{
            type: z.ZodLiteral<"googleServiceAccount">;
            credentials: z.ZodObject<{
                type: z.ZodOptional<z.ZodLiteral<"service_account">>;
                projectId: z.ZodOptional<z.ZodString>;
                privateKeyId: z.ZodOptional<z.ZodString>;
                privateKey: z.ZodString;
                clientEmail: z.ZodString;
                clientId: z.ZodOptional<z.ZodString>;
                authUri: z.ZodOptional<z.ZodURL>;
                tokenUri: z.ZodOptional<z.ZodURL>;
                authProviderX509CertUrl: z.ZodOptional<z.ZodURL>;
                clientX509CertUrl: z.ZodOptional<z.ZodURL>;
                universeDomain: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>;
            scopes: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
            projectId: z.ZodOptional<z.ZodString>;
            universeDomain: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        providerOptions: z.ZodObject<{
            type: z.ZodLiteral<"vertex">;
            options: z.ZodObject<{
                project: z.ZodString;
                location: z.ZodString;
                baseURL: z.ZodOptional<z.ZodURL>;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>;
        }, z.core.$strict>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    provider: z.ZodLiteral<"ollama">;
    clientOptions: z.ZodObject<{
        provider: z.ZodOptional<z.ZodEnum<{
            openai: "openai";
            anthropic: "anthropic";
            google: "google";
            groq: "groq";
            cerebras: "cerebras";
        }>>;
        auth: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"apiKey">;
            apiKey: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"googleServiceAccount">;
            credentials: z.ZodObject<{
                type: z.ZodOptional<z.ZodLiteral<"service_account">>;
                projectId: z.ZodOptional<z.ZodString>;
                privateKeyId: z.ZodOptional<z.ZodString>;
                privateKey: z.ZodString;
                clientEmail: z.ZodString;
                clientId: z.ZodOptional<z.ZodString>;
                authUri: z.ZodOptional<z.ZodURL>;
                tokenUri: z.ZodOptional<z.ZodURL>;
                authProviderX509CertUrl: z.ZodOptional<z.ZodURL>;
                clientX509CertUrl: z.ZodOptional<z.ZodURL>;
                universeDomain: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>;
            scopes: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
            projectId: z.ZodOptional<z.ZodString>;
            universeDomain: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"azureEntraId">;
            token: z.ZodString;
        }, z.core.$strict>], "type">>;
        providerOptions: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"vertex">;
            options: z.ZodObject<{
                project: z.ZodString;
                location: z.ZodString;
                baseURL: z.ZodOptional<z.ZodURL>;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"azure">;
            options: z.ZodObject<{
                resourceName: z.ZodOptional<z.ZodString>;
                baseURL: z.ZodOptional<z.ZodURL>;
                apiVersion: z.ZodOptional<z.ZodString>;
                useDeploymentBasedUrls: z.ZodOptional<z.ZodBoolean>;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>;
        }, z.core.$strict>], "type">>;
        baseURL: z.ZodOptional<z.ZodString>;
        organization: z.ZodOptional<z.ZodString>;
        thinkingBudget: z.ZodOptional<z.ZodNumber>;
        thinkingEffort: z.ZodOptional<z.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            max: "max";
        }>>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        reasoningEffort: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>], "provider">;
/** Session ID path parameter */
export declare const SessionIdParamsSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strict>;
/** Browser configuration for session start */
export declare const BrowserConfigSchema: z.ZodObject<{
    type: z.ZodOptional<z.ZodEnum<{
        browserbase: "browserbase";
        local: "local";
    }>>;
    cdpUrl: z.ZodOptional<z.ZodString>;
    launchOptions: z.ZodOptional<z.ZodObject<{
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
    }, z.core.$strict>>;
}, z.core.$strip>;
/** Operational headers for all session requests (auth handled via security schemes) */
export declare const SessionHeadersSchema: z.ZodObject<{
    "x-stream-response": z.ZodOptional<z.ZodEnum<{
        true: "true";
        false: "false";
    }>>;
}, z.core.$strip>;
/** Standard error response */
export declare const ErrorResponseSchema: z.ZodObject<{
    success: z.ZodLiteral<false>;
    error: z.ZodString;
    code: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const SessionStartRequestSchema: z.ZodObject<{
    modelName: z.ZodUnion<readonly [z.ZodTemplateLiteral<"openai/gpt-4.1" | "openai/gpt-4.1-2025-04-14" | "openai/gpt-4.1-mini" | "openai/gpt-4.1-mini-2025-04-14" | "openai/gpt-4.1-nano" | "openai/gpt-4.1-nano-2025-04-14" | "openai/gpt-4o" | "openai/gpt-4o-2024-05-13" | "openai/gpt-4o-2024-08-06" | "openai/gpt-4o-2024-11-20" | "openai/gpt-4o-audio-preview" | "openai/gpt-4o-audio-preview-2024-12-17" | "openai/gpt-4o-search-preview" | "openai/gpt-4o-search-preview-2025-03-11" | "openai/gpt-4o-mini-search-preview" | "openai/gpt-4o-mini-search-preview-2025-03-11" | "openai/gpt-4o-mini" | "openai/gpt-4o-mini-2024-07-18" | "openai/gpt-3.5-turbo-0125" | "openai/gpt-3.5-turbo" | "openai/gpt-3.5-turbo-1106" | "openai/gpt-5-chat-latest" | "openai/o1" | "openai/o1-2024-12-17" | "openai/o3" | "openai/o3-2025-04-16" | "openai/o3-mini" | "openai/o3-mini-2025-01-31" | "openai/o4-mini" | "openai/o4-mini-2025-04-16" | "openai/gpt-5" | "openai/gpt-5-2025-08-07" | "openai/gpt-5-codex" | "openai/gpt-5-mini" | "openai/gpt-5-mini-2025-08-07" | "openai/gpt-5-nano" | "openai/gpt-5-nano-2025-08-07" | "openai/gpt-5-pro" | "openai/gpt-5-pro-2025-10-06" | "openai/gpt-5.1" | "openai/gpt-5.1-chat-latest" | "openai/gpt-5.1-codex-mini" | "openai/gpt-5.1-codex" | "openai/gpt-5.1-codex-max" | "openai/gpt-5.2" | "openai/gpt-5.2-chat-latest" | "openai/gpt-5.2-pro" | "openai/gpt-5.2-codex" | "openai/gpt-5.3-chat-latest" | "openai/gpt-5.3-codex" | "openai/gpt-5.4" | "openai/gpt-5.4-2026-03-05" | "openai/gpt-5.4-mini" | "openai/gpt-5.4-mini-2026-03-17" | "openai/gpt-5.4-nano" | "openai/gpt-5.4-nano-2026-03-17" | "openai/gpt-5.4-pro" | "openai/gpt-5.4-pro-2026-03-05" | "openai/gpt-5.5" | "openai/gpt-5.5-2026-04-23" | "openai/gpt-5.6" | "openai/gpt-5.6-luna" | "openai/gpt-5.6-sol" | "openai/gpt-5.6-terra">, z.ZodTemplateLiteral<"anthropic/claude-3-haiku-20240307" | "anthropic/claude-haiku-4-5-20251001" | "anthropic/claude-haiku-4-5" | "anthropic/claude-opus-4-0" | "anthropic/claude-opus-4-20250514" | "anthropic/claude-opus-4-1-20250805" | "anthropic/claude-opus-4-1" | "anthropic/claude-opus-4-5" | "anthropic/claude-opus-4-5-20251101" | "anthropic/claude-sonnet-4-0" | "anthropic/claude-sonnet-4-20250514" | "anthropic/claude-sonnet-4-5-20250929" | "anthropic/claude-sonnet-4-5" | "anthropic/claude-sonnet-4-6" | "anthropic/claude-opus-4-6" | "anthropic/claude-opus-4-7" | "anthropic/claude-opus-4-8" | "anthropic/claude-fable-5" | "anthropic/claude-sonnet-5">, z.ZodTemplateLiteral<"google/gemini-2.0-flash" | "google/gemini-2.0-flash-001" | "google/gemini-2.0-flash-lite" | "google/gemini-2.0-flash-lite-001" | "google/gemini-2.5-pro" | "google/gemini-2.5-flash" | "google/gemini-2.5-flash-image" | "google/gemini-2.5-flash-lite" | "google/gemini-2.5-flash-preview-tts" | "google/gemini-2.5-pro-preview-tts" | "google/gemini-2.5-flash-native-audio-latest" | "google/gemini-2.5-flash-native-audio-preview-09-2025" | "google/gemini-2.5-flash-native-audio-preview-12-2025" | "google/gemini-2.5-computer-use-preview-10-2025" | "google/gemini-3-pro-preview" | "google/gemini-3-pro-image-preview" | "google/gemini-3-flash-preview" | "google/gemini-3.1-pro-preview" | "google/gemini-3.1-pro-preview-customtools" | "google/gemini-3.1-flash-image-preview" | "google/gemini-3.1-flash-lite-preview" | "google/gemini-3.1-flash-tts-preview" | "google/gemini-3.5-flash" | "google/gemini-pro-latest" | "google/gemini-flash-latest" | "google/gemini-flash-lite-latest" | "google/deep-research-pro-preview-12-2025" | "google/deep-research-max-preview-04-2026" | "google/deep-research-preview-04-2026" | "google/nano-banana-pro-preview" | "google/aqa" | "google/gemini-robotics-er-1.5-preview" | "google/gemma-3-1b-it" | "google/gemma-3-4b-it" | "google/gemma-3n-e4b-it" | "google/gemma-3n-e2b-it" | "google/gemma-3-12b-it" | "google/gemma-3-27b-it">, z.ZodTemplateLiteral<"groq/gemma2-9b-it" | "groq/llama-3.1-8b-instant" | "groq/llama-3.3-70b-versatile" | "groq/meta-llama/llama-guard-4-12b" | "groq/openai/gpt-oss-120b" | "groq/openai/gpt-oss-20b" | "groq/deepseek-r1-distill-llama-70b" | "groq/meta-llama/llama-4-maverick-17b-128e-instruct" | "groq/meta-llama/llama-4-scout-17b-16e-instruct" | "groq/meta-llama/llama-prompt-guard-2-22m" | "groq/meta-llama/llama-prompt-guard-2-86m" | "groq/moonshotai/kimi-k2-instruct-0905" | "groq/qwen/qwen3-32b" | "groq/llama-guard-3-8b" | "groq/llama3-70b-8192" | "groq/llama3-8b-8192" | "groq/mixtral-8x7b-32768" | "groq/qwen-qwq-32b" | "groq/qwen-2.5-32b" | "groq/deepseek-r1-distill-qwen-32b">, z.ZodTemplateLiteral<"cerebras/llama3.1-8b" | "cerebras/gpt-oss-120b" | "cerebras/qwen-3-235b-a22b-instruct-2507" | "cerebras/qwen-3-235b-a22b-thinking-2507" | "cerebras/zai-glm-4.6" | "cerebras/zai-glm-4.7">]>;
    domSettleTimeoutMs: z.ZodOptional<z.ZodNumber>;
    verbose: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>, z.ZodLiteral<2>]>>;
    systemPrompt: z.ZodOptional<z.ZodString>;
    browserbaseSessionCreateParams: z.ZodOptional<z.ZodObject<{
        browserSettings: z.ZodOptional<z.ZodObject<{
            advancedStealth: z.ZodOptional<z.ZodBoolean>;
            blockAds: z.ZodOptional<z.ZodBoolean>;
            captchaImageSelector: z.ZodOptional<z.ZodString>;
            captchaInputSelector: z.ZodOptional<z.ZodString>;
            context: z.ZodOptional<z.ZodObject<{
                id: z.ZodString;
                persist: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>;
            extensionId: z.ZodOptional<z.ZodString>;
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
        }, z.core.$strip>>;
        extensionId: z.ZodOptional<z.ZodString>;
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
        userMetadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strict>>;
    browser: z.ZodOptional<z.ZodObject<{
        type: z.ZodOptional<z.ZodEnum<{
            browserbase: "browserbase";
            local: "local";
        }>>;
        cdpUrl: z.ZodOptional<z.ZodString>;
        launchOptions: z.ZodOptional<z.ZodObject<{
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
        }, z.core.$strict>>;
    }, z.core.$strip>>;
    selfHeal: z.ZodOptional<z.ZodBoolean>;
    browserbaseSessionID: z.ZodOptional<z.ZodString>;
    experimental: z.ZodOptional<z.ZodBoolean>;
    waitForCaptchaSolves: z.ZodOptional<z.ZodBoolean>;
    actTimeoutMs: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const SessionStartResultSchema: z.ZodObject<{
    sessionId: z.ZodString;
    cdpUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    available: z.ZodBoolean;
}, z.core.$strip>;
export declare const SessionStartResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    data: z.ZodObject<{
        sessionId: z.ZodString;
        cdpUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        available: z.ZodBoolean;
    }, z.core.$strip>;
}, z.core.$strip>;
/** Session end request - no request body. */
export declare const SessionEndRequestSchema: z.ZodOptional<z.ZodObject<{}, z.core.$strict>>;
export declare const SessionEndResultSchema: z.ZodObject<{}, z.core.$strict>;
/** Session end response - just success flag, no data wrapper */
export declare const SessionEndResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
}, z.core.$strict>;
export declare const ActRequestSchema: z.ZodObject<{
    input: z.ZodUnion<[z.ZodString, z.ZodObject<{
        selector: z.ZodString;
        description: z.ZodString;
        method: z.ZodOptional<z.ZodString>;
        arguments: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>]>;
    options: z.ZodOptional<z.ZodObject<{
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
    }, z.core.$strip>>;
    frameId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    streamResponse: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const ActResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    data: z.ZodObject<{
        result: z.ZodObject<{
            success: z.ZodBoolean;
            message: z.ZodString;
            actionDescription: z.ZodString;
            actions: z.ZodArray<z.ZodObject<{
                selector: z.ZodString;
                description: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
                arguments: z.ZodOptional<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
        actionId: z.ZodOptional<z.ZodString>;
        cacheStatus: z.ZodOptional<z.ZodEnum<{
            HIT: "HIT";
            MISS: "MISS";
        }>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const ExtractRequestSchema: z.ZodObject<{
    instruction: z.ZodOptional<z.ZodString>;
    schema: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    options: z.ZodOptional<z.ZodObject<{
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
    }, z.core.$strip>>;
    frameId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    streamResponse: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const ExtractResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    data: z.ZodObject<{
        result: z.ZodUnknown;
        actionId: z.ZodOptional<z.ZodString>;
        cacheStatus: z.ZodOptional<z.ZodEnum<{
            HIT: "HIT";
            MISS: "MISS";
        }>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const ObserveRequestSchema: z.ZodObject<{
    instruction: z.ZodOptional<z.ZodString>;
    options: z.ZodOptional<z.ZodObject<{
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
    }, z.core.$strip>>;
    frameId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    streamResponse: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const ObserveResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    data: z.ZodObject<{
        result: z.ZodArray<z.ZodObject<{
            selector: z.ZodString;
            description: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
            arguments: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>;
        actionId: z.ZodOptional<z.ZodString>;
        cacheStatus: z.ZodOptional<z.ZodEnum<{
            HIT: "HIT";
            MISS: "MISS";
        }>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const NavigateOptionsSchema: z.ZodOptional<z.ZodObject<{
    referer: z.ZodOptional<z.ZodString>;
    timeout: z.ZodOptional<z.ZodNumber>;
    waitUntil: z.ZodOptional<z.ZodEnum<{
        load: "load";
        domcontentloaded: "domcontentloaded";
        networkidle: "networkidle";
    }>>;
}, z.core.$strip>>;
export declare const NavigateRequestSchema: z.ZodObject<{
    url: z.ZodString;
    options: z.ZodOptional<z.ZodObject<{
        referer: z.ZodOptional<z.ZodString>;
        timeout: z.ZodOptional<z.ZodNumber>;
        waitUntil: z.ZodOptional<z.ZodEnum<{
            load: "load";
            domcontentloaded: "domcontentloaded";
            networkidle: "networkidle";
        }>>;
    }, z.core.$strip>>;
    frameId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    streamResponse: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const NavigateResultSchema: z.ZodObject<{
    result: z.ZodNullable<z.ZodUnknown>;
    actionId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const NavigateResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    data: z.ZodObject<{
        result: z.ZodNullable<z.ZodUnknown>;
        actionId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
/** Token usage for a single action */
export declare const TokenUsageSchema: z.ZodObject<{
    inputTokens: z.ZodOptional<z.ZodNumber>;
    outputTokens: z.ZodOptional<z.ZodNumber>;
    timeMs: z.ZodOptional<z.ZodNumber>;
    cost: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
/** Action entry in replay metrics */
export declare const ReplayActionSchema: z.ZodObject<{
    method: z.ZodString;
    parameters: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    result: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    timestamp: z.ZodNumber;
    endTime: z.ZodOptional<z.ZodNumber>;
    tokenUsage: z.ZodOptional<z.ZodObject<{
        inputTokens: z.ZodOptional<z.ZodNumber>;
        outputTokens: z.ZodOptional<z.ZodNumber>;
        timeMs: z.ZodOptional<z.ZodNumber>;
        cost: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** Page entry in replay metrics */
export declare const ReplayPageSchema: z.ZodObject<{
    url: z.ZodString;
    timestamp: z.ZodNumber;
    duration: z.ZodNumber;
    actions: z.ZodArray<z.ZodObject<{
        method: z.ZodString;
        parameters: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        result: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        timestamp: z.ZodNumber;
        endTime: z.ZodOptional<z.ZodNumber>;
        tokenUsage: z.ZodOptional<z.ZodObject<{
            inputTokens: z.ZodOptional<z.ZodNumber>;
            outputTokens: z.ZodOptional<z.ZodNumber>;
            timeMs: z.ZodOptional<z.ZodNumber>;
            cost: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** Inner result data for replay */
export declare const ReplayResultSchema: z.ZodObject<{
    pages: z.ZodArray<z.ZodObject<{
        url: z.ZodString;
        timestamp: z.ZodNumber;
        duration: z.ZodNumber;
        actions: z.ZodArray<z.ZodObject<{
            method: z.ZodString;
            parameters: z.ZodRecord<z.ZodString, z.ZodUnknown>;
            result: z.ZodRecord<z.ZodString, z.ZodUnknown>;
            timestamp: z.ZodNumber;
            endTime: z.ZodOptional<z.ZodNumber>;
            tokenUsage: z.ZodOptional<z.ZodObject<{
                inputTokens: z.ZodOptional<z.ZodNumber>;
                outputTokens: z.ZodOptional<z.ZodNumber>;
                timeMs: z.ZodOptional<z.ZodNumber>;
                cost: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    clientLanguage: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const ReplayResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    data: z.ZodObject<{
        pages: z.ZodArray<z.ZodObject<{
            url: z.ZodString;
            timestamp: z.ZodNumber;
            duration: z.ZodNumber;
            actions: z.ZodArray<z.ZodObject<{
                method: z.ZodString;
                parameters: z.ZodRecord<z.ZodString, z.ZodUnknown>;
                result: z.ZodRecord<z.ZodString, z.ZodUnknown>;
                timestamp: z.ZodNumber;
                endTime: z.ZodOptional<z.ZodNumber>;
                tokenUsage: z.ZodOptional<z.ZodObject<{
                    inputTokens: z.ZodOptional<z.ZodNumber>;
                    outputTokens: z.ZodOptional<z.ZodNumber>;
                    timeMs: z.ZodOptional<z.ZodNumber>;
                    cost: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        clientLanguage: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
/** Status values for SSE stream events */
export declare const StreamEventStatusSchema: z.ZodEnum<{
    error: "error";
    connected: "connected";
    starting: "starting";
    running: "running";
    finished: "finished";
}>;
/** Type discriminator for SSE stream events */
export declare const StreamEventTypeSchema: z.ZodEnum<{
    log: "log";
    system: "system";
}>;
/** Data payload for system stream events */
export declare const StreamEventSystemDataSchema: z.ZodObject<{
    status: z.ZodEnum<{
        error: "error";
        connected: "connected";
        starting: "starting";
        running: "running";
        finished: "finished";
    }>;
    result: z.ZodOptional<z.ZodUnknown>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** Data payload for log stream events */
export declare const StreamEventLogDataSchema: z.ZodObject<{
    status: z.ZodLiteral<"running">;
    message: z.ZodString;
}, z.core.$strip>;
/**
 * SSE stream event sent during streaming responses.
 *
 * The SSE wire format includes an `event:` line that mirrors the stream status
 * (`starting`, `connected`, `running`, `finished`, or `error`) followed by a
 * JSON `data:` line containing the typed payload below.
 */
export declare const StreamEventSchema: z.ZodObject<{
    data: z.ZodUnion<readonly [z.ZodObject<{
        status: z.ZodEnum<{
            error: "error";
            connected: "connected";
            starting: "starting";
            running: "running";
            finished: "finished";
        }>;
        result: z.ZodOptional<z.ZodUnknown>;
        error: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        status: z.ZodLiteral<"running">;
        message: z.ZodString;
    }, z.core.$strip>]>;
    type: z.ZodEnum<{
        log: "log";
        system: "system";
    }>;
    id: z.ZodString;
}, z.core.$strip>;
