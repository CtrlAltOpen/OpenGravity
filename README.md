<div align="center">
  <img src="opengravitylogo.png" alt="OpenGravity Logo" width="128" height="128">
  <h1>OpenGravity</h1>
  <p><strong>A powerful, 100% private AI coding assistant deeply integrated into VS Code.</strong></p>
  <p>Experience the cutting-edge intelligence of Google Cloud Code, GitHub Copilot, and Cursor—running entirely on your own hardware.</p>
</div>

---

OpenGravity is a premium, locally-hosted AI coding assistant tightly integrated into Visual Studio Code. Powered natively by [Ollama](https://ollama.com/), [LM Studio](https://lmstudio.ai/), and [llama.cpp](https://github.com/ggerganov/llama.cpp), OpenGravity acts as an intelligent agent capable of deep codebase analysis, autonomous file discovery, structured implementation planning, and inline autocompletions.

## 🌟 Why OpenGravity?
1. **No usage limits:** Generate as much code as you want.
2. **No outages:** Your AI works 100% offline.
3. **Total Privacy:** Zero data ever leaves your machine or goes to the cloud.
4. **No monthly costs:** Cancel your $20/mo subscriptions.
5. **Open Source:** Fully transparent and hackable to fit your workflow.

## 🚀 Key Features

### 1. The "Clean Box" Interface
OpenGravity features a highly polished, zero-clutter conversational interface natively docked to your Secondary Side Bar. Complex markdown, syntax-highlighted code blocks, and dynamic UI elements strictly follow the beautiful "Antigravity Aesthetic".

![Interface Overview](screenshots/screen_shot_1.png)

### 2. Autonomous Context Gathering
Never copy-paste code again. OpenGravity actively reads your currently active files, maps your entire workspace directory structure, and can autonomously fetch and read un-opened files on the fly to gain the context it needs to solve your problem.

![Context Reading](screenshots/screen_shot_2.png)

### 3. Structured Implementation Plans
For complex tasks, OpenGravity is constrained to generate an **Implementation Plan** first. This prevents the agent from making eager, unchecked code changes and gives you full control over the architecture.

![Implementation Plan](screenshots/screen_shot_3.png)

### 4. One-Click Code Application
Once you click **Approve Plan**, the agent generates strictly-formatted code blocks. With a single click of the "Apply All Code Changes" button, OpenGravity sequentially injects its patches directly into your editor's files in real-time.

![Code Application](screenshots/screen_shot_4.png)

## ⚡ Additional Capabilities

- **Ollama, LM Studio, and llama.cpp Support:** Use Ollama native APIs, LM Studio OpenAI-compatible APIs, and llama.cpp in either OpenAI-compatible mode or native `/completion` mode.
- **Inline Ghost Text:** Get lightning-fast, as-you-type code completion suggestions using your local models right inside the editor pane.
- **Vision Model Support:** Drag and drop images into the chat to prompt advanced visually-aware models like `llava`.

---

## ⚙️ Configuration

OpenGravity exposes advanced determinism properties natively inside VS Code settings, allowing you to maximize the coding proficiency of local models. Access via **Settings > Extensions > OpenGravity**:

| Setting | Description | Default |
| --- | --- | --- |
| `opengravity.provider` | Backend type (`ollama`, `lmstudio`, `llamacpp`, `openaiCompatible`). | `ollama` |
| `opengravity.url` | Legacy fallback base URL (kept for backwards compatibility). | `http://localhost:11434` |
| `opengravity.ollamaUrl` | Ollama URL (default port `11434`). | `http://localhost:11434` |
| `opengravity.lmstudioUrl` | LM Studio URL (default port `1234`). | `http://localhost:1234` |
| `opengravity.llamacppUrl` | llama.cpp URL (default port `8080`). | `http://localhost:8080` |
| `opengravity.openaiCompatibleUrl` | Generic OpenAI-compatible URL (common port `8000`). | `http://localhost:8000` |
| `opengravity.llamacppApiMode` | `openaiCompat` or `native` mode for llama.cpp. | `openaiCompat` |
| `opengravity.llamacppChatEndpoint` | llama.cpp chat endpoint in `openaiCompat` mode. | `/v1/chat/completions` |
| `opengravity.llamacppCompletionEndpoint` | llama.cpp completion endpoint in `native` mode. | `/completion` |
| `opengravity.model` | Model ID used for chat + tools + completion. | `qwen2.5-coder:7b` |
| `opengravity.presetProfile` | Active preset label (`balanced`, `deterministic`, `fast`, `custom`). | `balanced` |
| `opengravity.contextLength` | Chat/tool context window (`num_ctx` on Ollama). | `16384` |
| `opengravity.maxTokens` | Max generated tokens per chat turn. | `4096` |
| `opengravity.temperature` | Sampling temperature. | `0.15` |
| `opengravity.topP` | Nucleus sampling (`top_p`). | `0.9` |
| `opengravity.topK` | Top-K sampling. | `40` |
| `opengravity.repeatPenalty` | Repetition penalty (mainly Ollama). | `1.1` |
| `opengravity.presencePenalty` | Presence penalty (OpenAI-compatible backends). | `0` |
| `opengravity.frequencyPenalty` | Frequency penalty (OpenAI-compatible backends). | `0` |
| `opengravity.seed` | Random seed (`-1` disables fixed seed). | `42` |
| `opengravity.enableAutocomplete` | Enable inline ghost-text completion. | `true` |
| `opengravity.autocompleteContextLength` | Prefix chars sent to autocomplete model. | `2000` |
| `opengravity.autocompleteMaxTokens` | Max tokens returned by autocomplete. | `128` |
| `opengravity.autocompleteDebounceMs` | Debounce delay for autocomplete requests. | `300` |
| `opengravity.agentMaxSteps` | Max iterative tool-call steps per request. | `8` |
| `opengravity.enableNativeToolCalling` | Use native function calling when model supports it. | `true` |
| `opengravity.maxReadFileBytes` | Max payload returned by `read_file` tool. | `150000` |
| `opengravity.enableTerminalTool` | Allow `run_terminal_command` tool. | `false` |
| `opengravity.terminalCommandTimeoutMs` | Timeout for terminal tool calls. | `20000` |
| `opengravity.includeHiddenFilesInList` | Include dotfiles in `list_files` output. | `false` |
| `opengravity.systemPrompt` | Extra custom system rules appended to base prompt. | `""` |


### Provider Setup (Quick Start)

- `Ollama`
  - Set `opengravity.provider` = `ollama`
  - Default URL: `http://localhost:11434`
- `LM Studio`
  - Set `opengravity.provider` = `lmstudio`
  - Default URL: `http://localhost:1234`
- `llama.cpp`
  - Set `opengravity.provider` = `llamacpp`
  - Default URL: `http://localhost:8080`
  - Choose `opengravity.llamacppApiMode`:
    - `openaiCompat` for `/v1/chat/completions`
    - `native` for `/completion`
- `OpenAI-Compatible (generic local)`
  - Set `opengravity.provider` = `openaiCompatible`
  - Default URL: `http://localhost:8000`

Run **OpenGravity: Test Connection** from the Command Palette to validate connectivity and auto-populate the model name from the remote endpoint.

If llama.cpp does not connect, verify:
- The server is running and reachable at `opengravity.llamacppUrl`.
- API mode matches your server endpoint style.
- Endpoint paths are correct (`/v1/chat/completions` or `/completion`).
- `opengravity.url` (legacy) is not pointing to another provider port.
### Preset Profiles

Run **OpenGravity: Apply Preset** from the Command Palette to instantly switch tuning:

- `Balanced`: Best overall coding quality and reliability.
- `Deterministic`: Most stable/reproducible outputs.
- `Fast`: Lowest latency with shorter responses.

Applying a preset updates all relevant generation settings (tokens, context, sampling, penalties, and autocomplete tuning).
## 🛠️ Installation & Setup

1. Install [Ollama](https://ollama.com/), [LM Studio](https://lmstudio.ai/), or [llama.cpp](https://github.com/ggerganov/llama.cpp).
2. Pull a coding-optimized model (e.g., `llama3`, `deepseek-coder-v2`, `qwen2.5-coder`):
   ```bash
   ollama run llama3
   ```
3. Download the precompiled **OpenGravity** `.vsix` extension file.
4. Open VS Code, navigate to the **Extensions** view (`Ctrl+Shift+X` or `Cmd+Shift+X`).
5. Click the **Views and More Actions** (`...`) menu in the top right of the Extensions view and select **Install from VSIX...**.
6. Select the downloaded `.vsix` file to install it.
7. If the OpenGravity sidebar does not automatically appear on the right, press `Ctrl+Alt+B` (or `Cmd+Option+B` on Mac) to toggle the **Secondary Side Bar**, then explicitly drag the OpenGravity logo from the left Activity bar into it to dock it securely!

*Note: For maximum performance and context retention, a GPU with at least 8GB of VRAM is recommended.*

## 🔧 Build From Source (Compile)

1. Clone this repo and open it in VS Code.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Compile TypeScript:
   ```bash
   npm run compile
   ```
4. (Optional) Rebuild automatically while editing:
   ```bash
   npm run watch
   ```
5. Press `F5` in VS Code to launch the Extension Development Host and test your local build.

### Build the VS Code Package (`.vsix`)

Note: VS Code extension packages are `.vsix` files (often mistyped as "vsdx").

1. Install dependencies:
   ```bash
   npm install
   ```
2. Compile the extension:
   ```bash
   npm run compile
   ```
3. Build the package file:
   ```bash
   npx @vscode/vsce package
   ```
4. Confirm the generated file in the project root (example):
   ```bash
   opengravity-0.0.9.vsix
   ```
5. Install it in VS Code:
   - Open **Extensions** (`Ctrl+Shift+X`)
   - Click `...` (top-right menu)
   - Select **Install from VSIX...**
   - Choose the generated `.vsix` file

### Alternative (Global `vsce`)

If you prefer a global command:

1. Install once:
   ```bash
   npm install -g @vscode/vsce
   ```
2. Package:
   ```bash
   vsce package
   ```










