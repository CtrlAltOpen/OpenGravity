import * as path from 'path';
import * as vscode from 'vscode';

export type ChatMessage = {
    role: string;
    content: string;
    images?: string[];
    [key: string]: any;
};

export type ToolDefinition = {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, any>;
    };
};

export type ParsedToolCall = {
    id?: string;
    name: string;
    arguments: Record<string, any>;
};

export type ConnectionDiagnostics = {
    ok: boolean;
    provider: string;
    mode: string;
    baseUrl: string;
    testedEndpoints: string[];
    models: string[];
    error?: string;
};

type GenerateOptions = {
    maxTokens?: number;
};

type ProviderKind = 'ollama' | 'openaiCompat' | 'llamacppNative';

type ProviderConfig = {
    provider: string;
    kind: ProviderKind;
    baseUrl: string;
    model: string;
    temp: number;
    maxTokens: number;
    numCtx: number;
    topP: number;
    topK: number;
    repeatPenalty: number;
    presencePenalty: number;
    frequencyPenalty: number;
    seed: number;
    llamaCppChatEndpoint: string;
    llamaCppCompletionEndpoint: string;
};

export class OllamaService {
    private _abortController: AbortController = new AbortController();

    private _getProviderConfig(modelOverride?: string): ProviderConfig {
        const config = vscode.workspace.getConfiguration('opengravity');
        const provider = config.get<string>('provider', 'ollama');

        const legacyUrl = config.get<string>('url', provider === 'lmstudio' ? 'http://localhost:1234' : 'http://localhost:11434');
        const legacyUrlInspect = config.inspect<string>('url');
        const legacyUrlSet = Boolean(
            legacyUrlInspect?.globalValue !== undefined
            || legacyUrlInspect?.workspaceValue !== undefined
            || legacyUrlInspect?.workspaceFolderValue !== undefined
        );

        const providerUrlKeys: Record<string, string> = {
            ollama: 'ollamaUrl',
            lmstudio: 'lmstudioUrl',
            llamacpp: 'llamacppUrl',
            openaiCompatible: 'openaiCompatibleUrl'
        };

        const providerUrls: Record<string, string> = {
            ollama: config.get<string>('ollamaUrl', 'http://localhost:11434'),
            lmstudio: config.get<string>('lmstudioUrl', 'http://localhost:1234'),
            llamacpp: config.get<string>('llamacppUrl', 'http://localhost:8080'),
            openaiCompatible: config.get<string>('openaiCompatibleUrl', 'http://localhost:8000')
        };

        const providerUrlKey = providerUrlKeys[provider] || 'ollamaUrl';
        const providerUrlInspect = config.inspect<string>(providerUrlKey);
        const providerUrlSet = Boolean(
            providerUrlInspect?.globalValue !== undefined
            || providerUrlInspect?.workspaceValue !== undefined
            || providerUrlInspect?.workspaceFolderValue !== undefined
        );

        let baseUrl = providerUrls[provider] || providerUrls.ollama;
        // Backward compatibility: use legacy URL only if provider-specific URL was never set.
        if (!providerUrlSet && legacyUrlSet && legacyUrl) {
            baseUrl = legacyUrl;
        }

        const model = modelOverride || config.get<string>('model', 'qwen2.5-coder:7b');
        const temp = config.get<number>('temperature', 0.15);
        const maxTokens = config.get<number>('maxTokens', 4096);
        const numCtx = config.get<number>('contextLength', 16384);
        const topP = config.get<number>('topP', 0.9);
        const topK = config.get<number>('topK', 40);
        const repeatPenalty = config.get<number>('repeatPenalty', 1.1);
        const presencePenalty = config.get<number>('presencePenalty', 0);
        const frequencyPenalty = config.get<number>('frequencyPenalty', 0);
        const seed = config.get<number>('seed', 42);

        const llamaCppApiMode = config.get<string>('llamacppApiMode', 'openaiCompat');
        const llamaCppChatEndpoint = config.get<string>('llamacppChatEndpoint', '/v1/chat/completions');
        const llamaCppCompletionEndpoint = config.get<string>('llamacppCompletionEndpoint', '/completion');

        let kind: ProviderKind = 'ollama';
        if (provider === 'lmstudio' || provider === 'openaiCompatible') {
            kind = 'openaiCompat';
        } else if (provider === 'llamacpp') {
            kind = llamaCppApiMode === 'native' ? 'llamacppNative' : 'openaiCompat';
        }

        return {
            provider,
            kind,
            baseUrl,
            model,
            temp,
            maxTokens,
            numCtx,
            topP,
            topK,
            repeatPenalty,
            presencePenalty,
            frequencyPenalty,
            seed,
            llamaCppChatEndpoint,
            llamaCppCompletionEndpoint
        };
    }

    private _normalizeEndpoint(baseUrl: string, endpoint: string): string {
        const cleanBase = baseUrl.replace(/\/$/, '');
        if (!endpoint) {
            return cleanBase;
        }
        if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
            return endpoint;
        }
        const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        return `${cleanBase}${cleanEndpoint}`;
    }

    private _messagesToPrompt(messages: ChatMessage[]): string {
        const lines: string[] = [];
        for (const message of messages) {
            if (message.role === 'system') {
                lines.push(`System: ${message.content}`);
            } else if (message.role === 'user') {
                lines.push(`User: ${message.content}`);
            } else if (message.role === 'assistant') {
                lines.push(`Assistant: ${message.content}`);
            } else if (message.role === 'tool') {
                lines.push(`Tool: ${message.content}`);
            }
        }
        lines.push('Assistant:');
        return lines.join('\n\n');
    }

    private _buildRequest(messages: ChatMessage[], modelOverride: string | undefined, stream: boolean, tools?: ToolDefinition[]) {
        const cfg = this._getProviderConfig(modelOverride);

        if (cfg.kind === 'openaiCompat') {
            const endpoint = cfg.provider === 'llamacpp'
                ? this._normalizeEndpoint(cfg.baseUrl, cfg.llamaCppChatEndpoint)
                : this._normalizeEndpoint(cfg.baseUrl, '/v1/chat/completions');

            const body: any = {
                model: cfg.model,
                messages,
                stream,
                temperature: cfg.temp,
                top_p: cfg.topP,
                frequency_penalty: cfg.frequencyPenalty,
                presence_penalty: cfg.presencePenalty
            };
            if (cfg.maxTokens > 0) {
                body.max_tokens = cfg.maxTokens;
            }
            if (cfg.seed >= 0) {
                body.seed = cfg.seed;
            }
            if (tools && tools.length > 0) {
                body.tools = tools;
                body.tool_choice = 'auto';
            }

            return {
                cfg,
                endpoint,
                body
            };
        }

        if (cfg.kind === 'llamacppNative') {
            const endpoint = this._normalizeEndpoint(cfg.baseUrl, cfg.llamaCppCompletionEndpoint);
            const body: any = {
                prompt: this._messagesToPrompt(messages),
                stream,
                temperature: cfg.temp,
                top_p: cfg.topP,
                top_k: cfg.topK,
                repeat_penalty: cfg.repeatPenalty
            };
            if (cfg.maxTokens > 0) {
                body.n_predict = cfg.maxTokens;
            }
            if (cfg.seed >= 0) {
                body.seed = cfg.seed;
            }
            return {
                cfg,
                endpoint,
                body
            };
        }

        const endpoint = this._normalizeEndpoint(cfg.baseUrl, '/api/chat');
        const body: any = {
            model: cfg.model,
            messages,
            stream,
            options: {
                temperature: cfg.temp,
                num_ctx: cfg.numCtx,
                top_p: cfg.topP,
                top_k: cfg.topK,
                repeat_penalty: cfg.repeatPenalty
            }
        };
        if (cfg.maxTokens > 0) {
            body.options.num_predict = cfg.maxTokens;
        }
        if (cfg.seed >= 0) {
            body.options.seed = cfg.seed;
        }
        if (tools && tools.length > 0) {
            body.tools = tools;
        }

        return {
            cfg,
            endpoint,
            body
        };
    }

    public async chat(messages: ChatMessage[], onChunk: (text: string) => void, modelOverride?: string): Promise<any> {
        const request = this._buildRequest(messages, modelOverride, true);

        try {
            const response = await fetch(request.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request.body),
                signal: this._abortController.signal
            });

            if (!response.ok) {
                throw new Error(`Local API Error: ${response.status} ${response.statusText}`);
            }
            if (!response.body) {
                throw new Error('No response body');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (!line.trim()) continue;

                    const raw = line.startsWith('data: ') ? line.slice(6) : line;
                    if (raw === '[DONE]') {
                        return { done: true };
                    }

                    try {
                        const json: any = JSON.parse(raw);
                        const openAiDelta = json.choices?.[0]?.delta?.content;
                        const llamaNativeDelta = json.content;
                        const ollamaDelta = json.message?.content;
                        const text = openAiDelta || llamaNativeDelta || ollamaDelta;
                        if (text) {
                            onChunk(text);
                        }

                        if (json.done === true || json.stop === true) {
                            return json;
                        }
                    } catch {
                        // Ignore malformed chunks while streaming.
                    }
                }
            }

            return { done: true };
        } catch (error: any) {
            if (error.name === 'AbortError') {
                return { aborted: true };
            }
            console.error('Ollama Service Error:', error);
            onChunk(`\n\n**Error:** ${error.message}`);
            return null;
        }
    }

    public async complete(
        messages: ChatMessage[],
        modelOverride?: string,
        tools?: ToolDefinition[]
    ): Promise<{ text: string; raw?: any; aborted?: boolean; assistantMessage?: ChatMessage; toolCalls?: ParsedToolCall[] }> {
        const request = this._buildRequest(messages, modelOverride, false, tools);

        try {
            const response = await fetch(request.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request.body),
                signal: this._abortController.signal
            });

            if (!response.ok) {
                throw new Error(`Local API Error: ${response.status} ${response.statusText}`);
            }

            const json: any = await response.json();

            if (request.cfg.kind === 'openaiCompat') {
                const message = json.choices?.[0]?.message || {};
                return {
                    text: message.content || '',
                    toolCalls: this._extractToolCalls(message.tool_calls),
                    assistantMessage: {
                        role: message.role || 'assistant',
                        content: message.content || '',
                        tool_calls: message.tool_calls
                    },
                    raw: json
                };
            }

            if (request.cfg.kind === 'llamacppNative') {
                const text = json.content || json.response || '';
                return {
                    text,
                    assistantMessage: {
                        role: 'assistant',
                        content: text
                    },
                    raw: json
                };
            }

            const message = json.message || {};
            return {
                text: message.content || '',
                toolCalls: this._extractToolCalls(message.tool_calls),
                assistantMessage: {
                    role: message.role || 'assistant',
                    content: message.content || '',
                    tool_calls: message.tool_calls
                },
                raw: json
            };
        } catch (error: any) {
            if (error.name === 'AbortError') {
                return { text: '', aborted: true };
            }
            throw error;
        }
    }

    private _extractToolCalls(rawCalls: any): ParsedToolCall[] {
        if (!Array.isArray(rawCalls)) {
            return [];
        }

        const calls: ParsedToolCall[] = [];
        for (const call of rawCalls) {
            const fn = call?.function;
            if (!fn?.name) {
                continue;
            }

            let parsedArgs: Record<string, any> = {};
            if (typeof fn.arguments === 'string') {
                try {
                    parsedArgs = JSON.parse(fn.arguments);
                } catch {
                    parsedArgs = {};
                }
            } else if (typeof fn.arguments === 'object' && fn.arguments) {
                parsedArgs = fn.arguments;
            }

            calls.push({
                id: typeof call.id === 'string' ? call.id : undefined,
                name: String(fn.name),
                arguments: parsedArgs
            });
        }

        return calls;
    }

    public async generate(prompt: string, options?: GenerateOptions): Promise<string> {
        const cfg = this._getProviderConfig();
        const maxTokens = options?.maxTokens ?? 128;

        if (cfg.kind === 'openaiCompat') {
            const endpoint = cfg.provider === 'llamacpp'
                ? this._normalizeEndpoint(cfg.baseUrl, cfg.llamaCppChatEndpoint)
                : this._normalizeEndpoint(cfg.baseUrl, '/v1/chat/completions');

            const body: any = {
                model: cfg.model,
                messages: [{ role: 'user', content: prompt }],
                stream: false,
                temperature: cfg.temp,
                top_p: cfg.topP,
                frequency_penalty: cfg.frequencyPenalty,
                presence_penalty: cfg.presencePenalty,
                max_tokens: maxTokens
            };
            if (cfg.seed >= 0) {
                body.seed = cfg.seed;
            }

            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                if (!response.ok) return '';
                const json: any = await response.json();
                return json.choices?.[0]?.message?.content || '';
            } catch {
                return '';
            }
        }

        if (cfg.kind === 'llamacppNative') {
            const endpoint = this._normalizeEndpoint(cfg.baseUrl, cfg.llamaCppCompletionEndpoint);
            const body: any = {
                prompt,
                stream: false,
                temperature: cfg.temp,
                top_p: cfg.topP,
                top_k: cfg.topK,
                repeat_penalty: cfg.repeatPenalty,
                n_predict: maxTokens
            };
            if (cfg.seed >= 0) {
                body.seed = cfg.seed;
            }

            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                if (!response.ok) return '';
                const json: any = await response.json();
                return json.content || json.response || '';
            } catch {
                return '';
            }
        }

        const endpoint = this._normalizeEndpoint(cfg.baseUrl, '/api/generate');
        const body: any = {
            model: cfg.model,
            prompt,
            stream: false,
            options: {
                temperature: cfg.temp,
                top_p: cfg.topP,
                top_k: cfg.topK,
                repeat_penalty: cfg.repeatPenalty,
                num_ctx: cfg.numCtx,
                num_predict: maxTokens
            }
        };
        if (cfg.seed >= 0) {
            body.options.seed = cfg.seed;
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                return '';
            }

            const json: any = await response.json();
            return json.response || '';
        } catch (e) {
            console.error('Ollama Generate Error:', e);
            return '';
        }
    }

    private _extractModelNames(payload: any): string[] {
        if (!payload) {
            return [];
        }

        const fromModels = Array.isArray(payload.models)
            ? payload.models.map((m: any) => m?.id || m?.name)
            : [];
        const fromData = Array.isArray(payload.data)
            ? payload.data.map((m: any) => m?.id || m?.name)
            : [];

        const names = [...fromModels, ...fromData]
            .map((v) => typeof v === 'string' ? v : '')
            .filter(Boolean);

        if (names.length > 0) {
            return names;
        }

        if (typeof payload.model_path === 'string' && payload.model_path) {
            return [path.basename(payload.model_path)];
        }

        return [];
    }

    public async diagnoseConnection(): Promise<ConnectionDiagnostics> {
        const cfg = this._getProviderConfig();
        const testedEndpoints: string[] = [];
        const mode = cfg.kind === 'llamacppNative' ? 'llamacpp-native' : cfg.kind;

        let candidates: string[] = [];
        if (cfg.kind === 'openaiCompat') {
            candidates = cfg.provider === 'llamacpp' ? ['/v1/models', '/models'] : ['/v1/models'];
        } else if (cfg.kind === 'llamacppNative') {
            candidates = ['/props', '/models'];
        } else {
            candidates = ['/api/tags'];
        }

        for (const candidate of candidates) {
            const endpoint = this._normalizeEndpoint(cfg.baseUrl, candidate);
            try {
                const response = await fetch(endpoint, { signal: this._abortController.signal });
                testedEndpoints.push(`${endpoint} -> ${response.status}`);

                if (!response.ok) {
                    continue;
                }

                const payload: any = await response.json();
                const models = this._extractModelNames(payload);
                return {
                    ok: true,
                    provider: cfg.provider,
                    mode,
                    baseUrl: cfg.baseUrl,
                    testedEndpoints,
                    models
                };
            } catch (error: any) {
                testedEndpoints.push(`${endpoint} -> error: ${error?.message || String(error)}`);
            }
        }

        return {
            ok: false,
            provider: cfg.provider,
            mode,
            baseUrl: cfg.baseUrl,
            testedEndpoints,
            models: [],
            error: 'Could not reach a valid endpoint for the selected provider.'
        };
    }

    public async getModels(): Promise<string[]> {
        const cfg = this._getProviderConfig();

        try {
            if (cfg.kind === 'openaiCompat') {
                const candidateEndpoints = cfg.provider === 'llamacpp'
                    ? ['/v1/models', '/models']
                    : ['/v1/models'];

                for (const candidate of candidateEndpoints) {
                    const response = await fetch(this._normalizeEndpoint(cfg.baseUrl, candidate));
                    if (!response.ok) {
                        continue;
                    }
                    const json: any = await response.json();
                    const models = (json.data || json.models || []).map((m: any) => m.id || m.name).filter(Boolean);
                    if (models.length > 0) {
                        return models;
                    }
                }
                return [];
            }

            if (cfg.kind === 'llamacppNative') {
                const tryEndpoints = ['/models', '/props'];
                for (const ep of tryEndpoints) {
                    try {
                        const response = await fetch(this._normalizeEndpoint(cfg.baseUrl, ep));
                        if (!response.ok) {
                            continue;
                        }
                        const json: any = await response.json();

                        if (Array.isArray(json.models)) {
                            const models = json.models.map((m: any) => m.id || m.name).filter(Boolean);
                            if (models.length > 0) return models;
                        }

                        if (Array.isArray(json.data)) {
                            const models = json.data.map((m: any) => m.id || m.name).filter(Boolean);
                            if (models.length > 0) return models;
                        }

                        if (typeof json.model_path === 'string' && json.model_path) {
                            return [path.basename(json.model_path)];
                        }
                    } catch {
                        // Try next endpoint.
                    }
                }
                return [];
            }

            const response = await fetch(this._normalizeEndpoint(cfg.baseUrl, '/api/tags'));
            if (!response.ok) {
                return [];
            }
            const json: any = await response.json();
            return (json.models || []).map((m: any) => m.name).filter(Boolean);
        } catch (e) {
            console.error('GetModels Error:', e);
            return [];
        }
    }

    public async getActiveModels(): Promise<any[]> {
        const cfg = this._getProviderConfig();
        if (cfg.provider !== 'ollama') {
            return [];
        }

        const endpoint = this._normalizeEndpoint(cfg.baseUrl, '/api/ps');

        try {
            const response = await fetch(endpoint);
            if (!response.ok) {
                return [];
            }
            const json: any = await response.json();
            return json.models || [];
        } catch (e) {
            console.error('Ollama GetActiveModels Error:', e);
            return [];
        }
    }

    public cancelChat() {
        this._abortController.abort();
        this._abortController = new AbortController();
    }
}





