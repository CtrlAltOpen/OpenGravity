import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { OllamaService } from './ollamaService';
import { OllamaCompletionProvider } from './completionProvider';

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

    // Register Apply Code Command
    context.subscriptions.push(vscode.commands.registerCommand('opengravity.applyCode', async (code: string) => {
        const editor = vscode.window.activeTextEditor?.document.uri.scheme === 'file' ? vscode.window.activeTextEditor : lastActiveTextEditor;
        if (editor) {
            const success = await editor.edit(editBuilder => {
                if (!editor.selection.isEmpty) {
                    editBuilder.replace(editor.selection, code);
                } else {
                    editBuilder.insert(editor.selection.active, code);
                }
            });
            if (success) {
                await editor.document.save();
            }
        }
    }));

    // Register Inline Completion Provider
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

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'chat':
                        await this._handleChat(message.text, message.images || [], message.model);
                        break;
                    case 'applyCode':
                        vscode.commands.executeCommand('opengravity.applyCode', message.text);
                        break;
                    case 'getModels':
                        const models = await this._ollamaService.getModels();
                        const activeModels = await this._ollamaService.getActiveModels();
                        this._view?.webview.postMessage({ command: 'modelsList', models: models, activeModels: activeModels });
                        break;
                    case 'setModel':
                        await vscode.workspace.getConfiguration('opengravity').update('model', message.model, vscode.ConfigurationTarget.Global);
                        const active = await this._ollamaService.getActiveModels();
                        this._view?.webview.postMessage({ command: 'updateActiveModels', activeModels: active });
                        break;
                    case 'getSettings':
                        const config = vscode.workspace.getConfiguration('opengravity');
                        this._view?.webview.postMessage({
                            command: 'settings',
                            model: config.get<string>('model', 'llama3')
                        });
                        break;
                    case 'cancelChat':
                        this._ollamaService.cancelChat();
                        break;
                }
            }
        );
    }

    private async _handleChat(text: string, images: string[], overrideModel?: string) {
        try {
            // Gather Context
            let contextMsg = '';

            // 1. All Open Text Documents
            const documents = vscode.workspace.textDocuments;
            if (documents.length > 0) {
                contextMsg += '\n\n<open_files>\n';
                for (const doc of documents) {
                    if (doc.uri.scheme === 'file' && !doc.fileName.includes(path.sep + 'node_modules' + path.sep)) {
                        const fileName = path.basename(doc.fileName);
                        contextMsg += `<file name="${fileName}" path="${doc.uri.fsPath}">\n${doc.getText()}\n</file>\n`;
                    }
                }
                contextMsg += '</open_files>';
            }

            // 2. File Tree (Simplified)
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders) {
                const tree = await this._getFileTree(workspaceFolders[0].uri);
                contextMsg += `\n\n<file_tree>\n${tree}\n</file_tree>`;
            }

            // Construct Prompt with System Instructions
            const systemPrompt = `You are "OpenGravity", an expert coding assistant acting as an agent within VS Code.
Your goal is to be helpful, concise, and accurate and you must always use perfect grammar and spelling.
You have access to the user's OPEN FILES and the PROJECT STRUCTURE in the XML tags below.
<open_files> tags contain the contents of all files currently open in the editor.
<file_tree> tags contain the project structure and hierarchy.
If you need to read the contents of a file that is in the <file_tree> but not in the <open_files>, you MUST request it by outputting the following exact syntax: [READ_FILE: path/to/file.ext]. The system will read the file and provide it to you so you can complete the answer.
CRITICAL CONSTRAINT: For ANY complex instruction or code change, you MUST FIRST output an implementation plan wrapped entirely in <plan> ... </plan> tags!
You are strongly FORBIDDEN from writing any markdown code blocks (\`\`\`) in your initial response! You must only output the plan. You will only be allowed to output actual code blocks AFTER the user responds with "I approve the exact plan...".
Use this context to answer questions about the codebase without needing the user to copy-paste code.
Always answer the user's question directly.`;

            const fullSystemContext = `${systemPrompt}\n${contextMsg}`;

            if (this._chatHistory.length === 0) {
                this._chatHistory.push({
                    role: 'system',
                    content: fullSystemContext
                });
            } else {
                // Keep context fresh without infinitely duplicating file contents into the chat stream!
                this._chatHistory[0].content = fullSystemContext;
            }

            this._chatHistory.push({
                role: 'user',
                content: text,
                images: images.length > 0 ? images : undefined
            });

            let iterations = 0;
            const maxIterations = 10;
            let finalMetrics: any = null;

            while (iterations < maxIterations) {
                let fullResponse = '';
                const metrics = await this._ollamaService.chat(this._chatHistory, (chunk) => {
                    fullResponse += chunk;
                    this._view?.webview.postMessage({ command: 'chatResponse', text: chunk });
                }, overrideModel);

                if (metrics && metrics.aborted) {
                    this._chatHistory.push({
                        role: 'assistant',
                        content: fullResponse + "\n\n*[User physically canceled response generation]*"
                    });
                    finalMetrics = metrics;
                    break;
                }

                const matches = [...fullResponse.matchAll(/\[READ_FILE:\s*(.*?)\]/g)];
                if (matches.length > 0) {
                    let readResults = "";
                    for (const match of matches) {
                        const filePath = match[1].trim();
                        let fileContent = 'Error: File not found or cannot be read.';
                        try {
                            const workspaceFolders = vscode.workspace.workspaceFolders;
                            if (workspaceFolders) {
                                const fullPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceFolders[0].uri.fsPath, filePath);
                                if (fs.existsSync(fullPath)) {
                                    fileContent = fs.readFileSync(fullPath, 'utf8');
                                }
                            }
                        } catch (err) { }
                        readResults += `\nContents of ${filePath}:\n\`\`\`\n${fileContent}\n\`\`\`\n`;
                        this._view?.webview.postMessage({ command: 'chatResponse', text: ` [[FILE_READ_CHIP: ${filePath}]] ` });
                    }

                    this._chatHistory.push({
                        role: 'assistant',
                        content: fullResponse
                    });

                    this._chatHistory.push({
                        role: 'user',
                        content: `[System Response] Previously requested files have been successfully retrieved:\n${readResults}\nPlease continue answering my original request using this new code context.`
                    });

                    this._view?.webview.postMessage({ command: 'showLoading' });

                    iterations++;
                } else {
                    this._chatHistory.push({
                        role: 'assistant',
                        content: fullResponse
                    });
                    finalMetrics = metrics;
                    break;
                }
            }

            this._view?.webview.postMessage({ command: 'chatDone', metrics: finalMetrics });
        } catch (e: any) {
            this._view?.webview.postMessage({ command: 'chatResponse', text: `Error: ${e.message}` });
            this._view?.webview.postMessage({ command: 'chatDone' });
        }
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

        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'index.html');
        let htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');

        // Replace placeholders with actual URIs
        htmlContent = htmlContent.replace('${scriptUri}', scriptUri.toString());
        htmlContent = htmlContent.replace('${styleUri}', styleUri.toString());
        htmlContent = htmlContent.replace('${logoUri}', logoUri.toString());

        // Add CSP
        const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline';">`;
        htmlContent = htmlContent.replace('<!-- CSP -->', csp);

        return htmlContent;
    }
}
