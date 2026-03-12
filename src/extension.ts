import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { OllamaService } from './ollamaService';
import { OllamaCompletionProvider } from './completionProvider';
import { AgentRuntime } from './agentRuntime';
type PresetName = 'balanced' | 'deterministic' | 'fast';

function getPresetValues(preset: PresetName): Record<string, unknown> {
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

async function applyPreset(preset: PresetName): Promise<void> {
    const config = vscode.workspace.getConfiguration('opengravity');
    const values = getPresetValues(preset);

    for (const [key, value] of Object.entries(values)) {
        await config.update(key, value, vscode.ConfigurationTarget.Global);
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('OpenGravity is now active!');

    const provider = new OllamaViewProvider(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(OllamaViewProvider.viewType, provider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    let lastActiveTextEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && editor.document.uri.scheme === 'file') {
            lastActiveTextEditor = editor;
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('opengravity.applyCode', async (payload: { file: string, code: string }[] | string) => {
        if (typeof payload === 'string') {
            const editor = vscode.window.activeTextEditor?.document.uri.scheme === 'file' ? vscode.window.activeTextEditor : lastActiveTextEditor;
            if (editor) {
                const success = await editor.edit(editBuilder => {
                    if (!editor.selection.isEmpty) {
                        editBuilder.replace(editor.selection, payload);
                    } else {
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

            let targetUri: vscode.Uri | undefined;
            const workspaceFolders = vscode.workspace.workspaceFolders;

            if (workspaceFolders) {
                const root = workspaceFolders[0].uri.fsPath;
                if (path.isAbsolute(change.file)) {
                    targetUri = vscode.Uri.file(change.file);
                } else {
                    targetUri = vscode.Uri.file(path.join(root, change.file));
                }
            }

            let editorToUse: vscode.TextEditor | undefined;
            let isNewFile = false;

            if (targetUri && fs.existsSync(targetUri.fsPath)) {
                const doc = await vscode.workspace.openTextDocument(targetUri);
                editorToUse = await vscode.window.showTextDocument(doc, { preview: false });
            } else if (targetUri) {
                try {
                    fs.mkdirSync(path.dirname(targetUri.fsPath), { recursive: true });
                    fs.writeFileSync(targetUri.fsPath, '');
                    const doc = await vscode.workspace.openTextDocument(targetUri);
                    editorToUse = await vscode.window.showTextDocument(doc, { preview: false });
                    isNewFile = true;
                } catch (e) {
                    editorToUse = vscode.window.activeTextEditor?.document.uri.scheme === 'file' ? vscode.window.activeTextEditor : lastActiveTextEditor;
                }
            } else {
                editorToUse = vscode.window.activeTextEditor?.document.uri.scheme === 'file' ? vscode.window.activeTextEditor : lastActiveTextEditor;
            }

            if (editorToUse) {
                const document = editorToUse.document;
                const success = await editorToUse.edit(editBuilder => {
                    if (change.file || isNewFile) {
                        const fullRange = new vscode.Range(
                            document.positionAt(0),
                            document.positionAt(document.getText().length)
                        );
                        editBuilder.replace(fullRange, change.code);
                    } else {
                        if (!editorToUse!.selection.isEmpty) {
                            editBuilder.replace(editorToUse!.selection, change.code);
                        } else {
                            editBuilder.insert(editorToUse!.selection.active, change.code);
                        }
                    }
                });

                if (success) {
                    await editorToUse.document.save();
                }
            }
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('opengravity.applyPreset', async (presetArg?: string) => {
        let preset: PresetName | undefined;
        if (presetArg === 'balanced' || presetArg === 'deterministic' || presetArg === 'fast') {
            preset = presetArg;
        }

        if (!preset) {
            const picked = await vscode.window.showQuickPick([
                { label: 'Balanced', description: 'Best overall quality/speed', value: 'balanced' as const },
                { label: 'Deterministic', description: 'Highest stability, lowest randomness', value: 'deterministic' as const },
                { label: 'Fast', description: 'Lower latency and shorter outputs', value: 'fast' as const }
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
        const service = new OllamaService();
        const diagnostics = await service.diagnoseConnection();

        if (!diagnostics.ok) {
            const details = diagnostics.testedEndpoints.join(' | ');
            vscode.window.showErrorMessage(`OpenGravity connection failed (${diagnostics.provider}). ${diagnostics.error || ''} ${details}`.trim());
            return;
        }

        const config = vscode.workspace.getConfiguration('opengravity');
        const currentModel = config.get<string>('model', '');
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
    const inlineProvider = vscode.languages.registerInlineCompletionItemProvider(
        { pattern: '**' },
        new OllamaCompletionProvider()
    );
    context.subscriptions.push(inlineProvider);
}

class OllamaViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'opengravity.chatView';
    private _view?: vscode.WebviewView;
    private readonly _extensionUri: vscode.Uri;
    private _ollamaService: OllamaService;
    private _chatHistory: { role: string, content: string, images?: string[] }[] = [];

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
        this._ollamaService = new OllamaService();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'src', 'webview'),
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'chat':
                        await this._handleChat(message.text, message.images || [], message.model, message.thinkingLevel);
                        break;
                    case 'applyCode':
                        vscode.commands.executeCommand('opengravity.applyCode', message.changes || message.text);
                        break;
                    case 'getModels':
                        {
                            const models = await this._ollamaService.getModels();
                            const activeModels = await this._ollamaService.getActiveModels();
                            this._view?.webview.postMessage({ command: 'modelsList', models: models, activeModels: activeModels });
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
                                model: config.get<string>('model', 'qwen2.5-coder:7b'),
                                thinkingLevel: config.get<string>('thinkingLevel', 'medium')
                            });
                        }
                        break;
                    case 'setThinkingLevel':
                        await vscode.workspace.getConfiguration('opengravity').update('thinkingLevel', message.thinkingLevel || 'medium', vscode.ConfigurationTarget.Global);
                        break;
                    case 'cancelChat':
                        this._ollamaService.cancelChat();
                        break;
                }
            }
        );
    }

    private async _handleChat(text: string, images: string[], overrideModel?: string, thinkingLevel?: string) {
        try {
            const contextMsg = await this._buildContextMessage();
            const config = vscode.workspace.getConfiguration('opengravity');
            const customSystemPrompt = config.get<string>('systemPrompt', '');
            const selectedThinking = (thinkingLevel || config.get<string>('thinkingLevel', 'medium') || 'medium').toLowerCase();

            let thinkingInstruction = 'Thinking level is MEDIUM: balance depth and speed for reliable coding changes.';
            if (selectedThinking === 'off') {
                thinkingInstruction = 'Thinking level is OFF: respond quickly with minimal deliberation while staying correct.';
            } else if (selectedThinking === 'low') {
                thinkingInstruction = 'Thinking level is LOW: keep reasoning brief and prioritize speed.';
            } else if (selectedThinking === 'high') {
                thinkingInstruction = 'Thinking level is HIGH: spend extra effort validating assumptions, edge cases, and correctness.';
            }

            const systemPrompt = `You are OpenGravity, a local-first coding agent running inside VS Code.
Be precise, pragmatic, and safe.
You can inspect and modify the workspace through tools.
Before writing or changing code, gather enough evidence from project files and search results.
If a request is ambiguous, state your assumptions briefly and proceed with the most likely path.
${AgentRuntime.getToolInstructions()}
Return concise markdown in final answers.
${thinkingInstruction}

${customSystemPrompt ? `\nUser custom instructions:\n${customSystemPrompt}` : ''}`;

            const fullSystemContext = `${systemPrompt}\n\n${contextMsg}`;
            if (this._chatHistory.length === 0) {
                this._chatHistory.push({ role: 'system', content: fullSystemContext });
            } else {
                this._chatHistory[0].content = fullSystemContext;
            }

            this._view?.webview.postMessage({ command: 'showLoading' });

            const runtime = new AgentRuntime(this._ollamaService, {
                onStatus: (status) => this._view?.webview.postMessage({ command: 'chatResponse', text: status })
            });

            const result = await runtime.run({
                history: this._chatHistory,
                userMessage: {
                    role: 'user',
                    content: text,
                    images: images.length > 0 ? images : undefined
                },
                modelOverride: overrideModel
            });

            this._chatHistory = result.updatedHistory;
            this._view?.webview.postMessage({ command: 'chatResponse', text: result.finalResponse });
            this._view?.webview.postMessage({ command: 'chatDone', metrics: result.metrics });
        } catch (e: any) {
            this._view?.webview.postMessage({ command: 'chatResponse', text: `Error: ${e.message}` });
            this._view?.webview.postMessage({ command: 'chatDone' });
        }
    }

    private async _buildContextMessage(): Promise<string> {
        let contextMsg = '';

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

    private async _getFileTree(folderUri: vscode.Uri, depth: number = 2): Promise<string> {
        let tree = '';
        try {
            const children = await vscode.workspace.fs.readDirectory(folderUri);
            for (const [name, type] of children) {
                if (name.startsWith('.') || name === 'node_modules' || name === 'out' || name === 'dist') continue;

                tree += `- ${name}\n`;
                if (type === vscode.FileType.Directory && depth > 0) {
                    const subUri = vscode.Uri.joinPath(folderUri, name);
                    const subChildren = await this._getFileTree(subUri, depth - 1);
                    tree += subChildren.split('\n').map(line => line ? `  ${line}` : '').join('\n');
                }
            }
        } catch (e) {
            return '';
        }
        return tree;
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
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










