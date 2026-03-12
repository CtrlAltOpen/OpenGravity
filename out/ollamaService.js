"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaService = void 0;
const vscode = require("vscode");
class OllamaService {
    constructor() {
        this._abortController = new AbortController();
    }
    _getProviderConfig(modelOverride) {
        const config = vscode.workspace.getConfiguration('opengravity');
        const provider = config.get('provider', 'ollama');
        const url = config.get('url', provider === 'lmstudio' ? 'http://localhost:1234' : 'http://localhost:11434');
        const model = modelOverride || config.get('model', 'llama3');
        const temp = config.get('temperature', 0.2);
        const maxTokens = config.get('maxTokens', -1);
        const numCtx = config.get('contextLength', 8192);
        const topP = config.get('topP', 0.5);
        const topK = config.get('topK', 40);
        const openAiCompatible = provider === 'lmstudio' || provider === 'llamacpp' || provider === 'openaiCompatible';
        return { provider, url, model, temp, maxTokens, numCtx, topP, topK, openAiCompatible };
    }
    _buildChatRequest(messages, modelOverride, stream, tools) {
        const { url, model, temp, maxTokens, numCtx, topP, topK, openAiCompatible } = this._getProviderConfig(modelOverride);
        if (openAiCompatible) {
            const body = {
                model,
                messages,
                stream,
                temperature: temp,
                top_p: topP
            };
            if (maxTokens !== -1) {
                body.max_tokens = maxTokens;
            }
            if (tools && tools.length > 0) {
                body.tools = tools;
                body.tool_choice = 'auto';
            }
            return {
                fullUrl: `${url.replace(/\/$/, '')}/v1/chat/completions`,
                body,
                openAiCompatible
            };
        }
        const body = {
            model,
            messages,
            stream,
            options: {
                temperature: temp,
                num_ctx: numCtx,
                top_p: topP,
                top_k: topK
            }
        };
        if (maxTokens !== -1) {
            body.options.num_predict = maxTokens;
        }
        if (tools && tools.length > 0) {
            body.tools = tools;
        }
        return {
            fullUrl: `${url.replace(/\/$/, '')}/api/chat`,
            body,
            openAiCompatible
        };
    }
    async chat(messages, onChunk, modelOverride) {
        const request = this._buildChatRequest(messages, modelOverride, true);
        try {
            const response = await fetch(request.fullUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
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
                    if (request.openAiCompatible) {
                        if (line.includes('[DONE]')) {
                            return { done: true };
                        }
                        if (line.startsWith('data: ')) {
                            try {
                                const json = JSON.parse(line.slice(6));
                                if (json.choices && json.choices[0].delta && json.choices[0].delta.content) {
                                    onChunk(json.choices[0].delta.content);
                                }
                            }
                            catch {
                                // Ignore malformed chunks while streaming.
                            }
                        }
                    }
                    else {
                        try {
                            const json = JSON.parse(line);
                            if (json.message && json.message.content) {
                                onChunk(json.message.content);
                            }
                            if (json.done) {
                                return json;
                            }
                            if (json.error) {
                                throw new Error(json.error);
                            }
                        }
                        catch {
                            // Ignore malformed chunks while streaming.
                        }
                    }
                }
            }
            if (request.openAiCompatible)
                return { done: true };
            return null;
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
        const request = this._buildChatRequest(messages, modelOverride, false, tools);
        try {
            const response = await fetch(request.fullUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request.body),
                signal: this._abortController.signal
            });
            if (!response.ok) {
                throw new Error(`Local API Error: ${response.status} ${response.statusText}`);
            }
            const json = await response.json();
            if (request.openAiCompatible) {
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
    async generate(prompt) {
        const config = vscode.workspace.getConfiguration('opengravity');
        const provider = config.get('provider', 'ollama');
        const url = config.get('url', provider === 'lmstudio' ? 'http://localhost:1234' : 'http://localhost:11434');
        const model = config.get('model', 'llama3');
        const temp = config.get('temperature', 0.2);
        const openAiCompatible = provider === 'lmstudio' || provider === 'llamacpp' || provider === 'openaiCompatible';
        if (openAiCompatible) {
            const fullUrl = `${url.replace(/\/$/, '')}/v1/chat/completions`;
            const body = {
                model: model,
                messages: [{ role: 'user', content: prompt }],
                stream: false,
                temperature: temp,
                max_tokens: 50
            };
            try {
                const response = await fetch(fullUrl, {
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
        const fullUrl = `${url.replace(/\/$/, '')}/api/generate`;
        const body = {
            model: model,
            prompt: prompt,
            stream: false,
            options: {
                temperature: temp,
                num_predict: 50
            }
        };
        try {
            const response = await fetch(fullUrl, {
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
    async getModels() {
        const config = vscode.workspace.getConfiguration('opengravity');
        const provider = config.get('provider', 'ollama');
        const url = config.get('url', provider === 'lmstudio' ? 'http://localhost:1234' : 'http://localhost:11434');
        const openAiCompatible = provider === 'lmstudio' || provider === 'llamacpp' || provider === 'openaiCompatible';
        const fullUrl = openAiCompatible
            ? `${url.replace(/\/$/, '')}/v1/models`
            : `${url.replace(/\/$/, '')}/api/tags`;
        try {
            const response = await fetch(fullUrl);
            if (!response.ok) {
                return [];
            }
            const json = await response.json();
            if (openAiCompatible) {
                return (json.data || []).map((m) => m.id);
            }
            return (json.models || []).map((m) => m.name);
        }
        catch (e) {
            console.error('GetModels Error:', e);
            return [];
        }
    }
    async getActiveModels() {
        const config = vscode.workspace.getConfiguration('opengravity');
        const provider = config.get('provider', 'ollama');
        const url = config.get('url', provider === 'lmstudio' ? 'http://localhost:1234' : 'http://localhost:11434');
        if (provider !== 'ollama') {
            return [];
        }
        const fullUrl = `${url.replace(/\/$/, '')}/api/ps`;
        try {
            const response = await fetch(fullUrl);
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