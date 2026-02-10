import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

const CATEGORIES = [
  { id: 'editor', label: 'Editor' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'general', label: 'General' },
  { id: 'about', label: 'About' }
];

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

function Toggle({ checked, onChange }) {
  return (
    <button
      className={`setting-toggle ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span className="toggle-knob" />
    </button>
  );
}

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
  const [category, setCategory] = useState('editor');
  const [tokenDraft, setTokenDraft] = useState('');
  const [remoteDraft, setRemoteDraft] = useState('');
  const [repoNameDraft, setRepoNameDraft] = useState('');
  const [repoPrivate, setRepoPrivate] = useState(true);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [remoteMode, setRemoteMode] = useState('create');
  const modalRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" ref={modalRef} onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3>Settings</h3>
          <button className="settings-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="settings-body">
          <nav className="settings-nav">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                className={category === cat.id ? 'active' : ''}
                onClick={() => setCategory(cat.id)}
              >
                {cat.label}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {category === 'editor' && (
              <>
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
                  <select
                    className="setting-select"
                    value={settings.editorFontFamily}
                    onChange={(e) => onSettingsChange('editorFontFamily', e.target.value)}
                  >
                    {FONT_FAMILIES.map((font) => (
                      <option key={font.value} value={font.value}>{font.label}</option>
                    ))}
                  </select>
                </SettingRow>
                <SettingRow label="Spellcheck" description="Check spelling while editing">
                  <Toggle
                    checked={settings.editorSpellcheck}
                    onChange={(v) => onSettingsChange('editorSpellcheck', v)}
                  />
                </SettingRow>
              </>
            )}
            {category === 'appearance' && (
              <>
                <SettingRow label="Theme" description="Switch between dark, light, and warm modes">
                  <select
                    className="setting-select"
                    value={settings.theme}
                    onChange={(e) => onSettingsChange('theme', e.target.value)}
                  >
                    {THEMES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
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
              </>
            )}
            {category === 'general' && (
              <>
                <SettingRow label="New Note Title" description="Default naming for new notes">
                  <select
                    className="setting-select"
                    value={settings.newNoteTitleFormat}
                    onChange={(e) => onSettingsChange('newNoteTitleFormat', e.target.value)}
                  >
                    {TITLE_FORMATS.map((fmt) => (
                      <option key={fmt.value} value={fmt.value}>{fmt.label}</option>
                    ))}
                  </select>
                </SettingRow>
                <SettingRow label="Terminal Position" description="Choose where the terminal pane opens">
                  <select
                    className="setting-select"
                    value={settings.terminalPosition}
                    onChange={(e) => onSettingsChange('terminalPosition', e.target.value)}
                  >
                    {TERMINAL_POSITIONS.map((position) => (
                      <option key={position.value} value={position.value}>{position.label}</option>
                    ))}
                  </select>
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
                    {/* Step 1: Init git repo if needed */}
                    {!syncConfig?.isRepo && (
                      <>
                        <button
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
                          {setupBusy ? 'Initializing…' : 'Initialize Git Repository'}
                        </button>
                        {setupError ? <div className="setting-status-text setting-error-text">{setupError}</div> : null}
                      </>
                    )}

                    {/* Step 2: Connect to GitHub if repo exists but no remote */}
                    {syncConfig?.isRepo && !syncConfig?.enabled && (
                      <>
                        <input
                          className="setting-input"
                          type="password"
                          autoComplete="off"
                          placeholder="GitHub personal access token"
                          value={tokenDraft}
                          onChange={(e) => setTokenDraft(e.target.value)}
                          disabled={setupBusy}
                        />

                        <div className="setting-tab-row">
                          <button
                            className={`setting-tab ${remoteMode === 'create' ? 'active' : ''}`}
                            onClick={() => { setRemoteMode('create'); setSetupError(''); }}
                          >
                            Create New
                          </button>
                          <button
                            className={`setting-tab ${remoteMode === 'link' ? 'active' : ''}`}
                            onClick={() => { setRemoteMode('link'); setSetupError(''); }}
                          >
                            Link Existing
                          </button>
                        </div>

                        {remoteMode === 'create' && (
                          <>
                            <input
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
                            <button
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
                              {setupBusy ? 'Creating…' : 'Create Repository on GitHub'}
                            </button>
                          </>
                        )}

                        {remoteMode === 'link' && (
                          <>
                            <input
                              className="setting-input"
                              type="text"
                              autoComplete="off"
                              placeholder="https://github.com/user/repo.git"
                              value={remoteDraft}
                              onChange={(e) => setRemoteDraft(e.target.value)}
                              disabled={setupBusy}
                            />
                            <button
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
                              {setupBusy ? 'Linking…' : 'Link Repository'}
                            </button>
                          </>
                        )}

                        {setupError ? <div className="setting-status-text setting-error-text">{setupError}</div> : null}
                      </>
                    )}

                    {/* Step 3: Token + sync when fully configured */}
                    {syncConfig?.enabled && (
                      <>
                        <input
                          className="setting-input"
                          type="password"
                          autoComplete="off"
                          placeholder={syncConfig?.hasToken ? 'Token saved. Enter new token to rotate.' : 'GitHub personal access token'}
                          value={tokenDraft}
                          onChange={(e) => setTokenDraft(e.target.value)}
                          disabled={tokenBusy}
                        />
                        <div className="setting-inline-actions">
                          <button
                            className="setting-action-btn"
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
                          </button>
                          <button
                            className="setting-action-btn secondary"
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
                          </button>
                          <button
                            className="setting-action-btn"
                            disabled={syncBusy || !syncConfig?.hasToken}
                            onClick={() => onSyncNow()}
                          >
                            {syncBusy ? 'Syncing…' : 'Sync Now'}
                          </button>
                        </div>
                      </>
                    )}
                    {(syncStatus || setupError) ? <div className="setting-status-text">{setupError || syncStatus}</div> : null}
                  </div>
                </SettingRow>
              </>
            )}
            {category === 'about' && (
              <div className="settings-about">
                <div className="about-name">Agno</div>
                <div className="about-version">Version 1.0.0</div>
                <div className="about-desc">A native macOS knowledge app for writing, linking, and thinking.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
