// Type declarations for URLPattern API
// https://developer.mozilla.org/en-US/docs/Web/API/URLPattern

interface URLPatternInit {
    protocol?: string;
    username?: string;
    password?: string;
    hostname?: string;
    port?: string;
    pathname?: string;
    search?: string;
    hash?: string;
    baseURL?: string;
}

interface URLPatternResult {
    inputs: [URLPatternInit] | [string, string?];
    protocol: URLPatternComponentResult;
    username: URLPatternComponentResult;
    password: URLPatternComponentResult;
    hostname: URLPatternComponentResult;
    port: URLPatternComponentResult;
    pathname: URLPatternComponentResult;
    search: URLPatternComponentResult;
    hash: URLPatternComponentResult;
}

interface URLPatternComponentResult {
    input: string;
    groups: Record<string, string>;
}

declare class URLPattern {
    constructor(input?: URLPatternInit | string, baseURL?: string);

    test(input?: URLPatternInit | string, baseURL?: string): boolean;
    exec(input?: URLPatternInit | string, baseURL?: string): URLPatternResult | null;

    readonly protocol: string;
    readonly username: string;
    readonly password: string;
    readonly hostname: string;
    readonly port: string;
    readonly pathname: string;
    readonly search: string;
    readonly hash: string;
}
