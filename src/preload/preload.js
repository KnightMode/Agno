const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ngobs', {
  vault: {
    pick: () => ipcRenderer.invoke('vault:pick'),
    load: () => ipcRenderer.invoke('vault:load'),
    recent: () => ipcRenderer.invoke('vault:recent'),
    openRecent: (vaultPath) => ipcRenderer.invoke('vault:open-recent', vaultPath),
    tree: () => ipcRenderer.invoke('vault:tree'),
    onChanged: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('vault:changed', listener);
      return () => ipcRenderer.removeListener('vault:changed', listener);
    }
  },
  file: {
    read: (relPath) => ipcRenderer.invoke('file:read', relPath),
    write: (relPath, content) => ipcRenderer.invoke('file:write', relPath, content),
    create: (relPath, content) => ipcRenderer.invoke('file:create', relPath, content),
    delete: (relPath) => ipcRenderer.invoke('file:delete', relPath),
    remove: (relPath) => ipcRenderer.invoke('file:remove', relPath),
    rename: (fromRelPath, toRelPath) => ipcRenderer.invoke('file:rename', fromRelPath, toRelPath),
    duplicate: (relPath) => ipcRenderer.invoke('file:duplicate', relPath),
    reveal: (relPath) => ipcRenderer.invoke('file:reveal', relPath),
    createFolder: (relPath) => ipcRenderer.invoke('folder:create', relPath),
    removeFolder: (relPath) => ipcRenderer.invoke('folder:remove', relPath)
  },
  search: {
    all: (query) => ipcRenderer.invoke('search:all', query)
  },
  graph: {
    data: () => ipcRenderer.invoke('graph:data')
  },
  history: {
    save: (relPath, content) => ipcRenderer.invoke('history:save', relPath, content),
    list: (relPath) => ipcRenderer.invoke('history:list', relPath),
    get: (relPath, timestamp) => ipcRenderer.invoke('history:get', relPath, timestamp)
  },
  menu: {
    on: (channel, callback) => {
      const validChannels = [
        'menu:new-note',
        'menu:open-vault',
        'menu:save',
        'menu:settings',
        'menu:toggle-sidebar',
        'menu:toggle-terminal',
        'menu:toggle-links'
      ];
      if (!validChannels.includes(channel)) return () => {};
      const listener = () => callback();
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    }
  },
  terminal: {
    create: (id, cols, rows) => ipcRenderer.invoke('terminal:create', id, cols, rows),
    write: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    kill: (id) => ipcRenderer.invoke('terminal:kill', id),
    onData: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('terminal:data', listener);
      return () => ipcRenderer.removeListener('terminal:data', listener);
    },
    onExit: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('terminal:exit', listener);
      return () => ipcRenderer.removeListener('terminal:exit', listener);
    },
    onError: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('terminal:error', listener);
      return () => ipcRenderer.removeListener('terminal:error', listener);
    }
  },
  sync: {
    config: () => ipcRenderer.invoke('sync:config'),
    status: () => ipcRenderer.invoke('sync:status'),
    init: () => ipcRenderer.invoke('sync:init'),
    setRemote: (url) => ipcRenderer.invoke('sync:set-remote', url),
    createRepo: (token, name, isPrivate) => ipcRenderer.invoke('sync:create-repo', token, name, isPrivate),
    setToken: (token) => ipcRenderer.invoke('sync:set-token', token),
    clearToken: () => ipcRenderer.invoke('sync:clear-token'),
    run: () => ipcRenderer.invoke('sync:run')
  },
  updater: {
    getVersion: () => ipcRenderer.invoke('updater:get-version'),
    check: () => ipcRenderer.invoke('updater:check'),
    openRelease: () => ipcRenderer.invoke('updater:open-release'),
    onStatus: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('updater:status', listener);
      return () => ipcRenderer.removeListener('updater:status', listener);
    }
  }
});
