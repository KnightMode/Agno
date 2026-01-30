import React, { useEffect, useMemo, useState } from 'react';
import { X, RotateCcw, Copy } from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const wikiPattern = /\[\[([^\]]+)\]\]/g;

function wikify(markdownText) {
  return markdownText.replace(wikiPattern, (_match, title) => {
    const clean = (title || '').trim();
    return `<a href="#" data-wiki="${clean}">${clean}</a>`;
  });
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta: null, body: text };

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

  return { meta: Object.keys(meta).length > 0 ? meta : null, body };
}

function formatTimestamp(ts) {
  const date = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  if (date >= today) return `Today ${time}`;
  if (date >= yesterday) return `Yesterday ${time}`;

  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
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

export default function HistoryPanel({ currentPath, content, isDirty, onRestore, onClose }) {
  const [versions, setVersions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState('');
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!currentPath) return;
    window.ngobs.history.list(currentPath).then((list) => {
      setVersions(list);
      if (list.length > 0) setSelected(list[0].timestamp);
    });
  }, [currentPath]);

  useEffect(() => {
    if (selected === null || selected === 'current') {
      setPreview(content);
      return;
    }
    window.ngobs.history.get(currentPath, selected).then((v) => setPreview(v.content));
  }, [selected, currentPath, content]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { meta, body } = useMemo(() => parseFrontmatter(preview || ''), [preview]);

  const renderedBody = useMemo(() => {
    if (showRaw) return null;
    return DOMPurify.sanitize(marked.parse(wikify(body || '')), { ADD_ATTR: ['data-wiki'] });
  }, [body, showRaw]);

  const handleRestore = async () => {
    if (selected === null || selected === 'current') return;
    onRestore(preview);
    onClose();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(preview);
  };

  const allItems = [];
  if (isDirty) {
    allItems.push({ timestamp: 'current', label: 'Current (unsaved)' });
  }
  for (const v of versions) {
    allItems.push({ timestamp: v.timestamp, label: formatTimestamp(v.timestamp) });
  }

  return (
    <div className="history-overlay" onClick={onClose}>
      <div className="history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="history-header">
          <h3>Version History</h3>
          <span className="history-note-name">{currentPath?.split('/').pop()?.replace(/\.md$/, '')}</span>
          <button className="history-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="history-body">
          <div className="history-list">
            {allItems.length === 0 && (
              <div className="history-empty">No versions yet</div>
            )}
            {allItems.map((item) => (
              <button
                key={item.timestamp}
                className={`history-item ${selected === item.timestamp ? 'active' : ''}`}
                onClick={() => setSelected(item.timestamp)}
              >
                <span className="history-item-label">{item.label}</span>
                {item.timestamp !== 'current' && (
                  <span className="history-item-sub">
                    {new Date(item.timestamp).toLocaleString()}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="history-preview-col">
            <div className="history-preview-toggle">
              <button
                className={!showRaw ? 'active' : ''}
                onClick={() => setShowRaw(false)}
              >Preview</button>
              <button
                className={showRaw ? 'active' : ''}
                onClick={() => setShowRaw(true)}
              >Raw</button>
            </div>
            <div className="history-preview">
              {showRaw ? (
                <pre className="history-raw">{preview}</pre>
              ) : (
                <div className="prose-wrapper" style={{ maxWidth: '100%' }}>
                  <FrontmatterPanel meta={meta} />
                  <div className="prose" dangerouslySetInnerHTML={{ __html: renderedBody }} />
                </div>
              )}
            </div>
            <div className="history-actions">
              <button className="history-restore-btn" onClick={handleRestore} disabled={selected === 'current' || selected === null}>
                <RotateCcw size={13} />
                Restore
              </button>
              <button className="history-copy-btn" onClick={handleCopy}>
                <Copy size={13} />
                Copy
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
