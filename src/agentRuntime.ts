import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { ChatMessage, OllamaService, ParsedToolCall, ToolDefinition } from './ollamaService';

const exec = promisify(execCallback);

type ToolCall = {
    id?: string;
    tool: string;
    args?: Record<string, any>;
};

type AgentCallbacks = {
    onStatus?: (status: string) => void;
};

type AgentRunInput = {
    history: ChatMessage[];
    userMessage: ChatMessage;
    modelOverride?: string;
};

type AgentRunOutput = {
    finalResponse: string;
    updatedHistory: ChatMessage[];
    metrics?: any;
    aborted?: boolean;
};

type ParsedPatchHunk = {
    oldStart: number;
    lines: string[];
};

type ParsedPatchFile = {
    path: string;
    hunks: ParsedPatchHunk[];
};

export class AgentRuntime {
    private _service: OllamaService;
    private _callbacks: AgentCallbacks;
    private _workspaceRoot: string | undefined;

    constructor(service: OllamaService, callbacks: AgentCallbacks = {}) {
        this._service = service;
        this._callbacks = callbacks;
        this._workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    public static getToolInstructions(): string {
        return `
You can call tools to gather/modify project context.
Preferred mode: native function calling when available.
Fallback mode: output ONLY this exact XML block and nothing else:
<tool_call>
{"tool":"read_file","args":{"path":"src/file.ts"}}
</tool_call>

Allowed tools:
- list_files: args { "path"?: string, "maxEntries"?: number }
- read_file: args { "path": string, "startLine"?: number, "endLine"?: number }
- search_in_files: args { "query": string, "glob"?: string, "maxResults"?: number }
- write_file: args { "path": string, "content": string }
- replace_in_file: args { "path": string, "search": string, "replace": string, "replaceAll"?: boolean }
- apply_unified_diff: args { "patch": string }
- run_terminal_command: args { "command": string }
- fetch_url: args { "url": string, "maxChars"?: number }

Rules:
- Never invent file contents; read before editing.
- Prefer search_in_files before broad file reads.
- Prefer apply_unified_diff or replace_in_file for precise edits.
- Use minimal edits and keep changes atomic.
- After tools return results, either call another tool or provide the final user answer (normal markdown, no XML).
`;}

    public async run(input: AgentRunInput): Promise<AgentRunOutput> {
        const config = vscode.workspace.getConfiguration('opengravity');
        const maxSteps = Math.max(1, config.get<number>('agentMaxSteps', 8));
        const nativeToolCalling = config.get<boolean>('enableNativeToolCalling', true);

        const publicHistory = [...input.history, input.userMessage];
        const workingHistory: ChatMessage[] = [...publicHistory];

        for (let step = 0; step < maxSteps; step++) {
            const completion = await this._service.complete(
                workingHistory,
                input.modelOverride,
                nativeToolCalling ? this._getToolDefinitions() : undefined
            );
            if (completion.aborted) {
                return {
                    finalResponse: '*Generation canceled.*',
                    updatedHistory: [...publicHistory, { role: 'assistant', content: '*Generation canceled.*' }],
                    aborted: true
                };
            }

            const assistantText = completion.text || '';
            const nativeCalls = this._mapNativeToolCalls(completion.toolCalls || []);
            const xmlCall = this._extractToolCall(assistantText);
            const toolCalls = nativeCalls.length > 0 ? nativeCalls : (xmlCall ? [xmlCall] : []);

            if (toolCalls.length === 0) {
                return {
                    finalResponse: assistantText,
                    updatedHistory: [...publicHistory, { role: 'assistant', content: assistantText }],
                    metrics: completion.raw
                };
            }

            workingHistory.push(completion.assistantMessage || { role: 'assistant', content: assistantText });

            for (const toolCall of toolCalls) {
                const toolResult = await this._executeTool(toolCall);
                this._callbacks.onStatus?.(`${this._formatToolStatus(toolCall)}\n`);

                workingHistory.push({
                    role: 'tool',
                    content: toolResult.output,
                    tool_call_id: toolCall.id,
                    name: toolCall.tool
                });

                workingHistory.push({
                    role: 'user',
                    content: `<tool_result name="${toolCall.tool}" ok="${toolResult.ok}">\n${toolResult.output}\n</tool_result>`
                });
            }
        }

        const fallback = `I reached the agent step limit (${maxSteps} steps) before completing. You can increase **Agent Max Steps** in settings, or ask me to continue from where I left off.`;
        return {
            finalResponse: fallback,
            updatedHistory: [...publicHistory, { role: 'assistant', content: fallback }]
        };
    }

    private _getToolDefinitions(): ToolDefinition[] {
        return [
            {
                type: 'function',
                function: {
                    name: 'list_files',
                    description: 'List files in the workspace or inside a subpath.',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string' },
                            maxEntries: { type: 'number' }
                        },
                        additionalProperties: false
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'read_file',
                    description: 'Read a file from the workspace, optionally between line bounds.',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string' },
                            startLine: { type: 'number' },
                            endLine: { type: 'number' }
                        },
                        required: ['path'],
                        additionalProperties: false
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'search_in_files',
                    description: 'Search for plain-text matches across workspace files.',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: { type: 'string' },
                            glob: { type: 'string' },
                            maxResults: { type: 'number' }
                        },
                        required: ['query'],
                        additionalProperties: false
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'write_file',
                    description: 'Write full content to a file in the workspace.',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string' },
                            content: { type: 'string' }
                        },
                        required: ['path', 'content'],
                        additionalProperties: false
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'replace_in_file',
                    description: 'Replace text in a file; can replace first or all matches.',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string' },
                            search: { type: 'string' },
                            replace: { type: 'string' },
                            replaceAll: { type: 'boolean' }
                        },
                        required: ['path', 'search', 'replace'],
                        additionalProperties: false
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'apply_unified_diff',
                    description: 'Apply a unified diff patch to one or more workspace files.',
                    parameters: {
                        type: 'object',
                        properties: {
                            patch: { type: 'string' }
                        },
                        required: ['patch'],
                        additionalProperties: false
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'run_terminal_command',
                    description: 'Execute a terminal command in workspace root when enabled.',
                    parameters: {
                        type: 'object',
                        properties: {
                            command: { type: 'string' }
                        },
                        required: ['command'],
                        additionalProperties: false
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'fetch_url',
                    description: 'Fetch content from a URL and return it as plain text. Useful for documentation, API specs, GitHub raw files, package READMEs, etc. HTML is stripped to text automatically.',
                    parameters: {
                        type: 'object',
                        properties: {
                            url: { type: 'string' },
                            maxChars: { type: 'number' }
                        },
                        required: ['url'],
                        additionalProperties: false
                    }
                }
            }
        ];
    }

    private _mapNativeToolCalls(calls: ParsedToolCall[]): ToolCall[] {
        return calls.map((call) => ({
            id: call.id,
            tool: call.name,
            args: call.arguments || {}
        }));
    }

    private _formatToolStatus(call: ToolCall): string {
        const args = call.args || {};
        const pathArg = typeof args.path === 'string' ? args.path : '';
        switch (call.tool) {
            case 'read_file':
                return `Reading ${pathArg || 'file'}...`;
            case 'list_files':
                return `Listing files${pathArg ? ` in ${pathArg}` : ''}...`;
            case 'search_in_files':
                return `Searching files for "${typeof args.query === 'string' ? args.query : ''}"...`;
            case 'write_file':
                return `Writing ${pathArg || 'file'}...`;
            case 'replace_in_file':
                return `Updating ${pathArg || 'file'}...`;
            case 'apply_unified_diff':
                return 'Applying patch...';
            case 'run_terminal_command':
                return 'Running terminal command...';
            case 'fetch_url':
                return `Fetching ${typeof args.url === 'string' ? args.url : 'URL'}...`;
            default:
                return `Using tool: ${call.tool}...`;
        }
    }

    private _extractToolCall(text: string): ToolCall | undefined {
        const match = text.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i);
        if (!match) {
            return undefined;
        }

        try {
            const parsed = JSON.parse(match[1]);
            if (!parsed || typeof parsed.tool !== 'string') {
                return undefined;
            }
            return {
                tool: parsed.tool,
                args: typeof parsed.args === 'object' && parsed.args ? parsed.args : {}
            };
        } catch {
            return undefined;
        }
    }

    private _resolveWorkspacePath(inputPath: string): string {
        if (!this._workspaceRoot) {
            throw new Error('No workspace folder is open.');
        }

        const resolved = path.isAbsolute(inputPath)
            ? path.resolve(inputPath)
            : path.resolve(this._workspaceRoot, inputPath);

        const rootNorm = path.resolve(this._workspaceRoot).toLowerCase();
        const candidateNorm = resolved.toLowerCase();
        if (candidateNorm !== rootNorm && !candidateNorm.startsWith(rootNorm + path.sep.toLowerCase())) {
            throw new Error('Path is outside the workspace root.');
        }

        return resolved;
    }

    private async _executeTool(call: ToolCall): Promise<{ ok: boolean; output: string }> {
        try {
            switch (call.tool) {
                case 'list_files':
                    return await this._toolListFiles(call.args || {});
                case 'read_file':
                    return await this._toolReadFile(call.args || {});
                case 'search_in_files':
                    return await this._toolSearchInFiles(call.args || {});
                case 'write_file':
                    return await this._toolWriteFile(call.args || {});
                case 'replace_in_file':
                    return await this._toolReplaceInFile(call.args || {});
                case 'apply_unified_diff':
                    return await this._toolApplyUnifiedDiff(call.args || {});
                case 'run_terminal_command':
                    return await this._toolRunTerminalCommand(call.args || {});
                case 'fetch_url':
                    return await this._toolFetchUrl(call.args || {});
                default:
                    return { ok: false, output: `Unknown tool: ${call.tool}` };
            }
        } catch (error: any) {
            return { ok: false, output: error?.message || String(error) };
        }
    }

    private async _toolListFiles(args: Record<string, any>): Promise<{ ok: boolean; output: string }> {
        const maxEntries = Math.max(1, Math.min(Number(args.maxEntries) || 300, 2000));
        const includeHidden = vscode.workspace.getConfiguration('opengravity').get<boolean>('includeHiddenFilesInList', false);
        const relativePath = typeof args.path === 'string' ? args.path : '';

        const all = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,out,dist}/**', maxEntries * 2);
        const root = this._workspaceRoot;
        if (!root) {
            return { ok: false, output: 'No workspace folder is open.' };
        }

        const base = relativePath ? this._resolveWorkspacePath(relativePath) : root;
        const normalizedBase = path.resolve(base).toLowerCase();
        const entries: string[] = [];

        for (const uri of all) {
            const fsPath = path.resolve(uri.fsPath);
            const normalizedPath = fsPath.toLowerCase();
            if (normalizedPath !== normalizedBase && !normalizedPath.startsWith(normalizedBase + path.sep.toLowerCase())) {
                continue;
            }

            const rel = path.relative(root, fsPath).replace(/\\/g, '/');
            if (!includeHidden && rel.split('/').some(p => p.startsWith('.'))) {
                continue;
            }
            entries.push(rel);
            if (entries.length >= maxEntries) {
                break;
            }
        }

        entries.sort();
        return { ok: true, output: entries.join('\n') || '(no files)' };
    }

    private async _toolReadFile(args: Record<string, any>): Promise<{ ok: boolean; output: string }> {
        if (typeof args.path !== 'string' || !args.path.trim()) {
            return { ok: false, output: 'read_file requires a non-empty "path".' };
        }

        const maxBytes = Math.max(1024, vscode.workspace.getConfiguration('opengravity').get<number>('maxReadFileBytes', 150000));
        const filePath = this._resolveWorkspacePath(args.path);
        const content = fs.readFileSync(filePath, 'utf8');
        const maybeTruncated = content.length > maxBytes ? content.slice(0, maxBytes) : content;

        const startLine = Number.isInteger(args.startLine) ? Number(args.startLine) : undefined;
        const endLine = Number.isInteger(args.endLine) ? Number(args.endLine) : undefined;

        if (startLine && endLine && endLine >= startLine) {
            const lines = maybeTruncated.split(/\r?\n/);
            const slice = lines.slice(Math.max(0, startLine - 1), Math.min(lines.length, endLine));
            return { ok: true, output: slice.join('\n') };
        }

        return {
            ok: true,
            output: maybeTruncated + (content.length > maxBytes ? '\n\n[truncated]' : '')
        };
    }

    private async _toolSearchInFiles(args: Record<string, any>): Promise<{ ok: boolean; output: string }> {
        const query = typeof args.query === 'string' ? args.query : '';
        if (!query) {
            return { ok: false, output: 'search_in_files requires "query".' };
        }

        const glob = typeof args.glob === 'string' && args.glob.trim() ? args.glob : '**/*';
        const maxResults = Math.max(1, Math.min(Number(args.maxResults) || 30, 200));
        const files = await vscode.workspace.findFiles(glob, '**/{node_modules,.git,out,dist}/**', 800);
        const root = this._workspaceRoot;
        const results: string[] = [];

        for (const file of files) {
            let content = '';
            try {
                content = fs.readFileSync(file.fsPath, 'utf8');
            } catch {
                continue;
            }

            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(query)) {
                    const relPath = root ? path.relative(root, file.fsPath).replace(/\\/g, '/') : file.fsPath;
                    results.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
                    if (results.length >= maxResults) {
                        return { ok: true, output: results.join('\n') };
                    }
                }
            }
        }

        return { ok: true, output: results.join('\n') || '(no matches)' };
    }

    private async _toolWriteFile(args: Record<string, any>): Promise<{ ok: boolean; output: string }> {
        if (typeof args.path !== 'string' || !args.path.trim()) {
            return { ok: false, output: 'write_file requires "path".' };
        }
        if (typeof args.content !== 'string') {
            return { ok: false, output: 'write_file requires string "content".' };
        }

        const target = this._resolveWorkspacePath(args.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, args.content, 'utf8');
        const rel = this._workspaceRoot ? path.relative(this._workspaceRoot, target).replace(/\\/g, '/') : target;
        return { ok: true, output: `Wrote ${rel}` };
    }

    private async _toolReplaceInFile(args: Record<string, any>): Promise<{ ok: boolean; output: string }> {
        if (typeof args.path !== 'string' || !args.path.trim()) {
            return { ok: false, output: 'replace_in_file requires "path".' };
        }
        if (typeof args.search !== 'string') {
            return { ok: false, output: 'replace_in_file requires string "search".' };
        }
        if (typeof args.replace !== 'string') {
            return { ok: false, output: 'replace_in_file requires string "replace".' };
        }

        const target = this._resolveWorkspacePath(args.path);
        const content = fs.readFileSync(target, 'utf8');
        const replaceAll = Boolean(args.replaceAll);

        if (!content.includes(args.search)) {
            return { ok: false, output: 'Search text was not found in target file.' };
        }

        const next = replaceAll ? content.split(args.search).join(args.replace) : content.replace(args.search, args.replace);
        fs.writeFileSync(target, next, 'utf8');

        return { ok: true, output: `Updated ${args.path}` };
    }

    private async _toolApplyUnifiedDiff(args: Record<string, any>): Promise<{ ok: boolean; output: string }> {
        const patch = typeof args.patch === 'string' ? args.patch : '';
        if (!patch.trim()) {
            return { ok: false, output: 'apply_unified_diff requires "patch".' };
        }

        const files = this._parseUnifiedDiff(patch);
        if (files.length === 0) {
            return { ok: false, output: 'No valid file patches were found in the unified diff.' };
        }

        const touched: string[] = [];
        for (const filePatch of files) {
            const target = this._resolveWorkspacePath(filePatch.path);
            const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
            const updated = this._applyFilePatch(existing, filePatch);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, updated, 'utf8');
            touched.push(filePatch.path);
        }

        return { ok: true, output: `Patched files:\n${touched.join('\n')}` };
    }

    private _parseUnifiedDiff(patch: string): ParsedPatchFile[] {
        const lines = patch.replace(/\r/g, '').split('\n');
        const files: ParsedPatchFile[] = [];
        let i = 0;

        while (i < lines.length) {
            if (!lines[i].startsWith('--- ')) {
                i++;
                continue;
            }

            const oldPathRaw = lines[i].slice(4).trim();
            i++;
            if (i >= lines.length || !lines[i].startsWith('+++ ')) {
                throw new Error('Invalid unified diff: expected +++ line after --- line.');
            }

            const newPathRaw = lines[i].slice(4).trim();
            const chosenPath = newPathRaw !== '/dev/null' ? newPathRaw : oldPathRaw;
            const normalizedPath = this._normalizePatchPath(chosenPath);
            i++;

            const hunks: ParsedPatchHunk[] = [];
            while (i < lines.length && !lines[i].startsWith('--- ')) {
                if (!lines[i].startsWith('@@ ')) {
                    i++;
                    continue;
                }

                const header = lines[i];
                const match = header.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
                if (!match) {
                    throw new Error(`Invalid hunk header: ${header}`);
                }

                const oldStart = Number(match[1]);
                i++;
                const hunkLines: string[] = [];

                while (i < lines.length && !lines[i].startsWith('@@ ') && !lines[i].startsWith('--- ')) {
                    const line = lines[i];
                    if (line === '\\ No newline at end of file') {
                        i++;
                        continue;
                    }
                    if (!line.startsWith(' ') && !line.startsWith('+') && !line.startsWith('-')) {
                        break;
                    }

                    hunkLines.push(line);
                    i++;
                }

                hunks.push({ oldStart, lines: hunkLines });
            }

            files.push({ path: normalizedPath, hunks });
        }

        return files;
    }

    private _normalizePatchPath(rawPath: string): string {
        const cleaned = rawPath.trim().replace(/^"|"$/g, '');
        if (cleaned.startsWith('a/') || cleaned.startsWith('b/')) {
            return cleaned.slice(2);
        }
        return cleaned;
    }

    private _applyFilePatch(originalContent: string, filePatch: ParsedPatchFile): string {
        const lines = originalContent.replace(/\r/g, '').split('\n');
        let offset = 0;

        for (const hunk of filePatch.hunks) {
            let index = Math.max(0, hunk.oldStart - 1 + offset);

            for (const rawLine of hunk.lines) {
                const marker = rawLine.charAt(0);
                const text = rawLine.slice(1);

                if (marker === ' ') {
                    if (lines[index] !== text) {
                        throw new Error(`Patch context mismatch in ${filePatch.path}.`);
                    }
                    index++;
                    continue;
                }

                if (marker === '-') {
                    if (lines[index] !== text) {
                        throw new Error(`Patch removal mismatch in ${filePatch.path}.`);
                    }
                    lines.splice(index, 1);
                    offset--;
                    continue;
                }

                if (marker === '+') {
                    lines.splice(index, 0, text);
                    index++;
                    offset++;
                    continue;
                }
            }
        }

        return lines.join('\n');
    }

    private async _toolFetchUrl(args: Record<string, any>): Promise<{ ok: boolean; output: string }> {
        const config = vscode.workspace.getConfiguration('opengravity');
        if (!config.get<boolean>('enableFetchTool', false)) {
            return { ok: false, output: 'fetch_url is disabled. Enable opengravity.enableFetchTool in settings.' };
        }

        const url = typeof args.url === 'string' ? args.url.trim() : '';
        if (!url) {
            return { ok: false, output: 'fetch_url requires a non-empty "url".' };
        }
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return { ok: false, output: 'fetch_url only supports http:// and https:// URLs.' };
        }

        const maxChars = Math.max(1000, Math.min(Number(args.maxChars) || 20000, 100000));
        const timeoutMs = Math.max(5000, config.get<number>('fetchToolTimeoutMs', 15000));

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, {
                headers: { 'User-Agent': 'OpenGravity-VSCode-Agent/1.0' },
                signal: controller.signal
            });

            clearTimeout(timer);

            if (!response.ok) {
                return { ok: false, output: `HTTP ${response.status} ${response.statusText} — ${url}` };
            }

            const contentType = response.headers.get('content-type') || '';
            const raw = await response.text();

            let content: string;
            if (contentType.includes('text/html')) {
                content = raw
                    .replace(/<script[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/&nbsp;/g, ' ')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .replace(/[ \t]{2,}/g, ' ')
                    .replace(/\n{3,}/g, '\n\n')
                    .trim();
            } else {
                content = raw;
            }

            const truncated = content.length > maxChars
                ? content.slice(0, maxChars) + `\n\n[truncated — ${content.length} total chars]`
                : content;

            return { ok: true, output: truncated };
        } catch (error: any) {
            clearTimeout(timer);
            if (error.name === 'AbortError') {
                return { ok: false, output: `fetch_url timed out after ${timeoutMs}ms — ${url}` };
            }
            return { ok: false, output: `fetch_url failed: ${error?.message || String(error)}` };
        }
    }

    private async _toolRunTerminalCommand(args: Record<string, any>): Promise<{ ok: boolean; output: string }> {
        const config = vscode.workspace.getConfiguration('opengravity');
        const enabled = config.get<boolean>('enableTerminalTool', false);
        if (!enabled) {
            return { ok: false, output: 'run_terminal_command is disabled by settings.' };
        }

        const command = typeof args.command === 'string' ? args.command.trim() : '';
        if (!command) {
            return { ok: false, output: 'run_terminal_command requires "command".' };
        }

        const cwd = this._workspaceRoot;
        if (!cwd) {
            return { ok: false, output: 'No workspace folder is open.' };
        }

        const timeoutMs = Math.max(1000, config.get<number>('terminalCommandTimeoutMs', 20000));
        const { stdout, stderr } = await exec(command, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 });

        const output = [stdout?.trim(), stderr?.trim()].filter(Boolean).join('\n');
        return { ok: true, output: output || '(no output)' };
    }
}
