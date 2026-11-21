import { useEffect, useMemo, useRef, useState } from 'react';

import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

import { buildContext } from './lib/context.js';
import {
  createCharacterPack,
  downloadCharacterPack,
} from './lib/character-pack.js';
import { API_BASE } from './lib/config.js';
import { importFile, readCharacterPack } from './lib/import-client.js';
import {
  clearLibrary,
  loadLegacySession,
  loadLibrary,
  saveLibrary,
} from './lib/storage.js';

const INITIAL_NEW_CHARACTER = {
  name: '',
  title: '',
  userName: '你',
  stage: '初识',
  aliases: '',
  age: '',
  appearance: '',
  personality: '',
  speechStyle: '',
  habits: '',
  background: '',
  characterRole: '',
  addressUser: '',
  addressCharacter: '',
  boundaries: '',
  tensions: '',
  memories: '',
  openThreads: '',
  opening: '',
};

const DEFAULT_SETTINGS = {
  provider: 'deepseek',
  model: 'deepseek-flash',
  apiKey: '',
  useServerKey: false,
  directDeepseek: false,
  managed: true,
  remember: false,
  maxRecent: 6,
  retrievalLimit: 4,
  memoryLimit: 6,
  contextBudgetTokens: 1500,
  maxOutputTokens: 500,
  temperature: 0.9,
};

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const timeLabel = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const firstChar = (name) => String(name || '?').slice(0, 1);

const voiceErrorMessage = (error) => {
  const text = String(error?.message ?? error ?? '');
  if (text === '2' || /client side/i.test(text)) {
    return '语音引擎还没准备好，请再点一次麦克风';
  }
  if (/no selected voice/i.test(text)) {
    return '当前手机没有语音识别服务，可以改用输入法的麦克风';
  }
  return `语音输入失败：${text || '未知错误'}`;
};

const stripDayLabel = (text) =>
  String(text ?? '').replace(
    /^\s*[（(【\[]?\s*第\s*\d+\s*天\s*[）)】\]]?\s*/u,
    '',
  );

function cleanBible(bible) {
  if (!bible) return bible;
  return {
    ...bible,
    timeline: (bible.timeline ?? []).map((item) => ({
      ...item,
      when: stripDayLabel(item.when),
    })),
    memories: (bible.memories ?? []).map((memory) => ({
      ...memory,
      text: stripDayLabel(memory.text),
    })),
    style_samples: (bible.style_samples ?? []).map((sample) => stripDayLabel(sample)),
  };
}

function cleanTextItems(items) {
  return (items ?? []).map((item) => ({ ...item, text: stripDayLabel(item.text) }));
}

const loadSettings = () => {
  try {
    const stored = JSON.parse(localStorage.getItem('whale-settings') || '{}');
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    // Consumer build: no provider/model/key settings. Always use credits.
    merged.managed = true;
    merged.directDeepseek = false;
    merged.useServerKey = false;
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

function normalizeMessages(character) {
  if (Array.isArray(character.messages) && character.messages.length > 0) {
    return cleanTextItems(character.messages);
  }
  return cleanTextItems(
    (character.events ?? []).map((event) => ({ ...event, imported: true })),
  );
}

function makeCharacter({ id, bible, events, messages, source }) {
  const now = new Date().toISOString();
  return {
    id: id ?? `char-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: bible?.persona?.name ?? '角色',
    title: bible?.title ?? '未命名故事',
    source: source ?? 'imported',
    bible: cleanBible(bible),
    events: cleanTextItems(events),
    messages: cleanTextItems(messages).map(({ pending, ...message }) => message),
    createdAt: now,
    updatedAt: now,
  };
}

export default function App() {
  const [data, setData] = useState(null);
  const [messages, setMessages] = useState([]);
  const [events, setEvents] = useState([]);
  const [library, setLibrary] = useState({
    version: 1,
    activeId: null,
    characters: [],
  });
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [context, setContext] = useState(null);
  const [view, setView] = useState('chat');
  const [settings, setSettings] = useState(loadSettings);
  const [showAll, setShowAll] = useState(false);
  const [characterQuery, setCharacterQuery] = useState('');
  const [characterSort, setCharacterSort] = useState('recent');
  const [newCharacter, setNewCharacter] = useState(INITIAL_NEW_CHARACTER);
  const [source, setSource] = useState('demo');
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [installPrompt, setInstallPrompt] = useState(null);
  const [accountToken, setAccountToken] = useState(
    () => localStorage.getItem('whale-account-token') || '',
  );
  const [credits, setCredits] = useState(null);
  const [redeemInput, setRedeemInput] = useState('');
  const [quotaNotice, setQuotaNotice] = useState(false);

  const abortRef = useRef(null);
  const fileInputRef = useRef(null);
  const bottomRef = useRef(null);
  const chatScrollRef = useRef(null);
  const [showJump, setShowJump] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const voiceBaseRef = useRef('');
  const webRecognitionRef = useRef(null);

  const config = useMemo(
    () => ({
      provider: settings.provider || 'deepseek',
      model:
        settings.model ||
        (settings.provider === 'zhipu' ? 'glm-4.7-flash' : 'deepseek-flash'),
      apiKey: settings.apiKey || '',
      useServerKey: settings.useServerKey !== false,
      managed: settings.managed === true,
      directDeepseek:
        settings.managed !== true &&
        settings.directDeepseek === true &&
        (settings.provider || 'deepseek') === 'deepseek',
    }),
    [settings],
  );

  const chatOptions = useMemo(
    () => ({
      maxRecent: Number(settings.maxRecent) || 6,
      retrievalLimit: Number(settings.retrievalLimit) || 4,
      memoryLimit: Number(settings.memoryLimit) || 6,
      contextBudgetTokens: Number(settings.contextBudgetTokens) || 1500,
      maxOutputTokens: Number(settings.maxOutputTokens) || 500,
      temperature: Number(settings.temperature) || 0.9,
    }),
    [settings],
  );

  const applyCharacter = (character) => {
    setData(cleanBible(character.bible));
    setEvents(cleanTextItems(character.events));
    setMessages(normalizeMessages(character));
    setSource(character.source ?? 'demo');
    setImportStatus('');
    setContext(null);
    setDraft('');
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const stored = await loadLibrary();
        if (cancelled) return;

        if (stored?.characters?.length > 0) {
          const active =
            stored.characters.find((character) => character.id === stored.activeId) ??
            stored.characters[0];
          setLibrary({ ...stored, activeId: active.id });
          applyCharacter(active);
          return;
        }

        const legacy = await loadLegacySession();
        if (legacy?.bible) {
          const character = makeCharacter({
            bible: legacy.bible,
            events: legacy.events ?? [],
            messages: legacy.messages ?? [],
            source: legacy.source ?? 'imported',
          });
          const next = { version: 1, activeId: character.id, characters: [character] };
          await saveLibrary(next);
          if (cancelled) return;
          setLibrary(next);
          applyCharacter(character);
          return;
        }

        const response = await fetch('/demo-data.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const character = makeCharacter({
          id: 'demo',
          bible: payload,
          events: payload.events,
          messages: payload.events.map((event) => ({ ...event, imported: true })),
          source: 'demo',
        });
        const next = { version: 1, activeId: character.id, characters: [character] };
        await saveLibrary(next);
        if (cancelled) return;
        setLibrary(next);
        applyCharacter(character);
      } catch (loadError) {
        if (!cancelled) setError(`加载角色失败：${loadError.message}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (view !== 'chat') return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, messages[messages.length - 1]?.text.length, view]);

  useEffect(() => {
    const handler = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let disposed = false;
    let partialHandle;
    let stateHandle;

    (async () => {
      try {
        partialHandle = await SpeechRecognition.addListener(
          'partialResults',
          (data) => {
            if (disposed) return;
            const text = data.matches?.[0] ?? '';
            if (text) setDraft(`${voiceBaseRef.current}${text}`);
          },
        );
        stateHandle = await SpeechRecognition.addListener(
          'listeningState',
          (data) => {
            if (!disposed) setListening(data.status === 'started');
          },
        );
      } catch {
        // Native speech recognition is unavailable; the Web Speech fallback is used.
      }
    })();

    return () => {
      disposed = true;
      partialHandle?.remove();
      stateHandle?.remove();
    };
  }, []);

  useEffect(() => {
    if (!accountToken) {
      setCredits(null);
      return undefined;
    }
    let cancelled = false;
    fetch(`${API_BASE}/api/balance`, {
      headers: { Authorization: `Bearer ${accountToken}` },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!cancelled && payload) setCredits(payload.credits);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [accountToken]);

  useEffect(() => {
    if (!data || !library.activeId) return;
    const timer = setTimeout(() => {
      setLibrary((previous) => {
        const characters = previous.characters.map((character) =>
          character.id === previous.activeId
            ? {
                ...character,
                name: data.persona.name,
                title: data.title,
                bible: data,
                events,
                messages: messages.map(({ pending, ...message }) => message),
                source,
                updatedAt: new Date().toISOString(),
              }
            : character,
        );
        const next = { ...previous, characters };
        saveLibrary(next).catch(() => {});
        return next;
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [data, events, messages, source, library.activeId]);

  const importedCount = messages.filter((message) => message.imported).length;
  const visibleMessages = showAll ? messages : messages.slice(-60);
  const filteredCharacters = library.characters.filter((character) => {
    const query = characterQuery.trim().toLowerCase();
    if (!query) return true;
    return `${character.name} ${character.title}`.toLowerCase().includes(query);
  });
  const sortedCharacters = [...filteredCharacters].sort((left, right) => {
    if (characterSort === 'name') {
      return left.name.localeCompare(right.name, 'zh-CN');
    }
    if (characterSort === 'memories') {
      return (
        (right.bible?.memories?.length ?? 0) - (left.bible?.memories?.length ?? 0)
      );
    }
    return new Date(right.updatedAt ?? 0) - new Date(left.updatedAt ?? 0);
  });

  const snapshotCharacters = () => {
    if (!data) return library.characters;
    return library.characters.map((character) =>
      character.id === library.activeId
        ? {
            ...character,
            name: data.persona.name,
            title: data.title,
            bible: data,
            events,
            messages: messages.map(({ pending, ...message }) => message),
            source,
            updatedAt: new Date().toISOString(),
          }
        : character,
    );
  };

  const switchCharacter = (id) => {
    const characters = snapshotCharacters();
    const character = characters.find((item) => item.id === id);
    if (!character) return;
    const next = { ...library, activeId: id, characters };
    setLibrary(next);
    saveLibrary(next).catch(() => {});
    applyCharacter(character);
    setView('chat');
  };

  const openDemoCharacter = async () => {
    let character = library.characters.find((item) => item.source === 'demo');
    if (!character) {
      const response = await fetch('/demo-data.json');
      const payload = await response.json();
      character = makeCharacter({
        id: `demo-${Date.now()}`,
        bible: payload,
        events: payload.events,
        messages: payload.events.map((event) => ({ ...event, imported: true })),
        source: 'demo',
      });
    }
    const characters = [character, ...snapshotCharacters().filter((item) => item.id !== character.id)];
    const next = { ...library, activeId: character.id, characters };
    setLibrary(next);
    await saveLibrary(next);
    applyCharacter(character);
    setView('chat');
  };

  const openNewCharacter = () => {
    setNewCharacter({ ...INITIAL_NEW_CHARACTER });
    setError('');
    setView('new');
  };

  const updateNewCharacter = (key, value) => {
    setNewCharacter((previous) => ({ ...previous, [key]: value }));
  };

  const createBlankCharacter = async () => {
    const name = newCharacter.name.trim();
    if (!name) {
      setError('角色名不能为空');
      return;
    }

    const title = newCharacter.title.trim() || `和${name}的故事`;
    const userName = newCharacter.userName.trim() || '你';
    const list = (value) =>
      String(value ?? '')
        .split(/[，,、\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
    const lines = (value) =>
      String(value ?? '')
        .split(/\n/)
        .map((item) => item.trim())
        .filter(Boolean);

    const personality = list(newCharacter.personality);
    const aliases = list(newCharacter.aliases);
    const habits = list(newCharacter.habits);
    const addressUser = list(newCharacter.addressUser);
    const addressCharacter = list(newCharacter.addressCharacter);
    const boundaries = lines(newCharacter.boundaries);
    const tensions = lines(newCharacter.tensions);
    const openThreads = lines(newCharacter.openThreads);
    const memories = lines(newCharacter.memories).map((text) => ({
      kind: '事件',
      text,
      importance: 0.7,
    }));
    const opening = newCharacter.opening.trim();
    const now = new Date().toISOString();

    const bible = {
      title,
      persona: {
        name,
        aliases,
        age: newCharacter.age.trim() || '未知',
        appearance: newCharacter.appearance.trim() || '未知',
        personality,
        speech_style: newCharacter.speechStyle.trim() || '未知',
        background: newCharacter.background.trim() || '未知',
        habits,
      },
      relationship: {
        stage: newCharacter.stage.trim() || '初识',
        user_name: userName,
        character_role: newCharacter.characterRole.trim() || '恋人',
        address_terms: {
          user: addressUser.length > 0 ? addressUser : [userName],
          character: addressCharacter.length > 0 ? addressCharacter : [name],
        },
        boundaries,
        tensions,
      },
      timeline: [],
      memories,
      style_samples: opening ? [opening] : [],
      open_threads: openThreads,
    };

    const openingMessages = opening
      ? [
          {
            id: uid(),
            role: 'assistant',
            speaker: name,
            text: opening,
            createdAt: now,
          },
        ]
      : [];

    const character = makeCharacter({
      bible,
      events: openingMessages,
      messages: openingMessages,
      source: 'created',
    });
    const next = {
      ...library,
      activeId: character.id,
      characters: [character, ...snapshotCharacters()],
    };
    setLibrary(next);
    await saveLibrary(next);
    applyCharacter(character);
    setNewCharacter({ ...INITIAL_NEW_CHARACTER });
    setImportStatus('新角色已创建');
    setView('chat');
  };

  const deleteActive = async () => {
    if (!window.confirm('删除当前角色？它的聊天记录也会删除。')) return;
    const remaining = library.characters.filter(
      (character) => character.id !== library.activeId,
    );
    if (remaining.length === 0) {
      await clearLibrary();
      window.location.reload();
      return;
    }
    const next = { version: 1, activeId: remaining[0].id, characters: remaining };
    setLibrary(next);
    await saveLibrary(next);
    applyCharacter(remaining[0]);
    setView('chat');
  };

  const installApp = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    setInstallPrompt(null);
  };

  const exportActive = () => {
    if (!data) return;
    const pack = createCharacterPack({
      character: {
        name: data.persona.name,
        title: data.title,
        source,
        bible: data,
        events,
        messages,
      },
    });
    downloadCharacterPack(pack, `${data.persona.name}-鲸忆角色.json`);
    setImportStatus('角色包已导出');
  };

  const renameActive = () => {
    const nextName = window.prompt('角色名', data.persona.name);
    if (!nextName || !nextName.trim()) return;
    setData((previous) =>
      previous
        ? { ...previous, persona: { ...previous.persona, name: nextName.trim() } }
        : previous,
    );
    setImportStatus('角色名已更新');
  };

  const persistSettings = (next) => {
    setSettings(next);
    const persisted = { ...next };
    if (!next.remember) delete persisted.apiKey;
    localStorage.setItem('whale-settings', JSON.stringify(persisted));
  };

  const refreshBalance = async () => {
    if (!accountToken) return;
    try {
      const response = await fetch(`${API_BASE}/api/balance`, {
        headers: { Authorization: `Bearer ${accountToken}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      setCredits(payload.credits);
    } catch (balanceError) {
      setError(`余额读取失败：${balanceError.message}`);
    }
  };

  const redeemAccount = async () => {
    const code = redeemInput.trim();
    if (!code) return;
    setError('');
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (accountToken) headers.Authorization = `Bearer ${accountToken}`;
      const response = await fetch(`${API_BASE}/api/redeem`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        throw new Error((await response.text()) || `HTTP ${response.status}`);
      }
      const payload = await response.json();
      localStorage.setItem('whale-account-token', payload.token);
      setAccountToken(payload.token);
      setCredits(payload.credits);
      setRedeemInput('');
      setQuotaNotice(false);
      persistSettings({
        ...settings,
        managed: true,
        directDeepseek: false,
        useServerKey: false,
      });
      setImportStatus(`兑换成功：${payload.credits} 次`);
    } catch (redeemError) {
      setError(`兑换失败：${redeemError.message}`);
    }
  };

  const clearAccount = () => {
    localStorage.removeItem('whale-account-token');
    setAccountToken('');
    setCredits(null);
    persistSettings({ ...settings, managed: false });
  };

  const openSettings = () => {
    setView('settings');
  };

  const handleFile = async (file) => {
    if (!file || importing) return;
    setImporting(true);
    setImportStatus('解析中…');
    setError('');

    try {
      const pack = await readCharacterPack(file).catch(() => null);
      if (pack) {
        const character = makeCharacter({
          bible: pack.bible,
          events: pack.events,
          messages: pack.messages,
          source: pack.source,
        });
        character.name = pack.name;
        character.title = pack.title;
        const next = {
          ...library,
          activeId: character.id,
          characters: [character, ...snapshotCharacters()],
        };
        setLibrary(next);
        await saveLibrary(next);
        applyCharacter(character);
        setImportStatus(`角色包已导入：${pack.name}`);
        setView('chat');
        return;
      }

      const { result, bible } = await importFile(file);
      const selected = cleanTextItems(result.selected).map((event) => ({
        ...event,
        imported: true,
      }));
      const character = makeCharacter({
        bible,
        events: selected,
        messages: selected,
        source: 'imported',
      });
      const characters = [character, ...snapshotCharacters()];
      const next = { ...library, activeId: character.id, characters };
      setLibrary(next);
      await saveLibrary(next);
      applyCharacter(character);
      setImportStatus(`导入完成：${selected.length} 条主线`);
      setView('chat');
    } catch (importError) {
      setError(`导入失败：${importError.message}`);
      setImportStatus('');
    } finally {
      setImporting(false);
    }
  };

  const copyMessage = async (message) => {
    try {
      await navigator.clipboard.writeText(message.text);
      setImportStatus('已复制');
    } catch {
      setError('复制失败，请手动选择文字');
    }
  };

  const deleteMessage = (message) => {
    if (!window.confirm('删除这条消息？')) return;
    setMessages((previous) => previous.filter((item) => item.id !== message.id));
    setEvents((previous) => previous.filter((item) => item.id !== message.id));
  };

  const rememberMessage = (message) => {
    const text = String(message.text ?? '').trim().slice(0, 180);
    if (!text) return;
    setData((previous) => {
      if (!previous) return previous;
      const memories = previous.memories ?? [];
      if (memories.some((memory) => memory.text === text)) return previous;
      return {
        ...previous,
        memories: [...memories, { kind: '事件', text, importance: 0.8 }],
      };
    });
    setImportStatus('已加入长期记忆');
  };

  const updateMemory = (index, updates) => {
    setData((previous) =>
      previous
        ? {
            ...previous,
            memories: previous.memories.map((memory, memoryIndex) =>
              memoryIndex === index ? { ...memory, ...updates } : memory,
            ),
          }
        : previous,
    );
    setImportStatus('已更新长期记忆');
  };

  const removeMemory = (index) => {
    setData((previous) =>
      previous
        ? {
            ...previous,
            memories: previous.memories.filter((_, memoryIndex) => memoryIndex !== index),
          }
        : previous,
    );
    setImportStatus('已删除一条长期记忆');
  };

  const stop = () => abortRef.current?.abort();

  const stopVoice = async () => {
    setListening(false);
    if (webRecognitionRef.current) {
      webRecognitionRef.current.stop();
      webRecognitionRef.current = null;
    }
    if (Capacitor.isNativePlatform()) {
      try {
        await SpeechRecognition.stop();
      } catch {
        // Ignore stop errors when the native recognizer is not running.
      }
    }
  };

  const startVoice = async () => {
    setVoiceError('');
    voiceBaseRef.current = draft ? `${draft} ` : '';

    if (Capacitor.isNativePlatform()) {
      try {
        const permission = await SpeechRecognition.requestPermissions();
        if (permission.speechRecognition !== 'granted') {
          setVoiceError('需要麦克风权限才能语音输入');
          return;
        }
        const { available } = await SpeechRecognition.available();
        if (!available) {
          setVoiceError('当前设备没有可用的语音识别服务');
          return;
        }
        setListening(true);
        const result = await SpeechRecognition.start({
          language: 'zh-CN',
          maxResults: 1,
          partialResults: false,
          popup: true,
          prompt: '请说话',
        });
        const match = result?.matches?.[0];
        if (match) setDraft(`${voiceBaseRef.current}${match}`);
        setListening(false);
      } catch (voiceException) {
        setListening(false);
        setVoiceError(voiceErrorMessage(voiceException));
      }
      return;
    }

    const WebSpeech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!WebSpeech) {
      setVoiceError('当前设备不支持语音输入');
      return;
    }
    try {
      const recognition = new WebSpeech();
      recognition.lang = 'zh-CN';
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.onresult = (event) => {
        let text = '';
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          text += event.results[index][0].transcript;
        }
        setDraft(`${voiceBaseRef.current}${text}`);
      };
      recognition.onerror = (event) => {
        setVoiceError(`语音输入失败：${event.error || '未知错误'}`);
        setListening(false);
      };
      recognition.onend = () => {
        setListening(false);
        webRecognitionRef.current = null;
      };
      webRecognitionRef.current = recognition;
      setListening(true);
      recognition.start();
    } catch (voiceException) {
      setListening(false);
      setVoiceError(voiceErrorMessage(voiceException));
    }
  };

  const toggleVoice = () => {
    if (listening) stopVoice();
    else startVoice();
  };

  const send = async (textArg) => {
    const text = String(textArg ?? draft).trim();
    if (!text || streaming || !data) return;
    if (!accountToken || credits === 0) {
      setQuotaNotice(true);
      return;
    }
    setQuotaNotice(false);
    if (listening) stopVoice();

    setError('');
    const userMessage = {
      id: uid(),
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    };

    const ctx = buildContext({
      bible: data,
      events,
      messages,
      userText: text,
      maxRecent: chatOptions.maxRecent,
      retrievalLimit: chatOptions.retrievalLimit,
      memoryLimit: chatOptions.memoryLimit,
      contextBudgetTokens: chatOptions.contextBudgetTokens,
      estimatedOutputTokens: chatOptions.maxOutputTokens,
    });
    setContext(ctx);

    const assistantId = uid();
    const assistantCreatedAt = new Date().toISOString();
    let assistantText = '';
    setMessages((previous) => [
      ...previous,
      userMessage,
      {
        id: assistantId,
        role: 'assistant',
        speaker: data.persona.name,
        text: '',
        createdAt: assistantCreatedAt,
        pending: true,
      },
    ]);
    setDraft('');
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let url;
      let headers;
      let body;

      if (config.managed) {
        if (!accountToken) throw new Error('托管模式需要先兑换额度');
        url = `${API_BASE}/api/chat`;
        headers = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accountToken}`,
        };
        body = {
          managed: true,
          provider: config.provider,
          model: config.model,
          messages: ctx.messages,
          temperature: chatOptions.temperature,
          maxTokens: chatOptions.maxOutputTokens,
        };
      } else if (config.directDeepseek) {
        if (!config.apiKey) throw new Error('直连模式需要先填 DeepSeek API key');
        url = 'https://api.deepseek.com/chat/completions';
        headers = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        };
        body = {
          model: config.model,
          messages: ctx.messages,
          stream: true,
          temperature: chatOptions.temperature,
          max_tokens: chatOptions.maxOutputTokens,
          thinking: { type: 'disabled' },
        };
      } else {
        if (!API_BASE) {
          throw new Error('没有配置 gateway，请开启 DeepSeek 直连或设置 VITE_API_BASE');
        }
        url = `${API_BASE}/api/chat`;
        headers = { 'Content-Type': 'application/json' };
        body = {
          provider: config.provider,
          model: config.model,
          apiKey: config.useServerKey ? undefined : config.apiKey,
          messages: ctx.messages,
          temperature: chatOptions.temperature,
          maxTokens: chatOptions.maxOutputTokens,
        };
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `HTTP ${response.status}`);
      }
      if (!response.body) throw new Error('浏览器没有收到流式响应');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamDone = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload) continue;
          if (payload === '[DONE]') {
            streamDone = true;
            break;
          }
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              assistantText += delta;
              setMessages((previous) =>
                previous.map((message) =>
                  message.id === assistantId
                    ? { ...message, text: message.text + delta }
                    : message,
                ),
              );
            }
          } catch {
            // Ignore keepalive / partial SSE payloads.
          }
        }

        if (streamDone) break;
      }

      if (streamDone) await reader.cancel().catch(() => {});

      setMessages((previous) =>
        previous.map((message) =>
          message.id === assistantId ? { ...message, pending: false } : message,
        ),
      );
    } catch (sendError) {
      if (sendError.name === 'AbortError') {
        setError('已停止生成。');
      } else {
        setError(`生成失败：${sendError.message}`);
      }
      setMessages((previous) =>
        previous.filter(
          (message) => message.id !== assistantId || message.text.length > 0,
        ),
      );
    } finally {
      const finalMessages = assistantText
        ? [
            ...messages,
            userMessage,
            {
              id: assistantId,
              role: 'assistant',
              speaker: data.persona.name,
              text: assistantText,
              createdAt: assistantCreatedAt,
            },
          ]
        : [...messages, userMessage];
      const characters = snapshotCharacters().map((character) =>
        character.id === library.activeId
          ? {
              ...character,
              messages: finalMessages,
              updatedAt: new Date().toISOString(),
            }
          : character,
      );
      const next = { ...library, characters };
      setLibrary(next);
      await saveLibrary(next).catch(() => {});
      setStreaming(false);
      abortRef.current = null;
      if (config.managed) refreshBalance();
    }
  };

  if (error && !data) {
    return (
      <main className="boot-error">
        <h1>鲸忆</h1>
        <p>{error}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="boot-error">
        <h1>鲸忆</h1>
        <p>正在加载本地角色…</p>
      </main>
    );
  }

  const headerTitle =
    view === 'chat'
      ? data.persona.name
      : view === 'characters'
        ? '角色'
        : view === 'memory'
          ? '记忆'
          : view === 'new'
            ? '新建角色'
            : '设置';
  const headerSub =
    view === 'chat'
      ? `${data.memories.length} 条长期记忆 · ${importedCount} 条导入 · ${library.characters.length} 个角色`
      : view === 'characters'
        ? `${library.characters.length} 个角色`
        : view === 'memory'
          ? data.title
          : view === 'new'
            ? '不导入也能开始'
            : '额度与兑换';

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          {view === 'chat' && (
            <button
              className="icon-btn"
              onClick={() => setView('characters')}
              aria-label="角色列表"
            >
              ☰
            </button>
          )}
          {view === 'new' && (
            <button
              className="icon-btn"
              onClick={() => setView('characters')}
              aria-label="返回角色列表"
            >
              ←
            </button>
          )}
          {view !== 'chat' && view !== 'characters' && view !== 'new' && (
            <button className="icon-btn" onClick={() => setView('chat')} aria-label="返回">
              ←
            </button>
          )}
          <div className="avatar">{firstChar(data.persona.name)}</div>
          <div className="title-block">
            <h1>{headerTitle}</h1>
            <div className="sub">{headerSub}</div>
          </div>
        </div>
        <div className="topbar-actions">
          {view === 'chat' && (
            <>
              <button className="ghost" onClick={() => setView('memory')}>
                记忆
              </button>
              <button className="ghost" onClick={openSettings}>
                设置
              </button>
            </>
          )}
          {view === 'characters' && (
            <>
              <button
                className="ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
              >
                {importing ? '导入中…' : '导入'}
              </button>
              {installPrompt && (
                <button className="ghost" onClick={installApp}>
                  安装
                </button>
              )}
              <button className="ghost" onClick={openSettings}>
                设置
              </button>
            </>
          )}
          {view === 'memory' && (
            <>
              <button className="ghost" onClick={exportActive}>
                导出
              </button>
              <button className="ghost" onClick={renameActive}>
                改名
              </button>
              <button className="ghost" onClick={deleteActive}>
                删除
              </button>
              <button className="ghost" onClick={openSettings}>
                设置
              </button>
            </>
          )}
          {view === 'new' && (
            <>
              <button className="ghost" onClick={() => setView('characters')}>
                取消
              </button>
              <button className="primary" onClick={createBlankCharacter}>
                创建
              </button>
            </>
          )}

          <span className={`status ${streaming ? 'live' : ''}`}>
            {streaming ? '生成中…' : ''}
          </span>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,.json,.jsonl,.txt"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          handleFile(file);
        }}
      />

      {error && (
        <div className="error-bar">
          <span>{error}</span>
          <button className="ghost small" onClick={() => setError('')}>
            关闭
          </button>
        </div>
      )}

      {view === 'chat' && (
        <main className="chat-view">
          <div className="thread-bar">
            <button className="ghost small" onClick={() => setShowAll((value) => !value)}>
              {showAll ? '只看最近 60 条' : `显示全部 ${messages.length} 条`}
            </button>
            {importStatus && <span className="thread-note">{importStatus}</span>}
          </div>

          <div
            className="chat-scroll"
            ref={chatScrollRef}
            onScroll={(event) => {
              const element = event.currentTarget;
              const distance =
                element.scrollHeight - element.scrollTop - element.clientHeight;
              setShowJump(distance > 240);
            }}
          >
            <div className="chat-thread">
              {!showAll && messages.length > 60 && (
                <div className="older-hint">已折叠较早的 {messages.length - 60} 条</div>
              )}
              {messages.length === 0 && (
                <div className="empty-chat">
                  <div className="avatar big">{firstChar(data.persona.name)}</div>
                  <strong>开始和「{data.persona.name}」聊天</strong>
                  <span>人设已经载入，直接说话就行。</span>
                </div>
              )}
              {visibleMessages.map((message) => (
                <Message
                  key={message.id}
                  message={message}
                  personaName={data.persona.name}
                  onRemember={rememberMessage}
                  onCopy={copyMessage}
                  onDelete={deleteMessage}
                />
              ))}
              <div ref={bottomRef} />
            </div>
          </div>

          {showJump && (
            <button
              className="jump-bottom"
              onClick={() => {
                bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
                setShowJump(false);
              }}
            >
              ↓ 最新
            </button>
          )}

          <div className="composer-wrap">
            {voiceError && (
              <div className="voice-error">
                <span>{voiceError}</span>
                <button onClick={() => setVoiceError('')}>×</button>
              </div>
            )}
            {quotaNotice && (
              <div className="quota-banner">
                <span>额度已用完，兑换后继续聊</span>
                <button
                  className="primary small"
                  onClick={() => {
                    setQuotaNotice(false);
                    setView('settings');
                  }}
                >
                  去兑换
                </button>
              </div>
            )}
            <div className="composer">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
                placeholder={`给「${data.persona.name}」发消息…`}
                rows={1}
              />
              <div className="composer-row">
                <span className="hint">
                  {accountToken
                    ? credits === null
                      ? '加载额度…'
                      : `剩余 ${credits} 次`
                    : '未兑换'}
                </span>
                <div className="composer-buttons">
                  <button
                    type="button"
                    className={`mic-btn ${listening ? 'recording' : ''}`}
                    onClick={toggleVoice}
                    disabled={streaming}
                    title="语音输入"
                  >
                    {listening ? '停止' : '🎙'}
                  </button>
                  {streaming ? (
                    <button className="danger" onClick={stop}>
                      停止
                    </button>
                  ) : (
                    <button
                      className="primary"
                      onClick={() => send()}
                      disabled={!draft.trim()}
                    >
                      发送
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="composer-note">
              {accountToken
                ? `每轮消耗 1 次 · 剩余 ${credits ?? '—'} 次`
                : '输入兑换码后开始聊天'}
            </div>
          </div>
        </main>
      )}

      {view === 'characters' && (
        <main className="page">
          <div className="page-inner">
            <div className="character-toolbar">
              <input
                className="character-search"
                type="search"
                placeholder="搜索角色名 / 故事标题…"
                value={characterQuery}
                onChange={(event) => setCharacterQuery(event.target.value)}
              />
              <select
                className="character-sort"
                value={characterSort}
                onChange={(event) => setCharacterSort(event.target.value)}
              >
                <option value="recent">最近使用</option>
                <option value="name">按名字</option>
                <option value="memories">按记忆数</option>
              </select>
            </div>
            <div className="character-grid">
              {sortedCharacters.map((character) => (
                <button
                  key={character.id}
                  className={`character-card ${
                    character.id === library.activeId ? 'active' : ''
                  }`}
                  onClick={() => switchCharacter(character.id)}
                >
                  <span className="avatar">{firstChar(character.name)}</span>
                  <span className="character-info">
                    <strong>{character.name}</strong>
                    <span>{character.title}</span>
                    <small>
                      {character.bible?.memories?.length ?? 0} 条记忆 ·{' '}
                      {character.messages?.length ?? 0} 条消息
                    </small>
                  </span>
                </button>
              ))}
            </div>
            {filteredCharacters.length === 0 && (
              <p className="page-sub">没有匹配的角色。</p>
            )}
            <div className="page-actions">
              <button className="ghost" onClick={openNewCharacter}>
                新建角色
              </button>
              <button
                className="ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
              >
                {importing ? '导入中…' : '导入新角色'}
              </button>
              <button className="ghost" onClick={openDemoCharacter}>
                使用 demo 角色
              </button>
            </div>
          </div>
        </main>
      )}

      {view === 'new' && (
        <main className="page">
          <div className="page-inner">
            <section className="page-card">
              <h3>基本信息</h3>
              <div className="field-grid">
                <label className="field">
                  角色名 *
                  <input
                    autoFocus
                    value={newCharacter.name}
                    placeholder="比如：沈砚"
                    onChange={(event) => updateNewCharacter('name', event.target.value)}
                  />
                </label>
                <label className="field">
                  故事标题
                  <input
                    value={newCharacter.title}
                    placeholder={`默认：和${newCharacter.name || '角色'}的故事`}
                    onChange={(event) => updateNewCharacter('title', event.target.value)}
                  />
                </label>
                <label className="field">
                  你的名字
                  <input
                    value={newCharacter.userName}
                    onChange={(event) => updateNewCharacter('userName', event.target.value)}
                  />
                </label>
                <label className="field">
                  关系阶段
                  <input
                    value={newCharacter.stage}
                    placeholder="初识 / 暧昧 / 已在一起…"
                    onChange={(event) => updateNewCharacter('stage', event.target.value)}
                  />
                </label>
                <label className="field">
                  别名（逗号分隔）
                  <input
                    value={newCharacter.aliases}
                    placeholder="沈医生、阿砚"
                    onChange={(event) => updateNewCharacter('aliases', event.target.value)}
                  />
                </label>
                <label className="field">
                  年龄
                  <input
                    value={newCharacter.age}
                    placeholder="28"
                    onChange={(event) => updateNewCharacter('age', event.target.value)}
                  />
                </label>
              </div>
              <label className="field">
                外貌
                <textarea
                  rows={2}
                  value={newCharacter.appearance}
                  placeholder="白大褂、袖口挽到小臂、左手腕有一道旧疤…"
                  onChange={(event) => updateNewCharacter('appearance', event.target.value)}
                />
              </label>
            </section>

            <section className="page-card">
              <h3>人设</h3>
              <div className="field-grid">
                <label className="field">
                  性格（逗号分隔）
                  <input
                    value={newCharacter.personality}
                    placeholder="克制、温柔、嘴硬"
                    onChange={(event) =>
                      updateNewCharacter('personality', event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  说话风格
                  <input
                    value={newCharacter.speechStyle}
                    placeholder="话少、短句、行动多于语言"
                    onChange={(event) =>
                      updateNewCharacter('speechStyle', event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  习惯（逗号分隔）
                  <input
                    value={newCharacter.habits}
                    placeholder="把伞往你那边偏、淋雨容易发烧"
                    onChange={(event) => updateNewCharacter('habits', event.target.value)}
                  />
                </label>
              </div>
              <label className="field">
                背景 / 设定
                <textarea
                  rows={6}
                  value={newCharacter.background}
                  placeholder="他是谁、你们怎么认识、有哪些不能忘的设定…"
                  onChange={(event) =>
                    updateNewCharacter('background', event.target.value)
                  }
                />
              </label>
            </section>

            <section className="page-card">
              <h3>关系</h3>
              <div className="field-grid">
                <label className="field">
                  角色定位
                  <input
                    value={newCharacter.characterRole}
                    placeholder="恋人 / 医生 / 隔壁花店老板"
                    onChange={(event) =>
                      updateNewCharacter('characterRole', event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  角色对你的称呼
                  <input
                    value={newCharacter.addressUser}
                    placeholder="你、小朋友、阿晚"
                    onChange={(event) =>
                      updateNewCharacter('addressUser', event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  你对角色的称呼
                  <input
                    value={newCharacter.addressCharacter}
                    placeholder="沈砚、沈医生"
                    onChange={(event) =>
                      updateNewCharacter('addressCharacter', event.target.value)
                    }
                  />
                </label>
              </div>
              <label className="field">
                边界（一行一条）
                <textarea
                  rows={3}
                  value={newCharacter.boundaries}
                  placeholder="不要替他决定人生；不要提顾青…"
                  onChange={(event) =>
                    updateNewCharacter('boundaries', event.target.value)
                  }
                />
              </label>
              <label className="field">
                未解决的矛盾（一行一条）
                <textarea
                  rows={3}
                  value={newCharacter.tensions}
                  placeholder="他淋雨会发烧，却仍坚持送你…"
                  onChange={(event) =>
                    updateNewCharacter('tensions', event.target.value)
                  }
                />
              </label>
            </section>

            <section className="page-card">
              <h3>初始记忆</h3>
              <label className="field">
                长期记忆（一行一条，可选）
                <textarea
                  rows={4}
                  value={newCharacter.memories}
                  placeholder="第一次见面是在医院走廊；他习惯把伞往你那边偏…"
                  onChange={(event) =>
                    updateNewCharacter('memories', event.target.value)
                  }
                />
              </label>
              <label className="field">
                未结束的线（一行一条，可选）
                <textarea
                  rows={3}
                  value={newCharacter.openThreads}
                  placeholder="周末去看海；他答应过要解释那通电话…"
                  onChange={(event) =>
                    updateNewCharacter('openThreads', event.target.value)
                  }
                />
              </label>
            </section>

            <section className="page-card">
              <h3>开场</h3>
              <label className="field">
                开场白（可选）
                <textarea
                  rows={4}
                  value={newCharacter.opening}
                  placeholder="创建后他会先说的第一句话"
                  onChange={(event) => updateNewCharacter('opening', event.target.value)}
                />
              </label>
            </section>

            <div className="page-actions">
              <button className="ghost" onClick={() => setView('characters')}>
                取消
              </button>
              <button className="primary" onClick={createBlankCharacter}>
                创建角色
              </button>
            </div>
          </div>
        </main>
      )}

      {view === 'memory' && (
        <MemoryPage
          data={data}
          chatOptions={chatOptions}
          onUpdateMemory={updateMemory}
          onRemoveMemory={removeMemory}
        />
      )}

      {view === 'settings' && (
        <SettingsPage
          accountToken={accountToken}
          credits={credits}
          redeemInput={redeemInput}
          setRedeemInput={setRedeemInput}
          onRedeem={redeemAccount}
          onRefreshBalance={refreshBalance}
          onClearAccount={clearAccount}
        />
      )}
    </div>
  );
}

function Message({ message, personaName, onRemember, onCopy, onDelete }) {
  const isUser = message.role === 'user';
  return (
    <article className={`message ${isUser ? 'user' : 'assistant'}`}>
      <div className="message-meta">
        <span>{isUser ? '你' : message.speaker || personaName}</span>
        <span>{timeLabel(message.createdAt)}</span>
        <div className="message-actions">
          <button onClick={() => onCopy(message)}>复制</button>
          <button onClick={() => onRemember(message)}>记住</button>
          <button onClick={() => onDelete(message)}>删除</button>
        </div>
      </div>
      <div className="message-text">
        {message.text}
        {message.pending && <span className="cursor">▋</span>}
      </div>
    </article>
  );
}

function InjectionSection({ context }) {
  if (!context) return null;
  return (
    <section className="page-card">
      <h3>
        上一轮注入
        <span className="page-badge">
          ≈ {context.estimatedInputTokens} tokens · ¥{context.estimatedCostCNY.toFixed(3)}
        </span>
      </h3>
      <div className="injection-grid">
        <div>
          <h4>长期记忆</h4>
          <ul className="memory-list">
            {(context.memories.length > 0 ? context.memories : [{ kind: '无', text: '暂无' }]).map(
              (memory, index) => (
                <li key={`${memory.text}-${index}`}>
                  <span className="kind">{memory.kind}</span>
                  {memory.text}
                </li>
              ),
            )}
          </ul>
        </div>
        <div>
          <h4>相关往事</h4>
          <ul className="memory-list">
            {(context.retrieved.length > 0
              ? context.retrieved
              : [{ id: 'none', role: 'assistant', text: '本轮没有额外检索到往事' }]
            ).map((event) => (
              <li key={event.id}>
                <span className="kind">
                  {event.role === 'user' ? '你' : event.speaker || '角色'}
                </span>
                {event.text.slice(0, 140)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function MemoryPage({ data, chatOptions, onUpdateMemory, onRemoveMemory }) {
  const persona = data.persona;
  const relationship = data.relationship;
  const [editingIndex, setEditingIndex] = useState(null);
  const [editText, setEditText] = useState('');
  const [editKind, setEditKind] = useState('事件');
  const [editImportance, setEditImportance] = useState(0.5);

  const startEdit = (index, memory) => {
    setEditingIndex(index);
    setEditText(memory.text);
    setEditKind(memory.kind || '事件');
    setEditImportance(memory.importance ?? 0.5);
  };

  const saveEdit = () => {
    if (editingIndex === null || !editText.trim()) return;
    onUpdateMemory(editingIndex, {
      kind: editKind || '事件',
      text: editText.trim(),
      importance: Math.min(1, Math.max(0, Number(editImportance) || 0.5)),
    });
    setEditingIndex(null);
  };

  return (
    <main className="page">
      <div className="page-inner">
        <section className="page-hero">
          <div className="avatar big">{firstChar(persona.name)}</div>
          <div>
            <h2>{persona.name}</h2>
            <p className="page-sub">{data.title}</p>
            <div className="chips">
              {persona.personality.map((trait) => (
                <span className="chip" key={trait}>
                  {trait}
                </span>
              ))}
            </div>
          </div>
        </section>



        <section className="page-card">
          <h3>人设</h3>
          <dl>
            <dt>别名</dt>
            <dd>{persona.aliases.join('、') || '未知'}</dd>
            <dt>年龄</dt>
            <dd>{persona.age}</dd>
            <dt>外貌</dt>
            <dd>{persona.appearance}</dd>
            <dt>说话</dt>
            <dd>{persona.speech_style}</dd>
            <dt>背景</dt>
            <dd>{persona.background}</dd>
            <dt>习惯</dt>
            <dd>{persona.habits.join('、') || '未知'}</dd>
          </dl>
        </section>

        <section className="page-card">
          <h3>关系</h3>
          <dl>
            <dt>阶段</dt>
            <dd>{relationship.stage}</dd>
            <dt>用户</dt>
            <dd>{relationship.user_name}</dd>
            <dt>定位</dt>
            <dd>{relationship.character_role}</dd>
            <dt>角色→用户</dt>
            <dd>{relationship.address_terms.user.join('、') || '你'}</dd>
            <dt>用户→角色</dt>
            <dd>{relationship.address_terms.character.join('、') || persona.name}</dd>
          </dl>
          <h4>边界</h4>
          <ul className="memory-list">
            {(relationship.boundaries.length > 0
              ? relationship.boundaries
              : ['暂无']
            ).map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
          <h4>未解决</h4>
          <ul className="memory-list">
            {(relationship.tensions.length > 0 ? relationship.tensions : ['暂无']).map(
              (item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ),
            )}
          </ul>
        </section>

        <section className="page-card">
          <h3>
            长期记忆 <span className="page-badge">{data.memories.length}</span>
          </h3>
          <ul className="memory-list">
            {data.memories.map((memory, index) => (
              <li key={`${memory.text}-${index}`}>
                {editingIndex === index ? (
                  <div className="memory-edit">
                    <div className="memory-edit-row">
                      <select
                        value={editKind}
                        onChange={(event) => setEditKind(event.target.value)}
                      >
                        {['约定', '称呼', '心事', '事件', '喜好', '禁忌', '梗'].map(
                          (kind) => (
                            <option key={kind} value={kind}>
                              {kind}
                            </option>
                          ),
                        )}
                      </select>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.1"
                        value={editImportance}
                        onChange={(event) => setEditImportance(event.target.value)}
                      />
                    </div>
                    <textarea
                      rows={3}
                      value={editText}
                      onChange={(event) => setEditText(event.target.value)}
                    />
                    <div className="memory-edit-actions">
                      <button className="ghost small" onClick={() => setEditingIndex(null)}>
                        取消
                      </button>
                      <button
                        className="primary"
                        onClick={saveEdit}
                        disabled={!editText.trim()}
                      >
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="kind">{memory.kind}</span>
                    {memory.text}
                    <span className="importance">{memory.importance.toFixed(2)}</span>
                    <button
                      className="memory-edit-btn"
                      onClick={() => startEdit(index, memory)}
                    >
                      编辑
                    </button>
                    <button
                      className="memory-remove"
                      onClick={() => onRemoveMemory(index)}
                      aria-label="删除记忆"
                    >
                      ×
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="page-card">
          <h3>时间线</h3>
          <ul className="memory-list">
            {data.timeline.map((item, index) => (
              <li key={`${item.event}-${index}`}>
                {item.when && <span className="kind">{item.when}</span>}
                {item.event}
              </li>
            ))}
          </ul>
        </section>

        <section className="page-card">
          <h3>语气样本</h3>
          {data.style_samples.map((sample, index) => (
            <blockquote key={`${sample}-${index}`}>{sample}</blockquote>
          ))}
        </section>

        <section className="page-card">
          <h3>未结束的线</h3>
          <ul className="memory-list">
            {(data.open_threads.length > 0 ? data.open_threads : ['暂无']).map(
              (thread, index) => (
                <li key={`${thread}-${index}`}>{thread}</li>
              ),
            )}
          </ul>
        </section>

        <p className="page-note">
          角色会记住这些长期记忆，并在聊天时自然提起；不会把整份记录都塞给模型。
        </p>
      </div>
    </main>
  );
}

function SettingsPage({
  accountToken,
  credits,
  redeemInput,
  setRedeemInput,
  onRedeem,
  onRefreshBalance,
  onClearAccount,
}) {
  return (
    <main className="page">
      <div className="page-inner">
        <section className="page-card">
          <h3>鲸忆额度</h3>
          <p className="managed-balance">
            {accountToken ? (
              <>
                剩余 <strong>{credits ?? '…'}</strong> 次
              </>
            ) : (
              '尚未兑换'
            )}
          </p>
          <div className="managed-redeem">
            <input
              value={redeemInput}
              placeholder="输入兑换码"
              onChange={(event) => setRedeemInput(event.target.value)}
            />
            <button
              className="primary"
              onClick={onRedeem}
              disabled={!redeemInput.trim()}
            >
              兑换
            </button>
          </div>
          <div className="page-actions">
            <button className="ghost" onClick={onRefreshBalance}>
              刷新余额
            </button>
            {accountToken && (
              <button className="ghost" onClick={onClearAccount}>
                清除本机额度
              </button>
            )}
          </div>
          <p className="page-sub">
            兑换码在微店购买后自动发货；每轮对话消耗 1 次。
          </p>
        </section>

        <section className="page-card">
          <h3>关于</h3>
          <p className="page-sub">鲸忆 1.0.0 · 本地优先的角色记忆</p>
          <p className="page-sub">
            角色和聊天记录保存在本机；生成回复由鲸忆额度服务提供。
          </p>
        </section>
      </div>
    </main>
  );
}
