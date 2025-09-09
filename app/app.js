(() => {
  const dom = {
    messages: document.getElementById('messages'),
    input: document.getElementById('input'),
    sendBtn: document.getElementById('sendBtn'),
    stopBtn: document.getElementById('stopBtn'),
    openSettings: document.getElementById('openSettings'),
    themeToggle: document.getElementById('themeToggle'),
    settingsDialog: document.getElementById('settingsDialog'),
    settingsForm: document.getElementById('settingsForm'),
    apiKeyInput: document.getElementById('apiKeyInput'),
    modelSelect: document.getElementById('modelSelect'),
    systemPromptInput: document.getElementById('systemPromptInput'),
    clearChatBtn: document.getElementById('clearChatBtn'),
  };

  const storage = {
    get apiKey() { return localStorage.getItem('chat.apiKey') || ''; },
    set apiKey(v) { localStorage.setItem('chat.apiKey', v || ''); },
    get model() { return localStorage.getItem('chat.model') || 'gpt-4o-mini'; },
    set model(v) { localStorage.setItem('chat.model', v || 'gpt-4o-mini'); },
    get systemPrompt() { return localStorage.getItem('chat.system') || ''; },
    set systemPrompt(v) { localStorage.setItem('chat.system', v || ''); },
    get theme() { return localStorage.getItem('chat.theme') || 'dark'; },
    set theme(v) { localStorage.setItem('chat.theme', v || 'dark'); },
    get history() {
      try { return JSON.parse(localStorage.getItem('chat.history') || '[]'); }
      catch { return []; }
    },
    set history(v) { localStorage.setItem('chat.history', JSON.stringify(v || [])); },
  };

  let controller = null;

  function applyTheme() {
    const isLight = storage.theme === 'light';
    document.documentElement.classList.toggle('light', isLight);
  }

  function setTheme(next) {
    storage.theme = next;
    applyTheme();
  }

  function autoGrowTextarea() {
    const el = dom.input;
    el.style.height = 'auto';
    el.style.height = Math.min(220, el.scrollHeight) + 'px';
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      dom.messages.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }

  function elMessage(role, content) {
    const wrapper = document.createElement('div');
    wrapper.className = `message ${role === 'user' ? 'user' : 'bot'}`;
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role === 'user' ? '🧑' : '🤖';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = content || '';
    wrapper.appendChild(avatar);
    wrapper.appendChild(bubble);
    return { wrapper, bubble };
  }

  function elTyping() {
    const span = document.createElement('span');
    span.className = 'typing';
    span.innerHTML = '<span></span><span></span><span></span>';
    return span;
  }

  function loadHistory() {
    const history = storage.history;
    history.forEach(m => {
      const { wrapper, bubble } = elMessage(m.role, m.content);
      dom.messages.appendChild(wrapper);
    });
    if (history.length) scrollToBottom();
  }

  function saveToHistory(role, content) {
    const history = storage.history;
    history.push({ role, content });
    storage.history = history.slice(-200);
  }

  function openSettings() {
    dom.apiKeyInput.value = storage.apiKey;
    dom.modelSelect.value = storage.model;
    dom.systemPromptInput.value = storage.systemPrompt;
    dom.settingsDialog.showModal();
  }

  function saveSettings(e) {
    e?.preventDefault?.();
    storage.apiKey = dom.apiKeyInput.value.trim();
    storage.model = dom.modelSelect.value;
    storage.systemPrompt = dom.systemPromptInput.value.trim();
    dom.settingsDialog.close();
  }

  function clearChat(e) {
    e?.preventDefault?.();
    storage.history = [];
    dom.messages.innerHTML = '';
    const { wrapper } = elMessage('bot', '会话已清空。我能帮你做点什么？');
    dom.messages.appendChild(wrapper);
  }

  async function sendMessage() {
    const content = dom.input.value.trim();
    if (!content) return;
    dom.input.value = '';
    autoGrowTextarea();

    const userMsg = elMessage('user', content);
    dom.messages.appendChild(userMsg.wrapper);
    saveToHistory('user', content);

    const botMsg = elMessage('bot', '');
    botMsg.bubble.appendChild(elTyping());
    dom.messages.appendChild(botMsg.wrapper);
    scrollToBottom();

    dom.sendBtn.disabled = true;
    dom.stopBtn.disabled = false;

    try {
      const apiKey = storage.apiKey;
      const model = storage.model;
      const systemPrompt = storage.systemPrompt;
      if (!apiKey) {
        // Offline demo mode if no key
        await demoRespond(botMsg.bubble, content);
        finalize();
        return;
      }
      controller = new AbortController();
      await streamChat({ apiKey, model, systemPrompt, userContent: content, targetEl: botMsg.bubble, signal: controller.signal });
    } catch (err) {
      if (err?.name === 'AbortError') {
        appendText(botMsg.bubble, '\n[已停止]\n');
      } else {
        appendText(botMsg.bubble, `\n[错误] ${err?.message || err}`);
      }
    } finally {
      finalize();
    }

    function finalize() {
      dom.sendBtn.disabled = false;
      dom.stopBtn.disabled = true;
      scrollToBottom();
    }
  }

  function appendText(el, text) {
    if (!el) return;
    const typing = el.querySelector('.typing');
    if (typing) typing.remove();
    el.textContent += text;
  }

  async function demoRespond(targetEl, prompt) {
    const typing = targetEl.querySelector('.typing');
    if (typing) typing.remove();
    const reply = `（演示模式）你说：${prompt}`;
    for (const ch of reply) {
      await new Promise(r => setTimeout(r, 18 + Math.random() * 12));
      appendText(targetEl, ch);
    }
    saveToHistory('assistant', reply);
  }

  async function streamChat({ apiKey, model, systemPrompt, userContent, targetEl, signal }) {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    storage.history.forEach(m => messages.push(m));
    messages.push({ role: 'user', content: userContent });

    const body = {
      model,
      messages,
      stream: true,
    };

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    // SSE-style stream
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split(/\n/).filter(l => l.trim().startsWith('data: '));
      for (const line of lines) {
        const json = line.replace(/^data: /, '').trim();
        if (json === '[DONE]') break;
        try {
          const delta = JSON.parse(json);
          const token = delta?.choices?.[0]?.delta?.content || '';
          if (token) {
            appendText(targetEl, token);
            fullText += token;
          }
        } catch {}
      }
    }
    if (fullText) saveToHistory('assistant', fullText);
  }

  // events
  dom.openSettings.addEventListener('click', openSettings);
  dom.settingsForm.addEventListener('submit', saveSettings);
  dom.clearChatBtn.addEventListener('click', clearChat);
  dom.themeToggle.addEventListener('click', () => setTheme(storage.theme === 'dark' ? 'light' : 'dark'));
  dom.sendBtn.addEventListener('click', sendMessage);
  dom.stopBtn.addEventListener('click', () => controller?.abort());
  dom.input.addEventListener('input', autoGrowTextarea);
  dom.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // init
  applyTheme();
  loadHistory();
  autoGrowTextarea();
})();

