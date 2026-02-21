"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaService = void 0;
const vscode = require("vscode");
class OllamaService {
    constructor() {
        this._abortController = new AbortController();
    }
    async chat(messages, onChunk, modelOverride) {
        const config = vscode.workspace.getConfiguration('opengravity');
        const url = config.get('url', 'http://localhost:11434');
        const model = modelOverride || config.get('model', 'llama3');
        const temp = config.get('temperature', 0.2);
        const maxTokens = config.get('maxTokens', -1);
        const fullUrl = `${url.replace(/\/$/, '')}/api/chat`;
        const body = {
            model: model,
            messages: messages,
            stream: true,
            options: {
                temperature: temp
            }
        };
        if (maxTokens !== -1) {
            body.options.num_predict = maxTokens;
        }
        try {
            const response = await fetch(fullUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body),
                signal: this._abortController.signal
            });
            if (!response.ok) {
                throw new Error(`Ollama API Error: ${response.status} ${response.statusText}`);
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
                    try {
                        const json = JSON.parse(line);
                        // Ollama 'chat' endpoint returns 'message' object
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
                    catch (e) {
                        // console.error('Error parsing JSON chunk', e);
                    }
                }
            }
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
    async generate(prompt) {
        const config = vscode.workspace.getConfiguration('opengravity');
        const url = config.get('url', 'http://localhost:11434');
        const model = config.get('model', 'llama3');
        const temp = config.get('temperature', 0.2);
        const fullUrl = `${url.replace(/\/$/, '')}/api/generate`;
        const body = {
            model: model,
            prompt: prompt,
            stream: false,
            options: {
                temperature: temp,
                num_predict: 50 // Short generation for autocomplete
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
        const url = config.get('url', 'http://localhost:11434');
        const fullUrl = `${url.replace(/\/$/, '')}/api/tags`;
        try {
            const response = await fetch(fullUrl);
            if (!response.ok) {
                return [];
            }
            const json = await response.json();
            return json.models.map((m) => m.name);
        }
        catch (e) {
            console.error('Ollama GetModels Error:', e);
            return [];
        }
    }
    async getActiveModels() {
        const config = vscode.workspace.getConfiguration('opengravity');
        const url = config.get('url', 'http://localhost:11434');
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