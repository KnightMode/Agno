const { app, BrowserWindow, dialog, ipcMain, Menu, shell, nativeImage, safeStorage } = require('electron');
const path = require('path');
const fsSync = require('fs');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const chokidar = require('chokidar');
const log = require('electron-log');
const pty = require('node-pty');
const { autoUpdater } = require('electron-updater');
const {
  answerVaultQuestion,
  buildChatContext,
  buildFrontmatterTemplate,
  buildProjectPulseMarkdown,
  buildResearchNote,
  buildVaultAnalysis,
  buildVaultReviewMarkdown,
  parseFrontmatter,
  sanitizeFileName
} = require('./agent');

log.initialize();

autoUpdater.logger = log;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

app.name = 'Agno';
app.setName('Agno');

let mainWindow;
let watcher;
const terminals = new Map();
let activeVault = null;
let lastSyncTimestamp = null;
const MAX_RECENT_VAULTS = 8;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const isDev = !app.isPackaged;

function setDockIcon() {
  if (process.platform !== 'darwin') return;
  const candidates = [
    path.join(app.getAppPath(), 'build', 'icon.png'),
    path.join(__dirname, '..', '..', 'build', 'icon.png'),
    path.join(process.cwd(), 'build', 'icon.png')
  ];

  for (const iconPath of candidates) {
    try {
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        app.dock.setIcon(icon);
        return;
      }
    } catch {
      // Try next candidate
    }
  }
}

function recentVaultsPath() {
  return path.join(app.getPath('userData'), 'recent-vaults.json');
}

function resolveTerminalShell() {
  const candidates = [
    process.env.SHELL,
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) continue;
    try {
      if (fsSync.existsSync(candidate)) return candidate;
    } catch {
      // Try next shell candidate
    }
  }

  return '/bin/sh';
}

function buildTerminalEnv() {
  return {
    ...process.env,
    TERM: 'xterm-256color',
    PATH: process.env.PATH || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
  };
}

function ensureNodePtyHelperExecutable() {
  const appPath = app.getAppPath()
    .replace('app.asar', 'app.asar.unpacked')
    .replace('node_modules.asar', 'node_modules.asar.unpacked');
  const helperPath = path.join(
    appPath,
    'node_modules',
    'node-pty',
    'prebuilds',
    `${process.platform}-${process.arch}`,
    'spawn-helper'
  );

  try {
    if (!fsSync.existsSync(helperPath)) return;
    const stats = fsSync.statSync(helperPath);
    if ((stats.mode & 0o111) !== 0o111) {
      fsSync.chmodSync(helperPath, 0o755);
    }
  } catch (error) {
    log.warn('terminal:helper chmod failed', helperPath, error);
  }
}

async function loadRecentVaults() {
  try {
    const raw = await fs.readFile(recentVaultsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const existing = [];
    for (const entry of parsed) {
      if (typeof entry !== 'string' || !entry) continue;
      try {
        const stat = await fs.stat(entry);
        if (stat.isDirectory()) existing.push(entry);
      } catch {
        // ignore missing directories
      }
    }
    return existing;
  } catch {
    return [];
  }
}

async function saveRecentVaults(paths) {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(recentVaultsPath(), JSON.stringify(paths.slice(0, MAX_RECENT_VAULTS), null, 2), 'utf8');
}

async function touchRecentVault(vaultPath) {
  const current = await loadRecentVaults();
  const next = [vaultPath, ...current.filter((item) => item !== vaultPath)];
  await saveRecentVaults(next);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#00000000',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 18 },
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    transparent: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  if (isDev) {
    mainWindow.loadURL(devUrl).catch((err) => log.error(err));
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist/index.html')).catch((err) => log.error(err));
  }
}

function normalizePath(vaultPath, targetPath) {
  const resolved = path.resolve(vaultPath, targetPath);
  if (!resolved.startsWith(vaultPath)) {
    throw new Error('Path escapes vault root.');
  }
  return resolved;
}

async function ensureUniqueRelativePath(vaultPath, relPath) {
  const ext = path.extname(relPath);
  const dir = path.dirname(relPath);
  const base = path.basename(relPath, ext);
  let nextPath = relPath;
  let index = 2;

  while (true) {
    try {
      await fs.access(normalizePath(vaultPath, nextPath));
      nextPath = path.join(dir === '.' ? '' : dir, `${base} ${index}${ext}`);
      index += 1;
    } catch {
      return nextPath.replace(/^\.\/+/, '');
    }
  }
}

function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 60000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const details = (stderr || stdout || error.message || 'git command failed').trim();
        reject(new Error(details));
        return;
      }
      resolve((stdout || '').trim());
    });
  });
}

function syncSecretsPath() {
  return path.join(app.getPath('userData'), 'sync-secrets.json');
}

function aiSecretsPath() {
  return path.join(app.getPath('userData'), 'ai-secrets.json');
}

function encryptSecret(plainText) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is unavailable on this system.');
  }
  return safeStorage.encryptString(plainText).toString('base64');
}

function decryptSecret(cipherText) {
  if (!cipherText) return '';
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is unavailable on this system.');
  }
  return safeStorage.decryptString(Buffer.from(cipherText, 'base64'));
}

async function readSyncSecrets() {
  try {
    const raw = await fs.readFile(syncSecretsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeSyncSecrets(secrets) {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(syncSecretsPath(), JSON.stringify(secrets, null, 2), 'utf8');
}

async function readAISecrets() {
  try {
    const raw = await fs.readFile(aiSecretsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeAISecrets(secrets) {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(aiSecretsPath(), JSON.stringify(secrets, null, 2), 'utf8');
}

async function getOpenRouterKey() {
  const secrets = await readAISecrets();
  return secrets.openrouter ? decryptSecret(secrets.openrouter) : '';
}

function getOpenRouterHeaders(token, includeJson = false) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'HTTP-Referer': 'https://github.com/KnightMode/Agno',
    'X-Title': 'Agno'
  };

  if (includeJson) headers['Content-Type'] = 'application/json';
  return headers;
}

async function openRouterRequest(endpoint, options = {}) {
  const token = await getOpenRouterKey();
  if (!token) throw new Error('OpenRouter key is not configured.');

  const response = await fetch(`${OPENROUTER_BASE_URL}${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      ...getOpenRouterHeaders(token, Boolean(options.body)),
      ...(options.headers || {})
    },
    body: options.body
  });

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || raw || `OpenRouter request failed (${response.status})`);
  }

  return data;
}

function normalizeAssistantContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item?.type === 'text') return item.text || '';
        return '';
      })
      .join('');
  }
  return '';
}

function extractLatestUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return String(messages[i].content || '');
  }
  return '';
}

function detectCreateNoteIntent(text) {
  const value = String(text || '').toLowerCase();
  if (!value) return false;
  const action = /\b(create|write|draft|make|generate|save|turn)\b/.test(value);
  const target = /\b(note|article|doc|document|page|markdown|md file|file)\b/.test(value);
  return action && target;
}

function extractMarkdownFence(text) {
  const source = String(text || '');
  const matches = Array.from(source.matchAll(/```(?:markdown|md)?\n([\s\S]*?)```/gi));
  if (!matches.length) return '';
  return matches
    .map((match) => String(match[1] || '').trim())
    .sort((a, b) => b.length - a.length)[0];
}

function inferRequestedTitle(userText, assistantText, currentPath) {
  const candidates = [
    String(assistantText || '').match(/file named [`"]?([^`"\n]+?)(?:\.md)?[`"]?/i)?.[1],
    String(assistantText || '').match(/created note[:\s]+[`"]?([^`"\n]+?)(?:\.md)?[`"]?/i)?.[1],
    String(userText || '').match(/\b(?:called|named|titled)\s+["`]?([^"`\n]+?)(?:\.md)?["`]?(?:$|\s)/i)?.[1],
    String(userText || '').match(/\bcreate\b.*?\b(?:note|article|doc|document|page)\b\s+["`]?([^"`\n]+?)(?:\.md)?["`]?(?:$|\s)/i)?.[1]
  ].filter(Boolean);

  const cleaned = sanitizeFileName(candidates[0] || '');
  if (cleaned) return cleaned;

  if (currentPath) {
    return `${sanitizeFileName(path.basename(currentPath, '.md')) || 'Untitled'} Summary`;
  }

  return 'Generated Note';
}

function inferRequestedPath(userText, assistantText, currentPath, title) {
  const assistantPath =
    String(assistantText || '').match(/(?:inside|in)\s+your\s+[`"]?([^`"\n]+?)\/[`"]?\s+directory/i)?.[1] ||
    String(assistantText || '').match(/\bpath[:\s]+[`"]?([^`"\n]+?\.md)[`"]?/i)?.[1];
  const userPath = String(userText || '').match(/\b(?:in|under|inside)\s+[`"]?([^`"\n]+?)\/[`"]?/i)?.[1];
  const preferredDir = sanitizeFileName(assistantPath || userPath || '');
  const currentDir = currentPath ? path.posix.dirname(currentPath) : '';
  const dir = preferredDir || (currentDir === '.' ? '' : currentDir);
  const fileName = `${sanitizeFileName(title) || 'Generated Note'}.md`;
  return dir ? `${dir}/${fileName}` : fileName;
}

function buildFallbackNoteMarkdown({ title, userText, assistantText, currentPath }) {
  const fenced = extractMarkdownFence(assistantText);
  if (fenced) return ensureNoteScaffold(fenced, title);

  const sourceRef = currentPath ? `- Source note: [[${path.basename(currentPath, '.md')}]] (${currentPath})\n` : '';
  const cleanedAssistant = String(assistantText || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const draft = [
    buildFrontmatterTemplate(title).trimEnd(),
    '',
    `# ${title}`,
    '',
    '## Objective',
    String(userText || '').trim() || 'Create a new note from the conversation context.',
    '',
    '## Source Context',
    sourceRef || '- Source note: none',
    '',
    '## Draft',
    cleanedAssistant || 'Draft generated from the conversation.',
    ''
  ].join('\n');

  return draft.endsWith('\n') ? draft : `${draft}\n`;
}

function normalizeChatMessages(messages) {
  return messages
    .filter((message) => message && typeof message === 'object' && typeof message.role === 'string')
    .map((message) => ({
      role: message.role,
      content: typeof message.content === 'string' ? message.content : normalizeAssistantContent(message.content)
    }))
    .filter((message) => message.content || message.role === 'assistant');
}

function buildInstructionSearchDirs(relPath = '') {
  const dirs = [''];
  let current = String(relPath || '').replace(/\\/g, '/').trim();
  if (current.endsWith('/')) current = current.slice(0, -1);
  current = current ? path.posix.dirname(current) : '';

  while (current && current !== '.' && !dirs.includes(current)) {
    dirs.push(current);
    const next = path.posix.dirname(current);
    if (!next || next === current || next === '.') break;
    current = next;
  }

  return dirs.reverse();
}

async function collectRepoInstructionDocs(vaultPath, relPath = '') {
  const fileNames = ['AGENTS.md', 'CLAUDE.md', '.claude.md'];
  const docs = [];
  const seen = new Set();

  for (const dir of buildInstructionSearchDirs(relPath)) {
    for (const name of fileNames) {
      const rel = dir ? path.posix.join(dir, name) : name;
      if (seen.has(rel)) continue;
      seen.add(rel);
      try {
        const content = await fs.readFile(normalizePath(vaultPath, rel), 'utf8');
        docs.push({
          path: rel,
          content: content.slice(0, 7000)
        });
      } catch {
        // Missing instruction files are fine.
      }
    }
  }

  return docs;
}

function sanitizeRelativeMarkdownPath(relPath, title, fallbackDir = '') {
  const raw = String(relPath || '').replace(/\\/g, '/').trim();
  const fallbackBase = sanitizeFileName(title) || 'Untitled';
  const fallback = fallbackDir && fallbackDir !== '.'
    ? `${fallbackDir}/${fallbackBase}.md`
    : `${fallbackBase}.md`;

  const source = raw || fallback;
  const parts = source
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== '.' && segment !== '..');

  if (!parts.length) return `${fallbackBase}.md`;

  const normalized = parts.map((segment, index) => {
    const isLeaf = index === parts.length - 1;
    const cleaned = isLeaf
      ? sanitizeFileName(segment.replace(/\.md$/i, ''))
      : sanitizeFileName(segment);
    return cleaned || (isLeaf ? fallbackBase : 'Untitled');
  });

  const joined = normalized.join('/');
  return joined.toLowerCase().endsWith('.md') ? joined : `${joined}.md`;
}

function ensureNoteScaffold(markdown, title) {
  const raw = String(markdown || '').trim();
  const safeTitle = sanitizeFileName(title) || 'Untitled';
  const parsed = parseFrontmatter(raw);
  const body = String(parsed.body || '').trim();
  const hasHeading = /^\s*#\s+/m.test(body);
  const frontmatter = parsed.frontmatterRaw || buildFrontmatterTemplate(safeTitle);
  const heading = hasHeading ? '' : `# ${safeTitle}\n\n`;
  const finalBody = body || '## Summary\n\n## Key Points\n\n## Next Steps\n';
  return `${frontmatter}${heading}${finalBody.endsWith('\n') ? finalBody : `${finalBody}\n`}`;
}

async function createAgentNote(vaultPath, currentPath, args = {}) {
  const title = sanitizeFileName(args.title || path.basename(String(args.rel_path || args.relPath || ''), '.md')) || 'Untitled';
  const fallbackDir = currentPath ? path.posix.dirname(currentPath) : '';
  const requestedPath = args.rel_path || args.relPath || '';
  const relPath = await ensureUniqueRelativePath(
    vaultPath,
    sanitizeRelativeMarkdownPath(requestedPath, title, fallbackDir === '.' ? '' : fallbackDir)
  );
  const filePath = normalizePath(vaultPath, relPath);
  const markdown = ensureNoteScaffold(args.markdown, title);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, markdown, 'utf8');

  return {
    kind: 'create-note',
    title,
    openedPath: relPath,
    updatedPaths: [relPath],
    message: `Created ${relPath}`
  };
}

async function runAgentToolCall(vaultPath, currentPath, toolCall) {
  if (!toolCall?.function?.name) {
    throw new Error('Invalid tool call received from model.');
  }

  let args = {};
  try {
    args = JSON.parse(toolCall.function.arguments || '{}');
  } catch {
    throw new Error(`Tool arguments for ${toolCall.function.name} were not valid JSON.`);
  }

  switch (toolCall.function.name) {
    case 'create_note':
      return createAgentNote(vaultPath, currentPath, args);
    default:
      throw new Error(`Unsupported tool call: ${toolCall.function.name}`);
  }
}

function parseGitHubRemote(remoteUrl) {
  const normalized = (remoteUrl || '').trim();
  if (!normalized) return null;

  const httpsMatch = normalized.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (httpsMatch) {
    return {
      host: 'github.com',
      owner: httpsMatch[1],
      repo: httpsMatch[2],
      slug: `${httpsMatch[1]}/${httpsMatch[2]}`,
      remoteUrl: normalized
    };
  }

  const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return {
      host: 'github.com',
      owner: sshMatch[1],
      repo: sshMatch[2],
      slug: `${sshMatch[1]}/${sshMatch[2]}`,
      remoteUrl: normalized
    };
  }

  return null;
}

function repoSecretKey(repoInfo) {
  return `${repoInfo.host}/${repoInfo.owner}/${repoInfo.repo}`.toLowerCase();
}

function makeAuthRemoteUrl(repoInfo, token) {
  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${repoInfo.owner}/${repoInfo.repo}.git`;
}

function redactTokenInText(value) {
  return String(value || '').replace(/x-access-token:[^@]+@/gi, 'x-access-token:***@');
}

async function getVaultGitInfo(vaultPath) {
  try {
    const insideRepo = await runGit(['rev-parse', '--is-inside-work-tree'], vaultPath);
    if (insideRepo !== 'true') return { isRepo: false };
  } catch {
    return { isRepo: false };
  }

  let remoteUrl = '';
  try {
    remoteUrl = await runGit(['remote', 'get-url', 'origin'], vaultPath);
  } catch {
    // No remote configured yet
  }

  let branch = '';
  try {
    branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], vaultPath);
  } catch {
    branch = 'main';
  }

  const repoInfo = parseGitHubRemote(remoteUrl);
  return {
    isRepo: true,
    remoteUrl,
    branch,
    repoInfo
  };
}

async function getTree(dir, root) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const result = [];
  for (const entry of sorted) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(root, fullPath);
    if (entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path: relPath,
        type: 'directory',
        children: await getTree(fullPath, root)
      });
    } else {
      result.push({
        name: entry.name,
        path: relPath,
        type: 'file'
      });
    }
  }

  return result;
}

async function indexMarkdown(vaultPath) {
  const all = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith('.md')) {
        const rel = path.relative(vaultPath, full);
        const content = await fs.readFile(full, 'utf8');
        all.push({ path: rel, content });
      }
    }
  }

  await walk(vaultPath);
  return all;
}

function attachWatcher(vaultPath) {
  if (watcher) watcher.close();
  watcher = chokidar.watch(vaultPath, {
    ignored: [/(^|[\\/])\./, path.join(vaultPath, '.agno', '**')],
    ignoreInitial: true,
    persistent: true
  });

  watcher.on('all', (_event, changedPath) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const rel = path.relative(vaultPath, changedPath);
    mainWindow.webContents.send('vault:changed', { path: rel });
  });
}

ipcMain.handle('vault:pick', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Vault',
    properties: ['openDirectory', 'createDirectory']
  });

  if (canceled || !filePaths?.[0]) return null;
  activeVault = filePaths[0];
  attachWatcher(activeVault);
  await touchRecentVault(activeVault);

  return {
    rootPath: activeVault,
    tree: await getTree(activeVault, activeVault)
  };
});

ipcMain.handle('vault:recent', async () => {
  return loadRecentVaults();
});

ipcMain.handle('vault:open-recent', async (_event, vaultPath) => {
  if (!vaultPath || typeof vaultPath !== 'string') throw new Error('Invalid vault path');
  const stat = await fs.stat(vaultPath);
  if (!stat.isDirectory()) throw new Error('Vault path is not a directory');

  activeVault = vaultPath;
  attachWatcher(activeVault);
  await touchRecentVault(activeVault);

  return {
    rootPath: activeVault,
    tree: await getTree(activeVault, activeVault)
  };
});

ipcMain.handle('vault:load', async () => {
  if (!activeVault) return null;
  return {
    rootPath: activeVault,
    tree: await getTree(activeVault, activeVault)
  };
});

ipcMain.handle('vault:tree', async () => {
  if (!activeVault) throw new Error('No active vault');
  return getTree(activeVault, activeVault);
});

ipcMain.handle('file:read', async (_event, relPath) => {
  if (!activeVault) throw new Error('No active vault');
  const filePath = normalizePath(activeVault, relPath);
  return fs.readFile(filePath, 'utf8');
});

ipcMain.handle('file:write', async (_event, relPath, content) => {
  if (!activeVault) throw new Error('No active vault');
  const filePath = normalizePath(activeVault, relPath);
  await fs.writeFile(filePath, content, 'utf8');
  return true;
});

ipcMain.handle('file:create', async (_event, relPath, content = '') => {
  if (!activeVault) throw new Error('No active vault');
  const filePath = normalizePath(activeVault, relPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  return true;
});

ipcMain.handle('file:delete', async (_event, relPath) => {
  if (!activeVault) throw new Error('No active vault');
  if (!relPath) throw new Error('Invalid path');
  const filePath = normalizePath(activeVault, relPath);
  await fs.rm(filePath, { force: true });
  return true;
});

ipcMain.handle('file:remove', async (_event, relPath) => {
  if (!activeVault) throw new Error('No active vault');
  if (!relPath) throw new Error('Invalid path');
  const filePath = normalizePath(activeVault, relPath);
  await fs.rm(filePath, { force: true, recursive: true });
  return true;
});

ipcMain.handle('file:rename', async (_event, fromRelPath, toRelPath) => {
  if (!activeVault) throw new Error('No active vault');
  if (!fromRelPath || !toRelPath) throw new Error('Invalid path');

  const fromPath = normalizePath(activeVault, fromRelPath);
  const toPath = normalizePath(activeVault, toRelPath);

  await fs.mkdir(path.dirname(toPath), { recursive: true });
  await fs.rename(fromPath, toPath);
  return true;
});

ipcMain.handle('file:duplicate', async (_event, relPath) => {
  if (!activeVault) throw new Error('No active vault');
  if (!relPath) throw new Error('Invalid path');

  const sourcePath = normalizePath(activeVault, relPath);
  const dir = path.dirname(relPath);
  const ext = path.extname(relPath);
  const base = path.basename(relPath, ext);

  let copyName = `${base} copy${ext}`;
  let copyRelPath = path.join(dir, copyName);
  let index = 2;
  while (true) {
    try {
      await fs.access(normalizePath(activeVault, copyRelPath));
      copyName = `${base} copy ${index}${ext}`;
      copyRelPath = path.join(dir, copyName);
      index += 1;
    } catch {
      break;
    }
  }

  await fs.copyFile(sourcePath, normalizePath(activeVault, copyRelPath));
  return copyRelPath;
});

ipcMain.handle('file:reveal', async (_event, relPath) => {
  if (!activeVault) throw new Error('No active vault');
  if (!relPath) throw new Error('Invalid path');
  const filePath = normalizePath(activeVault, relPath);
  shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle('folder:create', async (_event, relPath) => {
  if (!activeVault) throw new Error('No active vault');
  const folderPath = normalizePath(activeVault, relPath);
  await fs.mkdir(folderPath, { recursive: true });
  return true;
});

ipcMain.handle('folder:remove', async (_event, relPath) => {
  if (!activeVault) throw new Error('No active vault');
  if (!relPath) throw new Error('Invalid path');
  const folderPath = normalizePath(activeVault, relPath);
  await fs.rm(folderPath, { force: true, recursive: true });
  return true;
});

ipcMain.handle('search:all', async (_event, query) => {
  if (!activeVault) throw new Error('No active vault');
  const docs = await indexMarkdown(activeVault);
  if (!query) return docs;

  const lower = query.toLowerCase();
  return docs.filter((doc) => doc.path.toLowerCase().includes(lower) || doc.content.toLowerCase().includes(lower));
});

ipcMain.handle('graph:data', async () => {
  if (!activeVault) throw new Error('No active vault');
  const docs = await indexMarkdown(activeVault);

  const nodes = docs.map((doc) => ({ id: doc.path, label: path.basename(doc.path, '.md') }));
  const links = [];
  const wikiPattern = /\[\[([^\]]+)\]\]/g;

  for (const doc of docs) {
    const matches = [...doc.content.matchAll(wikiPattern)];
    for (const match of matches) {
      const target = `${match[1].trim()}.md`;
      const found = docs.find((d) => d.path.endsWith(target));
      if (found) {
        links.push({ source: doc.path, target: found.path });
      }
    }
  }

  return { nodes, links };
});

ipcMain.handle('agent:overview', async () => {
  if (!activeVault) throw new Error('No active vault');
  const docs = await indexMarkdown(activeVault);
  return buildVaultAnalysis(activeVault, docs);
});

ipcMain.handle('agent:chat', async (_event, payload) => {
  if (!activeVault) throw new Error('No active vault');

  const messages = normalizeChatMessages(Array.isArray(payload?.messages) ? payload.messages : []);
  const model = String(payload?.model || '').trim();
  const currentPath = payload?.currentPath ? String(payload.currentPath) : '';
  if (!model) throw new Error('Select an OpenRouter model in Settings.');
  if (!messages.length) throw new Error('No chat messages provided.');

  const latestUser = extractLatestUserMessage(messages);
  const wantsNoteCreation = detectCreateNoteIntent(latestUser);
  const context = await buildChatContext(
    activeVault,
    latestUser,
    currentPath,
    payload?.currentContent ? String(payload.currentContent) : ''
  );
  const instructionDocs = await collectRepoInstructionDocs(activeVault, currentPath);

  const systemPrompt = [
    'You are Agno, a note-aware assistant inside a local-first knowledge base.',
    'Answer using the provided vault context only. If the answer is uncertain, say so clearly.',
    'Prefer concise, practical responses.',
    'Cite note paths inline when making factual claims from notes.',
    'When the user asks to create a note, article, doc, or markdown file, prefer using the available tools instead of only describing what to write.',
    'Any created markdown must follow the repository instruction files if they are provided.',
    'If multiple instruction files are provided, more specific files closer to the target path override broader root instructions.',
    'After using a tool, briefly explain what you created and why.'
  ].join(' ');

  const contextSections = [];
  if (context.currentNote) {
    contextSections.push(
      `Current note (${context.currentNote.path}):\nTitle: ${context.currentNote.title}\nTags: ${context.currentNote.tags.join(', ') || 'none'}\nOpen tasks: ${context.currentNote.tasks.map((task) => task.text).join(' | ') || 'none'}\nContent:\n${context.currentNote.body}`
    );
  }
  if (context.relatedNotes.length) {
    contextSections.push(
      `Related notes:\n${context.relatedNotes.map((note) => (
        `Path: ${note.path}\nTitle: ${note.title}\nExcerpt: ${note.excerpt}\nContent:\n${note.body}`
      )).join('\n\n---\n\n')}`
    );
  }

  const instructionSections = instructionDocs.length
    ? [
        `Repository instructions for note creation:\n${instructionDocs.map((doc) => (
          `File: ${doc.path}\n${doc.content}`
        )).join('\n\n====\n\n')}`
      ]
    : [];

  const toolDefinitions = [
    {
      type: 'function',
      function: {
        name: 'create_note',
        description: 'Create a new markdown note in the vault when the user asks for a note, article, document, or page to be created.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: {
              type: 'string',
              description: 'Human-readable note title.'
            },
            rel_path: {
              type: 'string',
              description: 'Optional vault-relative markdown path such as docs/Context and Cancellation.md.'
            },
            markdown: {
              type: 'string',
              description: 'Complete markdown for the new note, following any repository instruction files that were provided.'
            },
            rationale: {
              type: 'string',
              description: 'Short explanation of why this note should be created.'
            }
          },
          required: ['title', 'markdown']
        }
      }
    }
  ];

  const conversation = [
    { role: 'system', content: systemPrompt },
    ...(instructionSections.length ? instructionSections.map((content) => ({ role: 'system', content })) : []),
    ...(contextSections.length ? [{ role: 'system', content: contextSections.join('\n\n====\n\n') }] : []),
    ...messages
  ];

  const toolResults = [];
  let content = '';
  let completionCount = 0;

  const runCompletion = async (toolChoice = 'auto', extraMessages = []) => {
    completionCount += 1;
    const completion = await openRouterRequest('/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model,
        temperature: 0.2,
        tools: toolDefinitions,
        tool_choice: toolChoice,
        messages: [...conversation, ...extraMessages]
      })
    });

    const choice = completion?.choices?.[0];
    const assistantMessage = choice?.message || {};
    const toolCalls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];

    if (!toolCalls.length) {
      content = normalizeAssistantContent(assistantMessage.content);
      return false;
    }

    conversation.push({
      role: 'assistant',
      content: normalizeAssistantContent(assistantMessage.content),
      tool_calls: toolCalls
    });

    for (const toolCall of toolCalls) {
      const result = await runAgentToolCall(activeVault, currentPath, toolCall);
      toolResults.push(result);
      conversation.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result)
      });
    }
    return true;
  };

  await runCompletion('auto');

  if (wantsNoteCreation && toolResults.length === 0 && completionCount < 3) {
    await runCompletion(
      { type: 'function', function: { name: 'create_note' } },
      [{
        role: 'system',
        content: 'The user explicitly asked you to create a note. Do not answer with manual instructions. Call create_note now.'
      }]
    );
  }

  if (wantsNoteCreation && toolResults.length === 0) {
    const title = inferRequestedTitle(latestUser, content, currentPath);
    const relPath = inferRequestedPath(latestUser, content, currentPath, title);
    const markdown = buildFallbackNoteMarkdown({
      title,
      userText: latestUser,
      assistantText: content,
      currentPath
    });
    const fallbackResult = await createAgentNote(activeVault, currentPath, {
      title,
      rel_path: relPath,
      markdown
    });
    toolResults.push(fallbackResult);
    content = content
      ? `${content}\n\nCreated ${fallbackResult.openedPath} in the vault.`
      : `Created ${fallbackResult.openedPath} in the vault.`;
  }

  return {
    ok: true,
    content,
    context,
    createdNote: toolResults.find((result) => result.kind === 'create-note') || null,
    toolResults
  };
});

ipcMain.handle('agent:ask', async (_event, query, currentPath) => {
  if (!activeVault) throw new Error('No active vault');
  return answerVaultQuestion(activeVault, query, currentPath);
});

ipcMain.handle('agent:create-report', async (_event, kind) => {
  if (!activeVault) throw new Error('No active vault');
  const docs = await indexMarkdown(activeVault);
  const analysis = await buildVaultAnalysis(activeVault, docs);
  const dateStamp = new Date().toISOString().slice(0, 10);

  let relPath = '';
  let content = '';
  if (kind === 'project-pulse') {
    relPath = await ensureUniqueRelativePath(activeVault, `Agent Reports/${dateStamp} Project Pulse.md`);
    content = buildProjectPulseMarkdown(analysis);
  } else {
    relPath = await ensureUniqueRelativePath(activeVault, `Agent Reports/${dateStamp} Vault Review.md`);
    content = buildVaultReviewMarkdown(analysis);
  }

  const filePath = normalizePath(activeVault, relPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  return {
    ok: true,
    message: `Created ${relPath}`,
    openedPath: relPath,
    updatedPaths: [relPath]
  };
});

ipcMain.handle('agent:ingest-research', async (_event, payload) => {
  if (!activeVault) throw new Error('No active vault');
  const note = buildResearchNote(payload || {});
  const relPath = await ensureUniqueRelativePath(activeVault, note.suggestedPath);
  const filePath = normalizePath(activeVault, relPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, note.markdown, 'utf8');
  return {
    ok: true,
    message: `Captured research into ${relPath}`,
    openedPath: relPath,
    updatedPaths: [relPath]
  };
});

ipcMain.handle('agent:apply-suggestion', async (_event, suggestion) => {
  if (!activeVault) throw new Error('No active vault');
  if (!suggestion || typeof suggestion !== 'object') throw new Error('Invalid suggestion.');

  switch (suggestion.kind) {
    case 'add-frontmatter': {
      const relPath = suggestion.targetPath;
      const filePath = normalizePath(activeVault, relPath);
      const content = await fs.readFile(filePath, 'utf8');
      const parsed = parseFrontmatter(content);
      if (parsed.frontmatterRaw) {
        return { ok: true, message: `${relPath} already has frontmatter.`, updatedPaths: [] };
      }
      const title = sanitizeFileName(path.basename(relPath, '.md')) || 'Untitled';
      await fs.writeFile(filePath, `${buildFrontmatterTemplate(title)}${content}`, 'utf8');
      return {
        ok: true,
        message: `Added frontmatter to ${relPath}`,
        updatedPaths: [relPath]
      };
    }
    case 'create-missing-note': {
      const desiredPath = String(suggestion.suggestedPath || `${sanitizeFileName(suggestion.linkText) || 'Untitled'}.md`);
      const relPath = await ensureUniqueRelativePath(activeVault, desiredPath);
      const filePath = normalizePath(activeVault, relPath);
      const title = sanitizeFileName(path.basename(relPath, '.md')) || 'Untitled';
      const sourceLink = suggestion.sourcePath ? `\n\nLinked from [[${path.basename(suggestion.sourcePath, '.md')}]].\n` : '\n';
      const scaffold = `${buildFrontmatterTemplate(title)}# ${title}\n\n## Summary\n\n## Next Steps${sourceLink}`;
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, scaffold, 'utf8');
      return {
        ok: true,
        message: `Created ${relPath}`,
        openedPath: relPath,
        updatedPaths: [relPath]
      };
    }
    case 'fix-broken-link': {
      const sourcePath = suggestion.sourcePath;
      const linkText = String(suggestion.linkText || '').trim();
      const replacementTitle = String(suggestion.targetTitle || path.basename(String(suggestion.targetPath || ''), '.md')).trim();
      if (!sourcePath || !linkText || !replacementTitle) {
        throw new Error('Incomplete broken link suggestion.');
      }

      const filePath = normalizePath(activeVault, sourcePath);
      const content = await fs.readFile(filePath, 'utf8');
      const next = content.replaceAll(`[[${linkText}]]`, `[[${replacementTitle}]]`);
      if (next === content) {
        throw new Error(`No [[${linkText}]] links found in ${sourcePath}.`);
      }
      await fs.writeFile(filePath, next, 'utf8');
      return {
        ok: true,
        message: `Updated wiki links in ${sourcePath}`,
        updatedPaths: [sourcePath]
      };
    }
    default:
      throw new Error(`Unsupported suggestion type: ${suggestion.kind}`);
  }
});

ipcMain.handle('ai:status', async () => {
  const token = await getOpenRouterKey();
  return { hasOpenRouterKey: Boolean(token) };
});

ipcMain.handle('ai:set-openrouter-key', async (_event, token) => {
  const trimmed = String(token || '').trim();
  if (!trimmed) throw new Error('OpenRouter key is required.');
  const secrets = await readAISecrets();
  secrets.openrouter = encryptSecret(trimmed);
  await writeAISecrets(secrets);
  return { ok: true };
});

ipcMain.handle('ai:clear-openrouter-key', async () => {
  const secrets = await readAISecrets();
  delete secrets.openrouter;
  await writeAISecrets(secrets);
  return { ok: true };
});

ipcMain.handle('ai:list-openrouter-models', async () => {
  const data = await openRouterRequest('/models');
  const models = Array.isArray(data?.data) ? data.data : [];
  return models
    .map((model) => ({
      id: model.id,
      name: model.name || model.id,
      contextLength: model.context_length || 0,
      promptPrice: model.pricing?.prompt || '',
      completionPrice: model.pricing?.completion || ''
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

ipcMain.handle('sync:config', async () => {
  if (!activeVault) throw new Error('No active vault');
  const gitInfo = await getVaultGitInfo(activeVault);
  if (!gitInfo.isRepo) {
    return { enabled: false, isRepo: false, hasToken: false };
  }

  if (!gitInfo.repoInfo) {
    return {
      enabled: false,
      isRepo: true,
      hasToken: false,
      remoteUrl: gitInfo.remoteUrl,
      branch: gitInfo.branch,
      reason: 'Only GitHub remotes are currently supported.'
    };
  }

  const secrets = await readSyncSecrets();
  const key = repoSecretKey(gitInfo.repoInfo);
  const hasToken = Boolean(secrets[key]);
  return {
    enabled: true,
    isRepo: true,
    hasToken,
    remoteUrl: gitInfo.remoteUrl,
    repoSlug: gitInfo.repoInfo.slug,
    branch: gitInfo.branch
  };
});

ipcMain.handle('sync:init', async () => {
  if (!activeVault) throw new Error('No active vault');
  const gitInfo = await getVaultGitInfo(activeVault);
  if (gitInfo.isRepo) return { ok: true, alreadyInit: true };

  await runGit(['init'], activeVault);
  // Create .gitignore for vault metadata
  const gitignorePath = path.join(activeVault, '.gitignore');
  try { await fs.access(gitignorePath); } catch {
    await fs.writeFile(gitignorePath, '.agno/\n.DS_Store\n', 'utf8');
  }
  await runGit(['add', '-A'], activeVault);
  await runGit(['commit', '-m', 'Initial commit'], activeVault);
  return { ok: true };
});

ipcMain.handle('sync:set-remote', async (_event, remoteUrl) => {
  if (!activeVault) throw new Error('No active vault');
  const trimmed = String(remoteUrl || '').trim();
  if (!trimmed) throw new Error('Remote URL is required.');

  const repoInfo = parseGitHubRemote(trimmed);
  if (!repoInfo) throw new Error('Only GitHub repository URLs are supported.');

  const gitInfo = await getVaultGitInfo(activeVault);
  if (!gitInfo.isRepo) throw new Error('Vault is not a git repository. Initialize it first.');

  try {
    await runGit(['remote', 'get-url', 'origin'], activeVault);
    // Remote already exists, update it
    await runGit(['remote', 'set-url', 'origin', trimmed], activeVault);
  } catch {
    // No remote yet, add it
    await runGit(['remote', 'add', 'origin', trimmed], activeVault);
  }

  return { ok: true, repoSlug: repoInfo.slug };
});

ipcMain.handle('sync:create-repo', async (_event, token, repoName, isPrivate) => {
  if (!activeVault) throw new Error('No active vault');
  const trimmedToken = String(token || '').trim();
  if (!trimmedToken) throw new Error('GitHub token is required to create a repository.');

  const gitInfo = await getVaultGitInfo(activeVault);
  if (!gitInfo.isRepo) throw new Error('Vault is not a git repository. Initialize it first.');

  const name = String(repoName || '').trim() || path.basename(activeVault);

  // Create repo via GitHub API
  const { net } = require('electron');
  const body = JSON.stringify({ name, private: isPrivate !== false, auto_init: false });

  const repoData = await new Promise((resolve, reject) => {
    const request = net.request({
      method: 'POST',
      url: 'https://api.github.com/user/repos'
    });
    request.setHeader('Authorization', `Bearer ${trimmedToken}`);
    request.setHeader('Accept', 'application/vnd.github+json');
    request.setHeader('Content-Type', 'application/json');
    request.setHeader('User-Agent', 'Agno-App');

    let responseBody = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => { responseBody += chunk.toString(); });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody);
          if (response.statusCode >= 400) {
            reject(new Error(parsed.message || `GitHub API error (${response.statusCode})`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`Invalid response from GitHub (${response.statusCode})`));
        }
      });
    });
    request.on('error', (err) => reject(new Error(err.message || 'Network request failed')));
    request.write(body);
    request.end();
  });

  const cloneUrl = repoData.clone_url || `https://github.com/${repoData.full_name}.git`;
  const repoInfo = parseGitHubRemote(cloneUrl);

  // Set remote
  try {
    await runGit(['remote', 'get-url', 'origin'], activeVault);
    await runGit(['remote', 'set-url', 'origin', cloneUrl], activeVault);
  } catch {
    await runGit(['remote', 'add', 'origin', cloneUrl], activeVault);
  }

  // Save token
  if (repoInfo) {
    const secrets = await readSyncSecrets();
    secrets[repoSecretKey(repoInfo)] = encryptSecret(trimmedToken);
    await writeSyncSecrets(secrets);
  }

  return { ok: true, repoSlug: repoData.full_name, cloneUrl };
});

ipcMain.handle('sync:set-token', async (_event, token) => {
  if (!activeVault) throw new Error('No active vault');
  const trimmed = String(token || '').trim();
  if (!trimmed) throw new Error('Token is required.');

  const gitInfo = await getVaultGitInfo(activeVault);
  if (!gitInfo.isRepo || !gitInfo.repoInfo) {
    throw new Error('This vault is not connected to a supported GitHub remote.');
  }

  const secrets = await readSyncSecrets();
  secrets[repoSecretKey(gitInfo.repoInfo)] = encryptSecret(trimmed);
  await writeSyncSecrets(secrets);
  return { ok: true };
});

ipcMain.handle('sync:clear-token', async () => {
  if (!activeVault) throw new Error('No active vault');
  const gitInfo = await getVaultGitInfo(activeVault);
  if (!gitInfo.isRepo || !gitInfo.repoInfo) return { ok: true };

  const secrets = await readSyncSecrets();
  delete secrets[repoSecretKey(gitInfo.repoInfo)];
  await writeSyncSecrets(secrets);
  return { ok: true };
});

ipcMain.handle('sync:status', async () => {
  if (!activeVault) return { dirty: false, lastSync: null };
  try {
    const status = await runGit(['status', '--porcelain'], activeVault);
    const dirty = Boolean(status);
    const changedCount = dirty ? status.split('\n').filter(Boolean).length : 0;
    return { dirty, changedCount, lastSync: lastSyncTimestamp };
  } catch {
    return { dirty: false, changedCount: 0, lastSync: lastSyncTimestamp };
  }
});

ipcMain.handle('sync:run', async () => {
  if (!activeVault) throw new Error('No active vault');
  const gitInfo = await getVaultGitInfo(activeVault);
  if (!gitInfo.isRepo || !gitInfo.repoInfo) {
    throw new Error('This vault is not connected to a supported GitHub remote.');
  }

  const secrets = await readSyncSecrets();
  const encryptedToken = secrets[repoSecretKey(gitInfo.repoInfo)];
  if (!encryptedToken) {
    throw new Error('No GitHub token configured for this vault.');
  }
  const token = decryptSecret(encryptedToken);
  const authRemote = makeAuthRemoteUrl(gitInfo.repoInfo, token);

  try {
    const summary = [];

    // Auto-commit local changes before syncing
    const status = await runGit(['status', '--porcelain'], activeVault);
    if (status) {
      await runGit(['add', '-A'], activeVault);
      const now = new Date();
      const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      await runGit(['commit', '-m', `vault sync ${timestamp}`], activeVault);
      summary.push('Committed local changes');
    }

    // Try to fetch — will fail if remote branch doesn't exist yet (empty repo)
    let remoteHasBranch = true;
    try {
      await runGit(['fetch', authRemote, gitInfo.branch], activeVault);
      summary.push('Fetched remote updates');
    } catch {
      remoteHasBranch = false;
    }

    if (remoteHasBranch) {
      // Check if there are remote changes to pull
      const behind = await runGit(['rev-list', '--count', `HEAD..FETCH_HEAD`], activeVault);
      if (parseInt(behind, 10) > 0) {
        await runGit(['rebase', 'FETCH_HEAD'], activeVault);
        summary.push('Rebased on remote changes');
      }
    }

    await runGit(['push', authRemote, `HEAD:${gitInfo.branch}`], activeVault);
    summary.push(remoteHasBranch ? 'Pushed to remote' : 'Pushed initial commit');

    lastSyncTimestamp = Date.now();

    return {
      ok: true,
      repoSlug: gitInfo.repoInfo.slug,
      branch: gitInfo.branch,
      summary
    };
  } catch (error) {
    // Abort any in-progress rebase so the repo is not left in a broken state
    try { await runGit(['rebase', '--abort'], activeVault); } catch { /* no rebase in progress */ }
    throw new Error(redactTokenInText(error?.message || 'Sync failed.'));
  }
});

// ── Version History ──

const HISTORY_MAX_VERSIONS = 50;

function historyDir(vaultPath, relPath) {
  const name = path.basename(relPath, path.extname(relPath));
  return path.join(vaultPath, '.agno', 'history', name);
}

ipcMain.handle('history:save', async (_event, relPath, content) => {
  if (!activeVault) throw new Error('No active vault');
  const dir = historyDir(activeVault, relPath);
  await fs.mkdir(dir, { recursive: true });
  const timestamp = Date.now();
  const versionFile = path.join(dir, `${timestamp}.json`);
  await fs.writeFile(versionFile, JSON.stringify({ timestamp, content, path: relPath }), 'utf8');

  // Prune old versions
  const files = await fs.readdir(dir);
  const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();
  if (jsonFiles.length > HISTORY_MAX_VERSIONS) {
    const toRemove = jsonFiles.slice(0, jsonFiles.length - HISTORY_MAX_VERSIONS);
    for (const f of toRemove) {
      await fs.rm(path.join(dir, f), { force: true });
    }
  }

  return true;
});

ipcMain.handle('history:list', async (_event, relPath) => {
  if (!activeVault) throw new Error('No active vault');
  const dir = historyDir(activeVault, relPath);
  try {
    const files = await fs.readdir(dir);
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({
        timestamp: parseInt(f.replace('.json', ''), 10),
        filename: f
      }))
      .sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
});

ipcMain.handle('history:get', async (_event, relPath, timestamp) => {
  if (!activeVault) throw new Error('No active vault');
  const dir = historyDir(activeVault, relPath);
  const versionFile = path.join(dir, `${timestamp}.json`);
  const raw = await fs.readFile(versionFile, 'utf8');
  return JSON.parse(raw);
});

ipcMain.handle('terminal:create', async (_event, id, cols = 120, rows = 34) => {
  if (terminals.has(id)) return true;

  try {
    ensureNodePtyHelperExecutable();
    const shell = resolveTerminalShell();
    const ptyProc = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: activeVault || app.getPath('home'),
      env: buildTerminalEnv()
    });

    ptyProc.onData((data) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('terminal:data', { id, data });
    });

    ptyProc.onExit(() => {
      terminals.delete(id);
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('terminal:exit', { id });
    });

    terminals.set(id, ptyProc);
    return true;
  } catch (error) {
    log.error('terminal:create failed', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:error', {
        id,
        message: error?.message || 'Unable to start shell session'
      });
    }
    return false;
  }
});

ipcMain.handle('terminal:write', async (_event, id, data) => {
  terminals.get(id)?.write(data);
  return true;
});

ipcMain.handle('terminal:resize', async (_event, id, cols, rows) => {
  terminals.get(id)?.resize(cols, rows);
  return true;
});

ipcMain.handle('terminal:kill', async (_event, id) => {
  terminals.get(id)?.kill();
  terminals.delete(id);
  return true;
});

// ── Auto-Updater ──

function sendUpdaterStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status', status);
  }
}

autoUpdater.on('checking-for-update', () => {
  sendUpdaterStatus({ state: 'checking' });
});

autoUpdater.on('update-available', (info) => {
  sendUpdaterStatus({ state: 'available', version: info.version });
});

autoUpdater.on('update-not-available', () => {
  sendUpdaterStatus({ state: 'up-to-date' });
});

autoUpdater.on('download-progress', () => {});

autoUpdater.on('update-downloaded', () => {});

autoUpdater.on('error', (err) => {
  sendUpdaterStatus({ state: 'error', message: err?.message || 'Update check failed.' });
});

ipcMain.handle('updater:get-version', () => {
  return app.getVersion();
});

ipcMain.handle('updater:check', async () => {
  return autoUpdater.checkForUpdates();
});

ipcMain.handle('updater:install', () => {
  autoUpdater.quitAndInstall();
});

ipcMain.handle('updater:open-release', () => {
  shell.openExternal('https://github.com/KnightMode/Agno/releases/latest');
});

function sendToRenderer(channel) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel);
  }
}

function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [
          {
            label: 'Agno',
            submenu: [
              { role: 'about', label: 'About Agno' },
              { type: 'separator' },
              {
                label: 'Preferences\u2026',
                accelerator: 'CmdOrCtrl+,',
                click: () => sendToRenderer('menu:settings')
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide', label: 'Hide Agno' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit', label: 'Quit Agno' }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Note',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendToRenderer('menu:new-note')
        },
        {
          label: 'Open Vault\u2026',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendToRenderer('menu:open-vault')
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendToRenderer('menu:save')
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'Close Window' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+\\',
          click: () => sendToRenderer('menu:toggle-sidebar')
        },
        {
          label: 'Toggle Terminal',
          accelerator: 'CmdOrCtrl+`',
          click: () => sendToRenderer('menu:toggle-terminal')
        },
        {
          label: 'Toggle Links Panel',
          click: () => sendToRenderer('menu:toggle-links')
        },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Actual Size' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Learn More',
          click: () => shell.openExternal('https://github.com')
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  setDockIcon();
  buildAppMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (watcher) watcher.close();
  terminals.forEach((term) => term.kill());
});
