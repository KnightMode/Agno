import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Copy, Send } from 'lucide-react';
import { Button } from './ui/button';
import { renderMarkdownHtml } from '../lib/renderMarkdown';

function ChatBubble({ message, onOpenPath }) {
  const [copied, setCopied] = useState(false);
  const renderedHtml = useMemo(() => {
    if (message.role !== 'assistant') return '';
    return renderMarkdownHtml(message.content);
  }, [message.content, message.role]);

  useEffect(() => {
    if (!copied) return undefined;
    const id = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(id);
  }, [copied]);

  const copyResponse = async () => {
    if (!message.content) return;
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
  };

  return (
    <div className={`note-chat-message ${message.role === 'user' ? 'user' : 'assistant'}`}>
      <div className={`note-chat-bubble ${message.role === 'user' ? 'user' : 'assistant'}`}>
        <div className="note-chat-bubble-head">
          <span className="note-chat-role">{message.role === 'user' ? 'You' : 'Agent'}</span>
          {message.role === 'assistant' ? (
            <button className="note-chat-copy-btn" onClick={copyResponse}>
              <Copy size={12} />
              {copied ? 'Copied' : 'Copy'}
            </button>
          ) : null}
        </div>
        {message.role === 'assistant' ? (
          <>
            <div
              className="note-chat-text prose note-chat-markdown"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
            {message.createdNote?.openedPath ? (
              <div className="note-chat-tool-card">
                <div className="note-chat-tool-copy">
                  <strong>Created note</strong>
                  <span>{message.createdNote.openedPath}</span>
                </div>
                <button onClick={() => onOpenPath?.(message.createdNote.openedPath)}>
                  Open
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="note-chat-text">{message.content}</div>
        )}
      </div>
    </div>
  );
}

export default function NoteChatPanel({
  currentPath,
  currentContent,
  model,
  hasOpenRouterKey,
  onOpenPath
}) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const threadRef = useRef(null);
  const noteLabel = currentPath ? currentPath.replace(/\.md$/, '').split('/').pop() : 'Current note';
  const notePathLabel = currentPath || 'Unsaved note';
  const modelLabel = model ? model.split('/').pop() || model : '';
  const starterPrompts = useMemo(() => ([
    `Summarize ${noteLabel} in plain English`,
    `What is the key takeaway from ${noteLabel}?`,
    `What links or notes are missing here?`,
    `Turn this note into a short checklist`
  ]), [noteLabel]);

  useEffect(() => {
    setMessages([]);
    setDraft('');
    setError('');
    setBusy(false);
  }, [currentPath]);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    const id = window.requestAnimationFrame(() => {
      thread.scrollTo({
        top: thread.scrollHeight,
        behavior: 'smooth'
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [messages, busy]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (!hasOpenRouterKey) {
      setError('Add an OpenRouter key in Settings to use note chat.');
      return;
    }
    if (!model) {
      setError('Select an OpenRouter model in Settings first.');
      return;
    }

    const nextMessages = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setDraft('');
    setBusy(true);
    setError('');

    try {
      const result = await window.ngobs.agent.chat({
        model,
        currentPath,
        currentContent,
        messages: nextMessages
      });
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: result.content || (result.createdNote ? result.createdNote.message : 'No response.'),
          createdNote: result.createdNote || null
        }
      ]);
    } catch (err) {
      setError(err?.message || 'Note chat failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="note-chat-panel">
      <div className="note-chat-head">
        <div className="note-chat-mark">
          <Bot size={14} />
        </div>
        <div className="note-chat-head-copy">
          <div className="note-chat-title-row">
            <div className="note-chat-title">Ask This Note</div>
            <span className="note-chat-chip">Live</span>
          </div>
          <span className="note-chat-note" title={notePathLabel}>{noteLabel}</span>
          <div className="note-chat-meta-row">
            <span className="note-chat-note-path" title={notePathLabel}>{notePathLabel}</span>
            {modelLabel ? (
              <>
                <span className="note-chat-meta-sep">•</span>
                <span className="note-chat-model" title={model}>{modelLabel}</span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {error ? <div className="note-chat-status error">{error}</div> : null}

      <div className="note-chat-thread" ref={threadRef}>
        {messages.length ? (
          messages.map((message, index) => (
            <ChatBubble key={`${message.role}-${index}`} message={message} onOpenPath={onOpenPath} />
          ))
        ) : (
          <div className="note-chat-empty-state">
            <div className="note-chat-empty-copy">
              <strong>Ask for explanation, critique, or next steps.</strong>
              <p>Responses use the visible note content plus nearby vault context.</p>
            </div>
            <div className="note-chat-prompt-grid">
              {starterPrompts.map((prompt) => (
                <button key={prompt} className="note-chat-prompt" onClick={() => setDraft(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
        {busy ? <div className="note-chat-thinking">Thinking...</div> : null}
      </div>

      <div className="note-chat-composer">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask a follow-up about this note"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className="note-chat-compose-actions">
          <span className="note-chat-compose-hint">Enter to send</span>
          <Button variant="primary" size="sm" onClick={send} disabled={busy || !draft.trim()}>
            <Send size={14} />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
