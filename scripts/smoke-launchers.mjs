import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keymemory launcher smoke '));
const logDir = path.join(dataDir, 'logs');
const workspace = path.join(dataDir, 'workspace with spaces');
const agentFile = path.join(workspace, 'AGENTS.md');

fs.mkdirSync(workspace, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });
fs.writeFileSync(agentFile, [
  '# Launcher Smoke',
  'Preference: launcher smoke should preserve paths with spaces for [[Launcher/Smoke]].',
].join('\n'), 'utf8');

function env(extra = {}) {
  return {
    ...process.env,
    KEYMEMORY_DATA_DIR: dataDir,
    KEYMEMORY_LOG_DIR: logDir,
    ...extra,
  };
}

function runNodeScript(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: env(),
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${script} failed with ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`expected JSON from ${label}, got:\n${text}\n${err.message}`);
  }
}

function runKeymemory(args) {
  return parseJson(runNodeScript(path.join('bin', 'keymemory.js'), args), `keymemory.js ${args.join(' ')}`);
}

function runPlatformWrapper(args) {
  const command = process.platform === 'win32' ? 'cmd.exe' : process.execPath;
  const wrapperArgs = process.platform === 'win32'
    ? ['/d', '/c', `"${[path.join(root, 'bin', 'keymemory.cmd'), ...args].map(quoteCmdArg).join(' ')}"`]
    : [path.join(root, 'bin', 'keymemory'), ...args];
  const result = spawnSync(command, wrapperArgs, {
    cwd: root,
    env: env(),
    encoding: 'utf8',
    windowsVerbatimArguments: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`platform wrapper failed with ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return parseJson(result.stdout.trim(), 'platform keymemory wrapper');
}

function quoteCmdArg(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

if (process.platform !== 'win32') {
  const installScript = fs.readFileSync(path.join(root, 'bin', 'install.js'), 'utf8');
  for (const launcher of ['keymemory', 'keymemory-mcp', 'keymemory-ui', 'keymemory-ui-wsl']) {
    if (!installScript.includes(`'${launcher}'`) || !installScript.includes('chmodSync')) {
      throw new Error(`expected pnpm setup to chmod POSIX launcher: ${launcher}`);
    }
  }
}

function callMcpLauncher() {
  const child = spawn(process.execPath, [path.join(root, 'bin', 'keymemory-mcp.js')], {
    cwd: root,
    env: env({ KEYMEMORY_STDIO: '1' }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let nextId = 1;
  let stdoutBuffer = '';
  const stderrChunks = [];
  const nonJsonStdout = [];
  const pending = new Map();

  child.stderr.on('data', chunk => {
    stderrChunks.push(chunk.toString());
  });

  child.stdout.on('data', chunk => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        nonJsonStdout.push(line);
        continue;
      }
      const entry = pending.get(message.id);
      if (!entry) continue;
      pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(JSON.stringify(message.error)));
      } else {
        entry.resolve(message.result);
      }
    }
  });

  function call(method, params = {}) {
    const id = nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP launcher call timed out: ${method}`));
      }, 30000);
      pending.set(id, {
        resolve: value => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: error => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
    child.stdin.write(JSON.stringify(payload) + '\n');
    return promise;
  }

  return {
    async run() {
      try {
        const initialized = await call('initialize');
        if (initialized?.serverInfo?.name !== 'keymemory') {
          throw new Error(`expected MCP launcher initialize, got ${JSON.stringify(initialized)}`);
        }
        const listed = await call('tools/list');
        const toolNames = listed.tools.map(tool => tool.name);
        for (const required of ['keymemory', 'keymemory_search', 'keymemory_context_pack', 'memory_create', 'memory_search', 'memory_context_pack', 'memory_migration_import']) {
          if (!toolNames.includes(required)) throw new Error(`missing MCP launcher tool: ${required}`);
        }
        if (nonJsonStdout.length > 0) {
          throw new Error(`MCP launcher polluted stdout: ${nonJsonStdout.join('\n')}`);
        }
        return {
          tools: toolNames.length,
          stderrLogged: stderrChunks.join('').includes('[launcher] starting MCP server'),
        };
      } finally {
        child.stdin.end();
        child.kill();
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 1000).unref();
      }
    },
  };
}

const info = runKeymemory(['--format', 'json', '--data-dir', dataDir, 'info']);
if (path.resolve(info.dataDir) !== path.resolve(dataDir)) {
  throw new Error(`expected keymemory.js info to honor --data-dir, got ${JSON.stringify(info)}`);
}

const wrapperInfo = runPlatformWrapper(['--format', 'json', '--data-dir', dataDir, 'info']);
if (path.resolve(wrapperInfo.dataDir) !== path.resolve(dataDir)) {
  throw new Error(`expected platform wrapper to honor --data-dir, got ${JSON.stringify(wrapperInfo)}`);
}

const onboard = runKeymemory([
  '--format', 'json',
  '--data-dir', dataDir,
  'onboard',
  '--no-home',
  '--root', workspace,
  '--min-confidence', '0.6',
  '--agent-target', 'codex',
]);
if (onboard.mode !== 'preview' || !onboard.migration?.dryRun || onboard.migration.imported < 1) {
  throw new Error(`expected launcher onboard preview, got ${JSON.stringify(onboard)}`);
}
if (!onboard.agentConfigs?.some(item => item.target === 'codex' && item.snippet.includes('[mcp_servers.keymemory]'))) {
  throw new Error(`expected launcher onboard Codex config, got ${JSON.stringify(onboard.agentConfigs)}`);
}

const mcp = await callMcpLauncher().run();
if (!mcp.stderrLogged) {
  throw new Error('expected MCP launcher to write startup logs to stderr');
}

console.log(JSON.stringify({
  ok: true,
  dataDir,
  wrapper: process.platform === 'win32' ? 'keymemory.cmd' : 'bin/keymemory',
  onboardPreviewImported: onboard.migration.imported,
  onboardAgentConfigs: onboard.agentConfigs.length,
  mcpTools: mcp.tools,
  mcpLauncherLoggedToStderr: mcp.stderrLogged,
}, null, 2));
