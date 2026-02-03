import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import markdownLang from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import xml from 'highlight.js/lib/languages/xml';
import python from 'highlight.js/lib/languages/python';
import yaml from 'highlight.js/lib/languages/yaml';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import protobuf from 'highlight.js/lib/languages/protobuf';
import Fuse from 'fuse.js';
import DOMPurify from 'dompurify';
import { diffLines } from 'diff';
import {
  Search,
  FolderOpen,
  FolderPlus,
  TerminalSquare,
  ChevronLeft,
  ChevronRight,
  PanelLeftOpen,
  PanelLeftClose,
  PanelRightOpen,
  PanelRightClose,
  Plus,
  Network,
  Settings,
  Minimize2,
  PenLine,
  CheckCircle2,
  Clock,
  Pin,
  X
} from 'lucide-react';
import FileTree from './components/FileTree';
import TerminalPane from './components/TerminalPane';
import GraphView from './components/GraphView';
import SettingsPanel from './components/SettingsPanel';
import HistoryPanel from './components/HistoryPanel';
import AgnoLogo from './components/AgnoLogo';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('markdown', markdownLang);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('go', go);
hljs.registerLanguage('golang', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('protobuf', protobuf);
hljs.registerLanguage('proto', protobuf);

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const CODE_LANG_ALIASES = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  md: 'markdown',
  yml: 'yaml',
  html: 'xml',
  svg: 'xml',
  plist: 'xml',
  proto3: 'protobuf',
  protobuf: 'protobuf'
};

const CODE_LANG_DISPLAY = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  json: 'JSON',
  bash: 'Shell',
  markdown: 'Markdown',
  sql: 'SQL',
  xml: 'XML',
  python: 'Python',
  yaml: 'YAML',
  css: 'CSS',
  go: 'Go',
  java: 'Java',
  protobuf: 'ProtoBuf',
  plaintext: 'Plain Text'
};

function normalizeCodeLanguage(lang) {
  const cleaned = (lang || '').trim().toLowerCase();
  if (!cleaned) return '';
  return CODE_LANG_ALIASES[cleaned] || cleaned;
}

function getDisplayLanguage(lang) {
  if (!lang) return '';
  return CODE_LANG_DISPLAY[lang] || lang.charAt(0).toUpperCase() + lang.slice(1);
}

function isLikelyProtoSnippet(text) {
  const source = text || '';
  if (!source.trim()) return false;

  const hasProtoKeyword =
    /(^|\s)syntax\s*=/.test(source) ||
    /(^|\s)service\s+[A-Za-z_][\w]*/.test(source) ||
    /(^|\s)message\s+[A-Za-z_][\w]*/.test(source) ||
    /(^|\s)rpc\s+[A-Za-z_][\w]*\s*\(/.test(source);

  const hasProtoShape = /[{};]/.test(source);
  return hasProtoKeyword && hasProtoShape;
}

function highlightCode(text, lang) {
  const normalized = normalizeCodeLanguage(lang);
  if (normalized && hljs.getLanguage(normalized)) {
    return {
      language: normalized,
      html: hljs.highlight(text, { language: normalized }).value
    };
  }

  // Keep auto-detection intentionally narrow to avoid mislabeling diagrams.
  if (isLikelyProtoSnippet(text)) {
    return {
      language: 'protobuf',
      html: hljs.highlight(text, { language: 'protobuf' }).value
    };
  }

  return {
    language: 'plaintext',
    html: escapeHtml(text)
  };
}

marked.use({
  breaks: true,
  gfm: true,
  renderer: {
    code({ text, lang }) {
      const { language, html } = highlightCode(text, lang);
      const languageLabel = language === 'plaintext' ? '' : getDisplayLanguage(language);
      const labelMarkup = languageLabel
        ? `<div class="code-block-lang">${escapeHtml(languageLabel)}</div>`
        : '';
      return `<div class="code-block">${labelMarkup}<pre><code class="hljs${language ? ` language-${language}` : ''}">${html}</code></pre></div>\n`;
    }
  }
});

const wikiPattern = /\[\[([^\]]+)\]\]/g;
const CONTENT_WIDTH_MIN = 560;
const CONTENT_WIDTH_MAX = 1400;
const CONTENT_WIDTH_STEP = 10;
const CONTENT_WIDTH_DEFAULT = 760;
const CONTENT_WIDTH_KEY = 'ngobs.contentWidth';

const SETTINGS_DEFAULTS = {
  editorFontSize: 15,
  editorLineHeight: 1.7,
  editorFontFamily: 'systemSans',
  editorSpellcheck: false,
  accentColor: '#0a84ff',
  contentWidth: CONTENT_WIDTH_DEFAULT,
  newNoteTitleFormat: 'timestamp',
  terminalPosition: 'bottom',
  theme: 'dark'
};

const SETTINGS_KEY = 'ngobs.settings';

function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...SETTINGS_DEFAULTS, ...parsed };
    }
  } catch (_) {
    // ignore parse errors
  }
  // Migrate legacy content width if present
  const legacyWidth = Number(window.localStorage.getItem(CONTENT_WIDTH_KEY));
  if (Number.isFinite(legacyWidth) && legacyWidth >= CONTENT_WIDTH_MIN && legacyWidth <= CONTENT_WIDTH_MAX) {
    return { ...SETTINGS_DEFAULTS, contentWidth: legacyWidth };
  }
  return { ...SETTINGS_DEFAULTS };
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta: null, body: text, frontmatterRaw: '' };

  const yamlStr = match[1];
  const body = text.slice(match[0].length);
  const meta = {};
  let currentKey = null;
  let currentList = null;

  for (const line of yamlStr.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('- ') && currentKey) {
      if (!currentList) {
        currentList = [];
        meta[currentKey] = currentList;
      }
      currentList.push(trimmed.slice(2).trim());
      continue;
    }

    const kvMatch = trimmed.match(/^([\w_]+)\s*:\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      currentList = null;
      const value = kvMatch[2].trim();
      if (value) {
        meta[currentKey] = value;
      }
    }
  }

  return { meta: Object.keys(meta).length > 0 ? meta : null, body, frontmatterRaw: match[0] };
}

function FrontmatterPanel({ meta }) {
  if (!meta) return null;
  return (
    <div className="fm-panel">
      <div className="fm-header">Properties</div>
      {Object.entries(meta).map(([key, value]) => (
        <div key={key} className="fm-row">
          <span className="fm-key">{key.replace(/_/g, ' ')}</span>
          <span className="fm-value">
            {Array.isArray(value) ? (
              <span className="fm-tags">
                {value.map((tag) => (
                  <span key={tag} className="fm-tag">{tag}</span>
                ))}
              </span>
            ) : (
              <span className="fm-text">{value}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function collectBacklinks(docs, currentPath) {
  const targetName = currentPath.replace(/\.md$/, '').split('/').pop();
  return docs
    .filter((doc) => doc.path !== currentPath && doc.content.includes(`[[${targetName}]]`))
    .map((doc) => doc.path);
}

function fileTitleFromPath(filePath) {
  return filePath.replace(/\.md$/, '').split('/').pop() || filePath;
}

function rankDocsForShortQuery(docs, rawQuery) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];

  const tokens = query.split(/\s+/).filter(Boolean);
  return docs
    .map((doc) => {
      const title = fileTitleFromPath(doc.path).toLowerCase();
      const pathText = doc.path.toLowerCase();
      const content = (doc.content || '').toLowerCase();
      let score = 1000;

      if (title === query) score -= 900;
      else if (title.startsWith(query)) score -= 700;
      else if (title.includes(query)) score -= 500;

      if (pathText.startsWith(query)) score -= 320;
      else if (pathText.includes(query)) score -= 220;

      if (content.includes(query)) score -= 120;

      tokens.forEach((token) => {
        if (!token) return;
        if (title.includes(token)) score -= 70;
        if (pathText.includes(token)) score -= 35;
        if (content.includes(token)) score -= 12;
      });

      const titleIdx = title.indexOf(query);
      if (titleIdx >= 0) score += titleIdx;
      const pathIdx = pathText.indexOf(query);
      if (pathIdx >= 0) score += pathIdx * 0.3;

      return { doc, score };
    })
    .filter((entry) => {
      const lower = rawQuery.toLowerCase();
      const pathHit = entry.doc.path.toLowerCase().includes(lower);
      const contentHit = entry.doc.content.toLowerCase().includes(lower);
      return pathHit || contentHit;
    })
    .sort((a, b) => a.score - b.score)
    .map((entry) => entry.doc);
}

function splitBodyIntoBlocks(body) {
  const source = body || '';
  if (!source) return [{ text: '', separator: '' }];

  const lines = source.split('\n');
  const blocks = [];
  let blockLines = [];
  let separatorCount = 0;
  let inFence = false;
  let fenceMarker = '';

  const pushBlock = () => {
    blocks.push({
      text: blockLines.join('\n'),
      separator: '\n'.repeat(separatorCount)
    });
    blockLines = [];
    separatorCount = 0;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(```+|~~~+)/);

    if (fenceMatch) {
      const marker = fenceMatch[1].startsWith('`') ? '```' : '~~~';
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
    }

    // Split at heading lines so each heading starts its own block
    if (!inFence && /^#{1,6}\s/.test(trimmed) && blockLines.length > 0) {
      blocks.push({
        text: blockLines.join('\n'),
        separator: '\n'.repeat(separatorCount || 1)
      });
      blockLines = [];
      separatorCount = 0;
    }

    if (!inFence && trimmed === '') {
      if (blockLines.length === 0) {
        separatorCount += 1;
        continue;
      }

      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') {
        separatorCount += 1;
        j += 1;
      }
      separatorCount += 1;
      i = j - 1;
      pushBlock();
      continue;
    }

    blockLines.push(line);
  }

  if (blockLines.length > 0 || blocks.length === 0) {
    blocks.push({
      text: blockLines.join('\n'),
      separator: ''
    });
  }

  return blocks;
}

function joinBlocks(blocks) {
  return blocks.map((block) => `${block.text}${block.separator || ''}`).join('');
}

function clearNoteFindHighlights(container) {
  const highlights = container.querySelectorAll('mark.note-find-hit');
  highlights.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  });
}

function highlightNoteFindMatches(container, query) {
  const needle = (query || '').trim();
  if (!needle) return [];
  const lowerNeedle = needle.toLowerCase();
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const text = node.nodeValue || '';
        if (!text.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest('mark.note-find-hit, pre, code, textarea, input, button, script, style')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const textNodes = [];
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current);
    current = walker.nextNode();
  }

  textNodes.forEach((node) => {
    const text = node.nodeValue || '';
    const lower = text.toLowerCase();
    let idx = lower.indexOf(lowerNeedle);
    if (idx < 0) return;

    const frag = document.createDocumentFragment();
    let last = 0;
    while (idx >= 0) {
      if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
      const mark = document.createElement('mark');
      mark.className = 'note-find-hit';
      mark.textContent = text.slice(idx, idx + needle.length);
      frag.appendChild(mark);
      last = idx + needle.length;
      idx = lower.indexOf(lowerNeedle, last);
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode?.replaceChild(frag, node);
  });

  return Array.from(container.querySelectorAll('mark.note-find-hit'));
}

function applyInlineEditToContent(sourceContent, blockIndex, draftText) {
  if (blockIndex == null) return sourceContent;
  const { body, frontmatterRaw } = parseFrontmatter(sourceContent || '');
  const blocks = splitBodyIntoBlocks(body || '');
  const currentBlock = blocks[blockIndex];
  if (!currentBlock) return sourceContent;
  if (draftText === (currentBlock.text || '')) return sourceContent;

  const nextBlocks = blocks.map((block, index) => (index === blockIndex ? { ...block, text: draftText } : block));
  const nextBody = joinBlocks(nextBlocks);
  return `${frontmatterRaw || ''}${nextBody}`;
}

function useHotkey(key, handler) {
  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === key) {
        event.preventDefault();
        handler();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, handler]);
}

function wikify(markdownText) {
  return markdownText.replace(wikiPattern, (_match, title) => {
    const clean = (title || '').trim();
    return `<a href="#" data-wiki="${clean}">${clean}</a>`;
  });
}

function createPaletteActions() {
  return [
    { id: 'action:new', label: 'New Note', hint: 'Create a new note' },
    { id: 'action:new-folder', label: 'New Folder', hint: 'Create a folder in vault' },
    { id: 'action:save', label: 'Save Current Note', hint: 'Write changes to disk' },
    { id: 'action:shrink-content', label: 'Shrink All Content', hint: 'Set content width to compact' },
    { id: 'action:vault', label: 'Open Vault', hint: 'Switch vault folder' },
    { id: 'action:terminal', label: 'Toggle Terminal', hint: 'Show or hide terminal' },
    { id: 'action:sidebar', label: 'Toggle Sidebar', hint: 'Collapse or expand left panel' },
    { id: 'action:links', label: 'Toggle Links Panel', hint: 'Show or hide backlinks panel' },
    { id: 'action:graph', label: 'Open Graph View', hint: 'Open note graph' },
    { id: 'action:clear-search', label: 'Clear Note Search', hint: 'Show all notes in sidebar' },
    { id: 'action:settings', label: 'Open Settings', hint: 'Open app settings (Cmd+,)' }
  ];
}

function DiffModal({ oldText, newText, fileName, onRevert, onClose }) {
  const changes = useMemo(() => diffLines(oldText || '', newText || ''), [oldText, newText]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  let lineNum = 0;
  return (
    <div className="diff-overlay" onClick={onClose}>
      <div className="diff-modal" onClick={(e) => e.stopPropagation()}>
        <div className="diff-header">
          <span className="diff-filename">{fileName}</span>
          <div className="diff-header-actions">
            <button className="diff-revert-btn" onClick={onRevert}>Revert</button>
            <button className="diff-close-btn" onClick={onClose}><X size={14} /></button>
          </div>
        </div>
        <div className="diff-content">
          {changes.map((part, i) => {
            const lines = part.value.replace(/\n$/, '').split('\n');
            return lines.map((line, j) => {
              if (!part.removed) lineNum += 1;
              const cls = part.added ? 'added' : part.removed ? 'removed' : '';
              return (
                <div key={`${i}-${j}`} className={`diff-line ${cls}`}>
                  <span className="diff-line-number">{part.removed ? '' : lineNum}</span>
                  <span className="diff-line-text">{part.added ? '+ ' : part.removed ? '- ' : '  '}{line}</span>
                </div>
              );
            });
          })}
        </div>
      </div>
    </div>
  );
}

function FolderPromptModal({ value, onChange, onSubmit, onClose }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="folder-prompt-overlay" onClick={onClose}>
      <div className="folder-prompt-modal" onClick={(event) => event.stopPropagation()}>
        <h3>Create Folder</h3>
        <p>Enter a folder path relative to the vault.</p>
        <input
          autoFocus
          value={value}
          placeholder="New Folder"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <div className="folder-prompt-actions">
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={onSubmit}>Create</button>
        </div>
      </div>
    </div>
  );
}

function RenamePromptModal({ value, onChange, onSubmit, onClose }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="folder-prompt-overlay" onClick={onClose}>
      <div className="folder-prompt-modal" onClick={(event) => event.stopPropagation()}>
        <h3>Rename Note</h3>
        <p>Enter a new name for this note.</p>
        <input
          autoFocus
          value={value}
          placeholder="Untitled"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <div className="folder-prompt-actions">
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={onSubmit}>Rename</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [vault, setVault] = useState(null);
  const [recentVaults, setRecentVaults] = useState([]);
  const [tree, setTree] = useState([]);
  const [currentPath, setCurrentPath] = useState('');
  const [content, setContent] = useState('');
  const [allDocs, setAllDocs] = useState([]);
  const [query, setQuery] = useState('');
  const [showPalette, setShowPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const deferredPaletteQuery = useDeferredValue(paletteQuery);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [showGraph, setShowGraph] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [lastSaved, setLastSaved] = useState(null);
  const [showContext, setShowContext] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [treeMenu, setTreeMenu] = useState(null);
  const [openTabs, setOpenTabs] = useState([]);
  const [editingBlock, setEditingBlock] = useState(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [treeCollapseSignal, setTreeCollapseSignal] = useState(0);
  const [settings, setSettings] = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showNoteFind, setShowNoteFind] = useState(false);
  const [noteFindQuery, setNoteFindQuery] = useState('');
  const [noteFindIndex, setNoteFindIndex] = useState(0);
  const [noteFindCount, setNoteFindCount] = useState(0);
  const [showFolderPrompt, setShowFolderPrompt] = useState(false);
  const [folderDraft, setFolderDraft] = useState('New Folder');
  const [showRenamePrompt, setShowRenamePrompt] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameTargetPath, setRenameTargetPath] = useState('');
  const [pinnedTabs, setPinnedTabs] = useState(new Set());
  const [tabMenu, setTabMenu] = useState(null);
  const [splitView, setSplitView] = useState(null);
  const [splitContent, setSplitContent] = useState('');

  const contentWidth = settings.contentWidth;

  const unsubRef = useRef(null);
  const previewRef = useRef(null);
  const noteFindInputRef = useRef(null);
  const noteFindMatchesRef = useRef([]);
  const loadedContentRef = useRef('');
  const treeMenuRef = useRef(null);
  const tabMenuRef = useRef(null);
  const tabbarRef = useRef(null);
  const tabCacheRef = useRef({});
  const splitLoadRef = useRef(0);
  const [tabOverflow, setTabOverflow] = useState({ left: false, right: false });
  const [contentWidthCeiling, setContentWidthCeiling] = useState(CONTENT_WIDTH_MAX);

  const pendingInlineContent = useMemo(
    () => applyInlineEditToContent(content, editingBlock, editingDraft),
    [content, editingBlock, editingDraft]
  );
  const isDirty = pendingInlineContent !== loadedContentRef.current;

  const refreshTree = async () => {
    const newTree = await window.ngobs.vault.tree();
    setTree(newTree);
  };

  const refreshDocs = async () => {
    const docs = await window.ngobs.search.all('');
    setAllDocs(docs);
    return docs;
  };

  const refreshRecentVaults = async () => {
    const recents = await window.ngobs.vault.recent();
    setRecentVaults(recents || []);
  };

  const activatePath = async (path) => {
    if (!path) return;

    if (currentPath) {
      tabCacheRef.current[currentPath] = {
        content,
        loadedContent: loadedContentRef.current
      };
    }

    let cached = tabCacheRef.current[path];
    if (!cached) {
      const text = await window.ngobs.file.read(path);
      cached = { content: text, loadedContent: text };
      tabCacheRef.current[path] = cached;
    }

    loadedContentRef.current = cached.loadedContent;
    setCurrentPath(path);
    setContent(cached.content);
    setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setStatus(`Opened ${path}`);
    setEditingBlock(null);
    setEditingDraft('');
  };

  const loadPath = async (path) => {
    await activatePath(path);
  };

  const openVault = async () => {
    const next = await window.ngobs.vault.pick();
    if (!next) return;
    setVault(next.rootPath);
    setTree(next.tree);
    await refreshRecentVaults();
    const docs = await refreshDocs();
    const first = docs[0]?.path;
    if (first) loadPath(first);
  };

  const openRecentVault = async (vaultPath) => {
    if (!vaultPath) return;
    try {
      const next = await window.ngobs.vault.openRecent(vaultPath);
      if (!next) return;
      setVault(next.rootPath);
      setTree(next.tree);
      await refreshRecentVaults();
      const docs = await refreshDocs();
      const first = docs[0]?.path;
      if (first) loadPath(first);
    } catch (error) {
      setStatus(`Open vault failed: ${error?.message || 'unknown error'}`);
      await refreshRecentVaults();
    }
  };

  useEffect(() => {
    window.ngobs.vault.load().then(async (existing) => {
      await refreshRecentVaults();
      if (!existing) return;
      setVault(existing.rootPath);
      setTree(existing.tree);
      const docs = await refreshDocs();
      const first = docs[0]?.path;
      if (first) loadPath(first);
    });

    unsubRef.current = window.ngobs.vault.onChanged(async () => {
      await refreshTree();
      await refreshDocs();
    });

    return () => {
      if (unsubRef.current) unsubRef.current();
    };
  }, []);

  useEffect(() => {
    const unsubs = [
      window.ngobs.menu.on('menu:new-note', () => createNote()),
      window.ngobs.menu.on('menu:open-vault', () => openVault()),
      window.ngobs.menu.on('menu:save', () => save()),
      window.ngobs.menu.on('menu:settings', () => setShowSettings(true)),
      window.ngobs.menu.on('menu:toggle-sidebar', () => setShowSidebar((v) => !v)),
      window.ngobs.menu.on('menu:toggle-terminal', () => setShowTerminal((v) => !v)),
      window.ngobs.menu.on('menu:toggle-links', () => setShowContext((v) => !v))
    ];
    return () => unsubs.forEach((fn) => fn());
  }, []);

  useEffect(() => {
    const handler = (event) => {
      const target = event.target.closest('a[data-wiki]');
      if (!target) return;
      event.preventDefault();
      const wikiName = target.getAttribute('data-wiki');
      const match = allDocs.find((doc) => doc.path.endsWith(`${wikiName}.md`));
      if (match) loadPath(match.path);
      else setStatus(`Note not found: ${wikiName}`);
    };

    const node = previewRef.current;
    if (!node) return;
    node.addEventListener('click', handler);
    return () => node.removeEventListener('click', handler);
  }, [allDocs]);

  const save = async () => {
    if (!currentPath) return;
    const contentToSave = pendingInlineContent;
    await window.ngobs.file.write(currentPath, contentToSave);
    loadedContentRef.current = contentToSave;
    tabCacheRef.current[currentPath] = { content: contentToSave, loadedContent: contentToSave };
    if (contentToSave !== content) {
      setContent(contentToSave);
    }
    setEditingBlock(null);
    setEditingDraft('');
    setLastSaved(new Date());
    setStatus(`Saved ${currentPath}`);
    await refreshDocs();
    // Save version history in background — never block the save flow
    window.ngobs.history.save(currentPath, contentToSave).catch(() => {});
  };

  useHotkey('s', save);
  useHotkey('f', () => {
    setShowNoteFind(true);
  });
  useHotkey('k', () => setShowPalette((s) => !s));
  useHotkey('p', () => setShowPalette((s) => !s));
  useHotkey('o', openVault);
  useHotkey(',', () => setShowSettings((v) => !v));

  const handleSettingsChange = (key, value) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  };

  // Apply accent color to CSS custom properties
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--accent', settings.accentColor);
    // Compute a lighter hover shade
    const hex = settings.accentColor.replace('#', '');
    const r = Math.min(255, parseInt(hex.substring(0, 2), 16) + 40);
    const g = Math.min(255, parseInt(hex.substring(2, 4), 16) + 30);
    const b = Math.min(255, parseInt(hex.substring(4, 6), 16) + 20);
    root.style.setProperty('--accent-hover', `rgb(${r}, ${g}, ${b})`);
    root.style.setProperty('--accent-bg', `${settings.accentColor}2e`);
    root.style.setProperty('--selection', `${settings.accentColor}59`);
  }, [settings.accentColor]);

  // Apply theme
  useEffect(() => {
    if (settings.theme === 'dark') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = settings.theme;
    }
  }, [settings.theme]);

  // Apply prose typography
  useEffect(() => {
    const root = document.documentElement;
    const fontFamilies = {
      systemSans: '-apple-system, "SF Pro Text", BlinkMacSystemFont, "Helvetica Neue", sans-serif',
      systemRounded: '"SF Pro Rounded", "Arial Rounded MT Bold", "Hiragino Sans", "Segoe UI", sans-serif',
      inter: '"Inter", "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif',
      sourceSans: '"Source Sans 3", "Source Sans Pro", "Segoe UI", "Helvetica Neue", sans-serif',
      notoSans: '"Noto Sans", "Segoe UI", "Helvetica Neue", sans-serif',
      georgia: 'Georgia, "Times New Roman", Times, serif',
      serif: '"Iowan Old Style", "Palatino Linotype", Palatino, "Times New Roman", serif',
      charter: '"Charter", "Bitstream Charter", "Cambria", "Times New Roman", serif',
      sourceSerif: '"Source Serif 4", "Source Serif Pro", "Times New Roman", serif',
      atkinson: '"Atkinson Hyperlegible", "Verdana", "Segoe UI", sans-serif',
      humanist: '"Avenir Next", "Segoe UI", "Trebuchet MS", sans-serif',
      jetbrainsMono: '"JetBrains Mono", "SF Mono", SFMono-Regular, ui-monospace, Menlo, monospace',
      mono: '"SF Mono", SFMono-Regular, ui-monospace, Menlo, monospace'
    };
    root.style.setProperty('--editor-font-family', fontFamilies[settings.editorFontFamily] || fontFamilies.systemSans);
    root.style.setProperty('--prose-font-size', `${settings.editorFontSize}px`);
    root.style.setProperty('--prose-line-height', String(settings.editorLineHeight));
  }, [settings.editorFontSize, settings.editorLineHeight, settings.editorFontFamily]);

  useEffect(() => {
    if (!showPalette) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowPalette(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPalette]);

  useEffect(() => {
    setPaletteIndex(0);
  }, [deferredPaletteQuery, showPalette]);

  useEffect(() => {
    const previewEl = previewRef.current;
    if (!previewEl) {
      setContentWidthCeiling(CONTENT_WIDTH_MAX);
      return undefined;
    }

    const updateCeiling = () => {
      const styles = window.getComputedStyle(previewEl);
      const padLeft = Number.parseFloat(styles.paddingLeft) || 0;
      const padRight = Number.parseFloat(styles.paddingRight) || 0;
      const innerWidth = Math.max(0, previewEl.clientWidth - padLeft - padRight);
      const clamped = Math.min(CONTENT_WIDTH_MAX, Math.max(CONTENT_WIDTH_MIN, innerWidth));
      const snapped =
        CONTENT_WIDTH_MIN +
        Math.floor((clamped - CONTENT_WIDTH_MIN) / CONTENT_WIDTH_STEP) * CONTENT_WIDTH_STEP;
      setContentWidthCeiling(Math.max(CONTENT_WIDTH_MIN, snapped));
    };

    updateCeiling();

    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(updateCeiling);
      ro.observe(previewEl);
    } else {
      window.addEventListener('resize', updateCeiling);
    }

    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', updateCeiling);
    };
  }, [currentPath, showContext, showSidebar, showTerminal]);

  useEffect(() => {
    if (!showNoteFind) return;
    noteFindInputRef.current?.focus();
    noteFindInputRef.current?.select();
  }, [showNoteFind]);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setShowNoteFind(true);
        return;
      }
      if (!showNoteFind) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowNoteFind(false);
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (event.shiftKey) {
          setNoteFindIndex((idx) => (noteFindCount ? (idx - 1 + noteFindCount) % noteFindCount : 0));
        } else {
          setNoteFindIndex((idx) => (noteFindCount ? (idx + 1) % noteFindCount : 0));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showNoteFind, noteFindCount]);

  useEffect(() => {
    const container = previewRef.current?.querySelector('.prose-wrapper');
    if (!container) return;

    clearNoteFindHighlights(container);
    noteFindMatchesRef.current = [];

    if (!showNoteFind || !noteFindQuery.trim()) {
      setNoteFindCount(0);
      setNoteFindIndex(0);
      return;
    }

    const matches = highlightNoteFindMatches(container, noteFindQuery.trim());
    noteFindMatchesRef.current = matches;
    setNoteFindCount(matches.length);
    setNoteFindIndex((idx) => (matches.length ? Math.min(idx, matches.length - 1) : 0));
  }, [showNoteFind, noteFindQuery, content, editingBlock]);

  useEffect(() => {
    const matches = noteFindMatchesRef.current;
    matches.forEach((el) => el.classList.remove('active'));
    if (!showNoteFind || !matches.length) return;
    const active = matches[noteFindIndex] || matches[0];
    if (!active) return;
    active.classList.add('active');
    active.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [showNoteFind, noteFindIndex, noteFindCount]);

  const { meta: frontmatter, body: markdownBody } = useMemo(() => {
    return parseFrontmatter(content || '');
  }, [content]);
  const bodyBlocks = useMemo(() => splitBodyIntoBlocks(markdownBody), [markdownBody]);
  const firstBlockIsHeading = useMemo(() => {
    const first = bodyBlocks[0];
    return first && /^\s*#\s/.test(first.text);
  }, [bodyBlocks]);
  const wordCount = useMemo(() => {
    const words = (markdownBody || '').trim().match(/\S+/g);
    return words ? words.length : 0;
  }, [markdownBody]);
  const charCount = useMemo(() => (markdownBody || '').length, [markdownBody]);
  const effectiveContentWidth = Math.min(contentWidth, contentWidthCeiling);
  const widthPercent = useMemo(() => {
    const range = contentWidthCeiling - CONTENT_WIDTH_MIN;
    if (range <= 0) return 100;
    return Math.round(((effectiveContentWidth - CONTENT_WIDTH_MIN) / range) * 100);
  }, [effectiveContentWidth, contentWidthCeiling]);

  const sortedTabs = useMemo(() => {
    const pinned = openTabs.filter((p) => pinnedTabs.has(p));
    const unpinned = openTabs.filter((p) => !pinnedTabs.has(p));
    return [...pinned, ...unpinned];
  }, [openTabs, pinnedTabs]);

  const backlinks = useMemo(() => {
    if (!currentPath || !allDocs.length) return [];
    return collectBacklinks(allDocs, currentPath);
  }, [allDocs, currentPath]);

  const extractedLinks = useMemo(() => {
    return [...new Set([...content.matchAll(wikiPattern)].map((m) => m[1]?.trim()).filter(Boolean))];
  }, [content]);

  const resolveWikiPath = (wikiName) => allDocs.find((doc) => doc.path.endsWith(`${wikiName}.md`))?.path;

  const docsForSearch = useMemo(
    () =>
      allDocs.map((doc) => ({
        ...doc,
        title: fileTitleFromPath(doc.path)
      })),
    [allDocs]
  );

  const fuse = useMemo(
    () =>
      new Fuse(docsForSearch, {
        keys: [
          { name: 'title', weight: 0.6 },
          { name: 'path', weight: 0.3 },
          { name: 'content', weight: 0.1 }
        ],
        includeScore: true,
        threshold: 0.35,
        ignoreLocation: true,
        minMatchCharLength: 2
      }),
    [docsForSearch]
  );

  const rankedSearchDocs = useMemo(() => {
    const searchTerm = query.trim();
    if (!searchTerm) return [];

    if (searchTerm.length < 2) {
      return rankDocsForShortQuery(allDocs, searchTerm);
    }

    return fuse.search(searchTerm).map((result) => result.item);
  }, [allDocs, query, fuse]);

  const filteredTree = useMemo(() => {
    if (!query.trim()) return tree;

    return rankedSearchDocs.map((doc) => ({
      type: 'file',
      name: fileTitleFromPath(doc.path),
      path: doc.path,
      searchHint: doc.path
    }));
  }, [tree, query, rankedSearchDocs]);

  const createNote = async () => {
    let baseName;
    switch (settings.newNoteTitleFormat) {
      case 'untitled':
        baseName = 'Untitled';
        break;
      case 'date':
        baseName = new Date().toISOString().split('T')[0];
        break;
      default:
        baseName = `New Note ${Date.now()}`;
    }
    const title = `${baseName}.md`;
    await window.ngobs.file.create(title, `# ${baseName}\n`);
    await refreshTree();
    await refreshDocs();
    await loadPath(title);
  };

  const createFolder = () => {
    setFolderDraft('New Folder');
    setShowFolderPrompt(true);
  };

  const confirmCreateFolder = async () => {
    try {
      const createFolderFn = window.ngobs.file.createFolder;
      if (!createFolderFn) {
        throw new Error('Create Folder API unavailable. Restart the app to load updated preload APIs.');
      }

      const relPath = (folderDraft.trim() || 'New Folder').replace(/^\/+|\/+$/g, '');
      if (!relPath) return;

      await createFolderFn(relPath);
      await refreshTree();
      setStatus(`Created folder ${relPath}`);
      setShowFolderPrompt(false);
      setFolderDraft('New Folder');
    } catch (error) {
      const message = `Create folder failed: ${error?.message || 'unknown error'}`;
      setStatus(message);
      window.alert(message);
    }
  };

  const collapseAllTree = () => {
    setTreeCollapseSignal((v) => v + 1);
    setStatus('Collapsed all folders');
  };

  const closeTab = async (path) => {
    if (pinnedTabs.has(path)) return;
    const index = openTabs.indexOf(path);
    if (index < 0) return;

    const remainingTabs = openTabs.filter((tabPath) => tabPath !== path);
    setOpenTabs(remainingTabs);
    delete tabCacheRef.current[path];

    if (currentPath !== path) return;

    if (remainingTabs.length > 0) {
      const nextPath = remainingTabs[Math.max(0, index - 1)] || remainingTabs[0];
      await activatePath(nextPath);
      return;
    }

    loadedContentRef.current = '';
    setCurrentPath('');
    setContent('');
    setStatus('Ready');
  };

  const pinTab = (path) => {
    setPinnedTabs((prev) => {
      const next = new Set(prev);
      next.add(path);
      return next;
    });
  };

  const unpinTab = (path) => {
    setPinnedTabs((prev) => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  };

  const closeTabsToRight = async (path) => {
    const idx = sortedTabs.indexOf(path);
    if (idx < 0) return;
    const toClose = sortedTabs.slice(idx + 1).filter((p) => !pinnedTabs.has(p));
    const remaining = openTabs.filter((p) => !toClose.includes(p));
    setOpenTabs(remaining);
    toClose.forEach((p) => delete tabCacheRef.current[p]);
    if (toClose.includes(currentPath)) {
      await activatePath(path);
    }
  };

  const closeOtherTabs = async (path) => {
    const toClose = openTabs.filter((p) => p !== path && !pinnedTabs.has(p));
    const remaining = openTabs.filter((p) => !toClose.includes(p));
    setOpenTabs(remaining);
    toClose.forEach((p) => delete tabCacheRef.current[p]);
    if (toClose.includes(currentPath)) {
      await activatePath(path);
    }
  };

  const beginBlockEdit = (index) => {
    const block = bodyBlocks[index];
    if (!block) return;
    setEditingBlock(index);
    setEditingDraft(block.text || '');
  };

  const commitBlockEdit = () => {
    if (editingBlock == null) return;
    const nextContent = applyInlineEditToContent(content, editingBlock, editingDraft);
    if (nextContent !== content) {
      setContent(nextContent);
    }
    setEditingBlock(null);
    setEditingDraft('');
  };

  const deleteNote = async (path) => {
    if (!path) return;

    try {
      const removeFn = window.ngobs.file.remove || window.ngobs.file.delete;
      if (!removeFn) throw new Error('Delete API unavailable. Restart the app to load updated preload APIs.');

      await removeFn(path);
      setOpenTabs((prev) => prev.filter((tabPath) => tabPath !== path));
      delete tabCacheRef.current[path];
      await refreshTree();
      const docs = await refreshDocs();
      const stillExists = docs.some((doc) => doc.path === path);
      if (stillExists) throw new Error('File still exists after delete');

      if (currentPath === path) {
        const nextPath = openTabs.find((tabPath) => tabPath !== path) || docs.find((doc) => doc.path !== path)?.path;
        if (nextPath) {
          await activatePath(nextPath);
        } else {
          loadedContentRef.current = '';
          setCurrentPath('');
          setContent('');
        }
      }

      setStatus(`Deleted ${path}`);
    } catch (error) {
      const message = `Delete failed: ${error?.message || 'unknown error'}`;
      setStatus(message);
      window.alert(message);
    }
  };

  const deleteFolder = async (folderPath) => {
    if (!folderPath) return;

    try {
      const removeFolderFn = window.ngobs.file.removeFolder || window.ngobs.file.remove;
      if (!removeFolderFn) throw new Error('Delete Folder API unavailable. Restart the app to load updated preload APIs.');

      await removeFolderFn(folderPath);

      const prefix = `${folderPath}/`;
      const pathsToClose = openTabs.filter((tabPath) => tabPath === folderPath || tabPath.startsWith(prefix));
      if (pathsToClose.length) {
        setOpenTabs((prev) => prev.filter((tabPath) => !pathsToClose.includes(tabPath)));
        pathsToClose.forEach((tabPath) => {
          delete tabCacheRef.current[tabPath];
        });
      }

      await refreshTree();
      const docs = await refreshDocs();
      const currentDeleted = currentPath === folderPath || currentPath.startsWith(prefix);
      if (currentDeleted) {
        const nextPath = docs[0]?.path;
        if (nextPath) {
          await activatePath(nextPath);
        } else {
          loadedContentRef.current = '';
          setCurrentPath('');
          setContent('');
        }
      }

      setStatus(`Deleted folder ${folderPath}`);
    } catch (error) {
      const message = `Delete folder failed: ${error?.message || 'unknown error'}`;
      setStatus(message);
      window.alert(message);
    }
  };

  const startRenameNote = (path) => {
    if (!path) return;
    const segments = path.split('/');
    const originalFile = segments[segments.length - 1] || '';
    const ext = originalFile.endsWith('.md') ? '.md' : '';
    const baseName = ext ? originalFile.slice(0, -ext.length) : originalFile;
    setRenameTargetPath(path);
    setRenameDraft(baseName);
    setShowRenamePrompt(true);
  };

  const confirmRenameNote = async () => {
    const path = renameTargetPath;
    if (!path) return;

    const segments = path.split('/');
    const dir = segments.slice(0, -1).join('/');

    let nextName = renameDraft.trim();
    if (!nextName) return;
    if (!nextName.endsWith('.md')) nextName += '.md';

    const nextPath = dir ? `${dir}/${nextName}` : nextName;
    if (nextPath === path) return;

    await window.ngobs.file.rename(path, nextPath);
    setOpenTabs((prev) => prev.map((tabPath) => (tabPath === path ? nextPath : tabPath)));
    if (tabCacheRef.current[path]) {
      tabCacheRef.current[nextPath] = tabCacheRef.current[path];
      delete tabCacheRef.current[path];
    }
    await refreshTree();
    await refreshDocs();

    if (currentPath === path) {
      await activatePath(nextPath);
    }

    setStatus(`Renamed to ${nextName}`);
    setShowRenamePrompt(false);
    setRenameDraft('');
    setRenameTargetPath('');
  };

  const duplicateNote = async (path) => {
    if (!path) return;
    const duplicatedPath = await window.ngobs.file.duplicate(path);
    await refreshTree();
    await refreshDocs();
    if (duplicatedPath) {
      await loadPath(duplicatedPath);
      setStatus(`Duplicated ${path}`);
    }
  };

  const revealInFinder = async (path) => {
    if (!path) return;
    await window.ngobs.file.reveal(path);
  };

  const openSplitFromTab = useCallback((path, side) => {
    if (!path) return;
    setSplitView({ path, side: side === 'left' ? 'left' : 'right' });
  }, []);

  const closeSplitView = useCallback(() => {
    setSplitView(null);
    setSplitContent('');
  }, []);

  useEffect(() => {
    if (!splitView?.path) return;
    if (!allDocs.some((doc) => doc.path === splitView.path)) {
      closeSplitView();
    }
  }, [allDocs, splitView, closeSplitView]);

  useEffect(() => {
    if (!splitView?.path) return;
    if (splitView.path === currentPath) {
      setSplitContent(pendingInlineContent);
      return;
    }

    const reqId = splitLoadRef.current + 1;
    splitLoadRef.current = reqId;

    const cached = tabCacheRef.current[splitView.path];
    if (cached?.content != null) {
      setSplitContent(cached.content);
    }

    window.ngobs.file.read(splitView.path).then((text) => {
      if (splitLoadRef.current !== reqId) return;
      setSplitContent(text);
      tabCacheRef.current[splitView.path] = {
        content: text,
        loadedContent: text
      };
    }).catch(() => {
      if (splitLoadRef.current !== reqId) return;
      setSplitContent('# Unable to load split note');
    });
  }, [splitView, currentPath, pendingInlineContent]);

  const splitMetaAndBody = useMemo(() => parseFrontmatter(splitContent || ''), [splitContent]);
  const splitRenderedHtml = useMemo(() => {
    const body = splitMetaAndBody.body || '';
    if (!body.trim()) return '';
    return DOMPurify.sanitize(marked.parse(wikify(body)), { ADD_ATTR: ['data-wiki'] });
  }, [splitMetaAndBody.body]);

  const handleSplitPreviewClick = useCallback((event) => {
    const target = event.target.closest('a[data-wiki]');
    if (!target) return;
    event.preventDefault();
    const wikiName = target.getAttribute('data-wiki');
    const match = allDocs.find((doc) => doc.path.endsWith(`${wikiName}.md`));
    if (match) loadPath(match.path);
    else setStatus(`Note not found: ${wikiName}`);
  }, [allDocs, loadPath]);

  const paletteResults = useMemo(() => {
    if (!showPalette) return [];
    const q = deferredPaletteQuery.trim().toLowerCase();
    const actions = createPaletteActions();

    const actionItems = actions
      .filter((item) => !q || item.label.toLowerCase().includes(q) || item.hint.toLowerCase().includes(q))
      .map((item) => ({ ...item, kind: 'action' }));

    const docs = (q ? fuse.search(deferredPaletteQuery).map((r) => r.item) : allDocs).slice(0, 30);
    const docItems = docs.map((doc) => ({
      id: `doc:${doc.path}`,
      kind: 'doc',
      label: doc.path.replace(/\.md$/, '').split('/').pop(),
      hint: doc.path,
      path: doc.path
    }));

    return [...actionItems, ...docItems].slice(0, 40);
  }, [deferredPaletteQuery, fuse, allDocs, showPalette]);

  const runPaletteAction = async (id) => {
    switch (id) {
      case 'action:new':
        await createNote();
        break;
      case 'action:new-folder':
        await createFolder();
        break;
      case 'action:save':
        await save();
        break;
      case 'action:shrink-content':
        collapseAllTree();
        break;
      case 'action:vault':
        await openVault();
        break;
      case 'action:terminal':
        setShowTerminal((v) => !v);
        break;
      case 'action:sidebar':
        setShowSidebar((v) => !v);
        break;
      case 'action:links':
        setShowContext((v) => !v);
        break;
      case 'action:graph':
        setShowGraph(true);
        break;
      case 'action:clear-search':
        setQuery('');
        break;
      case 'action:settings':
        setShowSettings(true);
        break;
      default:
        break;
    }
  };

  const runPaletteItem = async (item) => {
    if (!item) return;
    if (item.kind === 'action') {
      await runPaletteAction(item.id);
    } else if (item.path) {
      await loadPath(item.path);
    }
    setShowPalette(false);
    setPaletteQuery('');
  };

  const onTreeContextMenu = (event, node) => {
    setTreeMenu({
      x: event.clientX,
      y: event.clientY,
      node,
      adjusted: false
    });
  };

  useEffect(() => {
    if (!treeMenu) return undefined;
    const dismiss = () => setTreeMenu(null);
    const onPointerDown = (event) => {
      if (treeMenuRef.current && treeMenuRef.current.contains(event.target)) return;
      dismiss();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', dismiss);
    };
  }, [treeMenu]);

  useEffect(() => {
    if (!treeMenu || treeMenu.adjusted) return undefined;

    const raf = window.requestAnimationFrame(() => {
      const menuEl = treeMenuRef.current;
      if (!menuEl) return;

      const margin = 8;
      const menuWidth = menuEl.offsetWidth;
      const menuHeight = menuEl.offsetHeight;
      const x = Math.min(Math.max(treeMenu.x, margin), window.innerWidth - menuWidth - margin);
      const y = Math.min(Math.max(treeMenu.y, margin), window.innerHeight - menuHeight - margin);

      setTreeMenu((prev) => (prev ? { ...prev, x, y, adjusted: true } : prev));
    });

    return () => window.cancelAnimationFrame(raf);
  }, [treeMenu]);

  // Tab context menu dismiss effects
  useEffect(() => {
    if (!tabMenu) return undefined;
    const dismiss = () => setTabMenu(null);
    const onPointerDown = (event) => {
      if (tabMenuRef.current && tabMenuRef.current.contains(event.target)) return;
      dismiss();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', dismiss);
    };
  }, [tabMenu]);

  useEffect(() => {
    if (!tabMenu || tabMenu.adjusted) return undefined;

    const raf = window.requestAnimationFrame(() => {
      const menuEl = tabMenuRef.current;
      if (!menuEl) return;

      const margin = 8;
      const menuWidth = menuEl.offsetWidth;
      const menuHeight = menuEl.offsetHeight;
      const x = Math.min(Math.max(tabMenu.x, margin), window.innerWidth - menuWidth - margin);
      const y = Math.min(Math.max(tabMenu.y, margin), window.innerHeight - menuHeight - margin);

      setTabMenu((prev) => (prev ? { ...prev, x, y, adjusted: true } : prev));
    });

    return () => window.cancelAnimationFrame(raf);
  }, [tabMenu]);

  const updateTabOverflow = () => {
    const el = tabbarRef.current;
    if (!el) return;
    const hasLeft = el.scrollLeft > 2;
    const hasRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setTabOverflow({ left: hasLeft, right: hasRight });
  };

  useEffect(() => {
    updateTabOverflow();
    const onResize = () => updateTabOverflow();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [openTabs.length, showSidebar]);

  useEffect(() => {
    const el = tabbarRef.current;
    if (!el) return;
    const active = el.querySelector('.top-tab.active');
    if (active) {
      active.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
      requestAnimationFrame(updateTabOverflow);
    }
  }, [currentPath, openTabs]);

  const scrollTabs = (delta) => {
    const el = tabbarRef.current;
    if (!el) return;
    el.scrollBy({ left: delta, behavior: 'smooth' });
    requestAnimationFrame(updateTabOverflow);
  };

  if (!vault) {
    return (
      <div className="vault-picker">
        <div className="vault-card">
          <h1><AgnoLogo size={26} className="vault-logo" />Agno</h1>
          <p>Open a vault to start writing and linking notes.</p>
          <button onClick={openVault}>Open Vault</button>
          {recentVaults.length > 0 && (
            <div className="recent-vaults">
              <div className="recent-vaults-title">Recent Vaults</div>
              {recentVaults.map((vaultPath) => (
                <button key={vaultPath} className="recent-vault-btn" onClick={() => openRecentVault(vaultPath)} title={vaultPath}>
                  <span className="recent-vault-name">{vaultPath.split('/').pop() || vaultPath}</span>
                  <span className="recent-vault-path">{vaultPath}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const terminalOnRight = settings.terminalPosition === 'right';
  const terminalOnBottom = settings.terminalPosition !== 'right';
  const splitPaneNode = splitView ? (
    <section className="single-pane split-pane">
      <article className="preview-pane split-preview-pane" onClick={handleSplitPreviewClick}>
        <div className="prose-wrapper split-prose-wrapper">
          <div className="split-pane-head">
            <span className="split-pane-title">{splitView.path.split('/').pop().replace(/\.md$/, '')}</span>
            <div className="split-pane-actions">
              <button
                className="split-pane-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  loadPath(splitView.path);
                }}
              >
                Open
              </button>
              <button
                className="split-pane-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  closeSplitView();
                }}
              >
                Close
              </button>
            </div>
          </div>
          <FrontmatterPanel meta={splitMetaAndBody.meta} />
          <div
            className="prose"
            dangerouslySetInnerHTML={{ __html: splitRenderedHtml || '<p></p>' }}
          />
        </div>
      </article>
    </section>
  ) : null;

  return (
    <div className={`app-shell ${showSidebar ? '' : 'sidebar-hidden'}`}>
      <aside className="left-panel">
        <div className="window-chrome">
          <div className="window-shortcuts">
            <button className="quick-icon-btn" onClick={createNote} title="New note">
              <Plus size={14} />
            </button>
            <button className="quick-icon-btn" onClick={() => setShowTerminal((v) => !v)} title="Terminal">
              <TerminalSquare size={14} />
            </button>
            <button className="quick-icon-btn" onClick={() => setShowGraph(true)} title="Graph view">
              <Network size={14} />
            </button>
            <button className="quick-icon-btn" onClick={() => setShowSettings(true)} title="Settings">
              <Settings size={14} />
            </button>
            <button className="quick-icon-btn" onClick={() => setShowSidebar(false)} title="Collapse sidebar">
              <PanelLeftClose size={14} />
            </button>
          </div>
        </div>

        <div className="side-section-head">
          <span className="sidebar-brand"><AgnoLogo size={14} className="sidebar-logo" />Agno</span>
          <div className="head-actions">
            <button onClick={createNote} title="Create note"><Plus size={12} /></button>
            <button onClick={createFolder} title="Create folder"><FolderPlus size={12} /></button>
            <button onClick={collapseAllTree} title="Collapse all folders"><Minimize2 size={12} /></button>
            <button onClick={openVault} title="Open vault"><FolderOpen size={12} /></button>
          </div>
        </div>

        <div className="search-box">
          <Search size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
          />
          {!!query && (
            <button className="search-clear" title="Clear search" onClick={() => setQuery('')}>
              <X size={12} />
            </button>
          )}
        </div>

        <div className="thread-list">
          <FileTree
            tree={filteredTree}
            onOpen={loadPath}
            onContextMenu={onTreeContextMenu}
            activePath={currentPath}
            collapseSignal={treeCollapseSignal}
            forceExpand={Boolean(query.trim())}
          />
          {!!query.trim() && filteredTree.length === 0 && <div className="tree-empty">No matching notes</div>}
        </div>

        <div className="sidebar-footer">
          <button className="sidebar-footer-btn" onClick={() => setShowSettings(true)} title="Settings">
            <Settings size={14} />
            <span>Settings</span>
          </button>
        </div>
      </aside>

      <main className={`workspace ${(showTerminal && terminalOnBottom) ? 'terminal-open' : 'terminal-closed'}`}>
        <div className="topbar">
          {!showSidebar && (
            <button className="sidebar-restore-btn" onClick={() => setShowSidebar(true)} title="Show sidebar (⌘\\)">
              <PanelLeftOpen size={14} />
            </button>
          )}
          <div className="topbar-main">
            <div className="tabbar-host">
              <div className="tabbar-shell">
                <button
                  className={`tab-scroll-btn ${tabOverflow.left ? '' : 'hidden'}`}
                  title="Scroll tabs left"
                  onClick={() => scrollTabs(-180)}
                >
                  <ChevronLeft size={12} />
                </button>
                <div className="tabbar" ref={tabbarRef} onScroll={updateTabOverflow}>
                  {sortedTabs.map((path) => {
                    const isPinned = pinnedTabs.has(path);
                    return (
                      <button
                        key={path}
                        className={`top-tab ${path === currentPath ? 'active' : ''} ${isPinned ? 'pinned' : ''}`}
                        onClick={() => activatePath(path)}
                        title={path}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setTabMenu({ x: e.clientX, y: e.clientY, path, adjusted: false });
                        }}
                      >
                        {isPinned && <Pin size={10} className="pin-icon" />}
                        <span>{path.split('/').pop().replace(/\.md$/, '')}</span>
                        {!isPinned && (
                          <span
                            className="top-tab-close"
                            onClick={(event) => {
                              event.stopPropagation();
                              closeTab(path);
                            }}
                          >
                            <X size={11} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <button
                  className={`tab-scroll-btn ${tabOverflow.right ? '' : 'hidden'}`}
                  title="Scroll tabs right"
                  onClick={() => scrollTabs(180)}
                >
                  <ChevronRight size={12} />
                </button>
              </div>
            </div>

            {showNoteFind && (
              <div className="note-find-bar">
                <input
                  ref={noteFindInputRef}
                  value={noteFindQuery}
                  placeholder="Find in note"
                  onChange={(event) => {
                    setNoteFindQuery(event.target.value);
                    setNoteFindIndex(0);
                  }}
                />
                <span className="note-find-count">{noteFindCount ? `${noteFindIndex + 1}/${noteFindCount}` : '0/0'}</span>
                <button
                  className="note-find-nav"
                  title="Previous match (Shift+Enter)"
                  onClick={() => setNoteFindIndex((idx) => (noteFindCount ? (idx - 1 + noteFindCount) % noteFindCount : 0))}
                >
                  Prev
                </button>
                <button
                  className="note-find-nav"
                  title="Next match (Enter)"
                  onClick={() => setNoteFindIndex((idx) => (noteFindCount ? (idx + 1) % noteFindCount : 0))}
                >
                  Next
                </button>
                <button
                  className="note-find-close"
                  title="Close find"
                  onClick={() => setShowNoteFind(false)}
                >
                  <X size={12} />
                </button>
              </div>
            )}

            <div className="toolbar-actions">
              <button className="icon-btn" onClick={() => currentPath && setShowHistory(true)} title="Version history">
                <Clock size={14} />
              </button>
              <button className="icon-btn" onClick={() => setShowContext((v) => !v)} title="Toggle links panel">
                {showContext ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
              </button>
              <button className={`icon-btn ${showTerminal ? 'active' : ''}`} onClick={() => setShowTerminal((v) => !v)} title="Toggle terminal">
                <TerminalSquare size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className={`content-grid ${showContext ? '' : 'context-hidden'} ${(terminalOnRight && showTerminal) ? 'terminal-right' : ''}`}>
          <div className={`editor-split ${splitView ? `split-open split-${splitView.side}` : ''}`}>
            {splitView?.side === 'left' && splitPaneNode}

            <section className="single-pane main-pane">
            {currentPath ? (
              <article className="preview-pane" ref={previewRef}>
                <div className="prose-wrapper" style={{ maxWidth: `${effectiveContentWidth}px` }}>
                  {(() => {
                    const renderBlock = (block, index) => {
                      if (editingBlock === index) {
                        return (
                          <textarea
                            key={`edit-${index}`}
                            className="inline-block-editor"
                            value={editingDraft}
                            spellCheck={settings.editorSpellcheck}
                            autoFocus
                            ref={(el) => {
                              if (el) {
                                el.style.height = 'auto';
                                el.style.height = `${el.scrollHeight}px`;
                              }
                            }}
                            onChange={(e) => {
                              setEditingDraft(e.target.value);
                              e.target.style.height = 'auto';
                              e.target.style.height = `${e.target.scrollHeight}px`;
                            }}
                            onBlur={commitBlockEdit}
                            onKeyDown={(e) => {
                              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                e.preventDefault();
                                commitBlockEdit();
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                commitBlockEdit();
                              }
                            }}
                          />
                        );
                      }

                      const html = block.text.trim()
                        ? DOMPurify.sanitize(marked.parse(wikify(block.text)), { ADD_ATTR: ['data-wiki'] })
                        : '<div class="block-empty-spacer"></div>';

                      return (
                        <div
                          key={`block-${index}`}
                          className={`live-block ${block.text.trim() ? '' : 'empty'}`}
                          onClick={(event) => {
                            if (event.target.closest('a[data-wiki]')) return;
                            beginBlockEdit(index);
                          }}
                          dangerouslySetInnerHTML={{ __html: html }}
                        />
                      );
                    };

                    const startIndex = firstBlockIsHeading ? 1 : 0;

                    return (
                      <>
                        {firstBlockIsHeading && (
                          <div className="prose live-blocks">
                            {renderBlock(bodyBlocks[0], 0)}
                          </div>
                        )}
                        <FrontmatterPanel meta={frontmatter} />
                        <div className="prose live-blocks">
                          {bodyBlocks.slice(startIndex).map((block, i) => renderBlock(block, startIndex + i))}
                        </div>
                      </>
                    );
                  })()}
                  <div className="inline-hint">Click a block to edit. Press Cmd/Ctrl+Enter or Esc to apply.</div>
                </div>
              </article>
            ) : (
              <div className="empty-state">
                <h2>Agno</h2>
                <div className="empty-state-tips">
                  <div className="empty-state-tip"><kbd>&#8984; N</kbd><span>New note</span></div>
                  <div className="empty-state-tip"><kbd>&#8984; O</kbd><span>Open vault</span></div>
                  <div className="empty-state-tip"><kbd>&#8984; K</kbd><span>Command palette</span></div>
                  <div className="empty-state-tip"><kbd>&#8984; ,</kbd><span>Settings</span></div>
                  <div className="empty-state-tip"><kbd>&#8984; \</kbd><span>Toggle sidebar</span></div>
                  <div className="empty-state-tip"><kbd>&#8984; `</kbd><span>Toggle terminal</span></div>
                </div>
              </div>
            )}
            </section>

            {splitView?.side !== 'left' && splitPaneNode}
          </div>

          {showContext && (
            <aside className="context-pane">
              <section className="context-section">
                <h4>Backlinks</h4>
                {backlinks.length ? (
                  <div className="context-list">
                    {backlinks.map((link) => (
                      <button key={link} onClick={() => loadPath(link)}>
                        <span className="context-link-title">{link.replace(/\.md$/, '').split('/').pop()}</span>
                        <span className="context-link-path">{link}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="context-empty">No backlinks</p>
                )}
              </section>

              <section className="context-section">
                <h4>Outgoing Links</h4>
                {extractedLinks.length ? (
                  <div className="context-tags">
                    {extractedLinks.map((link) => {
                      const targetPath = resolveWikiPath(link);
                      const displayName = link.split('/').pop() || link;
                      return (
                        <button
                          key={link}
                          className={targetPath ? '' : 'disabled'}
                          onClick={() => targetPath && loadPath(targetPath)}
                          title={targetPath || 'No matching note'}
                        >
                          {displayName}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="context-empty">No wikilinks</p>
                )}
              </section>
            </aside>
          )}

          {terminalOnRight && (
            <aside className={`terminal-side ${showTerminal ? '' : 'hidden'}`}>
              <TerminalPane visible={showTerminal} />
            </aside>
          )}
        </div>

        {terminalOnBottom && <TerminalPane visible={showTerminal} />}

        <div className="composer-bar">
          <div className="composer-left composer-metrics">
            <PenLine size={15} />
            <span>{wordCount.toLocaleString()} words</span>
            <span>{charCount.toLocaleString()} characters</span>
          </div>
          <div className={`composer-sync-group ${isDirty ? 'dirty' : 'saved'}`}>
            <button
              className={`composer-sync ${isDirty ? 'dirty' : 'saved'}`}
              onClick={() => isDirty && setShowDiff(true)}
              title={isDirty ? 'Unsaved changes. Press Cmd+S to save.' : 'Saved to disk'}
            >
              <CheckCircle2 size={15} />
            </button>
            {isDirty && <span className="composer-sync-hint">Unsaved. Cmd+S to save.</span>}
          </div>
          <div className="content-width-control" title={`Reading width: ${effectiveContentWidth}px (max ${contentWidthCeiling}px)`}>
            <input
              type="range"
              min={CONTENT_WIDTH_MIN}
              max={contentWidthCeiling}
              step={CONTENT_WIDTH_STEP}
              value={effectiveContentWidth}
              onChange={(e) => handleSettingsChange('contentWidth', Number(e.target.value))}
            />
          </div>
          <div className="composer-pill">{widthPercent}</div>
        </div>
      </main>

      {showPalette && (
        <div className="palette-overlay" onClick={() => setShowPalette(false)}>
          <div className="palette" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              placeholder="Command Palette (Cmd/Ctrl + K)"
              value={paletteQuery}
              onChange={(e) => setPaletteQuery(e.target.value)}
              onKeyDown={async (event) => {
                if (!paletteResults.length) return;
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setPaletteIndex((idx) => Math.min(idx + 1, paletteResults.length - 1));
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setPaletteIndex((idx) => Math.max(idx - 1, 0));
                  return;
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  await runPaletteItem(paletteResults[paletteIndex] || paletteResults[0]);
                }
              }}
            />
            <div className="palette-results">
              {paletteResults.map((item, index) => (
                <button
                  key={item.id}
                  className={index === paletteIndex ? 'active' : ''}
                  onMouseEnter={() => setPaletteIndex(index)}
                  onClick={async () => runPaletteItem(item)}
                >
                  <span>{item.label}</span>
                  <span className="palette-hint">{item.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showFolderPrompt && (
        <FolderPromptModal
          value={folderDraft}
          onChange={setFolderDraft}
          onSubmit={confirmCreateFolder}
          onClose={() => {
            setShowFolderPrompt(false);
            setFolderDraft('New Folder');
          }}
        />
      )}

      {showRenamePrompt && (
        <RenamePromptModal
          value={renameDraft}
          onChange={setRenameDraft}
          onSubmit={confirmRenameNote}
          onClose={() => {
            setShowRenamePrompt(false);
            setRenameDraft('');
            setRenameTargetPath('');
          }}
        />
      )}

      {showGraph && <GraphView onClose={() => setShowGraph(false)} onOpen={loadPath} />}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onSettingsChange={handleSettingsChange}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showDiff && (
        <DiffModal
          oldText={loadedContentRef.current}
          newText={content}
          fileName={currentPath?.split('/').pop() || ''}
          onRevert={() => {
            setContent(loadedContentRef.current);
            setShowDiff(false);
          }}
          onClose={() => setShowDiff(false)}
        />
      )}

      {showHistory && (
        <HistoryPanel
          currentPath={currentPath}
          content={content}
          isDirty={isDirty}
          onRestore={(restoredContent) => {
            setContent(restoredContent);
            loadedContentRef.current = restoredContent;
            tabCacheRef.current[currentPath] = { content: restoredContent, loadedContent: restoredContent };
          }}
          onClose={() => setShowHistory(false)}
        />
      )}

      {tabMenu && (
        <div
          ref={tabMenuRef}
          className="tree-context-menu"
          style={{ top: tabMenu.y, left: tabMenu.x }}
        >
          <button
            onClick={() => {
              if (pinnedTabs.has(tabMenu.path)) unpinTab(tabMenu.path);
              else pinTab(tabMenu.path);
              setTabMenu(null);
            }}
          >
            {pinnedTabs.has(tabMenu.path) ? 'Unpin Tab' : 'Pin Tab'}
          </button>
          <button
            disabled={pinnedTabs.has(tabMenu.path)}
            onClick={() => {
              closeTab(tabMenu.path);
              setTabMenu(null);
            }}
          >
            Close Tab
          </button>
          <div className="menu-separator" />
          <button
            onClick={() => {
              openSplitFromTab(tabMenu.path, 'right');
              setTabMenu(null);
            }}
          >
            Split Right
          </button>
          <button
            onClick={() => {
              openSplitFromTab(tabMenu.path, 'left');
              setTabMenu(null);
            }}
          >
            Split Left
          </button>
          <button
            disabled={!splitView}
            onClick={() => {
              closeSplitView();
              setTabMenu(null);
            }}
          >
            Close Split
          </button>
          <div className="menu-separator" />
          <button
            onClick={() => {
              closeTabsToRight(tabMenu.path);
              setTabMenu(null);
            }}
          >
            Close Tabs to Right
          </button>
          <button
            onClick={() => {
              closeOtherTabs(tabMenu.path);
              setTabMenu(null);
            }}
          >
            Close All Other Tabs
          </button>
        </div>
      )}

      {treeMenu && (
        <div
          ref={treeMenuRef}
          className="tree-context-menu"
          style={{ top: treeMenu.y, left: treeMenu.x }}
        >
          {treeMenu.node.type === 'file' ? (
            <>
              <button
                onClick={() => {
                  loadPath(treeMenu.node.path);
                  setTreeMenu(null);
                }}
              >
                Open
              </button>
              <button
                onClick={() => {
                  startRenameNote(treeMenu.node.path);
                  setTreeMenu(null);
                }}
              >
                Rename
              </button>
              <button
                onClick={() => {
                  duplicateNote(treeMenu.node.path);
                  setTreeMenu(null);
                }}
              >
                Duplicate
              </button>
              <button
                onClick={() => {
                  revealInFinder(treeMenu.node.path);
                  setTreeMenu(null);
                }}
              >
                Reveal in Finder
              </button>
              <div className="menu-separator" />
              <button
                className="danger"
                onClick={async () => {
                  await deleteNote(treeMenu.node.path);
                  setTreeMenu(null);
                }}
              >
                Delete Note
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  revealInFinder(treeMenu.node.path);
                  setTreeMenu(null);
                }}
              >
                Reveal Folder in Finder
              </button>
              <div className="menu-separator" />
              <button
                className="danger"
                onClick={async () => {
                  await deleteFolder(treeMenu.node.path);
                  setTreeMenu(null);
                }}
              >
                Delete Folder
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
