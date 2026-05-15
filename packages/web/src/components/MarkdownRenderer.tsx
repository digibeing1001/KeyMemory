import { ReactNode } from 'react';

interface MarkdownRendererProps {
  content: string;
}

interface InlineMatch {
  idx: number;
  len: number;
  render: () => ReactNode;
}

function sanitizeUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url, 'http://localhost');
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return url;
  } catch {
    return undefined;
  }
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
    candidates.push({
      idx: linkMatch[1].length,
      len: linkMatch[0].length,
      render: () => {
        const safeUrl = sanitizeUrl(linkMatch[3]);
        if (!safeUrl) return <span key={key} style={{ color: 'var(--text-secondary)' }}>{linkMatch[2]}</span>;
        return <a key={key} href={safeUrl} target="_blank" rel="noopener noreferrer">{linkMatch[2]}</a>;
      },
    });
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

function parseTableCell(cell: string): ReactNode[] {
  return parseInline(cell.trim());
}

function isTableRow(line: string): boolean {
  return /^\|.*\|$/.test(line.trim());
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s\-:]+\|/.test(line.trim());
}

function parseTableRow(line: string): string[] {
  return line.trim().split('|').slice(1, -1);
}

function renderTable(lines: string[], startKey: number): { element: ReactNode; linesConsumed: number; keyUsed: number } {
  let key = startKey;
  const headerCells = parseTableRow(lines[0]);
  let dataStart = 1;
  if (lines.length > 1 && isSeparatorRow(lines[1])) {
    dataStart = 2;
  }

  const rows: ReactNode[] = [];
  let i = dataStart;
  while (i < lines.length && isTableRow(lines[i])) {
    const cells = parseTableRow(lines[i]);
    rows.push(
      <tr key={key++}>
        {cells.map((cell, ci) => (
          <td key={ci} style={{ padding: '8px 12px', borderBottom: '0.5px solid var(--border)', fontSize: 14, color: 'var(--text-primary)' }}>
            {parseTableCell(cell)}
          </td>
        ))}
      </tr>
    );
    i++;
  }

  const element = (
    <div key={key++} style={{ overflowX: 'auto', margin: '12px 0' }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 14,
        border: '0.5px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}>
        <thead>
          <tr>
            {headerCells.map((cell, ci) => (
              <th key={ci} style={{
                padding: '10px 12px',
                textAlign: 'left',
                fontWeight: 600,
                fontSize: 13,
                color: 'var(--text-secondary)',
                background: 'var(--bg-muted)',
                borderBottom: '1px solid var(--border)',
                whiteSpace: 'nowrap',
              }}>
                {parseTableCell(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );

  return { element, linesConsumed: i, keyUsed: key };
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

    if (/^> /.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^> ?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^> ?/, ''));
        i++;
      }
      elements.push(
        <blockquote key={key++} style={{
          borderLeft: '3px solid var(--accent)',
          margin: '12px 0',
          padding: '8px 16px',
          color: 'var(--text-secondary)',
          background: 'var(--bg-muted)',
          borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
        }}>
          {quoteLines.map((l, qi) => <p key={qi} style={{ margin: 0 }}>{parseInline(l)}</p>)}
        </blockquote>
      );
      continue;
    }

    if (isTableRow(line)) {
      const tableLines: string[] = [];
      while (i < lines.length && (isTableRow(lines[i]) || isSeparatorRow(lines[i]))) {
        tableLines.push(lines[i]);
        i++;
      }
      const { element, linesConsumed, keyUsed } = renderTable(tableLines, key);
      elements.push(element);
      i = i - tableLines.length + linesConsumed;
      key = keyUsed;
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
