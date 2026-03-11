const path = require('path');
const fs = require('fs/promises');

const wikiPattern = /\[\[([^\]]+)\]\]/g;
const taskPattern = /^\s*[-*]\s+\[( |x)\]\s+(.*)$/;
const stopWords = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'with',
  'you'
]);

function fileTitleFromPath(filePath) {
  return filePath.replace(/\.md$/i, '').split('/').pop() || filePath;
}

function sanitizeFileName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '')
    .slice(0, 120);
}

function parseFrontmatter(text) {
  const match = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta: null, body: String(text || ''), frontmatterRaw: '' };

  const yamlStr = match[1];
  const body = String(text || '').slice(match[0].length);
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
      if (value) meta[currentKey] = value;
    }
  }

  return {
    meta: Object.keys(meta).length > 0 ? meta : null,
    body,
    frontmatterRaw: match[0]
  };
}

function stripMarkdown(text) {
  return String(text || '')
    .replace(/^---[\s\S]*?---\n?/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(wikiPattern, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/[#>*_~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return Array.from(
    new Set(
      String(text || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .filter((token) => token.length > 2 && !stopWords.has(token))
    )
  );
}

function titleTokenSet(doc) {
  return new Set(tokenize(`${doc.title} ${doc.path}`));
}

function jaccardScore(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function scoreCandidateName(target, candidate) {
  const a = String(target || '').toLowerCase().trim();
  const b = String(candidate || '').toLowerCase().trim();
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.startsWith(b) || b.startsWith(a)) return 0.88;
  if (a.includes(b) || b.includes(a)) return 0.78;
  return jaccardScore(new Set(tokenize(a)), new Set(tokenize(b)));
}

function extractTags(meta, body) {
  const tags = new Set();
  if (meta?.tags) {
    if (Array.isArray(meta.tags)) {
      meta.tags.forEach((tag) => tag && tags.add(String(tag).trim()));
    } else {
      String(meta.tags)
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .forEach((tag) => tags.add(tag));
    }
  }

  const inlineMatches = String(body || '').match(/(^|\s)#([a-z0-9/_-]+)/gi) || [];
  inlineMatches.forEach((match) => {
    const normalized = match.trim().replace(/^#/, '');
    if (normalized) tags.add(normalized);
  });

  return Array.from(tags);
}

function extractWikiLinks(body) {
  const text = String(body || '');
  const lines = text.split('\n');
  const results = [];

  lines.forEach((line, index) => {
    for (const match of line.matchAll(wikiPattern)) {
      const raw = (match[1] || '').trim();
      if (!raw) continue;
      const target = raw.split('|')[0].split('#')[0].trim();
      if (!target) continue;
      results.push({
        raw,
        target,
        line: index + 1
      });
    }
  });

  return results;
}

function extractTasks(body) {
  return String(body || '')
    .split('\n')
    .map((line, index) => {
      const match = line.match(taskPattern);
      if (!match) return null;
      return {
        line: index + 1,
        done: match[1] === 'x',
        text: match[2].trim()
      };
    })
    .filter(Boolean);
}

function buildExcerpt(body, query) {
  const plain = stripMarkdown(body);
  if (!plain) return '';
  const trimmedQuery = String(query || '').trim().toLowerCase();
  if (!trimmedQuery) return plain.slice(0, 220);

  const lower = plain.toLowerCase();
  const index = lower.indexOf(trimmedQuery);
  if (index < 0) return plain.slice(0, 220);

  const start = Math.max(0, index - 80);
  const end = Math.min(plain.length, index + trimmedQuery.length + 140);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < plain.length ? '...' : '';
  return `${prefix}${plain.slice(start, end).trim()}${suffix}`;
}

function formatRelativeDays(days) {
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 month ago';
  return `${months} months ago`;
}

async function indexMarkdown(vaultPath) {
  const docs = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith('.md')) {
        docs.push({
          path: path.relative(vaultPath, full),
          content: await fs.readFile(full, 'utf8')
        });
      }
    }
  }

  await walk(vaultPath);
  return docs;
}

function pickSuggestedCandidates(target, docInfos, limit = 3) {
  return docInfos
    .map((doc) => ({
      path: doc.path,
      title: doc.title,
      score:
        Math.max(scoreCandidateName(target, doc.title), scoreCandidateName(target, fileTitleFromPath(doc.path)))
    }))
    .filter((candidate) => candidate.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function buildVaultAnalysis(vaultPath, docsInput) {
  const docs = docsInput || await indexMarkdown(vaultPath);

  const exactMap = new Map();
  const basenameMap = new Map();
  const titleMap = new Map();

  const stats = await Promise.all(
    docs.map(async (doc) => {
      try {
        return await fs.stat(path.join(vaultPath, doc.path));
      } catch {
        return null;
      }
    })
  );

  const docInfos = docs.map((doc, index) => {
    const parsed = parseFrontmatter(doc.content);
    const title = parsed.meta?.title ? String(parsed.meta.title) : fileTitleFromPath(doc.path);
    const info = {
      path: doc.path,
      title,
      meta: parsed.meta,
      body: parsed.body,
      frontmatterRaw: parsed.frontmatterRaw,
      wikiLinks: extractWikiLinks(parsed.body),
      tasks: extractTasks(parsed.body),
      tags: extractTags(parsed.meta, parsed.body),
      wordCount: stripMarkdown(parsed.body).split(/\s+/).filter(Boolean).length,
      updatedAt: stats[index]?.mtimeMs || Date.now(),
      updatedLabel: ''
    };

    const relNoExt = doc.path.replace(/\.md$/i, '').toLowerCase();
    const basename = fileTitleFromPath(doc.path).toLowerCase();
    const normalizedTitle = title.toLowerCase();
    exactMap.set(relNoExt, info.path);
    basenameMap.set(basename, [...(basenameMap.get(basename) || []), info.path]);
    titleMap.set(normalizedTitle, [...(titleMap.get(normalizedTitle) || []), info.path]);
    return info;
  });

  const docInfoMap = new Map(docInfos.map((doc) => [doc.path, doc]));

  function resolveWikiTarget(target) {
    const normalized = String(target || '').trim().replace(/\\/g, '/').toLowerCase();
    if (!normalized) return { kind: 'missing' };

    if (exactMap.has(normalized)) {
      return { kind: 'resolved', path: exactMap.get(normalized) };
    }

    const basenameCandidates = basenameMap.get(path.basename(normalized)) || [];
    if (basenameCandidates.length === 1) {
      return { kind: 'resolved', path: basenameCandidates[0] };
    }
    if (basenameCandidates.length > 1) {
      return { kind: 'ambiguous', candidates: basenameCandidates };
    }

    const titleCandidates = titleMap.get(normalized) || [];
    if (titleCandidates.length === 1) {
      return { kind: 'resolved', path: titleCandidates[0] };
    }
    if (titleCandidates.length > 1) {
      return { kind: 'ambiguous', candidates: titleCandidates };
    }

    return { kind: 'missing' };
  }

  const backlinks = new Map();
  const outgoingCount = new Map();
  const brokenLinks = [];
  const suggestions = [];

  docInfos.forEach((doc) => {
    outgoingCount.set(doc.path, doc.wikiLinks.length);

    doc.wikiLinks.forEach((link) => {
      const resolution = resolveWikiTarget(link.target);
      if (resolution.kind === 'resolved') {
        backlinks.set(resolution.path, (backlinks.get(resolution.path) || 0) + 1);
        return;
      }

      const candidates = pickSuggestedCandidates(link.target, docInfos);
      const top = candidates[0];
      const next = candidates[1];
      const isConfidentSuggestion =
        top && top.score >= 0.72 && (!next || top.score - next.score >= 0.12);

      const issue = {
        id: `broken:${doc.path}:${link.line}:${link.raw}`,
        sourcePath: doc.path,
        sourceTitle: doc.title,
        linkText: link.raw,
        line: link.line,
        reason: resolution.kind,
        suggestions: candidates
      };
      brokenLinks.push(issue);

      if (resolution.kind === 'ambiguous') return;

      if (isConfidentSuggestion && !link.raw.includes('|') && !link.raw.includes('#')) {
        suggestions.push({
          id: `fix-link:${doc.path}:${link.raw}`,
          kind: 'fix-broken-link',
          priority: 'high',
          title: `Repair [[${link.raw}]] in ${doc.title}`,
          description: `Replace [[${link.raw}]] with [[${top.title}]] in ${doc.path}.`,
          sourcePath: doc.path,
          linkText: link.raw,
          targetPath: top.path,
          targetTitle: top.title
        });
      } else {
        const sourceDir = path.dirname(doc.path);
        const cleanName = sanitizeFileName(link.target) || 'Untitled';
        const suggestedPath = sourceDir && sourceDir !== '.'
          ? `${sourceDir}/${cleanName}.md`
          : `${cleanName}.md`;
        suggestions.push({
          id: `create-note:${doc.path}:${link.raw}`,
          kind: 'create-missing-note',
          priority: 'medium',
          title: `Create note for [[${link.target}]]`,
          description: `Create ${suggestedPath} so the link in ${doc.path} resolves.`,
          sourcePath: doc.path,
          linkText: link.target,
          suggestedPath
        });
      }
    });

    if (!doc.frontmatterRaw) {
      suggestions.push({
        id: `frontmatter:${doc.path}`,
        kind: 'add-frontmatter',
        priority: 'low',
        title: `Add frontmatter to ${doc.title}`,
        description: `Insert a basic title, status, and tags scaffold into ${doc.path}.`,
        targetPath: doc.path
      });
    }
  });

  const now = Date.now();
  const orphans = [];
  const stale = [];
  const untagged = [];
  const recent = docInfos
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8)
    .map((doc) => {
      const daysStale = Math.max(0, Math.floor((now - doc.updatedAt) / 86400000));
      return {
        path: doc.path,
        title: doc.title,
        updatedAt: doc.updatedAt,
        updatedLabel: formatRelativeDays(daysStale),
        wordCount: doc.wordCount
      };
    });

  docInfos.forEach((doc) => {
    const inbound = backlinks.get(doc.path) || 0;
    const outbound = outgoingCount.get(doc.path) || 0;
    const daysStale = Math.max(0, Math.floor((now - doc.updatedAt) / 86400000));

    if (inbound === 0 && outbound === 0) {
      orphans.push({
        path: doc.path,
        title: doc.title,
        updatedLabel: formatRelativeDays(daysStale)
      });
    }

    if (daysStale >= 45) {
      stale.push({
        path: doc.path,
        title: doc.title,
        daysStale,
        updatedLabel: formatRelativeDays(daysStale)
      });
    }

    if (doc.tags.length === 0) {
      untagged.push({
        path: doc.path,
        title: doc.title
      });
    }
  });

  const hubNotes = docInfos
    .map((doc) => ({
      path: doc.path,
      title: doc.title,
      backlinks: backlinks.get(doc.path) || 0,
      outgoing: outgoingCount.get(doc.path) || 0
    }))
    .map((doc) => ({
      ...doc,
      score: doc.backlinks * 2 + doc.outgoing
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const folderCounts = Array.from(
    docInfos.reduce((acc, doc) => {
      const folder = doc.path.includes('/') ? doc.path.split('/')[0] : 'Vault Root';
      acc.set(folder, (acc.get(folder) || 0) + 1);
      return acc;
    }, new Map()).entries()
  )
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const openTasks = docInfos
    .map((doc) => ({
      path: doc.path,
      title: doc.title,
      count: doc.tasks.filter((task) => !task.done).length,
      tasks: doc.tasks.filter((task) => !task.done).slice(0, 5)
    }))
    .filter((doc) => doc.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const duplicates = [];
  const titleTokens = docInfos.map((doc) => titleTokenSet(doc));
  const limit = Math.min(docInfos.length, 240);
  for (let i = 0; i < limit; i += 1) {
    for (let j = i + 1; j < limit; j += 1) {
      const score =
        Math.max(
          scoreCandidateName(docInfos[i].title, docInfos[j].title),
          jaccardScore(titleTokens[i], titleTokens[j])
        );

      if (score >= 0.83) {
        duplicates.push({
          paths: [docInfos[i].path, docInfos[j].path],
          titles: [docInfos[i].title, docInfos[j].title],
          score: Number(score.toFixed(2))
        });
      }
    }
  }

  duplicates.sort((a, b) => b.score - a.score);

  return {
    generatedAt: now,
    summary: {
      noteCount: docInfos.length,
      wordCount: docInfos.reduce((sum, doc) => sum + doc.wordCount, 0),
      linkCount: docInfos.reduce((sum, doc) => sum + doc.wikiLinks.length, 0),
      brokenLinkCount: brokenLinks.length,
      orphanCount: orphans.length,
      staleCount: stale.length,
      untaggedCount: untagged.length,
      openTaskCount: openTasks.reduce((sum, doc) => sum + doc.count, 0)
    },
    recent,
    hubs: hubNotes,
    folders: folderCounts,
    orphans: orphans.slice(0, 12),
    stale: stale.sort((a, b) => b.daysStale - a.daysStale).slice(0, 12),
    untagged: untagged.slice(0, 12),
    brokenLinks: brokenLinks.slice(0, 16),
    duplicates: duplicates.slice(0, 10),
    openTasks,
    suggestions: suggestions
      .sort((a, b) => {
        const rank = { high: 0, medium: 1, low: 2 };
        return (rank[a.priority] || 9) - (rank[b.priority] || 9);
      })
      .slice(0, 20)
  };
}

function rankDocsForQuery(docInfos, query, currentPath) {
  const search = String(query || '').trim().toLowerCase();
  if (!search) return [];

  const tokens = tokenize(search);

  return docInfos
    .map((doc) => {
      const title = doc.title.toLowerCase();
      const docPath = doc.path.toLowerCase();
      const body = stripMarkdown(doc.body).toLowerCase();
      let score = 0;

      if (title === search) score += 12;
      if (title.startsWith(search)) score += 9;
      if (title.includes(search)) score += 7;
      if (docPath.includes(search)) score += 5;
      if (body.includes(search)) score += 4;
      if (currentPath && currentPath === doc.path) score += 2;

      tokens.forEach((token) => {
        if (title.includes(token)) score += 2.5;
        if (docPath.includes(token)) score += 1.5;
        if (body.includes(token)) score += 1;
      });

      return { doc, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((entry) => ({
      path: entry.doc.path,
      title: entry.doc.title,
      score: entry.score,
      excerpt: buildExcerpt(entry.doc.body, search),
      tasks: entry.doc.tasks.filter((task) => !task.done).slice(0, 2),
      tags: entry.doc.tags.slice(0, 4)
    }));
}

async function answerVaultQuestion(vaultPath, query, currentPath) {
  const docs = await indexMarkdown(vaultPath);
  const analysis = await buildVaultAnalysis(vaultPath, docs);
  const docInfos = docs.map((doc) => {
    const parsed = parseFrontmatter(doc.content);
    return {
      path: doc.path,
      title: parsed.meta?.title ? String(parsed.meta.title) : fileTitleFromPath(doc.path),
      body: parsed.body,
      tasks: extractTasks(parsed.body),
      tags: extractTags(parsed.meta, parsed.body)
    };
  });

  const matches = rankDocsForQuery(docInfos, query, currentPath);
  const openTaskMatches = analysis.openTasks.filter((item) => {
    const lower = `${item.title} ${item.path} ${item.tasks.map((task) => task.text).join(' ')}`.toLowerCase();
    return lower.includes(String(query || '').trim().toLowerCase());
  }).slice(0, 4);

  const lead =
    matches.length > 0
      ? `Found ${matches.length} relevant notes${openTaskMatches.length ? ` and ${openTaskMatches.length} task lists` : ''}.`
      : `No strong matches found for "${query}".`;

  return {
    query,
    lead,
    matches,
    taskMatches: openTaskMatches
  };
}

async function buildChatContext(vaultPath, query, currentPath, currentContentOverride = '') {
  const docs = await indexMarkdown(vaultPath);
  const docInfos = docs.map((doc) => {
    const effectiveContent = currentPath && doc.path === currentPath && currentContentOverride
      ? currentContentOverride
      : doc.content;
    const parsed = parseFrontmatter(effectiveContent);
    return {
      path: doc.path,
      title: parsed.meta?.title ? String(parsed.meta.title) : fileTitleFromPath(doc.path),
      body: parsed.body,
      meta: parsed.meta,
      tasks: extractTasks(parsed.body),
      tags: extractTags(parsed.meta, parsed.body)
    };
  });

  const matches = rankDocsForQuery(docInfos, query, currentPath);
  const currentDoc = currentPath ? docInfos.find((doc) => doc.path === currentPath) || null : null;

  return {
    currentNote: currentDoc
      ? {
          path: currentDoc.path,
          title: currentDoc.title,
          body: currentDoc.body.slice(0, 16000),
          tags: currentDoc.tags,
          tasks: currentDoc.tasks.filter((task) => !task.done).slice(0, 6)
        }
      : null,
    relatedNotes: matches.map((match) => {
      const doc = docInfos.find((item) => item.path === match.path);
      return {
        path: match.path,
        title: match.title,
        excerpt: match.excerpt,
        body: String(doc?.body || '').slice(0, 5000),
        tags: match.tags,
        tasks: match.tasks
      };
    })
  };
}

function buildFrontmatterTemplate(title) {
  const escapedTitle = String(title || 'Untitled').replace(/"/g, '\\"');
  return `---\ntitle: "${escapedTitle}"\nstatus: active\ntags:\n  - inbox\nreviewed_at: ${new Date().toISOString().slice(0, 10)}\n---\n\n`;
}

function buildVaultReviewMarkdown(analysis) {
  const lines = [
    `# Vault Review - ${new Date(analysis.generatedAt).toISOString().slice(0, 10)}`,
    '',
    '## Summary',
    `- Notes: ${analysis.summary.noteCount}`,
    `- Words: ${analysis.summary.wordCount.toLocaleString()}`,
    `- Wiki links: ${analysis.summary.linkCount}`,
    `- Broken links: ${analysis.summary.brokenLinkCount}`,
    `- Orphan notes: ${analysis.summary.orphanCount}`,
    `- Stale notes: ${analysis.summary.staleCount}`,
    `- Untagged notes: ${analysis.summary.untaggedCount}`,
    `- Open tasks: ${analysis.summary.openTaskCount}`,
    '',
    '## Priorities'
  ];

  if (analysis.suggestions.length === 0) {
    lines.push('- No immediate maintenance actions detected.');
  } else {
    analysis.suggestions.slice(0, 10).forEach((suggestion) => {
      lines.push(`- ${suggestion.title}: ${suggestion.description}`);
    });
  }

  lines.push('', '## Recent Activity');
  analysis.recent.forEach((item) => {
    lines.push(`- [[${item.title}]] (${item.path}) updated ${item.updatedLabel}`);
  });

  lines.push('', '## Hub Notes');
  analysis.hubs.forEach((item) => {
    lines.push(`- [[${item.title}]]: ${item.backlinks} backlinks, ${item.outgoing} outgoing links`);
  });

  if (analysis.brokenLinks.length) {
    lines.push('', '## Broken Links');
    analysis.brokenLinks.forEach((item) => {
      lines.push(`- [[${item.sourceTitle}]] line ${item.line}: [[${item.linkText}]]`);
    });
  }

  if (analysis.openTasks.length) {
    lines.push('', '## Open Tasks');
    analysis.openTasks.forEach((item) => {
      lines.push(`- [[${item.title}]]`);
      item.tasks.forEach((task) => {
        lines.push(`  - [ ] ${task.text}`);
      });
    });
  }

  return `${lines.join('\n')}\n`;
}

function buildProjectPulseMarkdown(analysis) {
  const lines = [
    `# Project Pulse - ${new Date(analysis.generatedAt).toISOString().slice(0, 10)}`,
    '',
    '## Momentum',
    ...analysis.recent.slice(0, 6).map((item) => `- [[${item.title}]] updated ${item.updatedLabel}`),
    '',
    '## Open Work'
  ];

  if (analysis.openTasks.length === 0) {
    lines.push('- No open tasks detected.');
  } else {
    analysis.openTasks.slice(0, 8).forEach((item) => {
      lines.push(`- [[${item.title}]] (${item.count} open)`);
      item.tasks.forEach((task) => {
        lines.push(`  - [ ] ${task.text}`);
      });
    });
  }

  lines.push('', '## At Risk');
  if (analysis.stale.length === 0) {
    lines.push('- No stale notes older than 45 days.');
  } else {
    analysis.stale.slice(0, 6).forEach((item) => {
      lines.push(`- [[${item.title}]] last touched ${item.updatedLabel}`);
    });
  }

  return `${lines.join('\n')}\n`;
}

function buildResearchNote({ title, source, content }) {
  const safeTitle = sanitizeFileName(title) || 'Research Note';
  const rawBody = String(content || '').trim();
  const lines = rawBody.split('\n').map((line) => line.trim()).filter(Boolean);
  const bulletLines = lines.filter((line) => /^[-*]\s+/.test(line)).slice(0, 5);
  const summaryParagraph = lines.find((line) => line.length > 80) || lines.slice(0, 3).join(' ');
  const highlightLines = bulletLines.length
    ? bulletLines.map((line) => line.replace(/^[-*]\s+/, ''))
    : lines.slice(0, 5);

  const markdown = [
    '---',
    `title: "${safeTitle.replace(/"/g, '\\"')}"`,
    'tags:',
    '  - research',
    '  - inbox',
    `source: ${source || 'manual'}`,
    `captured_at: ${new Date().toISOString()}`,
    '---',
    '',
    `# ${safeTitle}`,
    '',
    '## Source',
    source || 'Manual paste',
    '',
    '## Summary',
    summaryParagraph || 'Add a short summary.',
    '',
    '## Highlights',
    ...(highlightLines.length ? highlightLines.map((line) => `- ${line}`) : ['- Add key takeaways.']),
    '',
    '## Open Questions',
    '- What should be linked from this note?',
    '- What is actionable here?',
    '- What remains uncertain?',
    '',
    '## Raw Material',
    rawBody || 'Paste source material here.'
  ].join('\n');

  return {
    markdown,
    suggestedPath: `Inbox/Research/${new Date().toISOString().slice(0, 10)} ${safeTitle}.md`
  };
}

module.exports = {
  answerVaultQuestion,
  buildChatContext,
  buildFrontmatterTemplate,
  buildProjectPulseMarkdown,
  buildResearchNote,
  buildVaultAnalysis,
  buildVaultReviewMarkdown,
  indexMarkdown,
  parseFrontmatter,
  sanitizeFileName
};
