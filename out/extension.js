"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const ollamaService_1 = require("./ollamaService");
const completionProvider_1 = require("./completionProvider");
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
    // Register Apply Code Command
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
                // Failsafe: If no filename could be parsed, open an Untitled document to prevent overwriting the active editor!
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
    // Register Inline Completion Provider
    const inlineProvider = vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, new completionProvider_1.OllamaCompletionProvider());
    context.subscriptions.push(inlineProvider);
}
class OllamaViewProvider {
    constructor(extensionUri) {
        this._chatHistory = [];
        this._extensionUri = extensionUri;
        this._ollamaService = new ollamaService_1.OllamaService();
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
        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'chat':
                    await this._handleChat(message.text, message.images || [], message.model);
                    break;
                case 'applyCode':
                    vscode.commands.executeCommand('opengravity.applyCode', message.changes || message.text);
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
                        model: config.get('model', 'llama3')
                    });
                    break;
                case 'cancelChat':
                    this._ollamaService.cancelChat();
                    break;
            }
        });
    }
    async _handleChat(text, images, overrideModel) {
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
            // Get Custom System overrides
            const config = vscode.workspace.getConfiguration('opengravity');
            const customSystemPrompt = config.get('systemPrompt', '');
            // Construct Prompt with System Instructions
            const systemPrompt = `You are "OpenGravity", an expert coding assistant acting as an agent within VS Code.
Your goal is to be helpful, concise, and accurate and you must always use perfect grammar and spelling.
You have access to the user's OPEN FILES and the PROJECT STRUCTURE in the XML tags below.
<open_files> tags contain the contents of all files currently open in the editor.
<file_tree> tags contain the project structure and hierarchy.
If you need to read the contents of a file that is in the <file_tree> but not in the <open_files>, you MUST request it by outputting the following exact syntax: [READ_FILE: path/to/file.ext]. The system will read the file and provide it to you so you can complete the answer.
CRITICAL CONSTRAINT: For ANY complex instruction or code change, you MUST FIRST output an implementation plan wrapped entirely in <plan> ... </plan> tags!
You are strongly FORBIDDEN from writing any markdown code blocks (\`\`\`) in your initial response! You must only output the plan. You will only be allowed to output actual code blocks AFTER the user responds with "I approve the exact plan...".

FORMATTING REQUIREMENTS:
- Use markdown to properly format all text.
- Use bullet lists where appropriate to organize explanations.
- Logically group code changes by file.
- Clearly note the exact filename in bold BEFORE any code block (e.g., **path/to/filename.ts**).

Use this context to answer questions about the codebase without needing the user to copy-paste code.
Always answer the user's question directly.
${customSystemPrompt ? `\nUSER SPECIFIC INSTRUCTIONS:\n${customSystemPrompt}\n` : ''}`;
            const fullSystemContext = `${systemPrompt}\n${contextMsg}`;
            if (this._chatHistory.length === 0) {
                this._chatHistory.push({
                    role: 'system',
                    content: fullSystemContext
                });
            }
            else {
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
            let finalMetrics = null;
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
                        }
                        catch (err) { }
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
                }
                else {
                    this._chatHistory.push({
                        role: 'assistant',
                        content: fullResponse
                    });
                    finalMetrics = metrics;
                    break;
                }
            }
            this._view?.webview.postMessage({ command: 'chatDone', metrics: finalMetrics });
        }
        catch (e) {
            this._view?.webview.postMessage({ command: 'chatResponse', text: `Error: ${e.message}` });
            this._view?.webview.postMessage({ command: 'chatDone' });
        }
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
        // Replace placeholders with actual URIs
        htmlContent = htmlContent.replace('${scriptUri}', scriptUri.toString());
        htmlContent = htmlContent.replace('${styleUri}', styleUri.toString());
        htmlContent = htmlContent.replace('${logoUri}', logoUri.toString());
        htmlContent = htmlContent.replace('${markedUri}', markedUri.toString());
        // Add CSP
        const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline';">`;
        htmlContent = htmlContent.replace('<!-- CSP -->', csp);
        return htmlContent;
    }
}
OllamaViewProvider.viewType = 'opengravity.chatView';
//# sourceMappingURL=extension.js.map