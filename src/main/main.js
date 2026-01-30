const { app, BrowserWindow, dialog, ipcMain, Menu, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const chokidar = require('chokidar');
const log = require('electron-log');
const pty = require('node-pty');

log.initialize();

app.name = 'Agno';
app.setName('Agno');

let mainWindow;
let watcher;
const terminals = new Map();
let activeVault = null;
const MAX_RECENT_VAULTS = 8;

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
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 18 },
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    transparent: false,
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
    const shell = process.env.SHELL || '/bin/zsh';
    const ptyProc = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: activeVault || app.getPath('home'),
      env: process.env
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
