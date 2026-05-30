# KeyMemory Memory Eval

Generated: 2026-05-30

## Purpose

KeyMemory should be judged by whether it helps agents use long-term project memory, not by whether CRUD works. This local eval is inspired by LongMemEval-style requirements: extraction, multi-session recall, temporal/project reasoning, knowledge updates, abstention, and safe handling of sensitive data.

## Command

```bash
pnpm eval:memory
```

The eval creates a fresh temporary database, writes a synthetic multi-session project fixture, builds agent context packs, and fails the process if any case fails.

## Cases

- preference recall: user delivery preference appears in project context
- descendant project recall: parent project context includes child project memories
- decision grouping: decisions are grouped separately from raw notes
- task grouping: release tasks appear under open tasks
- constraint grouping: rules appear under constraints
- project isolation: another project does not leak into scoped context
- privacy in context: fake API keys are redacted before context generation
- kind filter: `--kinds preference` returns only preference sections
- budget cap: `maxItems` and `maxChars` are respected
- abstain missing project: unknown project returns no context instead of hallucinating

## Release Gate

`pnpm release:check` runs this eval after build and before smoke tests.

## Limits

This is a deterministic local eval, not a replacement for a larger benchmark suite. A production benchmark should add real imported user memory corpora, human-rated relevance, temporal contradiction cases, and regression tracking across model/search changes.
