"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaService = void 0;
const path = require("path");
const vscode = require("vscode");
class OllamaService {
    constructor() {
        this._abortController = new AbortController();
    }
    _getProviderConfig(modelOverride) {
        const config = vscode.workspace.getConfiguration('opengravity');
        const provider = config.get('provider', 'ollama');
        const legacyUrl = config.get('url', provider === 'lmstudio' ? 'http://localhost:1234' : 'http://localhost:11434');
        const legacyUrlInspect = config.inspect('url');
        const legacyUrlSet = Boolean(legacyUrlInspect?.globalValue !== undefined
            || legacyUrlInspect?.workspaceValue !== undefined
            || legacyUrlInspect?.workspaceFolderValue !== undefined);
        const providerUrlKeys = {
            ollama: 'ollamaUrl',
            lmstudio: 'lmstudioUrl',
            llamacpp: 'llamacppUrl',
            openaiCompatible: 'openaiCompatibleUrl'
        };
        const providerUrls = {
            ollama: config.get('ollamaUrl', 'http://localhost:11434'),
            lmstudio: config.get('lmstudioUrl', 'http://localhost:1234'),
            llamacpp: config.get('llamacppUrl', 'http://localhost:8080'),
            openaiCompatible: config.get('openaiCompatibleUrl', 'http://localhost:8000')
        };
        const providerUrlKey = providerUrlKeys[provider] || 'ollamaUrl';
        const providerUrlInspect = config.inspect(providerUrlKey);
        const providerUrlSet = Boolean(providerUrlInspect?.globalValue !== undefined
            || providerUrlInspect?.workspaceValue !== undefined
            || providerUrlInspect?.workspaceFolderValue !== undefined);
        let baseUrl = providerUrls[provider] || providerUrls.ollama;
        // Backward compatibility: use legacy URL only if provider-specific URL was never set.
        if (!providerUrlSet && legacyUrlSet && legacyUrl) {
            baseUrl = legacyUrl;
        }
        const model = modelOverride || config.get('model', '') || '';
        const temp = config.get('temperature', 0.15);
        const maxTokens = config.get('maxTokens', 4096);
        const numCtx = config.get('contextLength', 16384);
        const topP = config.get('topP', 0.9);
        const topK = config.get('topK', 40);
        const repeatPenalty = config.get('repeatPenalty', 1.1);
        const presencePenalty = config.get('presencePenalty', 0);
        const frequencyPenalty = config.get('frequencyPenalty', 0);
        const seed = config.get('seed', 42);
        const llamaCppApiMode = config.get('llamacppApiMode', 'openaiCompat');
        const llamaCppChatEndpoint = config.get('llamacppChatEndpoint', '/v1/chat/completions');
        const llamaCppCompletionEndpoint = config.get('llamacppCompletionEndpoint', '/completion');
        let kind = 'ollama';
        if (provider === 'lmstudio' || provider === 'openaiCompatible') {
            kind = 'openaiCompat';
        }
        else if (provider === 'llamacpp') {
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
    _normalizeEndpoint(baseUrl, endpoint) {
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
    _isRecord(value) {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }
    _stringArray(value) {
        if (!Array.isArray(value)) {
            return [];
        }
        return value.map((item) => typeof item === 'string' ? item : '').filter(Boolean);
    }
    _detectCapabilitiesFromMetadata(rawModel, modelId) {
        const caps = new Set();
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
        const toolsExplicit = model.supports_tools === true
            || model.tool_calling === true
            || model.function_calling === true
            || model.tools === true
            || capabilityObj.tools === true
            || capabilityObj.function_calling === true
            || capabilityObj.tool_calling === true;
        if (toolsExplicit) {
            caps.add('tools');
        }
        const thinkingExplicit = model.reasoning === true
            || model.supports_reasoning === true
            || capabilityObj.reasoning === true
            || capabilityObj.thinking === true
            || capabilityObj.reasoner === true;
        if (thinkingExplicit) {
            caps.add('thinking');
        }
        const filesExplicit = model.supports_files === true
            || capabilityObj.files === true
            || capabilityObj.attachments === true;
        if (filesExplicit) {
            caps.add('files');
        }
        return Array.from(caps);
    }
    _extractModelInfosFromPayload(payload, provider) {
        const root = this._isRecord(payload) ? payload : {};
        const fromModels = Array.isArray(root.models) ? root.models : [];
        const fromData = Array.isArray(root.data) ? root.data : [];
        const modelEntries = [...fromModels, ...fromData];
        const infos = [];
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
    _messagesToPrompt(messages) {
        const lines = [];
        for (const message of messages) {
            if (message.role === 'system') {
                lines.push(`System: ${message.content}`);
            }
            else if (message.role === 'user') {
                lines.push(`User: ${message.content}`);
            }
            else if (message.role === 'assistant') {
                lines.push(`Assistant: ${message.content}`);
            }
            else if (message.role === 'tool') {
                lines.push(`Tool: ${message.content}`);
            }
        }
        lines.push('Assistant:');
        return lines.join('\n\n');
    }
    _buildRequest(messages, modelOverride, stream, tools) {
        const cfg = this._getProviderConfig(modelOverride);
        if (cfg.kind === 'openaiCompat') {
            const endpoint = cfg.provider === 'llamacpp'
                ? this._normalizeEndpoint(cfg.baseUrl, cfg.llamaCppChatEndpoint)
                : this._normalizeEndpoint(cfg.baseUrl, '/v1/chat/completions');
            const body = {
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
            const body = {
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
        const body = {
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
    async chat(messages, onChunk, modelOverride) {
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
                if (done)
                    break;
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');
                for (const line of lines) {
                    if (!line.trim())
                        continue;
                    const raw = line.startsWith('data: ') ? line.slice(6) : line;
                    if (raw === '[DONE]') {
                        return { done: true };
                    }
                    try {
                        const json = JSON.parse(raw);
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
                    }
                    catch {
                        // Ignore malformed chunks while streaming.
                    }
                }
            }
            return { done: true };
        }
        catch (error) {
            if (error.name === 'AbortError') {
                return { aborted: true };
            }
            console.error('Ollama Service Error:', error);
            onChunk(`\n\n**Error:** ${error.message}`);
            return null;
        }
    }
    async complete(messages, modelOverride, tools) {
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
            const json = await response.json();
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
        }
        catch (error) {
            if (error.name === 'AbortError') {
                return { text: '', aborted: true };
            }
            throw error;
        }
    }
    _extractToolCalls(rawCalls) {
        if (!Array.isArray(rawCalls)) {
            return [];
        }
        const calls = [];
        for (const call of rawCalls) {
            const fn = call?.function;
            if (!fn?.name) {
                continue;
            }
            let parsedArgs = {};
            if (typeof fn.arguments === 'string') {
                try {
                    parsedArgs = JSON.parse(fn.arguments);
                }
                catch {
                    parsedArgs = {};
                }
            }
            else if (typeof fn.arguments === 'object' && fn.arguments) {
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
    async generate(prompt, options) {
        const cfg = this._getProviderConfig();
        const maxTokens = options?.maxTokens ?? 128;
        if (cfg.kind === 'openaiCompat') {
            const endpoint = cfg.provider === 'llamacpp'
                ? this._normalizeEndpoint(cfg.baseUrl, cfg.llamaCppChatEndpoint)
                : this._normalizeEndpoint(cfg.baseUrl, '/v1/chat/completions');
            const body = {
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
                if (!response.ok)
                    return '';
                const json = await response.json();
                return json.choices?.[0]?.message?.content || '';
            }
            catch {
                return '';
            }
        }
        if (cfg.kind === 'llamacppNative') {
            const endpoint = this._normalizeEndpoint(cfg.baseUrl, cfg.llamaCppCompletionEndpoint);
            const body = {
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
                if (!response.ok)
                    return '';
                const json = await response.json();
                return json.content || json.response || '';
            }
            catch {
                return '';
            }
        }
        const endpoint = this._normalizeEndpoint(cfg.baseUrl, '/api/generate');
        const body = {
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
            const json = await response.json();
            return json.response || '';
        }
        catch (e) {
            console.error('Ollama Generate Error:', e);
            return '';
        }
    }
    _extractModelNames(payload) {
        if (!payload) {
            return [];
        }
        const fromModels = Array.isArray(payload.models)
            ? payload.models.map((m) => m?.id || m?.name)
            : [];
        const fromData = Array.isArray(payload.data)
            ? payload.data.map((m) => m?.id || m?.name)
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
    async diagnoseConnection() {
        const cfg = this._getProviderConfig();
        const testedEndpoints = [];
        const mode = cfg.kind === 'llamacppNative' ? 'llamacpp-native' : cfg.kind;
        let candidates = [];
        if (cfg.kind === 'openaiCompat') {
            candidates = cfg.provider === 'llamacpp' ? ['/v1/models', '/models'] : ['/v1/models'];
        }
        else if (cfg.kind === 'llamacppNative') {
            candidates = ['/props', '/models'];
        }
        else {
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
                const payload = await response.json();
                const models = this._extractModelNames(payload);
                return {
                    ok: true,
                    provider: cfg.provider,
                    mode,
                    baseUrl: cfg.baseUrl,
                    testedEndpoints,
                    models
                };
            }
            catch (error) {
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
    async getModelInfos() {
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
                    const json = await response.json();
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
                        const json = await response.json();
                        const infos = this._extractModelInfosFromPayload(json, cfg.provider);
                        if (infos.length > 0) {
                            return infos;
                        }
                    }
                    catch {
                        // Try next endpoint.
                    }
                }
                return [];
            }
            const response = await fetch(this._normalizeEndpoint(cfg.baseUrl, '/api/tags'));
            if (!response.ok) {
                return [];
            }
            const json = await response.json();
            return this._extractModelInfosFromPayload(json, cfg.provider);
        }
        catch (e) {
            console.error('GetModelInfos Error:', e);
            return [];
        }
    }
    async getModels() {
        const infos = await this.getModelInfos();
        return infos.map((m) => m.id);
    }
    async getActiveModels() {
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
            const json = await response.json();
            return json.models || [];
        }
        catch (e) {
            console.error('Ollama GetActiveModels Error:', e);
            return [];
        }
    }
    cancelChat() {
        this._abortController.abort();
        this._abortController = new AbortController();
    }
}
exports.OllamaService = OllamaService;
//# sourceMappingURL=ollamaService.js.map