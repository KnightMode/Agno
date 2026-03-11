import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Bot,
  ClipboardList,
  FileSearch,
  GitBranch,
  Link2,
  Copy,
  RefreshCw,
  Send,
  Sparkles,
  Wrench,
  Clock
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { renderMarkdownHtml } from '../lib/renderMarkdown';

function StatCard({ label, value, hint }) {
  return (
    <div className="agent-stat-card">
      <span className="agent-stat-label">{label}</span>
      <strong className="agent-stat-value">{value}</strong>
      <span className="agent-stat-hint">{hint}</span>
    </div>
  );
}

function ItemLink({ path, title, onNavigate }) {
  return (
    <button className="agent-item-link" onClick={() => onNavigate(path)}>
      <span>{title || path.replace(/\.md$/, '').split('/').pop()}</span>
      <span>{path}</span>
    </button>
  );
}

function OverviewList({ title, icon: Icon, items, empty, onNavigate, onChat, renderMeta }) {
  return (
    <section className="agent-section">
      <div className="agent-section-head">
        <div className="agent-section-title">
          <Icon size={14} />
          <span>{title}</span>
        </div>
      </div>
      {items?.length ? (
        <div className="agent-list">
          {items.map((item) => (
            <div className="agent-list-item" key={item.path || item.id || JSON.stringify(item)}>
              {item.path ? <ItemLink path={item.path} title={item.title} onNavigate={onNavigate} /> : <div className="agent-list-title">{item.title}</div>}
              {renderMeta ? <div className="agent-list-meta">{renderMeta(item)}</div> : null}
              {item.path && onChat ? (
                <div className="agent-list-actions">
                  <Button variant="ghost" size="sm" onClick={() => onChat(item.path)}>Chat</Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="agent-empty">{empty}</div>
      )}
    </section>
  );
}

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
    <div className={`agent-chat-bubble ${message.role === 'user' ? 'user' : 'assistant'}`}>
      <div className="agent-chat-bubble-head">
        <span className="agent-chat-role">{message.role === 'user' ? 'You' : 'Agent'}</span>
        {message.role === 'assistant' ? (
          <button className="agent-chat-copy-btn" onClick={copyResponse}>
            <Copy size={12} />
            {copied ? 'Copied' : 'Copy'}
          </button>
        ) : null}
      </div>
      {message.role === 'assistant' ? (
        <>
          <div
            className="agent-chat-text prose agent-chat-markdown"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
          {message.createdNote?.openedPath ? (
            <div className="agent-chat-tool-card">
              <div className="agent-chat-tool-copy">
                <strong>Created note</strong>
                <span>{message.createdNote.openedPath}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => onOpenPath?.(message.createdNote.openedPath)}>
                Open
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="agent-chat-text">{message.content}</div>
      )}
    </div>
  );
}

function PromptButton({ prompt, onSelect }) {
  return (
    <button className="agent-prompt-card" onClick={() => onSelect(prompt)}>
      <span>{prompt}</span>
    </button>
  );
}

function CompactRecentNotes({ items, onNavigate, onChat }) {
  return (
    <section className="agent-panel-card agent-chat-rail-list">
      <div className="agent-section-head">
        <div className="agent-section-title">
          <Clock size={14} />
          <span>Recent Notes</span>
        </div>
      </div>
      {items?.length ? (
        <div className="agent-compact-list">
          {items.map((item) => (
            <div className="agent-compact-item" key={item.path}>
              <button className="agent-compact-link" onClick={() => onNavigate(item.path)}>
                <strong>{item.title || item.path.replace(/\.md$/, '').split('/').pop()}</strong>
                <span>{item.path}</span>
                <em>{item.updatedLabel}  {item.wordCount} words</em>
              </button>
              <Button variant="ghost" size="sm" onClick={() => onChat(item.path)}>Chat</Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="agent-empty">No recent notes.</div>
      )}
    </section>
  );
}

export default function AgentPanel({
  sessionKey,
  initialTab = 'overview',
  currentPath,
  currentContent,
  contextPath,
  model,
  hasOpenRouterKey,
  isDirty,
  onNavigate,
  onOpenNoteChat,
  onAfterMutation,
  onBack
}) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [overview, setOverview] = useState(null);
  const [overviewBusy, setOverviewBusy] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const [actionBusyId, setActionBusyId] = useState('');
  const [actionStatus, setActionStatus] = useState('');
  const [vaultQuery, setVaultQuery] = useState('');
  const [vaultQueryBusy, setVaultQueryBusy] = useState(false);
  const [vaultQueryResult, setVaultQueryResult] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatDraft, setChatDraft] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState('');
  const chatThreadRef = useRef(null);
  const [ingestTitle, setIngestTitle] = useState('');
  const [ingestSource, setIngestSource] = useState('');
  const [ingestContent, setIngestContent] = useState('');

  const refreshOverview = useCallback(async () => {
    setOverviewBusy(true);
    setOverviewError('');
    try {
      const next = await window.ngobs.agent.overview();
      setOverview(next);
    } catch (error) {
      setOverviewError(error?.message || 'Unable to analyze vault.');
    } finally {
      setOverviewBusy(false);
    }
  }, []);

  useEffect(() => {
    setActiveTab(initialTab);
    setVaultQueryResult(null);
    setVaultQuery('');
    setChatError('');
    setChatDraft('');
    setChatMessages([]);
  }, [initialTab, sessionKey, contextPath]);

  useEffect(() => {
    refreshOverview();
  }, [refreshOverview]);

  useEffect(() => {
    const thread = chatThreadRef.current;
    if (!thread || activeTab !== 'chat') return;
    const id = window.requestAnimationFrame(() => {
      thread.scrollTo({
        top: thread.scrollHeight,
        behavior: 'smooth'
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [activeTab, chatBusy, chatMessages]);

  const summaryCards = useMemo(() => {
    if (!overview?.summary) return [];
    return [
      { label: 'Notes', value: overview.summary.noteCount, hint: 'Markdown files in vault' },
      { label: 'Broken Links', value: overview.summary.brokenLinkCount, hint: 'Resolvable graph issues' },
      { label: 'Orphans', value: overview.summary.orphanCount, hint: 'Notes with no in or out links' },
      { label: 'Open Tasks', value: overview.summary.openTaskCount, hint: 'Unchecked tasks detected' },
      { label: 'Stale', value: overview.summary.staleCount, hint: 'Untouched for 45 plus days' },
      { label: 'Untagged', value: overview.summary.untaggedCount, hint: 'No frontmatter or inline tags' }
    ];
  }, [overview]);

  const runMutation = useCallback(async (workId, runner) => {
    setActionBusyId(workId);
    setActionStatus('');
    try {
      const result = await runner();
      setActionStatus(result?.message || 'Agent action complete.');
      await onAfterMutation?.(result);
      await refreshOverview();
    } catch (error) {
      setActionStatus(error?.message || 'Agent action failed.');
    } finally {
      setActionBusyId('');
    }
  }, [onAfterMutation, refreshOverview]);

  const applySuggestion = useCallback(async (suggestion) => {
    const touchesCurrent =
      Boolean(currentPath) &&
      (suggestion?.sourcePath === currentPath || suggestion?.targetPath === currentPath);

    if (touchesCurrent && isDirty) {
      setActionStatus('Save or discard local edits before applying an agent action to the current note.');
      return;
    }

    await runMutation(suggestion.id, () => window.ngobs.agent.applySuggestion(suggestion));
  }, [currentPath, isDirty, runMutation]);

  const createReport = useCallback(async (kind) => {
    await runMutation(kind, () => window.ngobs.agent.createReport(kind));
  }, [runMutation]);

  const ingestResearch = useCallback(async () => {
    const payload = {
      title: ingestTitle.trim(),
      source: ingestSource.trim(),
      content: ingestContent.trim()
    };
    if (!payload.title || !payload.content) {
      setActionStatus('Research ingest needs a title and source material.');
      return;
    }

    await runMutation('ingest', () => window.ngobs.agent.ingestResearch(payload));
    setIngestTitle('');
    setIngestSource('');
    setIngestContent('');
  }, [ingestContent, ingestSource, ingestTitle, runMutation]);

  const runVaultQuery = useCallback(async () => {
    const query = vaultQuery.trim();
    if (!query) return;
    setVaultQueryBusy(true);
    setActionStatus('');
    try {
      const result = await window.ngobs.agent.ask(query, contextPath || currentPath);
      setVaultQueryResult(result);
    } catch (error) {
      setActionStatus(error?.message || 'Vault query failed.');
    } finally {
      setVaultQueryBusy(false);
    }
  }, [contextPath, currentPath, vaultQuery]);

  const sendChat = useCallback(async () => {
    const message = chatDraft.trim();
    if (!message || chatBusy) return;
    if (!hasOpenRouterKey) {
      setChatError('Add an OpenRouter key in Settings to use live agent chat.');
      return;
    }
    if (!model) {
      setChatError('Select an OpenRouter model in Settings before starting a chat.');
      return;
    }

    const nextMessages = [...chatMessages, { role: 'user', content: message }];
    setChatMessages(nextMessages);
    setChatDraft('');
    setChatBusy(true);
    setChatError('');

    try {
      const result = await window.ngobs.agent.chat({
        model,
        currentPath: contextPath || currentPath || '',
        currentContent: (contextPath || currentPath) === currentPath ? currentContent : '',
        messages: nextMessages
      });
      setChatMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: result.content || (result.createdNote ? result.createdNote.message : 'No response.'),
          createdNote: result.createdNote || null
        }
      ]);
      await onAfterMutation?.(result.createdNote || result);
    } catch (error) {
      setChatError(error?.message || 'Agent chat failed.');
    } finally {
      setChatBusy(false);
    }
  }, [chatBusy, chatDraft, chatMessages, contextPath, currentContent, currentPath, hasOpenRouterKey, model]);

  const contextLabel = contextPath ? contextPath.replace(/\.md$/, '').split('/').pop() : 'Whole vault';
  const focusCopy = contextPath
    ? 'Follow-ups will use the focused note, your live edits when available, and related vault notes.'
    : 'Use retrieval across the whole vault to surface notes, tasks, and references before diving into a note.';
  const hasLiveChat = Boolean(hasOpenRouterKey && model);

  const starterPrompts = useMemo(() => (
    contextPath
      ? [
          `Summarize the key idea in ${contextLabel}`,
          `What assumptions are weak in ${contextLabel}?`,
          `What notes should link to ${contextLabel}?`,
          `Turn ${contextLabel} into an action checklist`
        ]
      : [
          'What changed most in my vault recently?',
          'Which notes look stale but still important?',
          'Find duplicated ideas I should consolidate',
          'What projects have open tasks but no recent updates?'
        ]
  ), [contextLabel, contextPath]);

  const recentNotes = overview?.recent?.slice(0, 3) || [];

  return (
    <div className="agent-screen">
      <div className="agent-hero">
        <div className="agent-hero-main">
          <div className="agent-title-wrap">
            <Button variant="ghost" size="icon" className="agent-back-btn" onClick={onBack} title="Back to note">
              <ArrowLeft size={14} />
            </Button>
            <div className="agent-title-mark">
              <Bot size={18} />
            </div>
            <div className="agent-hero-copy">
              <span className="agent-eyebrow">Vault Operator</span>
              <div className="agent-screen-title">Agent Workspace</div>
              <div className="agent-screen-subtitle">
                Search, repair, review, and chat across the vault without losing note context.
              </div>
            </div>
          </div>

          <div className="agent-chip-row">
            <span className="agent-chip accent">{contextPath ? `Focused on ${contextLabel}` : 'Vault-wide mode'}</span>
            <span className="agent-chip">{model || 'No model selected'}</span>
            <span className={`agent-chip ${hasOpenRouterKey ? 'success' : 'warning'}`}>
              {hasOpenRouterKey ? 'OpenRouter ready' : 'OpenRouter key missing'}
            </span>
          </div>
        </div>

        <div className="agent-head-actions">
          <Button variant="ghost" size="sm" onClick={refreshOverview} disabled={overviewBusy}>
            <RefreshCw size={14} className={overviewBusy ? 'spin' : ''} />
            Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={onBack}>
            Return to note
          </Button>
        </div>
      </div>

      <div className="agent-tabs">
        <button className={activeTab === 'chat' ? 'active' : ''} onClick={() => setActiveTab('chat')}>Chat</button>
        <button className={activeTab === 'overview' ? 'active' : ''} onClick={() => setActiveTab('overview')}>Overview</button>
        <button className={activeTab === 'search' ? 'active' : ''} onClick={() => setActiveTab('search')}>Vault Search</button>
        <button className={activeTab === 'ingest' ? 'active' : ''} onClick={() => setActiveTab('ingest')}>Research Ingest</button>
      </div>

      {actionStatus ? <div className="agent-status">{actionStatus}</div> : null}
      {overviewError ? <div className="agent-status error">{overviewError}</div> : null}
      {chatError ? <div className="agent-status error">{chatError}</div> : null}

      <div className="agent-body">
        {activeTab === 'chat' && (
          <div className="agent-chat-layout">
            <div className="agent-chat-sidebar">
              <section className="agent-panel-card agent-focus-panel">
                <span className="agent-panel-kicker">Chat context</span>
                <div className="agent-focus-head">
                  <div>
                    <h3>{contextLabel}</h3>
                    <p>{focusCopy}</p>
                  </div>
                  <div className="agent-focus-badge">
                    <span>{contextPath ? 'Focused note' : 'Vault mode'}</span>
                  </div>
                </div>
                <div className="agent-chip-row">
                  <span className={`agent-chip ${hasLiveChat ? 'success' : 'warning'}`}>
                    {hasLiveChat ? 'Live model connected' : 'Model setup required'}
                  </span>
                  {currentPath ? <span className="agent-chip">Current note ready</span> : null}
                </div>
                <div className="agent-inline-actions">
                  {currentPath && currentPath !== contextPath ? (
                    <Button variant="ghost" size="sm" onClick={() => onOpenNoteChat(currentPath)}>
                      Use current note
                    </Button>
                  ) : null}
                  {contextPath ? (
                    <Button variant="ghost" size="sm" onClick={() => onOpenNoteChat('')}>
                      Switch to whole vault
                    </Button>
                  ) : null}
                </div>
              </section>

              <section className="agent-panel-card agent-chat-prompts-panel">
                <div className="agent-section-head">
                  <div className="agent-section-title">
                    <Sparkles size={14} />
                    <span>Starter prompts</span>
                  </div>
                </div>
                <div className="agent-chat-prompt-stack">
                  {starterPrompts.map((prompt) => (
                    <PromptButton key={prompt} prompt={prompt} onSelect={setChatDraft} />
                  ))}
                </div>
              </section>

              <CompactRecentNotes
                items={recentNotes}
                onNavigate={onNavigate}
                onChat={onOpenNoteChat}
              />
            </div>

            <section className="agent-chat-stage">
              <div className="agent-stage-head agent-surface">
                <div className="agent-stage-copy">
                  <span className="agent-panel-kicker">Conversation</span>
                  <h3>{contextPath ? `Ask about ${contextLabel}` : 'Ask across the vault'}</h3>
                  <p>
                    {contextPath
                      ? 'Use this space for explanation, critique, linking ideas, or turning the note into next actions.'
                      : 'Use this space to interrogate the vault, connect notes, and decide what to open or fix next.'}
                  </p>
                </div>
                <div className="agent-stage-side">
                  <span className="agent-stage-meta">
                    {chatMessages.length ? `${chatMessages.length} messages` : 'Grounded with local vault context'}
                  </span>
                  <div className="agent-stage-chips">
                    <button className="agent-stage-chip" onClick={() => setChatDraft(starterPrompts[0])}>Summarize</button>
                    <button className="agent-stage-chip" onClick={() => setChatDraft(starterPrompts[1])}>Critique</button>
                    <button className="agent-stage-chip" onClick={() => setChatDraft(starterPrompts[2])}>Find links</button>
                  </div>
                </div>
              </div>

              <div className="agent-chat-thread agent-surface" ref={chatThreadRef}>
                {chatMessages.length ? (
                  chatMessages.map((message, index) => (
                    <ChatBubble key={`${message.role}-${index}`} message={message} onOpenPath={onNavigate} />
                  ))
                ) : (
                  <div className="agent-chat-empty-state">
                    <div className="agent-chat-empty-mark">
                      <Bot size={20} />
                    </div>
                    <div className="agent-chat-empty-copy">
                      <strong>{contextPath ? `Start a follow-up on ${contextLabel}` : 'Start a grounded vault conversation'}</strong>
                      <p>
                        {contextPath
                          ? 'Use the prompts on the left or ask directly about structure, missing links, or next edits.'
                          : 'Ask for summaries, stale notes, missing links, or the best note to open next.'}
                      </p>
                    </div>
                    <div className="agent-chat-hero-grid">
                      {starterPrompts.map((prompt) => (
                        <PromptButton key={`empty-${prompt}`} prompt={prompt} onSelect={setChatDraft} />
                      ))}
                    </div>
                  </div>
                )}
                {chatBusy ? <div className="agent-chat-thinking">Thinking...</div> : null}
              </div>

              <div className="agent-chat-composer agent-surface">
                <textarea
                  value={chatDraft}
                  onChange={(event) => setChatDraft(event.target.value)}
                  placeholder={contextPath ? `Ask about ${contextLabel}` : 'Ask the agent about your vault'}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      sendChat();
                    }
                  }}
                />
                <div className="agent-chat-compose-bar">
                  <span className="agent-chat-compose-hint">Enter to send. Shift+Enter for a new line.</span>
                  <Button variant="primary" size="sm" onClick={sendChat} disabled={chatBusy || !chatDraft.trim()}>
                    <Send size={14} />
                    Send
                  </Button>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'overview' && (
          <div className="agent-overview">
            <section className="agent-overview-banner">
              <div className="agent-overview-copy">
                <span className="agent-panel-kicker">Vault health</span>
                <h2>Keep the graph clean, current, and ready for follow-up work.</h2>
                <p>
                  Run local maintenance, spot broken structure, and generate review notes without leaving the vault.
                </p>
                <div className="agent-toolbar">
                  <Button variant="primary" size="sm" onClick={() => createReport('vault-review')} disabled={Boolean(actionBusyId)}>
                    <Sparkles size={14} />
                    Create Vault Review
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => createReport('project-pulse')} disabled={Boolean(actionBusyId)}>
                    <ClipboardList size={14} />
                    Create Project Pulse
                  </Button>
                </div>
              </div>

              <div className="agent-grid">
                {summaryCards.map((card) => (
                  <StatCard key={card.label} label={card.label} value={card.value} hint={card.hint} />
                ))}
              </div>
            </section>

            <div className="agent-columns">
              <div className="agent-column">
                <section className="agent-section">
                  <div className="agent-section-head">
                    <div className="agent-section-title">
                      <Wrench size={14} />
                      <span>Suggested Actions</span>
                    </div>
                  </div>
                  {overviewBusy ? (
                    <div className="agent-empty">Analyzing vault...</div>
                  ) : overview?.suggestions?.length ? (
                    <div className="agent-list">
                      {overview.suggestions.map((suggestion) => (
                        <div className="agent-suggestion" key={suggestion.id}>
                          <div className="agent-suggestion-copy">
                            <strong>{suggestion.title}</strong>
                            <span>{suggestion.description}</span>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => applySuggestion(suggestion)} disabled={actionBusyId === suggestion.id}>
                            {actionBusyId === suggestion.id ? 'Applying...' : 'Apply'}
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="agent-empty">No immediate maintenance actions detected.</div>
                  )}
                </section>

                <OverviewList
                  title="Broken Links"
                  icon={Link2}
                  items={overview?.brokenLinks}
                  empty="No broken wiki links detected."
                  onNavigate={onNavigate}
                  onChat={onOpenNoteChat}
                  renderMeta={(item) => (
                    <>
                      <span>Line {item.line}</span>
                      <span>[[{item.linkText}]]</span>
                    </>
                  )}
                />

                <OverviewList
                  title="Hub Notes"
                  icon={GitBranch}
                  items={overview?.hubs}
                  empty="No hub notes yet."
                  onNavigate={onNavigate}
                  onChat={onOpenNoteChat}
                  renderMeta={(item) => (
                    <>
                      <span>{item.backlinks} backlinks</span>
                      <span>{item.outgoing} outgoing</span>
                    </>
                  )}
                />
              </div>

              <div className="agent-column">
                <OverviewList
                  title="Recent Activity"
                  icon={FileSearch}
                  items={overview?.recent}
                  empty="No recent notes."
                  onNavigate={onNavigate}
                  onChat={onOpenNoteChat}
                  renderMeta={(item) => (
                    <>
                      <span>{item.updatedLabel}</span>
                      <span>{item.wordCount} words</span>
                    </>
                  )}
                />

                <OverviewList
                  title="Open Tasks"
                  icon={ClipboardList}
                  items={overview?.openTasks}
                  empty="No unchecked tasks found."
                  onNavigate={onNavigate}
                  onChat={onOpenNoteChat}
                  renderMeta={(item) => (
                    <>
                      <span>{item.count} open</span>
                      <span>{item.tasks[0]?.text || 'Task list detected'}</span>
                    </>
                  )}
                />

                <OverviewList
                  title="Stale Notes"
                  icon={Clock}
                  items={overview?.stale}
                  empty="No notes older than 45 days."
                  onNavigate={onNavigate}
                  onChat={onOpenNoteChat}
                  renderMeta={(item) => (
                    <span>{item.updatedLabel}</span>
                  )}
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'search' && (
          <div className="agent-search-layout">
            <section className="agent-panel-card agent-search-hero">
              <div>
                <span className="agent-panel-kicker">Grounded retrieval</span>
                <h3>Search the vault before you chat.</h3>
                <p>Use local search to surface the strongest notes, then open a note or continue with note-aware chat.</p>
              </div>
              <div className="agent-ask-bar">
                <Input
                  value={vaultQuery}
                  onChange={(event) => setVaultQuery(event.target.value)}
                  placeholder="Ask the vault for notes, tasks, and references"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      runVaultQuery();
                    }
                  }}
                />
                <Button variant="primary" size="sm" onClick={runVaultQuery} disabled={vaultQueryBusy || !vaultQuery.trim()}>
                  {vaultQueryBusy ? 'Searching...' : 'Search'}
                </Button>
              </div>
            </section>

            {vaultQueryResult ? (
              <div className="agent-ask-results">
                <div className="agent-answer-lead">{vaultQueryResult.lead}</div>
                <section className="agent-section">
                  <div className="agent-section-head">
                    <div className="agent-section-title">
                      <Sparkles size={14} />
                      <span>Relevant Notes</span>
                    </div>
                  </div>
                  {vaultQueryResult.matches.length ? (
                    <div className="agent-list">
                      {vaultQueryResult.matches.map((match) => (
                        <div className="agent-answer-card" key={match.path}>
                          <ItemLink path={match.path} title={match.title} onNavigate={onNavigate} />
                          <p>{match.excerpt}</p>
                          <div className="agent-answer-meta">
                            {match.tags.map((tag) => <span key={`${match.path}-${tag}`}>#{tag}</span>)}
                            {match.tasks.map((task) => <span key={`${match.path}-${task.line}`}>[ ] {task.text}</span>)}
                          </div>
                          <div className="agent-list-actions">
                            <Button variant="ghost" size="sm" onClick={() => onOpenNoteChat(match.path)}>Chat About Note</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="agent-empty">No strong note matches for that query.</div>
                  )}
                </section>
              </div>
            ) : (
              <section className="agent-panel-card">
                <div className="agent-empty">Search the vault locally for grounded note references, then jump into note-specific chat.</div>
              </section>
            )}
          </div>
        )}

        {activeTab === 'ingest' && (
          <div className="agent-ingest-layout">
            <section className="agent-panel-card agent-ingest-hero">
              <span className="agent-panel-kicker">Research ingest</span>
              <h3>Turn pasted material into a linked research note.</h3>
              <p>Feed the agent article text, transcript excerpts, or raw meeting notes and it will create a structured note in the vault.</p>
            </section>

            <div className="agent-form-shell">
              <div className="agent-form">
                <label>
                  <span>Title</span>
                  <Input value={ingestTitle} onChange={(event) => setIngestTitle(event.target.value)} placeholder="Source title" />
                </label>
                <label>
                  <span>Source</span>
                  <Input value={ingestSource} onChange={(event) => setIngestSource(event.target.value)} placeholder="URL, paper, meeting, or person" />
                </label>
                <label>
                  <span>Source Material</span>
                  <textarea
                    value={ingestContent}
                    onChange={(event) => setIngestContent(event.target.value)}
                    placeholder="Paste article text, call notes, transcript, or research bullets"
                  />
                </label>
                <div className="agent-toolbar">
                  <Button variant="primary" size="sm" onClick={ingestResearch} disabled={Boolean(actionBusyId)}>
                    Create Research Note
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
