"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const ollamaService_1 = require("./ollamaService");
const completionProvider_1 = require("./completionProvider");
const agentRuntime_1 = require("./agentRuntime");
function getPresetValues(preset) {
    switch (preset) {
        case 'deterministic':
            return {
                presetProfile: 'deterministic',
                temperature: 0.05,
                topP: 0.7,
                topK: 20,
                repeatPenalty: 1.15,
                presencePenalty: 0,
                frequencyPenalty: 0,
                seed: 42,
                maxTokens: 4096,
                contextLength: 16384,
                agentMaxSteps: 8,
                autocompleteContextLength: 2000,
                autocompleteMaxTokens: 96,
                autocompleteDebounceMs: 280
            };
        case 'fast':
            return {
                presetProfile: 'fast',
                temperature: 0.2,
                topP: 0.9,
                topK: 40,
                repeatPenalty: 1.05,
                presencePenalty: 0,
                frequencyPenalty: 0,
                seed: -1,
                maxTokens: 2048,
                contextLength: 8192,
                agentMaxSteps: 5,
                autocompleteContextLength: 1200,
                autocompleteMaxTokens: 64,
                autocompleteDebounceMs: 180
            };
        case 'balanced':
        default:
            return {
                presetProfile: 'balanced',
                temperature: 0.15,
                topP: 0.9,
                topK: 40,
                repeatPenalty: 1.1,
                presencePenalty: 0,
                frequencyPenalty: 0,
                seed: 42,
                maxTokens: 4096,
                contextLength: 16384,
                agentMaxSteps: 8,
                autocompleteContextLength: 2000,
                autocompleteMaxTokens: 128,
                autocompleteDebounceMs: 300
            };
    }
}
async function applyPreset(preset) {
    const config = vscode.workspace.getConfiguration('opengravity');
    const values = getPresetValues(preset);
    for (const [key, value] of Object.entries(values)) {
        await config.update(key, value, vscode.ConfigurationTarget.Global);
    }
}
function activate(context) {
    console.log('OpenGravity is now active!');
    const provider = new OllamaViewProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(OllamaViewProvider.viewType, provider, {
        webviewOptions: { retainContextWhenHidden: true }
    }));
    let lastActiveTextEditor = vscode.window.activeTextEditor;
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && editor.document.uri.scheme === 'file') {
            lastActiveTextEditor = editor;
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('opengravity.applyCode', async (payload) => {
        if (typeof payload === 'string') {
            const editor = vscode.window.activeTextEditor?.document.uri.scheme === 'file' ? vscode.window.activeTextEditor : lastActiveTextEditor;
            if (editor) {
                const success = await editor.edit(editBuilder => {
                    if (!editor.selection.isEmpty) {
                        editBuilder.replace(editor.selection, payload);
                    }
                    else {
                        editBuilder.insert(editor.selection.active, payload);
                    }
                });
                if (success) {
                    await editor.document.save();
                }
            }
            return;
        }
        for (const change of payload) {
            if (!change.file || change.file.trim() === '') {
                const doc = await vscode.workspace.openTextDocument({ content: change.code });
                await vscode.window.showTextDocument(doc, { preview: false });
                continue;
            }
            let targetUri;
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders) {
                const root = workspaceFolders[0].uri.fsPath;
                if (path.isAbsolute(change.file)) {
                    targetUri = vscode.Uri.file(change.file);
                }
                else {
                    targetUri = vscode.Uri.file(path.join(root, change.file));
                }
            }
            let editorToUse;
            let isNewFile = false;
            if (targetUri && fs.existsSync(targetUri.fsPath)) {
                const doc = await vscode.workspace.openTextDocument(targetUri);
                editorToUse = await vscode.window.showTextDocument(doc, { preview: false });
            }
            else if (targetUri) {
                try {
                    fs.mkdirSync(path.dirname(targetUri.fsPath), { recursive: true });
                    fs.writeFileSync(targetUri.fsPath, '');
                    const doc = await vscode.workspace.openTextDocument(targetUri);
                    editorToUse = await vscode.window.showTextDocument(doc, { preview: false });
                    isNewFile = true;
                }
                catch (e) {
                    editorToUse = vscode.window.activeTextEditor?.document.uri.scheme === 'file' ? vscode.window.activeTextEditor : lastActiveTextEditor;
                }
            }
            else {
                editorToUse = vscode.window.activeTextEditor?.document.uri.scheme === 'file' ? vscode.window.activeTextEditor : lastActiveTextEditor;
            }
            if (editorToUse) {
                const document = editorToUse.document;
                const success = await editorToUse.edit(editBuilder => {
                    if (change.file || isNewFile) {
                        const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
                        editBuilder.replace(fullRange, change.code);
                    }
                    else {
                        if (!editorToUse.selection.isEmpty) {
                            editBuilder.replace(editorToUse.selection, change.code);
                        }
                        else {
                            editBuilder.insert(editorToUse.selection.active, change.code);
                        }
                    }
                });
                if (success) {
                    await editorToUse.document.save();
                }
            }
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('opengravity.applyPreset', async (presetArg) => {
        let preset;
        if (presetArg === 'balanced' || presetArg === 'deterministic' || presetArg === 'fast') {
            preset = presetArg;
        }
        if (!preset) {
            const picked = await vscode.window.showQuickPick([
                { label: 'Balanced', description: 'Best overall quality/speed', value: 'balanced' },
                { label: 'Deterministic', description: 'Highest stability, lowest randomness', value: 'deterministic' },
                { label: 'Fast', description: 'Lower latency and shorter outputs', value: 'fast' }
            ], {
                placeHolder: 'Select OpenGravity preset'
            });
            preset = picked?.value;
        }
        if (!preset) {
            return;
        }
        await applyPreset(preset);
        vscode.window.showInformationMessage(`OpenGravity preset applied: ${preset}.`);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('opengravity.testConnection', async () => {
        const service = new ollamaService_1.OllamaService();
        const diagnostics = await service.diagnoseConnection();
        if (!diagnostics.ok) {
            const details = diagnostics.testedEndpoints.join(' | ');
            vscode.window.showErrorMessage(`OpenGravity connection failed (${diagnostics.provider}). ${diagnostics.error || ''} ${details}`.trim());
            return;
        }
        const config = vscode.workspace.getConfiguration('opengravity');
        const currentModel = config.get('model', '');
        const models = diagnostics.models;
        let selectedModel = currentModel;
        if (models.length > 0) {
            if (!currentModel || !models.includes(currentModel)) {
                selectedModel = models[0];
                await config.update('model', selectedModel, vscode.ConfigurationTarget.Global);
            }
        }
        const modelPart = selectedModel
            ? `Model: ${selectedModel}`
            : 'Model: (none reported by endpoint)';
        vscode.window.showInformationMessage(`OpenGravity connected to ${diagnostics.provider} at ${diagnostics.baseUrl}. ${modelPart}`);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('opengravity.clearChat', () => {
        provider.clearChat();
    }));
    const inlineProvider = vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, new completionProvider_1.OllamaCompletionProvider());
    context.subscriptions.push(inlineProvider);
}
class OllamaViewProvider {
    constructor(extensionUri) {
        this._chatHistory = [];
        this._extensionUri = extensionUri;
        this._ollamaService = new ollamaService_1.OllamaService();
    }
    clearChat() {
        this._chatHistory = [];
        this._view?.webview.postMessage({ command: 'clearChat' });
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'src', 'webview'),
                this._extensionUri
            ]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'chat':
                    await this._handleChat(message.text, message.images || [], message.model, message.thinkingLevel, message.mode, message.attachments || []);
                    break;
                case 'applyCode':
                    vscode.commands.executeCommand('opengravity.applyCode', message.changes || message.text);
                    break;
                case 'getModels':
                    {
                        const modelInfos = await this._ollamaService.getModelInfos();
                        const models = modelInfos.map((m) => m.id);
                        const activeModels = await this._ollamaService.getActiveModels();
                        this._view?.webview.postMessage({ command: 'modelsList', models: models, modelInfos: modelInfos, activeModels: activeModels });
                    }
                    break;
                case 'setModel':
                    await vscode.workspace.getConfiguration('opengravity').update('model', message.model, vscode.ConfigurationTarget.Global);
                    {
                        const active = await this._ollamaService.getActiveModels();
                        this._view?.webview.postMessage({ command: 'updateActiveModels', activeModels: active });
                    }
                    break;
                case 'getSettings':
                    {
                        const config = vscode.workspace.getConfiguration('opengravity');
                        this._view?.webview.postMessage({
                            command: 'settings',
                            model: config.get('model', ''),
                            thinkingLevel: config.get('thinkingLevel', 'medium'),
                            chatMode: config.get('chatMode', 'execute')
                        });
                    }
                    break;
                case 'setThinkingLevel':
                    await vscode.workspace.getConfiguration('opengravity').update('thinkingLevel', message.thinkingLevel || 'medium', vscode.ConfigurationTarget.Global);
                    break;
                case 'setChatMode':
                    await vscode.workspace.getConfiguration('opengravity').update('chatMode', message.chatMode || 'execute', vscode.ConfigurationTarget.Global);
                    break;
                case 'cancelChat':
                    this._ollamaService.cancelChat();
                    break;
                case 'clearChat':
                    this._chatHistory = [];
                    break;
            }
        });
    }
    async _handleChat(text, images, overrideModel, thinkingLevel, chatMode, attachments = []) {
        try {
            const contextMsg = await this._buildContextMessage();
            const config = vscode.workspace.getConfiguration('opengravity');
            const customSystemPrompt = config.get('systemPrompt', '');
            const selectedThinking = (thinkingLevel || config.get('thinkingLevel', 'medium') || 'medium').toLowerCase();
            const selectedMode = (chatMode || config.get('chatMode', 'execute') || 'execute').toLowerCase();
            let thinkingInstruction = 'Thinking level is MEDIUM: balance depth and speed for reliable coding changes.';
            let modeInstruction = 'Mode is EXECUTE: you may provide direct implementation guidance and code changes.';
            if (selectedThinking === 'off') {
                thinkingInstruction = 'Thinking level is OFF: respond quickly with minimal deliberation while staying correct.';
            }
            else if (selectedThinking === 'low') {
                thinkingInstruction = 'Thinking level is LOW: keep reasoning brief and prioritize speed.';
            }
            else if (selectedThinking === 'high') {
                thinkingInstruction = 'Thinking level is HIGH: spend extra effort validating assumptions, edge cases, and correctness.';
            }
            if (selectedMode === 'plan') {
                modeInstruction = 'Mode is PLAN: provide an implementation plan and architecture only. Do not output final code unless the user asks to execute.';
            }
            else if (selectedMode === 'review') {
                modeInstruction = 'Mode is REVIEW: prioritize findings, risks, regressions, and missing tests. Findings first.';
            }
            const systemPrompt = `You are OpenGravity, a local-first coding agent running inside VS Code. You run exclusively on local inference (llama.cpp / Ollama / LM Studio) — no cloud calls.
Be precise, pragmatic, and safe. Prefer minimal, targeted edits over rewrites.
You can inspect and modify the workspace through tools. Read files before editing them.
If a request is ambiguous, state your assumptions in one sentence and proceed.
${agentRuntime_1.AgentRuntime.getToolInstructions()}

## Code Output Format
When your final answer contains code for a specific file, place the **workspace-relative path** on the line immediately before its code fence, formatted as a bold inline-code span:

**\`src/path/to/file.ext\`**
\`\`\`language
// code here
\`\`\`

This allows the user to apply changes with one click. Follow these rules:
- One label per code block, referencing the exact file being changed.
- Use the path relative to the workspace root (e.g. \`src/utils/helper.ts\`, not \`/absolute/path\`).
- If multiple files need changes, label each block separately.
- For code snippets with no target file, omit the label.

Return concise markdown in final answers.
${thinkingInstruction}
${modeInstruction}

${customSystemPrompt ? `\nUser custom instructions:\n${customSystemPrompt}` : ''}`;
            const fullSystemContext = `${systemPrompt}\n\n${contextMsg}`;
            if (this._chatHistory.length === 0) {
                this._chatHistory.push({ role: 'system', content: fullSystemContext });
            }
            else {
                this._chatHistory[0].content = fullSystemContext;
            }
            this._view?.webview.postMessage({ command: 'showLoading' });
            const runtime = new agentRuntime_1.AgentRuntime(this._ollamaService, {
                onStatus: (status) => this._view?.webview.postMessage({ command: 'toolStatus', text: status.trim() })
            });
            let attachmentContext = '';
            if (attachments.length > 0) {
                const fileSnippets = attachments.slice(0, 8).map((a) => {
                    const raw = a.content || '';
                    const trimmed = raw.length > 24000 ? `${raw.slice(0, 24000)}\n[truncated]` : raw;
                    return `<attachment name="${a.name}" mime="${a.mimeType || 'text/plain'}">\n${trimmed}\n</attachment>`;
                });
                attachmentContext = `\n\n<attached_files>\n${fileSnippets.join('\n')}\n</attached_files>`;
            }
            const result = await runtime.run({
                history: this._chatHistory,
                userMessage: {
                    role: 'user',
                    content: `${text}${attachmentContext}`,
                    images: images.length > 0 ? images : undefined
                },
                modelOverride: overrideModel
            });
            this._chatHistory = result.updatedHistory;
            this._view?.webview.postMessage({ command: 'chatResponse', text: result.finalResponse });
            this._view?.webview.postMessage({ command: 'chatDone', metrics: result.metrics });
        }
        catch (e) {
            this._view?.webview.postMessage({ command: 'chatResponse', text: `Error: ${e.message}` });
            this._view?.webview.postMessage({ command: 'chatDone' });
        }
    }
    async _buildContextMessage() {
        let contextMsg = '';
        // Include active editor position and selection
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && activeEditor.document.uri.scheme === 'file') {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const rel = workspaceRoot
                ? path.relative(workspaceRoot, activeEditor.document.uri.fsPath).replace(/\\/g, '/')
                : activeEditor.document.uri.fsPath;
            const pos = activeEditor.selection.active;
            if (!activeEditor.selection.isEmpty) {
                const selStart = activeEditor.selection.start;
                const selEnd = activeEditor.selection.end;
                const selText = activeEditor.document.getText(activeEditor.selection);
                contextMsg += `<active_editor path="${rel}" line="${pos.line + 1}" col="${pos.character + 1}">\n<selected_text lines="${selStart.line + 1}-${selEnd.line + 1}">\n${selText}\n</selected_text>\n</active_editor>\n`;
            }
            else {
                contextMsg += `<active_editor path="${rel}" line="${pos.line + 1}" col="${pos.character + 1}" />\n`;
            }
        }
        const documents = vscode.workspace.textDocuments;
        if (documents.length > 0) {
            contextMsg += '<open_files>\n';
            let budget = 120000;
            for (const doc of documents) {
                if (doc.uri.scheme !== 'file' || doc.fileName.includes(path.sep + 'node_modules' + path.sep)) {
                    continue;
                }
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                const rel = workspaceRoot ? path.relative(workspaceRoot, doc.uri.fsPath).replace(/\\/g, '/') : doc.uri.fsPath;
                const text = doc.getText();
                const available = Math.max(0, budget - 500);
                const snippet = text.slice(0, available);
                budget -= snippet.length;
                contextMsg += `<file path="${rel}">\n${snippet}${snippet.length < text.length ? '\n[truncated]' : ''}\n</file>\n`;
                if (budget <= 0) {
                    break;
                }
            }
            contextMsg += '</open_files>\n';
        }
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            const tree = await this._getFileTree(workspaceFolders[0].uri);
            contextMsg += `<file_tree>\n${tree}\n</file_tree>`;
        }
        return contextMsg;
    }
    async _getFileTree(folderUri, depth = 2) {
        let tree = '';
        try {
            const children = await vscode.workspace.fs.readDirectory(folderUri);
            for (const [name, type] of children) {
                if (name.startsWith('.') || name === 'node_modules' || name === 'out' || name === 'dist')
                    continue;
                tree += `- ${name}\n`;
                if (type === vscode.FileType.Directory && depth > 0) {
                    const subUri = vscode.Uri.joinPath(folderUri, name);
                    const subChildren = await this._getFileTree(subUri, depth - 1);
                    tree += subChildren.split('\n').map(line => line ? `  ${line}` : '').join('\n');
                }
            }
        }
        catch (e) {
            return '';
        }
        return tree;
    }
    _getHtmlForWebview(webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'script.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'style.css'));
        const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'opengravitylogo.png'));
        const markedUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'marked.min.js'));
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'index.html');
        let htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');
        htmlContent = htmlContent.replace('${scriptUri}', scriptUri.toString());
        htmlContent = htmlContent.replace('${styleUri}', styleUri.toString());
        htmlContent = htmlContent.replace('${logoUri}', logoUri.toString());
        htmlContent = htmlContent.replace('${markedUri}', markedUri.toString());
        const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline';">`;
        htmlContent = htmlContent.replace('<!-- CSP -->', csp);
        return htmlContent;
    }
}
OllamaViewProvider.viewType = 'opengravity.chatView';
//# sourceMappingURL=extension.js.map