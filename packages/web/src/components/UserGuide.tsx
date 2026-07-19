import { useEffect, useState } from 'react';
import { Activity, BookOpen, CheckCircle, Close, Layers, Mail, Plug, RefreshCw, Search, User, Zap } from './Icons';

interface UserGuideProps {
  open: boolean;
  firstRun: boolean;
  onClose: () => void;
  onComplete: () => void;
  onOpenIntegrations: () => void;
}

const pages = [
  { id: 'welcome', title: '先认识 KeyMemory', short: '它能帮你做什么' },
  { id: 'connect', title: '连接你的 AI 助手', short: '选择最合适的方式' },
  { id: 'verify', title: '确认真的连接成功', short: '三步排除假连接' },
  { id: 'capture', title: '它会记住什么', short: '工作、偏好和最近事项' },
  { id: 'features', title: '每个页面怎么用', short: '日常操作说明' },
  { id: 'help', title: '遇到问题怎么办', short: '最常见的解决办法' },
] as const;

export default function UserGuide({ open, firstRun, onClose, onComplete, onOpenIntegrations }: UserGuideProps) {
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (open && firstRun) setPage(0);
  }, [open, firstRun]);

  if (!open) return null;

  const finish = () => {
    onComplete();
    onClose();
  };

  return (
    <div className="user-guide-backdrop" role="presentation">
      <section className="user-guide-dialog" role="dialog" aria-modal="true" aria-label="KeyMemory 中文使用说明">
        <header className="user-guide-header">
          <div>
            <span><BookOpen size={14} /> KEYMEMORY GUIDE</span>
            <h2>{firstRun ? '欢迎使用 KeyMemory' : '使用说明'}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭使用说明"><Close size={16} /></button>
        </header>

        <div className="user-guide-body">
          <nav className="user-guide-nav" aria-label="说明目录">
            {pages.map((item, index) => (
              <button key={item.id} type="button" className={page === index ? 'is-active' : ''} onClick={() => setPage(index)}>
                <b>{index + 1}</b>
                <span><strong>{item.title}</strong><small>{item.short}</small></span>
                {index < page && <CheckCircle size={14} />}
              </button>
            ))}
          </nav>

          <main className="user-guide-content">
            {page === 0 && <WelcomePage />}
            {page === 1 && <ConnectPage onOpenIntegrations={onOpenIntegrations} />}
            {page === 2 && <VerifyPage />}
            {page === 3 && <CapturePage />}
            {page === 4 && <FeaturesPage />}
            {page === 5 && <HelpPage onOpenIntegrations={onOpenIntegrations} />}
          </main>
        </div>

        <footer className="user-guide-footer">
          <span>第 {page + 1} 步，共 {pages.length} 步</span>
          <div>
            {page > 0 && <button type="button" onClick={() => setPage(value => value - 1)}>上一步</button>}
            {page < pages.length - 1
              ? <button type="button" className="is-primary" onClick={() => setPage(value => value + 1)}>下一步</button>
              : <button type="button" className="is-primary" onClick={finish}>我会用了</button>}
          </div>
        </footer>
      </section>
    </div>
  );
}

function WelcomePage() {
  return (
    <article>
      <div className="guide-page-number">01</div>
      <span className="guide-eyebrow">人类与 AI 共用的记忆办公室</span>
      <h3>换了 AI 助手，也能从同一封工作邮件继续。</h3>
      <p>具体项目、任务和事件会成为持续回复的邮件主题；偏好、规则、事实和经验保存在记忆库。以后换工具、换窗口或隔几天继续做事，助手先读收件箱就能了解完整经过。</p>
      <div className="guide-callout"><Zap size={18} /><div><strong>最简单的理解</strong><span>它像一个人类与多个 AI 助手共同使用、由记忆秘书整理的内部工作邮箱。</span></div></div>
      <div className="guide-three-columns">
        <div><User size={18} /><strong>更懂你</strong><span>记住喜欢、不喜欢、重视和习惯。</span></div>
        <div><Activity size={18} /><strong>接着做</strong><span>在同一邮件主题中看见进度和下一步。</span></div>
        <div><CheckCircle size={18} /><strong>少踩坑</strong><span>记住失败原因和成功办法。</span></div>
      </div>
    </article>
  );
}

function ConnectPage({ onOpenIntegrations }: { onOpenIntegrations: () => void }) {
  return (
    <article>
      <div className="guide-page-number">02</div>
      <span className="guide-eyebrow">选择一种连接办法</span>
      <h3>不确定怎么选，就用“自动推荐”。</h3>
      <p>进入“Agent 接入”，点选你正在使用的 AI 助手，再选择连接办法。KeyMemory 会保留原有设置，改动前也会留下备份。</p>
      <div className="guide-choice-list">
        <div><b>推荐</b><strong>自动连接</strong><span>功能最完整，适合大多数桌面 AI 工具。</span></div>
        <div><b>轻量</b><strong>命令连接</strong><span>适合能够运行本机命令的 AI 助手。</span></div>
        <div><b>通用</b><strong>规则包连接</strong><span>给助手安装一份使用说明，让它知道何时读、何时写。</span></div>
      </div>
      <button type="button" className="guide-action-button" onClick={onOpenIntegrations}><Plug size={15} />现在去连接 AI 助手</button>
    </article>
  );
}

function VerifyPage() {
  return (
    <article>
      <div className="guide-page-number">03</div>
      <span className="guide-eyebrow">不要只看“配置完成”</span>
      <h3>看到三项通过，才算真正接好。</h3>
      <div className="guide-check-list">
        <div><b>1</b><div><strong>设置已经写入</strong><span>回到接入页面，点击“检测接入状态”，页面应显示“已检测到配置”。</span></div></div>
        <div><b>2</b><div><strong>助手能读到收件箱</strong><span>让助手检查 KeyMemory 连接，再列出记忆邮箱。它必须返回真实主题，不能只口头说成功。</span></div></div>
        <div><b>3</b><div><strong>助手能回复并找回</strong><span>开始真实工作后，让助手把进度回复到邮件，再重新读取。不要专门制造无用测试内容。</span></div></div>
      </div>
      <div className="guide-callout"><RefreshCw size={18} /><div><strong>如果第一项通过、后两项失败</strong><span>通常只需要重启对应的 AI 助手，再让它重新检查一次。</span></div></div>
    </article>
  );
}

function CapturePage() {
  return (
    <article>
      <div className="guide-page-number">04</div>
      <span className="guide-eyebrow">三类内容自动积累</span>
      <h3>该记的要完整，不该记的要克制。</h3>
      <div className="guide-capture-list">
        <div><b>A</b><div><strong>工作过程和经验</strong><span>做了什么、改了哪里、怎样验证；踩过什么坑、为什么失败；什么办法成功、以后怎样复用。</span></div></div>
        <div><b>B</b><div><strong>你这个人</strong><span>你关注、喜欢、重视和不喜欢什么；常用工具、沟通方式、工作习惯，以及你对助手的纠正和批评。</span></div></div>
        <div><b>C</b><div><strong>最近正在做的事</strong><span>工作、学习、研究、生活计划和个人项目；做到哪里、还差什么、卡在哪里、下一步是什么。</span></div></div>
      </div>
      <p className="guide-muted">密码、账号密钥、闲聊、没有证据的猜测和助手的内部思考不会进入普通记忆。</p>
    </article>
  );
}

function FeaturesPage() {
  const items = [
    ['记忆邮箱', '一项工作一个主题；人类、Agent 与记忆在同一项目中持续补充信息。'],
    ['记忆库', '查看、搜索、修改可跨事情复用的偏好、规则、事实和经验。'],
    ['使用动态', '看看最近哪些记忆被读取、哪些事情正在继续。'],
    ['Agent 接入', '连接新的 AI 助手，复制中文接入提示词，检查连接状态。'],
    ['关系图', '看看人物、工具、项目和经验之间有什么联系。'],
    ['标签', '按主题快速找到同类内容。'],
    ['自动整理', '让重复、过期和零散内容得到整理。'],
    ['导入旧内容', '把以前保存的资料带进 KeyMemory。'],
    ['回收站', '找回误删内容，或决定彻底清理。'],
  ];
  return (
    <article>
      <div className="guide-page-number">05</div>
      <span className="guide-eyebrow">页面功能一览</span>
      <h3>平时最常用的是“记忆邮箱”和“Agent 接入”。</h3>
      <div className="guide-feature-grid">
        {items.map(([title, description]) => <div key={title}>{title === '记忆邮箱' ? <Mail size={15} /> : <Layers size={15} />}<strong>{title}</strong><span>{description}</span></div>)}
      </div>
    </article>
  );
}

function HelpPage({ onOpenIntegrations }: { onOpenIntegrations: () => void }) {
  return (
    <article>
      <div className="guide-page-number">06</div>
      <span className="guide-eyebrow">常见问题</span>
      <h3>大多数问题，都可以按下面顺序解决。</h3>
      <div className="guide-faq-list">
        <details open><summary>一键接入按钮不能点</summary><p>先看页面是否提示“页面和后台版本不一致”。如果有，关闭并重新启动 KeyMemory，然后点击“检测接入状态”。没有检测到某个助手时，仍然可以主动选择它并接入。</p></details>
        <details><summary>页面说已配置，但助手找不到记忆</summary><p>重启这个 AI 助手，再让它检查连接并做一次只读搜索。只有真实返回记忆内容，才算连接成功。</p></details>
        <details><summary>换了一个新的 AI 助手</summary><p>打开“Agent 接入”，复制页面底部的中文接入提示词，发给新助手。完成后回到页面重新检测。</p></details>
        <details><summary>记忆写错了或已经过期</summary><p>在“记忆”中打开并修改。助手发现新事实时，也会保留新版本并让旧版本失效，避免继续使用错误内容。</p></details>
      </div>
      <button type="button" className="guide-action-button" onClick={onOpenIntegrations}><Search size={15} />打开接入与检测页面</button>
    </article>
  );
}
