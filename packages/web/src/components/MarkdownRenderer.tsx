import { ReactNode } from 'react';

interface MarkdownRendererProps {
  content: string;
}

interface InlineMatch {
  idx: number;
  len: number;
  render: () => ReactNode;
}

function findFirstInlineMatch(remaining: string, key: number): InlineMatch | null {
  const codeMatch = remaining.match(/^(.*?)`([^`]+)`/);
  const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*/);
  const italicMatch = remaining.match(/^(.*?)\*(.+?)\*/);
  const linkMatch = remaining.match(/^(.*?)\[([^\]]+)\]\(([^)]+)\)/);

  const candidates: InlineMatch[] = [];

  if (codeMatch && codeMatch[1] !== undefined) {
    candidates.push({ idx: codeMatch[1].length, len: codeMatch[0].length, render: () => <code key={key} className="inline-code">{codeMatch[2]}</code> });
  }
  if (boldMatch && boldMatch[1] !== undefined) {
    candidates.push({ idx: boldMatch[1].length, len: boldMatch[0].length, render: () => <strong key={key}>{boldMatch[2]}</strong> });
  }
  if (italicMatch && italicMatch[1] !== undefined) {
    candidates.push({ idx: italicMatch[1].length, len: italicMatch[0].length, render: () => <em key={key}>{italicMatch[2]}</em> });
  }
  if (linkMatch && linkMatch[1] !== undefined) {
    candidates.push({ idx: linkMatch[1].length, len: linkMatch[0].length, render: () => <a key={key} href={linkMatch[3]} target="_blank" rel="noopener noreferrer">{linkMatch[2]}</a> });
  }

  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => (c.idx < best.idx ? c : best));
}

function parseInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const match = findFirstInlineMatch(remaining, key++);

    if (match) {
      const before = remaining.slice(0, match.idx);
      if (before) nodes.push(before);
      nodes.push(match.render());
      remaining = remaining.slice(match.idx + match.len);
    } else {
      nodes.push(remaining);
      remaining = '';
    }
  }

  return nodes;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const lines = content.split('\n');
  const elements: ReactNode[] = [];
  let key = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      elements.push(
        <pre key={key++} className="code-block">
          {lang && <span className="code-lang">{lang}</span>}
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    if (/^### /.test(line)) {
      elements.push(<h4 key={key++}>{parseInline(line.slice(4))}</h4>);
      i++;
      continue;
    }
    if (/^## /.test(line)) {
      elements.push(<h3 key={key++}>{parseInline(line.slice(3))}</h3>);
      i++;
      continue;
    }
    if (/^# /.test(line)) {
      elements.push(<h2 key={key++}>{parseInline(line.slice(2))}</h2>);
      i++;
      continue;
    }

    if (/^- /.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^- /.test(lines[i])) {
        items.push(<li key={key++}>{parseInline(lines[i].slice(2))}</li>);
        i++;
      }
      elements.push(<ul key={key++}>{items}</ul>);
      continue;
    }

    if (/^\d+\. /.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(<li key={key++}>{parseInline(lines[i].replace(/^\d+\. /, ''))}</li>);
        i++;
      }
      elements.push(<ol key={key++}>{items}</ol>);
      continue;
    }

    if (line.trim() === '') {
      elements.push(<br key={key++} />);
      i++;
      continue;
    }

    elements.push(<p key={key++}>{parseInline(line)}</p>);
    i++;
  }

  return <div className="markdown-content">{elements}</div>;
}
