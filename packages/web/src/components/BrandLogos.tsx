import type { FC, CSSProperties, ReactNode } from 'react';

export interface BrandLogoProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** 用于在容器内做留白适配；默认会让 logo 占满 size 边界 */
  padding?: number;
}

const DEFAULT_VIEWBOX = '0 0 24 24';

function BrandSvg({
  size = 24,
  className,
  style,
  children,
  viewBox = DEFAULT_VIEWBOX,
  title,
}: BrandLogoProps & { children: ReactNode; viewBox?: string; title: string }) {
  return (
    <svg
      role="img"
      aria-label={title}
      viewBox={viewBox}
      width={size}
      height={size}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={{ flexShrink: 0, display: 'block', ...style }}
    >
      <title>{title}</title>
      {children}
    </svg>
  );
}

/* Anthropic Claude — official sunburst logo (simple-icons path) */
export const ClaudeLogo: FC<BrandLogoProps> = (p) => (
  <BrandSvg {...p} title="Claude">
    <path
      fill="#D97757"
      d="m4.714 15.956l4.718-2.648l.079-.23l-.08-.128h-.23l-.79-.048l-2.695-.073l-2.337-.097l-2.265-.122l-.57-.121l-.535-.704l.055-.353l.48-.321l.685.06l1.518.104l2.277.157l1.651.098l2.447.255h.389l.054-.158l-.133-.097l-.103-.098l-2.356-1.596l-2.55-1.688l-1.336-.972l-.722-.491L2 6.223l-.158-1.008l.656-.722l.88.06l.224.061l.893.686l1.906 1.476l2.49 1.833l.364.304l.146-.104l.018-.072l-.164-.274l-1.354-2.446l-1.445-2.49l-.644-1.032l-.17-.619a3 3 0 0 1-.103-.729L6.287.133L6.7 0l.995.134l.42.364l.619 1.415L9.735 4.14l1.555 3.03l.455.898l.243.832l.09.255h.159V9.01l.127-1.706l.237-2.095l.23-2.695l.08-.76l.376-.91l.747-.492l.583.28l.48.685l-.067.444l-.286 1.851l-.558 2.903l-.365 1.942h.213l.243-.242l.983-1.306l1.652-2.064l.728-.82l.85-.904l.547-.431h1.032l.759 1.129l-.34 1.166l-1.063 1.347l-.88 1.142l-1.263 1.7l-.79 1.36l.074.11l.188-.02l2.853-.606l1.542-.28l1.84-.315l.832.388l.09.395l-.327.807l-1.967.486l-2.307.462l-3.436.813l-.043.03l.049.061l1.548.146l.662.036h1.62l3.018.225l.79.522l.473.638l-.08.485l-1.213.62l-1.64-.389l-3.825-.91l-1.31-.329h-.183v.11l1.093 1.068l2.003 1.81l2.508 2.33l.127.578l-.321.455l-.34-.049l-2.204-1.657l-.85-.747l-1.925-1.62h-.127v.17l.443.649l2.343 3.521l.122 1.08l-.17.353l-.607.213l-.668-.122l-1.372-1.924l-1.415-2.168l-1.141-1.943l-.14.08l-.674 7.254l-.316.37l-.728.28l-.607-.461l-.322-.747l.322-1.476l.388-1.924l.316-1.53l.285-1.9l.17-.632l-.012-.042l-.14.018l-1.432 1.967l-2.18 2.945l-1.724 1.845l-.413.164l-.716-.37l.066-.662l.401-.589l2.386-3.036l1.439-1.882l.929-1.086l-.006-.158h-.055L4.138 18.56l-1.13.146l-.485-.456l.06-.746l.231-.243l1.907-1.312Z"
    />
  </BrandSvg>
);

/* OpenAI — official hexafoil logo (simple-icons path) */
export const OpenAILogo: FC<BrandLogoProps> = (p) => (
  <BrandSvg {...p} title="OpenAI">
    <path
      fill="currentColor"
      d="M22.282 9.821a6 6 0 0 0-.516-4.91a6.05 6.05 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a6 6 0 0 0-3.998 2.9a6.05 6.05 0 0 0 .743 7.097a5.98 5.98 0 0 0 .51 4.911a6.05 6.05 0 0 0 6.515 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.772-4.206a6 6 0 0 0 3.997-2.9a6.06 6.06 0 0 0-.747-7.073M13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081l4.779-2.758a.8.8 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085l4.783 2.759a.77.77 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646M2.34 7.896a4.5 4.5 0 0 1 2.366-1.973V11.6a.77.77 0 0 0 .388.677l5.815 3.354l-2.02 1.168a.08.08 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.08.08 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667m2.01-3.023l-.141-.085l-4.774-2.782a.78.78 0 0 0-.785 0L9.409 9.23V6.897a.07.07 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.8.8 0 0 0-.393.681zm1.097-2.365l2.602-1.5l2.607 1.5v2.999l-2.597 1.5l-2.607-1.5Z"
    />
  </BrandSvg>
);

/* Anthropic — A 字形 logo (simple-icons path) */
export const AnthropicLogo: FC<BrandLogoProps> = (p) => (
  <BrandSvg {...p} title="Anthropic">
    <path
      fill="#D97757"
      d="M17.304 3.541h-3.672l6.696 16.918H24Zm-10.608 0L0 20.459h3.744l1.37-3.553h7.005l1.369 3.553h3.744L10.536 3.541Zm-.371 10.223L8.616 7.82l2.291 5.945Z"
    />
  </BrandSvg>
);

/* OpenCode — official logo (simple-icons path) */
export const OpenCodeLogo: FC<BrandLogoProps> = (p) => (
  <BrandSvg {...p} title="OpenCode">
    <path
      fill="#7C3AED"
      d="M22 24H2V0h20zM17 4.8H7v14.4h10z"
    />
  </BrandSvg>
);

/* Hermes — 借用 simple-icons 的 Hermes 品牌 path（M + 斜线视觉） */
export const HermesLogo: FC<BrandLogoProps> = (p) => (
  <BrandSvg {...p} title="Hermes">
    <path
      fill="#2A7F83"
      d="m21.818 4.516l-1.05 4.148h2.175L24 4.516m-4.59 9.524h2.17l1.04-4.08h-2.178m-2.41 9.523h2.154l1.056-4.147h-2.16m.193-5.377H5.55v.92l3.341 3.161h9.349m2.41-9.525H0v1.116l3.206 3.032H19.6m-8.372 7.58l3.43 3.24h2.205l1.05-4.147h-6.685"
    />
  </BrandSvg>
);

/* OpenClaw — 自画简化龙虾剪影（OpenClaw 龙虾灵魂主题） */
export const OpenClawLogo: FC<BrandLogoProps> = (p) => (
  <BrandSvg {...p} title="OpenClaw">
    <g fill="#E2725B">
      <ellipse cx="12" cy="13" rx="2.6" ry="4.2" />
      <circle cx="12" cy="7.4" r="1.8" />
      <path d="M11 5.8C9.4 4.4 7.8 3.9 5.7 3.9M13 5.8C14.6 4.4 16.2 3.9 18.3 3.9" stroke="#E2725B" strokeWidth="0.9" fill="none" strokeLinecap="round" />
      <path d="M9.4 9C7.9 7.6 6 6.7 4 6.7" stroke="#E2725B" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <circle cx="3.6" cy="6.7" r="1.6" />
      <path d="M14.6 9C16.1 7.6 18 6.7 20 6.7" stroke="#E2725B" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <circle cx="20.4" cy="6.7" r="1.6" />
      <path d="M12 17.2L10.4 20.4L12 19.4L13.6 20.4Z" />
      <path d="M12 20.8L10.8 23.2L12 22.4L13.2 23.2Z" />
    </g>
  </BrandSvg>
);

/* TRAE — 字节跳动 TRAE IDE 风格（紫色渐变方块 + T） */
export const TraeLogo: FC<BrandLogoProps> = (p) => (
  <BrandSvg {...p} title="TRAE">
    <defs>
      <linearGradient id="traeBrandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#7C3AED" />
        <stop offset="100%" stopColor="#3B82F6" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="20" height="20" rx="5" fill="url(#traeBrandGrad)" />
    <path d="M7 8.4h10M12 8.4v8.4" stroke="#FFFFFF" strokeWidth="2.1" strokeLinecap="round" fill="none" />
  </BrandSvg>
);

/* Codex — Codex CLI 是 OpenAI 产品，沿用 OpenAI hexafoil */
export const CodexLogo: FC<BrandLogoProps> = (p) => (
  <BrandSvg {...p} title="Codex">
    <path
      fill="#10A37F"
      d="M22.282 9.821a6 6 0 0 0-.516-4.91a6.05 6.05 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a6 6 0 0 0-3.998 2.9a6.05 6.05 0 0 0 .743 7.097a5.98 5.98 0 0 0 .51 4.911a6.05 6.05 0 0 0 6.515 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.772-4.206a6 6 0 0 0 3.997-2.9a6.06 6.06 0 0 0-.747-7.073M13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081l4.779-2.758a.8.8 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085l4.783 2.759a.77.77 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646M2.34 7.896a4.5 4.5 0 0 1 2.366-1.973V11.6a.77.77 0 0 0 .388.677l5.815 3.354l-2.02 1.168a.08.08 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.08.08 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667m2.01-3.023l-.141-.085l-4.774-2.782a.78.78 0 0 0-.785 0L9.409 9.23V6.897a.07.07 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.8.8 0 0 0-.393.681zm1.097-2.365l2.602-1.5l2.607 1.5v2.999l-2.597 1.5l-2.607-1.5Z"
    />
  </BrandSvg>
);

/* WorkBuddy — 用户 + 齿轮伙伴组合 */
export const WorkBuddyLogo: FC<BrandLogoProps> = (p) => (
  <BrandSvg {...p} title="WorkBuddy">
    <defs>
      <linearGradient id="workBuddyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#F59E0B" />
        <stop offset="100%" stopColor="#EF4444" />
      </linearGradient>
    </defs>
    <circle cx="12" cy="12" r="12" fill="url(#workBuddyGrad)" />
    <circle cx="9.5" cy="9" r="2.6" fill="#FFFFFF" />
    <path d="M4 18.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" fill="#FFFFFF" />
    <g transform="translate(13.5 13.5)">
      <circle cx="3" cy="3" r="2.4" fill="#FFFFFF" />
      <path d="M3 0.2v1M3 4.8v1M0.2 3h1M4.8 3h1M1 1l0.7 0.7M4.3 4.3l0.7 0.7M1 5l0.7-0.7M4.3 1.6l0.7-0.7" stroke="#F59E0B" strokeWidth="0.7" strokeLinecap="round" fill="none" />
    </g>
  </BrandSvg>
);

export const AGENT_LOGOS: Record<string, FC<BrandLogoProps>> = {
  'claude-desktop': ClaudeLogo,
  'claude-code': ClaudeLogo,
  workbuddy: WorkBuddyLogo,
  trae: TraeLogo,
  hermes: HermesLogo,
  openclaw: OpenClawLogo,
  codex: CodexLogo,
  opencode: OpenCodeLogo,
};
