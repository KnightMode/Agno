import React, { useEffect, useState, useCallback } from 'react';
import { X, RefreshCw, Download, RotateCcw } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Switch } from './ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './ui/select';
import { Button } from './ui/button';
import { Input } from './ui/input';

const ACCENT_COLORS = [
  { value: '#0a84ff', label: 'Blue' },
  { value: '#ff453a', label: 'Red' },
  { value: '#ff9f0a', label: 'Orange' },
  { value: '#ffd60a', label: 'Yellow' },
  { value: '#30d158', label: 'Green' },
  { value: '#bf5af2', label: 'Purple' },
  { value: '#ff375f', label: 'Pink' }
];

const THEMES = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'warm', label: 'Warm' }
];

const TITLE_FORMATS = [
  { value: 'timestamp', label: 'Timestamp (e.g. New Note 1707...)' },
  { value: 'untitled', label: 'Untitled' },
  { value: 'date', label: 'Date (e.g. 2026-02-10)' }
];

const TERMINAL_POSITIONS = [
  { value: 'bottom', label: 'Bottom' },
  { value: 'right', label: 'Right Pane' }
];

const FONT_FAMILIES = [
  { value: 'systemSans', label: 'System Sans' },
  { value: 'systemRounded', label: 'System Rounded' },
  { value: 'inter', label: 'Inter' },
  { value: 'sourceSans', label: 'Source Sans' },
  { value: 'notoSans', label: 'Noto Sans' },
  { value: 'georgia', label: 'Georgia' },
  { value: 'serif', label: 'Serif' },
  { value: 'charter', label: 'Charter' },
  { value: 'sourceSerif', label: 'Source Serif' },
  { value: 'atkinson', label: 'Atkinson Hyperlegible' },
  { value: 'humanist', label: 'Humanist Sans' },
  { value: 'jetbrainsMono', label: 'JetBrains Mono' },
  { value: 'mono', label: 'Monospace' }
];

function ColorSwatch({ colors, value, onChange }) {
  return (
    <div className="setting-colors">
      {colors.map((color) => (
        <button
          key={color.value}
          className={`color-swatch ${value === color.value ? 'active' : ''}`}
          style={{ '--swatch-color': color.value }}
          onClick={() => onChange(color.value)}
          title={color.label}
        />
      ))}
    </div>
  );
}

function SettingRow({ label, description, children }) {
  return (
    <div className="setting-row">
      <div className="setting-info">
        <span className="setting-label">{label}</span>
        {description && <span className="setting-desc">{description}</span>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

export default function SettingsPanel({
  settings,
  onSettingsChange,
  syncConfig,
  syncBusy,
  syncStatus,
  onSyncNow,
  onSyncTokenSave,
  onSyncTokenClear,
  onSyncInit,
  onSyncSetRemote,
  onSyncCreateRepo,
  onClose
}) {
  const [tokenDraft, setTokenDraft] = useState('');
  const [remoteDraft, setRemoteDraft] = useState('');
  const [repoNameDraft, setRepoNameDraft] = useState('');
  const [repoPrivate, setRepoPrivate] = useState(true);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [remoteMode, setRemoteMode] = useState('create');

  const [appVersion, setAppVersion] = useState('');
  const [updateStatus, setUpdateStatus] = useState(null); // { state, version?, percent?, message? }

  useEffect(() => {
    window.ngobs.updater.getVersion().then(setAppVersion);
    const unsub = window.ngobs.updater.onStatus(setUpdateStatus);
    return unsub;
  }, []);

  const handleCheckForUpdates = useCallback(async () => {
    setUpdateStatus({ state: 'checking' });
    try {
      await window.ngobs.updater.check();
    } catch (err) {
      setUpdateStatus({ state: 'error', message: err?.message || 'Update check failed.' });
    }
  }, []);

  const handleDownloadUpdate = useCallback(async () => {
    try {
      await window.ngobs.updater.download();
    } catch (err) {
      setUpdateStatus({ state: 'error', message: err?.message || 'Download failed.' });
    }
  }, []);

  const handleInstallUpdate = useCallback(() => {
    window.ngobs.updater.install();
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="settings-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings-modal">
        <div className="settings-header">
          <h3>Settings</h3>
          <button className="settings-close" onClick={onClose}><X size={14} /></button>
        </div>
        <Tabs defaultValue="editor" className="settings-body">
          <TabsList className="settings-nav">
            <TabsTrigger value="editor">Editor</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>

          <div className="settings-content">
            <TabsContent value="editor">
              <SettingRow label="Font Size" description="Editor text size in pixels">
                <div className="setting-range">
                  <input
                    type="range"
                    min={12}
                    max={24}
                    step={1}
                    value={settings.editorFontSize}
                    onChange={(e) => onSettingsChange('editorFontSize', Number(e.target.value))}
                  />
                  <span className="range-value">{settings.editorFontSize}px</span>
                </div>
              </SettingRow>
              <SettingRow label="Line Height" description="Spacing between lines">
                <div className="setting-range">
                  <input
                    type="range"
                    min={1.3}
                    max={2.2}
                    step={0.1}
                    value={settings.editorLineHeight}
                    onChange={(e) => onSettingsChange('editorLineHeight', Number(e.target.value))}
                  />
                  <span className="range-value">{settings.editorLineHeight.toFixed(1)}</span>
                </div>
              </SettingRow>
              <SettingRow label="Font Family" description="Type face used for notes while editing and reading">
                <Select
                  value={settings.editorFontFamily}
                  onValueChange={(v) => onSettingsChange('editorFontFamily', v)}
                >
                  <SelectTrigger className="setting-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FONT_FAMILIES.map((font) => (
                      <SelectItem key={font.value} value={font.value}>{font.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
              <SettingRow label="Spellcheck" description="Check spelling while editing">
                <Switch
                  checked={settings.editorSpellcheck}
                  onCheckedChange={(v) => onSettingsChange('editorSpellcheck', v)}
                />
              </SettingRow>
            </TabsContent>

            <TabsContent value="appearance">
              <SettingRow label="Theme" description="Switch between dark, light, and warm modes">
                <Select
                  value={settings.theme}
                  onValueChange={(v) => onSettingsChange('theme', v)}
                >
                  <SelectTrigger className="setting-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {THEMES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
              <SettingRow label="Accent Color" description="Theme color used throughout the app">
                <ColorSwatch
                  colors={ACCENT_COLORS}
                  value={settings.accentColor}
                  onChange={(v) => onSettingsChange('accentColor', v)}
                />
              </SettingRow>
              <SettingRow label="Content Width" description="Maximum reading width in pixels">
                <div className="setting-range">
                  <input
                    type="range"
                    min={560}
                    max={1400}
                    step={10}
                    value={settings.contentWidth}
                    onChange={(e) => onSettingsChange('contentWidth', Number(e.target.value))}
                  />
                  <span className="range-value">{settings.contentWidth}px</span>
                </div>
              </SettingRow>
            </TabsContent>

            <TabsContent value="general">
              <SettingRow label="New Note Title" description="Default naming for new notes">
                <Select
                  value={settings.newNoteTitleFormat}
                  onValueChange={(v) => onSettingsChange('newNoteTitleFormat', v)}
                >
                  <SelectTrigger className="setting-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TITLE_FORMATS.map((fmt) => (
                      <SelectItem key={fmt.value} value={fmt.value}>{fmt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
              <SettingRow label="Terminal Position" description="Choose where the terminal pane opens">
                <Select
                  value={settings.terminalPosition}
                  onValueChange={(v) => onSettingsChange('terminalPosition', v)}
                >
                  <SelectTrigger className="setting-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TERMINAL_POSITIONS.map((pos) => (
                      <SelectItem key={pos.value} value={pos.value}>{pos.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
              <SettingRow
                label="Vault GitHub Sync"
                description={
                  syncConfig?.enabled
                    ? `Repo: ${syncConfig.repoSlug || 'origin'} (${syncConfig.branch || 'unknown branch'})`
                    : !syncConfig?.isRepo
                      ? 'Initialize a git repository to enable sync.'
                      : (syncConfig?.reason || 'Add a GitHub remote to enable sync.')
                }
              >
                <div className="setting-stacked">
                  {!syncConfig?.isRepo && (
                    <>
                      <Button
                        className="setting-action-btn"
                        disabled={setupBusy}
                        onClick={async () => {
                          try {
                            setSetupBusy(true);
                            setSetupError('');
                            await onSyncInit();
                          } catch (e) {
                            setSetupError(e?.message || 'Failed to initialize repository.');
                          } finally {
                            setSetupBusy(false);
                          }
                        }}
                      >
                        {setupBusy ? 'Initializing...' : 'Initialize Git Repository'}
                      </Button>
                      {setupError ? <div className="setting-status-text setting-error-text">{setupError}</div> : null}
                    </>
                  )}

                  {syncConfig?.isRepo && !syncConfig?.enabled && (
                    <>
                      <Input
                        className="setting-input"
                        type="password"
                        autoComplete="off"
                        placeholder="GitHub personal access token"
                        value={tokenDraft}
                        onChange={(e) => setTokenDraft(e.target.value)}
                        disabled={setupBusy}
                      />

                      <div className="setting-tab-row">
                        <Button
                          variant={remoteMode === 'create' ? 'default' : 'ghost'}
                          size="sm"
                          onClick={() => { setRemoteMode('create'); setSetupError(''); }}
                        >
                          Create New
                        </Button>
                        <Button
                          variant={remoteMode === 'link' ? 'default' : 'ghost'}
                          size="sm"
                          onClick={() => { setRemoteMode('link'); setSetupError(''); }}
                        >
                          Link Existing
                        </Button>
                      </div>

                      {remoteMode === 'create' && (
                        <>
                          <Input
                            className="setting-input"
                            type="text"
                            autoComplete="off"
                            placeholder="Repository name (optional, defaults to vault name)"
                            value={repoNameDraft}
                            onChange={(e) => setRepoNameDraft(e.target.value)}
                            disabled={setupBusy}
                          />
                          <div className="setting-inline-actions">
                            <label className="setting-checkbox">
                              <input
                                type="checkbox"
                                checked={repoPrivate}
                                onChange={(e) => setRepoPrivate(e.target.checked)}
                                disabled={setupBusy}
                              />
                              <span>Private repository</span>
                            </label>
                          </div>
                          <Button
                            className="setting-action-btn"
                            disabled={setupBusy || !tokenDraft.trim()}
                            onClick={async () => {
                              try {
                                setSetupBusy(true);
                                setSetupError('');
                                await onSyncCreateRepo(tokenDraft.trim(), repoNameDraft.trim(), repoPrivate);
                                setTokenDraft('');
                                setRepoNameDraft('');
                              } catch (e) {
                                setSetupError(e?.message || 'Failed to create repository.');
                              } finally {
                                setSetupBusy(false);
                              }
                            }}
                          >
                            {setupBusy ? 'Creating...' : 'Create Repository on GitHub'}
                          </Button>
                        </>
                      )}

                      {remoteMode === 'link' && (
                        <>
                          <Input
                            className="setting-input"
                            type="text"
                            autoComplete="off"
                            placeholder="https://github.com/user/repo.git"
                            value={remoteDraft}
                            onChange={(e) => setRemoteDraft(e.target.value)}
                            disabled={setupBusy}
                          />
                          <Button
                            className="setting-action-btn"
                            disabled={setupBusy || !tokenDraft.trim() || !remoteDraft.trim()}
                            onClick={async () => {
                              try {
                                setSetupBusy(true);
                                setSetupError('');
                                await onSyncSetRemote(remoteDraft.trim());
                                await onSyncTokenSave(tokenDraft.trim());
                                setRemoteDraft('');
                                setTokenDraft('');
                              } catch (e) {
                                setSetupError(e?.message || 'Failed to link repository.');
                              } finally {
                                setSetupBusy(false);
                              }
                            }}
                          >
                            {setupBusy ? 'Linking...' : 'Link Repository'}
                          </Button>
                        </>
                      )}

                      {setupError ? <div className="setting-status-text setting-error-text">{setupError}</div> : null}
                    </>
                  )}

                  {syncConfig?.enabled && (
                    <>
                      <Input
                        className="setting-input"
                        type="password"
                        autoComplete="off"
                        placeholder={syncConfig?.hasToken ? 'Token saved. Enter new token to rotate.' : 'GitHub personal access token'}
                        value={tokenDraft}
                        onChange={(e) => setTokenDraft(e.target.value)}
                        disabled={tokenBusy}
                      />
                      <div className="setting-inline-actions">
                        <Button
                          size="sm"
                          disabled={tokenBusy || !tokenDraft.trim()}
                          onClick={async () => {
                            try {
                              setTokenBusy(true);
                              await onSyncTokenSave(tokenDraft.trim());
                              setTokenDraft('');
                            } finally {
                              setTokenBusy(false);
                            }
                          }}
                        >
                          Save Token
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={tokenBusy || !syncConfig?.hasToken}
                          onClick={async () => {
                            try {
                              setTokenBusy(true);
                              await onSyncTokenClear();
                              setTokenDraft('');
                            } finally {
                              setTokenBusy(false);
                            }
                          }}
                        >
                          Clear Token
                        </Button>
                        <Button
                          size="sm"
                          disabled={syncBusy || !syncConfig?.hasToken}
                          onClick={() => onSyncNow()}
                        >
                          {syncBusy ? 'Syncing...' : 'Sync Now'}
                        </Button>
                      </div>
                    </>
                  )}
                  {(syncStatus || setupError) ? <div className="setting-status-text">{setupError || syncStatus}</div> : null}
                </div>
              </SettingRow>
            </TabsContent>

            <TabsContent value="about">
              <div className="settings-about">
                <div className="about-name">Agno</div>
                <div className="about-version">Version {appVersion || '...'}</div>
                <div className="about-desc">A native macOS knowledge app for writing, linking, and thinking.</div>

                <div className="about-update">
                  {(!updateStatus || updateStatus.state === 'error' || updateStatus.state === 'up-to-date') && (
                    <Button
                      className="setting-action-btn"
                      onClick={handleCheckForUpdates}
                    >
                      <RefreshCw size={14} />
                      Check for Updates
                    </Button>
                  )}

                  {updateStatus?.state === 'checking' && (
                    <div className="update-status">
                      <RefreshCw size={14} className="update-spinner" />
                      <span>Checking for updates...</span>
                    </div>
                  )}

                  {updateStatus?.state === 'up-to-date' && (
                    <div className="update-status update-success">
                      You're up to date!
                    </div>
                  )}

                  {updateStatus?.state === 'available' && (
                    <div className="update-status">
                      <span>Version {updateStatus.version} is available.</span>
                      <Button className="setting-action-btn" onClick={handleDownloadUpdate}>
                        <Download size={14} />
                        Download Update
                      </Button>
                    </div>
                  )}

                  {updateStatus?.state === 'downloading' && (
                    <div className="update-status">
                      <span>Downloading... {updateStatus.percent}%</span>
                      <div className="update-progress-bar">
                        <div
                          className="update-progress-fill"
                          style={{ width: `${updateStatus.percent || 0}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {updateStatus?.state === 'downloaded' && (
                    <div className="update-status">
                      <span>Update ready to install{updateStatus.version ? ` (v${updateStatus.version})` : ''}.</span>
                      <Button className="setting-action-btn" onClick={handleInstallUpdate}>
                        <RotateCcw size={14} />
                        Install &amp; Restart
                      </Button>
                    </div>
                  )}

                  {updateStatus?.state === 'error' && (
                    <div className="update-status update-error">
                      {updateStatus.message || 'Update check failed.'}
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
