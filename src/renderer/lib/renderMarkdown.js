import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function renderMarkdownHtml(markdown) {
  return DOMPurify.sanitize(marked.parse(markdown || ''));
}
