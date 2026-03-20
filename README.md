<div align="center">
  <img src="opengravitylogo.png" alt="OpenGravity Logo" width="128" height="128">
  <h1>OpenGravity</h1>
  <p><strong>A powerful, 100% private AI coding assistant deeply integrated into VS Code.</strong></p>
  <p>Experience the cutting-edge intelligence of Google Cloud Code, GitHub Copilot, and Cursor—running entirely on your own hardware.</p>
</div>

---

OpenGravity is a premium, locally-hosted AI coding assistant tightly integrated into Visual Studio Code. Powered natively by [llama.cpp](https://github.com/ggerganov/llama.cpp), [Ollama](https://ollama.com/), and [LM Studio](https://lmstudio.ai/), OpenGravity acts as an intelligent agent capable of deep codebase analysis, autonomous file discovery, structured implementation planning, and inline autocompletions.

## 🌟 Why OpenGravity?
1. **No usage limits:** Generate as much code as you want.
2. **No outages:** Your AI works 100% offline or on your own remote server.
3. **Total Privacy:** Zero data ever leaves your machine or goes to the cloud.
4. **No monthly costs:** Cancel your $20/mo subscriptions.
5. **Open Source:** Fully transparent and hackable to fit your workflow.

## 🚀 Key Features

### 1. The "Clean Box" Interface
OpenGravity features a highly polished, zero-clutter conversational interface natively docked to your Secondary Side Bar. Complex markdown, syntax-highlighted code blocks, and dynamic UI elements strictly follow the beautiful "Antigravity Aesthetic".

![Interface Overview](screenshots/screen_shot_1.png)

### 2. Autonomous Context Gathering
Never copy-paste code again. OpenGravity actively reads your currently active files, maps your entire workspace directory structure, and can autonomously fetch and read un-opened files on the fly to gain the context it needs to solve your problem.

It also tracks your **active editor cursor position and selection** — so if you highlight a block of code and ask a question, the agent sees exactly what you selected.

![Context Reading](screenshots/screen_shot_2.png)

### 3. Structured Implementation Plans
For complex tasks, OpenGravity is constrained to generate an **Implementation Plan** first. This prevents the agent from making eager, unchecked code changes and gives you full control over the architecture.

![Implementation Plan](screenshots/screen_shot_3.png)

### 4. One-Click Code Application
Once you click **Approve Plan**, the agent generates strictly-formatted code blocks. With a single click of the "Apply All Code Changes" button, OpenGravity sequentially injects its patches directly into your editor's files in real-time.

The agent formats every code block with the target file path immediately above it (`**\`src/path/to/file.ts\`**`), enabling reliable one-click application. Individual **Copy** buttons on every code block let you grab snippets instantly.

![Code Application](screenshots/screen_shot_4.png)

### 5. Live Agent Status
While the agent is working, the chat panel shows what it is doing in real time — reading files, searching the codebase, writing changes — so you always know what is happening under the hood.

### 6. New Chat / Clear History
A dedicated **New** button in the header clears the conversation and resets agent memory instantly, without reloading VS Code. Also available via **OpenGravity: Clear Chat History** in the Command Palette.

## ⚡ Additional Capabilities

- **llama.cpp Remote Support:** Point OpenGravity at a llama.cpp server running on another machine on your network — ideal for powerful desktop GPUs accessed from a laptop.
- **Ollama & LM Studio Support:** Use Ollama native APIs or LM Studio OpenAI-compatible APIs with zero extra configuration.
- **Inline Ghost Text:** Get lightning-fast, as-you-type code completion suggestions using your local models right inside the editor pane.
- **Vision Model Support:** Drag and drop images into the chat to prompt advanced visually-aware models like `llava`.
- **Native Tool Calling:** When the model supports function calling, OpenGravity uses native tool dispatch for faster, more reliable multi-step agentic tasks.
- **XML Tool Fallback:** Models that don't support native function calling can still use all tools via XML-based tool calls.
- **Unified Diff Patching:** The agent can apply precise unified diffs across multiple files in one step — minimal, surgical edits without full rewrites.

---

## ⚙️ Configuration

OpenGravity exposes advanced settings natively inside VS Code. Access via **Settings > Extensions > OpenGravity**:

### Provider & URLs

| Setting | Description | Default |
| --- | --- | --- |
| `opengravity.provider` | Backend type: `llamacpp`, `ollama`, `lmstudio`, or `openaiCompatible` | `llamacpp` |
| `opengravity.llamacppUrl` | llama.cpp server URL — supports remote addresses (e.g. `http://192.168.1.100:8080`) | `http://localhost:8080` |
| `opengravity.ollamaUrl` | Ollama base URL | `http://localhost:11434` |
| `opengravity.lmstudioUrl` | LM Studio base URL | `http://localhost:1234` |
| `opengravity.openaiCompatibleUrl` | Generic OpenAI-compatible base URL | `http://localhost:8000` |
| `opengravity.llamacppApiMode` | `openaiCompat` (chat endpoint) or `native` (/completion endpoint) | `openaiCompat` |
| `opengravity.llamacppChatEndpoint` | llama.cpp chat path in OpenAI-compat mode | `/v1/chat/completions` |
| `opengravity.llamacppCompletionEndpoint` | llama.cpp completion path in native mode | `/completion` |

### Model & Generation

| Setting | Description | Default |
| --- | --- | --- |
| `opengravity.model` | Model ID for chat and tools. Leave empty for llama.cpp (uses whatever is loaded). For Ollama use e.g. `qwen2.5-coder:7b`. | `""` |
| `opengravity.contextLength` | Chat/tool context window (`num_ctx` on Ollama) | `16384` |
| `opengravity.maxTokens` | Max generated tokens per chat turn | `4096` |
| `opengravity.temperature` | Sampling temperature (lower = more deterministic) | `0.15` |
| `opengravity.topP` | Nucleus sampling | `0.9` |
| `opengravity.topK` | Top-K sampling | `40` |
| `opengravity.repeatPenalty` | Repetition penalty (mainly Ollama) | `1.1` |
| `opengravity.presencePenalty` | Presence penalty (OpenAI-compatible backends) | `0` |
| `opengravity.frequencyPenalty` | Frequency penalty (OpenAI-compatible backends) | `0` |
| `opengravity.seed` | Fixed random seed (`-1` = random) | `42` |
| `opengravity.presetProfile` | Active tuning preset label | `balanced` |

### Chat Behavior

| Setting | Description | Default |
| --- | --- | --- |
| `opengravity.chatMode` | `execute` (write code), `plan` (plan first), or `review` (critique/risks) | `execute` |
| `opengravity.thinkingLevel` | Reasoning effort: `off`, `low`, `medium`, `high` | `medium` |
| `opengravity.systemPrompt` | Extra custom instructions appended to the base system prompt | `""` |

### Agent & Tools

| Setting | Description | Default |
| --- | --- | --- |
| `opengravity.agentMaxSteps` | Max tool-call iterations per request | `8` |
| `opengravity.enableNativeToolCalling` | Use native function calling when the model supports it | `true` |
| `opengravity.maxReadFileBytes` | Max bytes returned by the `read_file` tool | `150000` |
| `opengravity.enableTerminalTool` | Allow the agent to run terminal commands | `false` |
| `opengravity.terminalCommandTimeoutMs` | Timeout for terminal tool calls (ms) | `20000` |
| `opengravity.includeHiddenFilesInList` | Include dotfiles in `list_files` output | `false` |

### Autocomplete

| Setting | Description | Default |
| --- | --- | --- |
| `opengravity.enableAutocomplete` | Enable inline ghost-text completion | `true` |
| `opengravity.autocompleteContextLength` | Characters of prefix context sent to the model | `2000` |
| `opengravity.autocompleteMaxTokens` | Max tokens returned by autocomplete | `128` |
| `opengravity.autocompleteDebounceMs` | Debounce delay before firing autocomplete (ms) | `300` |

---

### Provider Quick Start

**llama.cpp (default)**
```
opengravity.provider = llamacpp
opengravity.llamacppUrl = http://<your-server>:8080   ← local or remote
opengravity.llamacppApiMode = openaiCompat            ← recommended
opengravity.model = ""                                ← leave empty; server picks the loaded model
```

**Ollama**
```
opengravity.provider = ollama
opengravity.ollamaUrl = http://localhost:11434
opengravity.model = qwen2.5-coder:7b
```

**LM Studio**
```
opengravity.provider = lmstudio
opengravity.lmstudioUrl = http://localhost:1234
```

**Generic OpenAI-compatible (vLLM, etc.)**
```
opengravity.provider = openaiCompatible
opengravity.openaiCompatibleUrl = http://localhost:8000
```

Run **OpenGravity: Test Connection** from the Command Palette to validate connectivity and auto-populate the model name from the server.

**llama.cpp troubleshooting:**
- Verify the server is running and reachable at `opengravity.llamacppUrl`
- For remote servers, ensure the port is accessible (firewall, VPN, etc.)
- API mode must match your server's endpoint style
- Endpoint paths must match (`/v1/chat/completions` or `/completion`)

---

### Preset Profiles

Run **OpenGravity: Apply Preset** from the Command Palette to instantly switch tuning:

| Preset | Temperature | Context | Max Tokens | Steps | Use Case |
| --- | --- | --- | --- | --- | --- |
| `Balanced` | 0.15 | 16384 | 4096 | 8 | Best overall quality/reliability |
| `Deterministic` | 0.05 | 16384 | 4096 | 8 | Most stable, reproducible outputs |
| `Fast` | 0.20 | 8192 | 2048 | 5 | Lowest latency, shorter responses |

Applying a preset updates all relevant generation settings at once — temperature, context length, token limits, penalties, seed, and autocomplete tuning.

---

### Chat Modes

| Mode | Behavior |
| --- | --- |
| **Execute** | Direct implementation — reads files, makes changes, writes code |
| **Plan** | Produces a structured implementation plan first; no code until you approve |
| **Review** | Focuses on critique, bugs, regressions, and missing test coverage |

### Thinking Levels

| Level | Behavior |
| --- | --- |
| **Off** | Fastest responses, minimal deliberation |
| **Low** | Light reasoning, prioritizes speed |
| **Medium** | Balanced depth and speed (recommended default) |
| **High** | Deep validation of assumptions, edge cases, and correctness |

---

### Agentic Tools

The agent has access to these tools when working on your codebase:

| Tool | Description |
| --- | --- |
| `list_files` | List files in the workspace or a subdirectory |
| `read_file` | Read file content, optionally between line bounds |
| `search_in_files` | Plain-text search across workspace files with glob filtering |
| `write_file` | Create or overwrite a file with new content |
| `replace_in_file` | Find-and-replace in a file (first match or all) |
| `apply_unified_diff` | Apply a unified diff patch across one or more files |
| `run_terminal_command` | Run a shell command in the workspace root *(disabled by default)* |

All file operations are sandboxed to the workspace root — the agent cannot read or write paths outside the open folder.

---

## 🛠️ Installation & Setup

1. Install your preferred local inference backend — [llama.cpp](https://github.com/ggerganov/llama.cpp), [Ollama](https://ollama.com/), or [LM Studio](https://lmstudio.ai/).
2. Start your server with a coding-optimized model. For example with Ollama:
   ```bash
   ollama run qwen2.5-coder:7b
   ```
   Or start a llama.cpp server:
   ```bash
   llama-server -m /path/to/model.gguf --host 0.0.0.0 --port 8080
   ```
3. Download the precompiled **OpenGravity** `.vsix` extension file.
4. Open VS Code, navigate to the **Extensions** view (`Ctrl+Shift+X`).
5. Click the **`...`** menu (top-right of Extensions view) and select **Install from VSIX...**.
6. Select the downloaded `.vsix` file to install it.
7. Configure your provider URL in **Settings > Extensions > OpenGravity**.
8. Run **OpenGravity: Test Connection** from the Command Palette to verify everything is working.

> **Tip:** If the OpenGravity sidebar does not appear automatically, press `Ctrl+Alt+B` (`Cmd+Option+B` on Mac) to toggle the Secondary Side Bar, then drag the OpenGravity logo from the Activity Bar into it.

*For maximum performance, a GPU with at least 8GB VRAM is recommended. llama.cpp can also run on CPU.*

---

## 🔧 Build From Source

1. Clone this repo and open it in VS Code.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Compile TypeScript:
   ```bash
   npm run compile
   ```
4. (Optional) Watch mode — rebuilds automatically on save:
   ```bash
   npm run watch
   ```
5. Press `F5` to launch the Extension Development Host and test your local build.

### Package a `.vsix` for Distribution

```bash
npm install
npm run compile
npx @vscode/vsce package
```

This generates `opengravity-<version>.vsix` in the project root. Install it via **Extensions > ... > Install from VSIX...**.

**Alternative (global `vsce`):**
```bash
npm install -g @vscode/vsce
vsce package
```
