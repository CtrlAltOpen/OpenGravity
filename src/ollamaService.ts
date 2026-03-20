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

export type ModelCapability = 'thinking' | 'vision' | 'tools' | 'files' | 'code';

export type ModelInfo = {
    id: string;
    provider: string;
    capabilities: ModelCapability[];
    raw?: Record<string, unknown>;
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

        const model = modelOverride || config.get<string>('model', '') || '';
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

    private _isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    private _stringArray(value: unknown): string[] {
        if (!Array.isArray(value)) {
            return [];
        }
        return value.map((item) => typeof item === 'string' ? item : '').filter(Boolean);
    }

    private _detectCapabilitiesFromMetadata(rawModel: unknown, modelId: string): ModelCapability[] {
        const caps = new Set<ModelCapability>();
        const model = this._isRecord(rawModel) ? rawModel : {};
        const details = this._isRecord(model.details) ? model.details : {};
        const architecture = this._isRecord(model.architecture) ? model.architecture : {};
        const metadata = this._isRecord(model.metadata) ? model.metadata : {};
        const capabilityObj = this._isRecord(model.capabilities) ? model.capabilities : {};

        const arrays = [
            ...this._stringArray(model.modalities),
            ...this._stringArray(model.input_modalities),
            ...this._stringArray(model.output_modalities),
            ...this._stringArray(model.supported_modalities),
            ...this._stringArray(details.families),
            ...this._stringArray(metadata.modalities),
            ...this._stringArray(architecture.modalities)
        ];

        const rawText = [
            modelId,
            typeof model.id === 'string' ? model.id : '',
            typeof model.name === 'string' ? model.name : '',
            typeof model.object === 'string' ? model.object : '',
            typeof details.family === 'string' ? details.family : '',
            typeof architecture.type === 'string' ? architecture.type : '',
            ...arrays
        ].join(' ').toLowerCase();

        if (/(image|vision|llava|vl|pixtral|moondream|clip)/.test(rawText)) {
            caps.add('vision');
        }

        if (/(coder|code|starcoder|codestral|deepseek-coder|qwen2\.5-coder)/.test(rawText)) {
            caps.add('code');
        }

        const toolsExplicit =
            model.supports_tools === true
            || model.tool_calling === true
            || model.function_calling === true
            || model.tools === true
            || capabilityObj.tools === true
            || capabilityObj.function_calling === true
            || capabilityObj.tool_calling === true;

        if (toolsExplicit) {
            caps.add('tools');
        }

        const thinkingExplicit =
            model.reasoning === true
            || model.supports_reasoning === true
            || capabilityObj.reasoning === true
            || capabilityObj.thinking === true
            || capabilityObj.reasoner === true;

        if (thinkingExplicit) {
            caps.add('thinking');
        }

        const filesExplicit =
            model.supports_files === true
            || capabilityObj.files === true
            || capabilityObj.attachments === true;

        if (filesExplicit) {
            caps.add('files');
        }

        return Array.from(caps);
    }

    private _extractModelInfosFromPayload(payload: unknown, provider: string): ModelInfo[] {
        const root = this._isRecord(payload) ? payload : {};
        const fromModels = Array.isArray(root.models) ? root.models : [];
        const fromData = Array.isArray(root.data) ? root.data : [];
        const modelEntries = [...fromModels, ...fromData];

        const infos: ModelInfo[] = [];

        for (const entry of modelEntries) {
            const item = this._isRecord(entry) ? entry : {};
            const id = typeof item.id === 'string'
                ? item.id
                : (typeof item.name === 'string' ? item.name : '');

            if (!id) {
                continue;
            }

            infos.push({
                id,
                provider,
                capabilities: this._detectCapabilitiesFromMetadata(item, id),
                raw: item
            });
        }

        if (infos.length > 0) {
            return infos;
        }

        if (typeof root.model_path === 'string' && root.model_path) {
            const id = path.basename(root.model_path);
            return [{
                id,
                provider,
                capabilities: this._detectCapabilitiesFromMetadata(root, id),
                raw: root
            }];
        }

        return [];
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

    private async _throwWithBody(response: Response): Promise<never> {
        let detail = '';
        try {
            const body = await response.text();
            const parsed = JSON.parse(body);
            detail = parsed?.error?.message || parsed?.error || parsed?.message || body;
        } catch {
            // body wasn't JSON or was empty — ignore
        }
        const hint = response.status === 500
            ? ' (llama.cpp returned 500 — likely context window exceeded or out of VRAM; try reducing contextLength or opening fewer files)'
            : '';
        throw new Error(`API error ${response.status}${detail ? `: ${detail}` : ` ${response.statusText}`}${hint}`);
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
                await this._throwWithBody(response);
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

    private _buildFimPrompt(prefix: string, suffix: string, modelId: string): string | null {
        const m = modelId.toLowerCase();
        if (/qwen/.test(m)) {
            return `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;
        }
        if (/deepseek.?coder/.test(m)) {
            return `<｜fim▁begin｜>${prefix}<｜fim▁hole｜>${suffix}<｜fim▁end｜>`;
        }
        if (/codellama|code.?llama/.test(m)) {
            return `<PRE> ${prefix} <SUF>${suffix} <MID>`;
        }
        if (/starcoder/.test(m)) {
            return `<fim_prefix>${prefix}<fim_suffix>${suffix}<fim_middle>`;
        }
        return null;
    }

    public async complete(
        messages: ChatMessage[],
        modelOverride?: string,
        tools?: ToolDefinition[],
        onChunk?: (text: string) => void
    ): Promise<{ text: string; raw?: any; aborted?: boolean; assistantMessage?: ChatMessage; toolCalls?: ParsedToolCall[] }> {
        if (onChunk) {
            return this._completeStreaming(messages, modelOverride, tools, onChunk);
        }
        const request = this._buildRequest(messages, modelOverride, false, tools);

        try {
            const response = await fetch(request.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request.body),
                signal: this._abortController.signal
            });

            if (!response.ok) {
                await this._throwWithBody(response);
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

    private async _completeStreaming(
        messages: ChatMessage[],
        modelOverride: string | undefined,
        tools: ToolDefinition[] | undefined,
        onChunk: (text: string) => void
    ): Promise<{ text: string; raw?: any; aborted?: boolean; assistantMessage?: ChatMessage; toolCalls?: ParsedToolCall[] }> {
        const request = this._buildRequest(messages, modelOverride, true, tools);

        try {
            const response = await fetch(request.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request.body),
                signal: this._abortController.signal
            });

            if (!response.ok) {
                await this._throwWithBody(response);
            }
            if (!response.body) {
                throw new Error('No response body');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            let fullText = '';
            let rawFinal: any = null;
            let xmlToolCallSeen = false;

            // Accumulate native tool call deltas (OpenAI-compat streaming format)
            const tcBuffers: Record<number, { id?: string; name: string; args: string }> = {};

            outer: while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (!line.trim()) continue;
                    const raw = line.startsWith('data: ') ? line.slice(6) : line;
                    if (raw === '[DONE]') break outer;

                    try {
                        const json: any = JSON.parse(raw);

                        if (request.cfg.kind === 'openaiCompat') {
                            const delta = json.choices?.[0]?.delta;
                            if (delta?.content) {
                                fullText += delta.content;
                                if (!xmlToolCallSeen) {
                                    if (fullText.trimStart().startsWith('<tool_call>')) {
                                        xmlToolCallSeen = true;
                                    } else {
                                        onChunk(delta.content);
                                    }
                                }
                            }
                            if (Array.isArray(delta?.tool_calls)) {
                                for (const tc of delta.tool_calls) {
                                    const idx = tc.index ?? 0;
                                    if (!tcBuffers[idx]) {
                                        tcBuffers[idx] = { id: tc.id, name: '', args: '' };
                                    }
                                    if (tc.id) { tcBuffers[idx].id = tc.id; }
                                    if (tc.function?.name) { tcBuffers[idx].name += tc.function.name; }
                                    if (tc.function?.arguments) { tcBuffers[idx].args += tc.function.arguments; }
                                }
                            }
                            if (json.choices?.[0]?.finish_reason) { rawFinal = json; }

                        } else if (request.cfg.kind === 'llamacppNative') {
                            const text = json.content || '';
                            if (text) {
                                fullText += text;
                                if (!xmlToolCallSeen) {
                                    if (fullText.trimStart().startsWith('<tool_call>')) {
                                        xmlToolCallSeen = true;
                                    } else {
                                        onChunk(text);
                                    }
                                }
                            }
                            if (json.stop) { rawFinal = json; }

                        } else {
                            // Ollama
                            const text = json.message?.content || '';
                            if (text) {
                                fullText += text;
                                if (!xmlToolCallSeen) {
                                    if (fullText.trimStart().startsWith('<tool_call>')) {
                                        xmlToolCallSeen = true;
                                    } else {
                                        onChunk(text);
                                    }
                                }
                            }
                            if (json.done) { rawFinal = json; }
                        }
                    } catch {
                        // Ignore malformed chunks
                    }
                }
            }

            // Reconstruct native tool calls from streaming buffers
            let nativeToolCalls: ParsedToolCall[] = [];
            let rawToolCallsForHistory: any[] | undefined;

            if (request.cfg.kind === 'openaiCompat') {
                const entries = Object.values(tcBuffers);
                if (entries.length > 0) {
                    rawToolCallsForHistory = entries.map(tc => ({
                        id: tc.id,
                        type: 'function',
                        function: { name: tc.name, arguments: tc.args }
                    }));
                    nativeToolCalls = this._extractToolCalls(rawToolCallsForHistory);
                }
            } else if (request.cfg.kind === 'ollama') {
                rawToolCallsForHistory = rawFinal?.message?.tool_calls;
                nativeToolCalls = this._extractToolCalls(rawToolCallsForHistory);
            }

            return {
                text: fullText,
                toolCalls: nativeToolCalls.length > 0 ? nativeToolCalls : undefined,
                assistantMessage: {
                    role: 'assistant',
                    content: fullText,
                    tool_calls: rawToolCallsForHistory
                },
                raw: rawFinal
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

    public async generate(prompt: string, options?: GenerateOptions & { suffix?: string }): Promise<string> {
        const cfg = this._getProviderConfig();

        // Build FIM prompt when suffix is provided and model supports it
        if (options?.suffix !== undefined && options.suffix !== '') {
            const fimPrompt = this._buildFimPrompt(prompt, options.suffix, cfg.model);
            if (fimPrompt !== null) {
                prompt = fimPrompt;
            }
        }

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

    public async getModelInfos(): Promise<ModelInfo[]> {
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
                    const json: unknown = await response.json();
                    const infos = this._extractModelInfosFromPayload(json, cfg.provider);
                    if (infos.length > 0) {
                        return infos;
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
                        const json: unknown = await response.json();
                        const infos = this._extractModelInfosFromPayload(json, cfg.provider);
                        if (infos.length > 0) {
                            return infos;
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

            const json: unknown = await response.json();
            return this._extractModelInfosFromPayload(json, cfg.provider);
        } catch (e) {
            console.error('GetModelInfos Error:', e);
            return [];
        }
    }

    public async getModels(): Promise<string[]> {
        const infos = await this.getModelInfos();
        return infos.map((m) => m.id);
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








