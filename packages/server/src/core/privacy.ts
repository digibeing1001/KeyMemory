export interface PrivacyFinding {
  type: string;
  count: number;
}

export interface PrivacyRedactionResult {
  text: string;
  findings: PrivacyFinding[];
  redacted: boolean;
}

type PatternDef = {
  type: string;
  pattern: RegExp;
  replace: (match: string, ...groups: string[]) => string;
};

const REDACTION_TOKEN = '[REDACTED]';

const PATTERNS: PatternDef[] = [
  {
    type: 'pem_private_key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: () => `${REDACTION_TOKEN}:private_key`,
  },
  {
    type: 'openai_api_key',
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    replace: () => `${REDACTION_TOKEN}:api_key`,
  },
  {
    type: 'anthropic_api_key',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    replace: () => `${REDACTION_TOKEN}:api_key`,
  },
  {
    type: 'github_token',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    replace: () => `${REDACTION_TOKEN}:token`,
  },
  {
    type: 'aws_access_key',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replace: () => `${REDACTION_TOKEN}:aws_key`,
  },
  {
    type: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replace: () => `${REDACTION_TOKEN}:jwt`,
  },
  {
    type: 'connection_string_password',
    pattern: /(\/\/[^:\s/@]+:)([^@\s/]+)(@)/g,
    replace: (_match, prefix, _secret, suffix) => `${prefix}${REDACTION_TOKEN}:password${suffix}`,
  },
  {
    type: 'labeled_secret',
    pattern: /\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|api[_-]?key|secret|access[_-]?token|refresh[_-]?token|private[_-]?key|credential)[A-Za-z0-9_.-]*)\s*[:=]\s*["'`]?([^\s"'`,;]+)["'`]?/gi,
    replace: (_match, key) => `${key}=${REDACTION_TOKEN}`,
  },
  {
    type: 'env_secret',
    pattern: /\b([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIAL)[A-Z0-9_]*)\s*=\s*([^\s"'`,;#]+)/g,
    replace: (_match, key) => `${key}=${REDACTION_TOKEN}`,
  },
];

function addFinding(counts: Map<string, number>, type: string): void {
  counts.set(type, (counts.get(type) ?? 0) + 1);
}

export function redactSensitiveText(value: string): PrivacyRedactionResult {
  let text = value;
  const counts = new Map<string, number>();

  for (const item of PATTERNS) {
    text = text.replace(item.pattern, (...args) => {
      addFinding(counts, item.type);
      return item.replace(args[0], ...args.slice(1, -2));
    });
  }

  const findings = Array.from(counts.entries()).map(([type, count]) => ({ type, count }));
  return { text, findings, redacted: findings.length > 0 };
}

export function mergePrivacyFindings(findings: PrivacyFinding[]): PrivacyFinding[] {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    counts.set(finding.type, (counts.get(finding.type) ?? 0) + finding.count);
  }
  return Array.from(counts.entries()).map(([type, count]) => ({ type, count }));
}

export function redactSensitiveValue(value: unknown, findings: PrivacyFinding[] = []): unknown {
  if (typeof value === 'string') {
    const result = redactSensitiveText(value);
    findings.push(...result.findings);
    return result.text;
  }
  if (Array.isArray(value)) {
    return value.map(item => redactSensitiveValue(item, findings));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactSensitiveValue(item, findings);
    }
    return out;
  }
  return value;
}

export function privacyMetadata(findings: PrivacyFinding[]): Record<string, unknown> | undefined {
  const merged = mergePrivacyFindings(findings);
  if (merged.length === 0) return undefined;
  return {
    redacted: true,
    redactionVersion: 1,
    findings: merged,
  };
}
