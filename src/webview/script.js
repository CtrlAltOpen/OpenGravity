const vscode = acquireVsCodeApi();

const messagesContainer = document.getElementById('messages');
const emptyState = document.getElementById('empty-state');
const input = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');
const imagePreview = document.getElementById('image-preview');
const modelSelect = document.getElementById('model-select');
const thinkingSelect = document.getElementById('thinking-select');
const modeSelect = document.getElementById('mode-select');
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');
const modelCapabilities = document.getElementById('model-capabilities');
const refreshModelsBtn = document.getElementById('refresh-models-btn');
const newChatBtn = document.getElementById('new-chat-btn');
const settingsBtn = document.getElementById('settings-btn');

let images = [];
let currentAssistantMessageDiv = null;
let currentAssistantMessageContent = '';
let currentModel = '';
let currentActiveModels = [];
let isGenerating = false;
let currentThinkingLevel = 'medium';
let currentChatMode = 'execute';
let attachedFiles = [];
let currentModelInfoMap = {};
let hasMessages = false;

// Initialize
window.addEventListener('load', () => {
    vscode.postMessage({ command: 'getSettings' });
    vscode.postMessage({ command: 'getModels' });
    input.focus();
});

// Handle Messages from Extension
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
        case 'chatResponse':
            removeLoadingIndicator();
            updateAssistantMessage(message.text);
            break;
        case 'toolStatus':
            updateLoadingStatus(message.text);
            break;
        case 'showLoading':
            addLoadingIndicator();
            break;
        case 'chatDone':
            setGeneratingState(false);
            removeLoadingIndicator();
            if (currentAssistantMessageDiv) {
                // Final render with buttons unlocked
                const contentDiv = currentAssistantMessageDiv.querySelector('.message-content');
                if (contentDiv) {
                    contentDiv.innerHTML = formatMessage(currentAssistantMessageContent);
                }

                const metricsDiv = document.createElement('div');
                metricsDiv.className = 'metrics-line';
                if (message.metrics && message.metrics.eval_count) {
                    const tokens = message.metrics.eval_count;
                    const seconds = (message.metrics.eval_duration || 0) / 1e9;
                    const tps = seconds > 0 ? (tokens / seconds).toFixed(1) : '—';
                    metricsDiv.innerText = `${tokens} tokens · ${tps} t/s · ${new Date().toLocaleTimeString()}`;
                } else {
                    metricsDiv.innerText = new Date().toLocaleTimeString();
                }
                currentAssistantMessageDiv.querySelector('.message-content').appendChild(metricsDiv);

                // Add copy-response button to message header
                const headerDiv = currentAssistantMessageDiv.querySelector('.message-header');
                if (headerDiv) {
                    const rawText = currentAssistantMessageContent;
                    const copyRespBtn = document.createElement('button');
                    copyRespBtn.className = 'copy-response-btn';
                    copyRespBtn.title = 'Copy response';
                    copyRespBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
                    copyRespBtn.addEventListener('click', () => {
                        navigator.clipboard.writeText(rawText).then(() => {
                            copyRespBtn.innerHTML = '✓';
                            setTimeout(() => {
                                copyRespBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
                            }, 2000);
                        }).catch(() => {});
                    });
                    headerDiv.appendChild(copyRespBtn);
                }

                scrollToBottom();
            }
            currentAssistantMessageDiv = null;
            currentAssistantMessageContent = '';
            break;
        case 'modelsList':
            currentActiveModels = message.activeModels || currentActiveModels;
            populateModels(message.models, message.modelInfos || []);
            break;
        case 'settings':
            if (message.model !== undefined) {
                currentModel = message.model;
                if (modelSelect.options.length > 1) {
                    modelSelect.value = currentModel;
                }
                renderModelCapabilities();
            }
            if (message.thinkingLevel && thinkingSelect) {
                currentThinkingLevel = message.thinkingLevel;
                thinkingSelect.value = currentThinkingLevel;
            }
            if (message.chatMode && modeSelect) {
                currentChatMode = message.chatMode;
                modeSelect.value = currentChatMode;
            }
            break;
        case 'updateActiveModels':
            currentActiveModels = message.activeModels || [];
            updateMemoryDisplay();
            renderModelCapabilities();
            break;
        case 'clearChat':
            clearChatUI();
            break;
        case 'systemNotice':
            addSystemNotice(message.text);
            break;
    }
});

function clearChatUI() {
    messagesContainer.innerHTML = '';
    if (emptyState) {
        messagesContainer.appendChild(emptyState);
        emptyState.style.display = '';
    }
    hasMessages = false;
    currentAssistantMessageDiv = null;
    currentAssistantMessageContent = '';
    isGenerating = false;
    setGeneratingState(false);
}

// Model capabilities
function normalizeCapabilityLabel(capability) {
    const key = String(capability || '').toLowerCase();
    if (key === 'thinking') return 'THINK';
    if (key === 'vision') return 'VIS';
    if (key === 'tools') return 'TOOLS';
    if (key === 'files') return 'FILES';
    if (key === 'code') return 'CODE';
    return '';
}

function getCapabilitiesForCurrentModel() {
    const info = currentModelInfoMap[currentModel];
    if (info && Array.isArray(info.capabilities)) {
        return Array.from(new Set(info.capabilities.map(normalizeCapabilityLabel).filter(Boolean)));
    }
    return [];
}

function renderModelCapabilities() {
    if (!modelCapabilities) return;
    modelCapabilities.innerHTML = '';
    const caps = getCapabilitiesForCurrentModel();
    if (!currentModel || caps.length === 0) return;
    caps.forEach(cap => {
        const chip = document.createElement('span');
        chip.className = 'capability-chip';
        chip.innerText = cap;
        modelCapabilities.appendChild(chip);
    });
}

function populateModels(models, modelInfos = []) {
    const uniqueModels = Array.from(new Set((models || []).filter(Boolean)));
    modelSelect.innerHTML = '';
    currentModelInfoMap = {};
    modelInfos.forEach(info => {
        if (info && info.id) currentModelInfoMap[info.id] = info;
    });

    if (uniqueModels.length === 0) {
        const option = document.createElement('option');
        option.text = 'No models found';
        option.value = '';
        modelSelect.add(option);
        updateMemoryDisplay();
        renderModelCapabilities();
        return;
    }

    uniqueModels.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.text = model;
        modelSelect.add(option);
    });

    if (currentModel && uniqueModels.includes(currentModel)) {
        modelSelect.value = currentModel;
    } else if (uniqueModels.length > 0) {
        currentModel = uniqueModels[0];
        modelSelect.value = currentModel;
        vscode.postMessage({ command: 'setModel', model: currentModel });
    }

    updateMemoryDisplay();
    renderModelCapabilities();
}

function updateMemoryDisplay() {
    const memorySpan = document.getElementById('model-memory');
    if (!currentModel || currentActiveModels.length === 0) {
        memorySpan.style.display = 'none';
        return;
    }
    const activeModel = currentActiveModels.find(m => m.name === currentModel || m.model === currentModel);
    if (activeModel && activeModel.size) {
        const sizeGB = (activeModel.size / (1024 * 1024 * 1024)).toFixed(1);
        memorySpan.innerText = `${sizeGB}GB`;
        memorySpan.style.display = 'inline';
    } else {
        memorySpan.style.display = 'none';
    }
}

// Event listeners
modelSelect.addEventListener('change', () => {
    currentModel = modelSelect.value;
    vscode.postMessage({ command: 'setModel', model: currentModel });
    renderModelCapabilities();
});

if (thinkingSelect) {
    thinkingSelect.addEventListener('change', () => {
        currentThinkingLevel = thinkingSelect.value;
        vscode.postMessage({ command: 'setThinkingLevel', thinkingLevel: currentThinkingLevel });
    });
}

if (modeSelect) {
    modeSelect.addEventListener('change', () => {
        currentChatMode = modeSelect.value;
        vscode.postMessage({ command: 'setChatMode', chatMode: currentChatMode });
    });
}

if (refreshModelsBtn) {
    refreshModelsBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'getModels' });
    });
}

if (newChatBtn) {
    newChatBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'clearChat' });
        clearChatUI();
    });
}

if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'openSettings' });
    });
}

// Send Message
function sendMessage() {
    if (isGenerating) {
        vscode.postMessage({ command: 'cancelChat' });
        setGeneratingState(false);
        removeLoadingIndicator();
        return;
    }

    const text = input.value.trim();
    if (!text && images.length === 0 && attachedFiles.length === 0) return;

    hideEmptyState();
    addMessage(text, 'user', images);
    addLoadingIndicator();
    setGeneratingState(true);

    vscode.postMessage({
        command: 'chat',
        text: text,
        images: images,
        attachments: attachedFiles,
        model: currentModel,
        thinkingLevel: currentThinkingLevel,
        mode: currentChatMode
    });

    input.value = '';
    input.style.height = 'auto';
    images = [];
    attachedFiles = [];
    imagePreview.innerHTML = '';
    if (fileInput) fileInput.value = '';
}

function hideEmptyState() {
    if (emptyState && emptyState.parentNode === messagesContainer) {
        messagesContainer.removeChild(emptyState);
    }
    hasMessages = true;
}

function setGeneratingState(generating) {
    isGenerating = generating;
    if (isGenerating) {
        sendBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"></rect></svg>';
        sendBtn.style.backgroundColor = '#b03030';
    } else {
        sendBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
        sendBtn.style.backgroundColor = 'var(--accent-color)';
    }

    const applyBtns = document.querySelectorAll('.apply-all-btn');
    applyBtns.forEach(btn => {
        if (isGenerating) {
            btn.dataset.prevState = btn.innerText;
            btn.disabled = true;
            btn.style.opacity = '0.4';
        } else {
            const prev = btn.dataset.prevState || 'Apply All Code Changes';
            btn.innerText = prev;
            if (prev !== 'Applied All Changes!') {
                btn.disabled = false;
                btn.style.opacity = '';
            }
        }
    });

    const approveBtns = document.querySelectorAll('.approve-plan-btn');
    approveBtns.forEach(btn => {
        if (isGenerating) {
            btn.dataset.prevState = btn.innerText;
            btn.disabled = true;
            btn.style.opacity = '0.4';
        } else {
            const prev = btn.dataset.prevState || 'Approve Plan';
            btn.innerText = prev;
            if (prev !== 'Plan Approved!') {
                btn.disabled = false;
                btn.style.opacity = '';
            }
        }
    });
}

setGeneratingState(false);

sendBtn.addEventListener('click', sendMessage);

input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Auto-resize textarea
input.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 180) + 'px';
});

// Paste image
window.addEventListener('paste', async (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
            const blob = item.getAsFile();
            const reader = new FileReader();
            reader.onload = (event) => {
                const b64 = event.target.result.split(',')[1];
                images.push(b64);
                const img = document.createElement('img');
                img.src = event.target.result;
                img.className = 'preview-thumb';
                imagePreview.appendChild(img);
            };
            reader.readAsDataURL(blob);
        }
    }
});

// File attach
if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        await processSelectedFiles(files);
        fileInput.value = '';
    });
}

async function processSelectedFiles(files) {
    for (const file of files) {
        if (file.type.startsWith('image/')) {
            const dataUrl = await readFileAsDataURL(file);
            const b64 = dataUrl.split(',')[1] || '';
            if (b64) {
                images.push(b64);
                const img = document.createElement('img');
                img.src = dataUrl;
                img.className = 'preview-thumb';
                imagePreview.appendChild(img);
            }
            continue;
        }

        const maxTextSize = 256 * 1024;
        if (file.size > maxTextSize) {
            const chip = document.createElement('span');
            chip.className = 'file-chip';
            chip.innerHTML = `<code>${escapeHtml(file.name)}</code> <span style="opacity:0.6">(too large)</span>`;
            imagePreview.appendChild(chip);
            continue;
        }

        const text = await readFileAsText(file);
        attachedFiles.push({ name: file.name, mimeType: file.type || 'text/plain', content: text });

        const chip = document.createElement('span');
        chip.className = 'file-chip';
        chip.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><code>${escapeHtml(file.name)}</code>`;
        imagePreview.appendChild(chip);
    }
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(String(e.target.result || ''));
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

function addMessage(text, sender, imgs = []) {
    const div = document.createElement('div');
    div.className = `message ${sender}`;

    const header = document.createElement('div');
    header.className = 'message-header';
    header.innerText = sender === 'user' ? 'You' : 'OpenGravity';
    div.appendChild(header);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (imgs && imgs.length > 0) {
        imgs.forEach(b64 => {
            const img = document.createElement('img');
            img.src = 'data:image/jpeg;base64,' + b64;
            img.className = 'preview-thumb';
            img.style.marginBottom = '8px';
            contentDiv.appendChild(img);
            contentDiv.appendChild(document.createElement('br'));
        });
    }

    contentDiv.innerHTML += formatMessage(text);
    div.appendChild(contentDiv);
    messagesContainer.appendChild(div);
    scrollToBottom();
    return div;
}

function updateAssistantMessage(textChunk) {
    if (!currentAssistantMessageDiv) {
        currentAssistantMessageDiv = addMessage('', 'assistant');
    }
    currentAssistantMessageContent += textChunk;
    const contentDiv = currentAssistantMessageDiv.querySelector('.message-content');
    if (contentDiv) {
        contentDiv.innerHTML = formatMessage(currentAssistantMessageContent);
    }
    scrollToBottom();
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function formatMessage(text) {
    // Strip internal read markers
    let cleanedText = text.replace(/\[READ_FILE:.*?\]/g, '');

    // Strip incomplete partial marker while streaming
    const partialMatch = cleanedText.match(/\[[^\]]*$/);
    if (partialMatch) {
        const p = partialMatch[0];
        if ('[READ_FILE:'.startsWith(p) || p.startsWith('[READ_FILE:')) {
            cleanedText = cleanedText.substring(0, partialMatch.index);
        }
    }

    const hasCodeBlocks = /```[\s\S]*?```/.test(cleanedText);

    // Protect plan blocks
    const plans = [];
    cleanedText = cleanedText.replace(/<plan>([\s\S]*?)<\/plan>/gi, (match, c) => {
        plans.push(c);
        return `%%%PLAN_${plans.length - 1}%%%`;
    });

    // Protect file chips
    const chips = [];
    cleanedText = cleanedText.replace(/\[\[FILE_READ_CHIP:\s*(.+?)\]\]/g, (match, file) => {
        chips.push(file);
        return `%%%CHIP_${chips.length - 1}%%%`;
    });

    // Parse markdown
    let content = typeof marked !== 'undefined' ? marked.parse(cleanedText) : cleanedText;

    // Inject copy buttons + language label into code blocks
    content = content
        .replace(/<pre><code class="language-([^"]+)">/g, (_, lang) =>
            `<div class="code-block-wrapper"><div class="code-header"><span class="code-lang">${lang}</span><button class="copy-btn" onclick="copyCode(this)">Copy</button></div><pre><code class="language-${lang}">`)
        .replace(/<pre><code>/g,
            `<div class="code-block-wrapper"><div class="code-header"><button class="copy-btn" onclick="copyCode(this)">Copy</button></div><pre><code>`)
        .replace(/<\/code><\/pre>/g, '</code></pre></div>');

    // Restore plans
    content = content.replace(/<p>%%%PLAN_(\d+)%%%<\/p>|%%%PLAN_(\d+)%%%/g, (match, p1, p2) => {
        const index = p1 !== undefined ? p1 : p2;
        const planContent = plans[index];
        const parsedPlan = typeof marked !== 'undefined' ? marked.parse(planContent) : planContent;
        const btnHtml = isGenerating
            ? `<button class="approve-plan-btn" disabled>Generating…</button>`
            : `<button class="approve-plan-btn" onclick="approvePlan(this)">Approve Plan</button>`;
        return `<div class="plan-block"><div class="plan-header">Implementation Plan</div><div class="plan-content">${parsedPlan}</div>${btnHtml}</div>`;
    });

    // Restore chips
    content = content.replace(/<p>%%%CHIP_(\d+)%%%<\/p>|%%%CHIP_(\d+)%%%/g, (match, p1, p2) => {
        const index = p1 !== undefined ? p1 : p2;
        return `<span class="file-chip"><code>${escapeHtml(chips[index])}</code></span>`;
    });

    // Apply All button
    if (hasCodeBlocks) {
        const btnHtml = isGenerating
            ? `<button class="apply-all-btn" disabled style="opacity:0.4">Generating…</button>`
            : `<button class="apply-all-btn" onclick="applyAllCode(this)">Apply All Code Changes</button>`;
        content += `<br>${btnHtml}`;
    }

    return content;
}

function escapeHtml(unsafe) {
    return String(unsafe || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Loading indicator
function addLoadingIndicator() {
    if (document.getElementById('loading-indicator')) return;

    const div = document.createElement('div');
    div.id = 'loading-indicator';
    div.className = 'message assistant';

    const header = document.createElement('div');
    header.className = 'message-header';
    header.innerText = 'OpenGravity';
    div.appendChild(header);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = '<div class="loading-dots"><span>.</span><span>.</span><span>.</span></div><div class="loading-status"></div>';
    div.appendChild(contentDiv);

    messagesContainer.appendChild(div);
    scrollToBottom();
}

function removeLoadingIndicator() {
    const loader = document.getElementById('loading-indicator');
    if (loader) loader.remove();
}

function addSystemNotice(text) {
    hideEmptyState();
    const div = document.createElement('div');
    div.className = 'system-notice';
    div.textContent = text;
    messagesContainer.appendChild(div);
    scrollToBottom();
}

function updateLoadingStatus(text) {
    const loader = document.getElementById('loading-indicator');
    if (!loader) return;
    const statusEl = loader.querySelector('.loading-status');
    if (statusEl) {
        const lines = text.trim().split('\n');
        statusEl.textContent = lines[lines.length - 1] || '';
    }
}

// Copy code button
window.copyCode = function (btn) {
    const wrapper = btn.closest('.code-block-wrapper');
    const code = wrapper ? wrapper.querySelector('code') : null;
    if (!code) return;
    navigator.clipboard.writeText(code.textContent || '').then(() => {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.textContent = 'Copy';
            btn.classList.remove('copied');
        }, 2000);
    }).catch(() => {
        btn.textContent = 'Error';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
};

// Apply all code changes
window.applyAllCode = function (btn) {
    const messageContent = btn.parentElement;
    const preElements = messageContent.querySelectorAll('pre');
    const codeChanges = [];

    preElements.forEach(pre => {
        let prev = pre.closest('.code-block-wrapper')?.previousElementSibling || pre.previousElementSibling;
        let filename = '';

        while (prev) {
            const text = (prev.innerText || prev.textContent || '').trim();
            if (text) {
                // 1. Bold+code: **`file.ts`**
                const strong = prev.querySelector('strong');
                if (strong) {
                    const inner = strong.querySelector('code');
                    const candidate = (inner || strong).innerText.trim();
                    if (candidate && !candidate.includes(' ')) { filename = candidate; break; }
                }

                // 2. Standalone code or em tag (no spaces = likely a path)
                const em = prev.querySelector('em, code');
                if (em && em.innerText.trim() && !em.innerText.includes(' ')) {
                    filename = em.innerText.trim(); break;
                }

                // 3. Last line heuristic
                const lines = text.split('\n');
                let lastLine = lines[lines.length - 1].trim().replace(/[:`*]/g, '').trim();
                if (lastLine) {
                    const words = lastLine.split(/\s+/);
                    if (words.length === 1) {
                        filename = words[0];
                    } else {
                        for (let i = words.length - 1; i >= 0; i--) {
                            let w = words[i].replace(/[.,;:!?]$/, '');
                            if ((w.includes('.') || w.includes('/') || w.includes('\\')) && w.length > 2) {
                                filename = w; break;
                            }
                        }
                    }
                    break;
                }
            }
            prev = prev.previousElementSibling;
        }

        if (filename) {
            filename = filename.replace(/[*`:"']/g, '').trim();
        }

        const codeBlock = pre.querySelector('code');
        if (codeBlock) {
            // textContent is more reliable than innerText for large blocks —
            // it reads raw text nodes without triggering layout or CSS evaluation.
            codeChanges.push({ file: filename, code: codeBlock.textContent || '' });
        }
    });

    if (codeChanges.length > 0) {
        vscode.postMessage({ command: 'applyCode', changes: codeChanges });
        btn.innerText = 'Applied!';
        btn.style.backgroundColor = '#1a5c32';
        btn.style.color = '#5cd68f';
        btn.disabled = true;
    }
};

// Approve plan
window.approvePlan = function (btn) {
    const text = 'I approve the plan above. Please execute it and write the code changes now.';
    setGeneratingState(true);
    addMessage(text, 'user', []);
    addLoadingIndicator();
    vscode.postMessage({
        command: 'chat',
        text: text,
        images: [],
        model: currentModel,
        thinkingLevel: currentThinkingLevel,
        mode: currentChatMode,
        attachments: []
    });
    btn.innerText = 'Plan Approved!';
    btn.style.opacity = '0.6';
    btn.disabled = true;
};
