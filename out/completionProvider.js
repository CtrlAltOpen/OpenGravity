"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaCompletionProvider = void 0;
const vscode = require("vscode");
const ollamaService_1 = require("./ollamaService");
class OllamaCompletionProvider {
    constructor() {
        this._ollamaService = new ollamaService_1.OllamaService();
    }
    async provideInlineCompletionItems(document, position, context, token) {
        const config = vscode.workspace.getConfiguration('opengravity');
        if (!config.get('enableAutocomplete', true)) {
            return [];
        }
        const debounceMs = Math.max(50, config.get('autocompleteDebounceMs', 300));
        const contextSize = Math.max(200, config.get('autocompleteContextLength', 2000));
        const autocompleteMaxTokens = Math.max(16, config.get('autocompleteMaxTokens', 128));
        // Suffix context for FIM — a modest window after the cursor
        const suffixSize = Math.floor(contextSize / 4);
        return new Promise((resolve) => {
            if (this._timer) {
                clearTimeout(this._timer);
            }
            this._timer = setTimeout(async () => {
                if (token.isCancellationRequested) {
                    resolve([]);
                    return;
                }
                const docEnd = document.lineAt(document.lineCount - 1).range.end;
                const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position)).slice(-contextSize);
                const suffix = document.getText(new vscode.Range(position, docEnd)).slice(0, suffixSize);
                const completion = await this._ollamaService.generate(prefix, {
                    maxTokens: autocompleteMaxTokens,
                    suffix
                });
                if (completion && !token.isCancellationRequested) {
                    resolve([new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))]);
                }
                else {
                    resolve([]);
                }
            }, debounceMs);
        });
    }
}
exports.OllamaCompletionProvider = OllamaCompletionProvider;
//# sourceMappingURL=completionProvider.js.map