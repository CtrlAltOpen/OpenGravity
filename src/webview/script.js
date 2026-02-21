const vscode = acquireVsCodeApi();

const messagesContainer = document.getElementById('messages');
const input = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');
const imagePreview = document.getElementById('image-preview');
const modelSelect = document.getElementById('model-select');

let images = [];
let currentAssistantMessageDiv = null;
let currentAssistantMessageContent = '';
let currentModel = '';
let currentActiveModels = [];
let isGenerating = false;

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
        case 'showLoading':
            addLoadingIndicator();
            break;
        case 'chatDone':
            setGeneratingState(false);
            removeLoadingIndicator();
            if (currentAssistantMessageDiv) {
                // Perform one final render now that isGenerating is false to unlock the buttons
                const contentDiv = currentAssistantMessageDiv.querySelector('.message-content');
                if (contentDiv) {
                    contentDiv.innerHTML = formatMessage(currentAssistantMessageContent);
                }

                const summaryDiv = document.createElement('div');
                summaryDiv.style.fontSize = '0.8em';
                summaryDiv.style.color = '#a0a0a0';
                summaryDiv.style.marginTop = '10px';

                if (message.metrics && message.metrics.eval_count) {
                    const tokens = message.metrics.eval_count;
                    const seconds = (message.metrics.eval_duration || 0) / 1e9;
                    const tps = seconds > 0 ? (tokens / seconds).toFixed(1) : 0;
                    const time = new Date().toLocaleTimeString();
                    summaryDiv.innerText = `Generated at ${time} | Tokens: ${tokens} | Speed: ${tps} t/s`;
                } else {
                    summaryDiv.innerText = `Generated at ${new Date().toLocaleTimeString()} (Metrics unavailable)`;
                }
                currentAssistantMessageDiv.querySelector('.message-content').appendChild(summaryDiv);
                scrollToBottom();
            }
            currentAssistantMessageDiv = null;
            currentAssistantMessageContent = '';
            break;
        case 'modelsList':
            populateModels(message.models);
            break;
        case 'settings':
            if (message.model) {
                currentModel = message.model;
                // Set dropdown if populated, else it will be set in populateModels
                if (modelSelect.options.length > 1) {
                    modelSelect.value = currentModel;
                }
            }
            break;
        case 'updateActiveModels':
            currentActiveModels = message.activeModels || [];
            updateMemoryDisplay();
            break;
    }
});

function populateModels(models) {
    modelSelect.innerHTML = '';

    if (models.length === 0) {
        const option = document.createElement('option');
        option.text = "No models found";
        modelSelect.add(option);
        updateMemoryDisplay();
        return;
    }

    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.text = model;
        modelSelect.add(option);
    });

    if (currentModel) {
        modelSelect.value = currentModel;
    }

    updateMemoryDisplay();
}

function updateMemoryDisplay() {
    const memorySpan = document.getElementById('model-memory');
    if (!currentModel || currentActiveModels.length === 0) {
        memorySpan.style.display = 'none';
        return;
    }

    const activeModel = currentActiveModels.find(m => m.name === currentModel || m.model === currentModel);
    if (activeModel && activeModel.size) {
        const sizeGB = (activeModel.size / (1024 * 1024 * 1024)).toFixed(2);
        memorySpan.innerText = `${sizeGB} GB`;
        memorySpan.style.display = 'inline';
    } else {
        memorySpan.style.display = 'none';
    }
}

// Model Selection
modelSelect.addEventListener('change', () => {
    currentModel = modelSelect.value;
    vscode.postMessage({ command: 'setModel', model: currentModel });
});

// Send Message
function sendMessage() {
    if (isGenerating) {
        // Cancel the current generation
        vscode.postMessage({ command: 'cancelChat' });
        setGeneratingState(false);
        removeLoadingIndicator();
        return;
    }

    const text = input.value.trim();
    if (!text && images.length === 0) return;

    addMessage(text, 'user', images);
    addLoadingIndicator();
    setGeneratingState(true);
    vscode.postMessage({ command: 'chat', text: text, images: images, model: currentModel });

    input.value = '';
    input.style.height = 'auto'; // Reset height
    images = [];
    imagePreview.innerHTML = '';
}

function setGeneratingState(generating) {
    isGenerating = generating;
    if (isGenerating) {
        sendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"></rect></svg>';
        sendBtn.style.backgroundColor = '#cc3333';
    } else {
        sendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
        sendBtn.style.backgroundColor = 'var(--accent-color)';
    }

    // Globally toggle all action buttons in the chat history
    const applyBtns = document.querySelectorAll('.apply-all-btn');
    applyBtns.forEach(btn => {
        if (isGenerating) {
            btn.dataset.prevState = btn.innerText;
            btn.innerText = 'Generating...';
            btn.style.backgroundColor = '#444';
            btn.style.borderColor = '#444';
            btn.style.color = '#888';
            btn.style.cursor = 'not-allowed';
            btn.disabled = true;
        } else {
            const prevState = btn.dataset.prevState || 'Apply All Code Changes';
            btn.innerText = prevState;
            if (prevState === 'Applied All Changes!') {
                btn.style.backgroundColor = '#28a745';
                btn.style.borderColor = '#28a745';
                btn.style.color = '#ffffff';
                btn.disabled = true;
                btn.style.cursor = 'default';
            } else {
                btn.style.backgroundColor = '#2ea043';
                btn.style.borderColor = '#2ea043';
                btn.style.color = '#ffffff';
                btn.disabled = false;
                btn.style.cursor = 'pointer';
            }
        }
    });

    const approveBtns = document.querySelectorAll('.approve-plan-btn');
    approveBtns.forEach(btn => {
        if (isGenerating) {
            btn.dataset.prevState = btn.innerText;
            btn.innerText = 'Generating...';
            btn.style.backgroundColor = '#444';
            btn.style.borderColor = '#444';
            btn.style.color = '#888';
            btn.style.cursor = 'not-allowed';
            btn.disabled = true;
        } else {
            const prevState = btn.dataset.prevState || 'Approve Plan';
            btn.innerText = prevState;
            if (prevState === 'Plan Approved!') {
                btn.style.backgroundColor = '#2ea043';
                btn.style.borderColor = '#2ea043';
                btn.style.color = '#ffffff';
                btn.disabled = true;
                btn.style.cursor = 'default';
            } else {
                btn.style.backgroundColor = '#007acc';
                btn.style.borderColor = '#007acc';
                btn.style.color = '#ffffff';
                btn.disabled = false;
                btn.style.cursor = 'pointer';
            }
        }
    });
}

// Initial state
setGeneratingState(false);

sendBtn.addEventListener('click', sendMessage);

input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});


// Paste Image Handling
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


// Auto-resize textarea
input.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
});

function addMessage(text, sender, images = []) {
    const div = document.createElement('div');
    div.className = `message ${sender}`;

    // Header
    const header = document.createElement('div');
    header.className = 'message-header';
    header.innerText = sender === 'user' ? 'You' : 'OpenGravity';
    div.appendChild(header);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (images && images.length > 0) {
        images.forEach(b64 => {
            const img = document.createElement('img');
            img.src = 'data:image/jpeg;base64,' + b64;
            img.className = 'preview-thumb';
            contentDiv.appendChild(img);
            contentDiv.appendChild(document.createElement('br'));
        });
    }

    contentDiv.innerHTML = formatMessage(text);
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
    // Hide READ_FILE requests completely from UI
    let cleanedText = text.replace(/\[READ_FILE:.*?\]/g, '');

    // Also hide incomplete [READ_FILE...] while streaming
    const partialMatch = cleanedText.match(/\[[^\]]*$/);
    if (partialMatch) {
        const p = partialMatch[0];
        if ('[READ_FILE:'.startsWith(p) || p.startsWith('[READ_FILE:')) {
            cleanedText = cleanedText.substring(0, partialMatch.index);
        }
    }

    // Check for code blocks before modifying content
    const hasCodeBlocks = /```([\s\S]*?)```/.test(cleanedText);

    // Extract Plan Blocks to protect from markdown parser
    const plans = [];
    cleanedText = cleanedText.replace(/<plan>([\s\S]*?)<\/plan>/gi, (match, planContent) => {
        plans.push(planContent);
        return `%%%PLAN_${plans.length - 1}%%%`;
    });

    // Extract File Chips
    const chips = [];
    cleanedText = cleanedText.replace(/\[\[FILE_READ_CHIP:\s*(.+?)\]\]/g, (match, file) => {
        chips.push(file);
        return `%%%CHIP_${chips.length - 1}%%%`;
    });

    // Parse Markdown!
    let content = typeof marked !== 'undefined' ? marked.parse(cleanedText) : cleanedText;

    // Restore Plans
    content = content.replace(/<p>%%%PLAN_(\d+)%%%<\/p>|%%%PLAN_(\d+)%%%/g, (match, p1, p2) => {
        const index = p1 !== undefined ? p1 : p2;
        const planContent = plans[index];
        const parsedPlan = typeof marked !== 'undefined' ? marked.parse(planContent) : planContent;

        const btnHtml = isGenerating
            ? `<button class="approve-plan-btn" disabled style="background-color: #444; border-color: #444; color: #888; cursor: not-allowed;">Generating...</button>`
            : `<button class="approve-plan-btn" onclick="approvePlan(this)">Approve Plan</button>`;

        return `<div class="plan-block">
            <div class="plan-header">Implementation Plan</div>
            <div class="plan-content">${parsedPlan}</div>
            ${btnHtml}
        </div>`;
    });

    // Restore Chips
    content = content.replace(/<p>%%%CHIP_(\d+)%%%<\/p>|%%%CHIP_(\d+)%%%/g, (match, p1, p2) => {
        const index = p1 !== undefined ? p1 : p2;
        const file = chips[index];
        return `<span class="file-chip">Read file: <code>${file}</code></span>`;
    });

    // Append a single Apply Code button if code blocks exist
    if (hasCodeBlocks) {
        content += isGenerating
            ? `<br><button class="apply-all-btn" disabled style="background-color: #444; border-color: #444; color: #888; cursor: not-allowed;">Generating...</button>`
            : `<br><button class="apply-all-btn" onclick="applyAllCode(this)">Apply All Code Changes</button>`;
    }

    return content;
}

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function addLoadingIndicator() {
    const div = document.createElement('div');
    div.id = 'loading-indicator';
    div.className = 'message assistant';

    const header = document.createElement('div');
    header.className = 'message-header';
    header.innerText = 'OpenGravity';
    div.appendChild(header);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content loading-dots';
    contentDiv.innerHTML = '<span>.</span><span>.</span><span>.</span>';
    div.appendChild(contentDiv);

    messagesContainer.appendChild(div);
    scrollToBottom();
}

function removeLoadingIndicator() {
    const loader = document.getElementById('loading-indicator');
    if (loader) {
        loader.remove();
    }
}

// Global function for insert all code
window.applyAllCode = function (btn) {
    const messageContent = btn.parentElement;
    const preElements = messageContent.querySelectorAll('pre');
    let codeChanges = [];

    preElements.forEach(pre => {
        // Try to find the filename from previous siblings
        let prev = pre.previousElementSibling;
        let filename = '';

        while (prev) {
            let text = prev.innerText || prev.textContent || '';
            text = text.trim();

            if (text) {
                // 1. Try to find a bold/strong tag first
                const strong = prev.querySelector('strong');
                if (strong && strong.innerText.trim()) {
                    filename = strong.innerText.trim();
                    break;
                }

                // 2. Try EM or CODE tags inside the previous element
                const em = prev.querySelector('em, code');
                if (em && em.innerText.trim() && !em.innerText.includes(' ')) {
                    filename = em.innerText.trim();
                    break;
                }

                // 3. Fallback: examine the exact text of the line directly above
                const lines = text.split('\n');
                let lastLine = lines[lines.length - 1].trim();

                // Remove trailing syntax characters
                lastLine = lastLine.replace(/[:`*]/g, '').trim();

                if (lastLine) {
                    const words = lastLine.split(' ');
                    if (words.length === 1) {
                        filename = words[0]; // Exactly one word (e.g. "requirements.txt")
                    } else {
                        // Look backwards for a word that seems like a filename
                        for (let i = words.length - 1; i >= 0; i--) {
                            let w = words[i].replace(/[.,;:!?]$/, '');
                            if ((w.includes('.') || w.includes('/') || w.includes('\\')) && w.length > 2 && !w.endsWith('.')) {
                                filename = w;
                                break;
                            }
                        }
                    }
                    break;
                }
            }
            prev = prev.previousElementSibling;
        }

        // Clean up any remaining markdown or punctuation
        if (filename) {
            filename = filename.replace(/[*`:"']/g, '').trim();
        }

        const codeBlock = pre.querySelector('code');
        if (codeBlock) {
            codeChanges.push({
                file: filename,
                code: codeBlock.innerText
            });
        }
    });

    if (codeChanges.length > 0) {
        vscode.postMessage({
            command: 'applyCode',
            changes: codeChanges
        });

        btn.innerText = 'Applied All Changes!';
        btn.style.backgroundColor = '#28a745';
        btn.disabled = true;
    }
};

window.approvePlan = function (btn) {
    const text = "I approve the exact plan proposed above. Please execute this plan now and write the actual code changes.";
    addMessage(text, 'user', []);
    addLoadingIndicator();

    vscode.postMessage({
        command: 'chat',
        text: text,
        images: [],
        model: currentModel
    });

    // Visual feedback
    btn.innerText = "Plan Approved!";
    btn.style.backgroundColor = "#2ea043"; // Success green
    btn.disabled = true;
};
