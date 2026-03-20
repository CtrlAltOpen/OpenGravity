import * as vscode from 'vscode';
import { OllamaService } from './ollamaService';

export class OllamaCompletionProvider implements vscode.InlineCompletionItemProvider {
    private _ollamaService: OllamaService;
    private _timer: NodeJS.Timeout | undefined;

    constructor() {
        this._ollamaService = new OllamaService();
    }

    public async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[]> {

        const config = vscode.workspace.getConfiguration('opengravity');
        if (!config.get<boolean>('enableAutocomplete', true)) {
            return [];
        }

        const debounceMs = Math.max(50, config.get<number>('autocompleteDebounceMs', 300));
        const contextSize = Math.max(200, config.get<number>('autocompleteContextLength', 2000));
        const autocompleteMaxTokens = Math.max(16, config.get<number>('autocompleteMaxTokens', 128));
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
                } else {
                    resolve([]);
                }
            }, debounceMs);
        });
    }
}
