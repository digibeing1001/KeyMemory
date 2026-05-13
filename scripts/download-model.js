#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

const MIRROR_BASES = [
  'https://hf-mirror.com/sentence-transformers/all-MiniLM-L6-v2/resolve/main',
  'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main',
];

const MODEL_DIR = path.join(__dirname, '..', 'packages', 'server', 'models');

const FILES = [
  { path: 'onnx/model.onnx', name: 'all-MiniLM-L6-v2.onnx', label: 'ONNX 模型 (FP32)' },
  { path: 'tokenizer.json', name: 'tokenizer.json', label: 'BERT 分词器' },
];

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const attempt = (currentUrl, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));

      const file = fs.createWriteStream(dest);
      https.get(currentUrl, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          file.close();
          try { fs.unlinkSync(dest); } catch {}
          const redirectUrl = response.headers.location;
          if (!redirectUrl) return reject(new Error('Redirect without location'));
          return attempt(redirectUrl, redirects + 1);
        }

        if (response.statusCode !== 200) {
          file.close();
          try { fs.unlinkSync(dest); } catch {}
          return reject(new Error(`HTTP ${response.statusCode}`));
        }

        const total = parseInt(response.headers['content-length'] || '0', 10);
        let downloaded = 0;
        let lastPercent = -1;

        response.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total > 0) {
            const percent = Math.floor((downloaded / total) * 100);
            if (percent !== lastPercent && percent % 10 === 0) {
              lastPercent = percent;
              process.stdout.write(`\r   下载进度: ${percent}% (${formatBytes(downloaded)} / ${formatBytes(total)})`);
            }
          }
        });

        response.pipe(file);
        file.on('finish', () => {
          file.close();
          if (total > 0) process.stdout.write('\n');
          resolve(downloaded);
        });
      }).on('error', (err) => {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        reject(err);
      });
    };

    attempt(url);
  });
}

async function downloadWithMirrors(fileSubpath, dest, label) {
  for (let mi = 0; mi < MIRROR_BASES.length; mi++) {
    const base = MIRROR_BASES[mi];
    const url = `${base}/${fileSubpath}`;
    const mirrorLabel = mi === 0 ? '镜像站' : '官方源';

    console.log(`\n⬇️  下载 ${label} (${mirrorLabel})...`);
    console.log(`   URL: ${url}`);

    let retries = 0;
    const maxRetries = 2;

    while (retries < maxRetries) {
      try {
        const size = await downloadFile(url, dest);
        console.log(`   ✅ 下载完成 (${formatBytes(size)})`);
        return size;
      } catch (err) {
        retries++;
        if (retries >= maxRetries) {
          console.log(`   ❌ ${mirrorLabel}下载失败: ${err.message}`);
          break;
        }
        console.log(`   重试 ${retries}/${maxRetries}...`);
        await new Promise(r => setTimeout(r, 2000 * retries));
      }
    }
  }

  throw new Error(`所有下载源均失败: ${fileSubpath}`);
}

async function main() {
  console.log('📥 KeyMemory 嵌入模型下载器');
  console.log('========================');
  console.log(`\n📂 目标目录: ${MODEL_DIR}`);

  if (!fs.existsSync(MODEL_DIR)) {
    fs.mkdirSync(MODEL_DIR, { recursive: true });
  }

  let totalSize = 0;

  for (const file of FILES) {
    const dest = path.join(MODEL_DIR, file.name);

    if (fs.existsSync(dest)) {
      const stat = fs.statSync(dest);
      console.log(`\n✅ ${file.label} 已存在 (${formatBytes(stat.size)})`);
      totalSize += stat.size;
      continue;
    }

    const size = await downloadWithMirrors(file.path, dest, file.label);
    totalSize += size;
  }

  console.log(`\n✅ 所有文件下载完成！`);
  console.log(`📊 总大小: ${formatBytes(totalSize)}`);
  console.log(`\n💡 模型文件位于: ${MODEL_DIR}`);
  console.log('   程序启动时会自动加载内置模型，无需联网下载。');
}

main().catch(err => {
  console.error(`\n❌ ${err.message}`);
  console.error('   请检查网络连接后重试，或手动下载模型文件到 packages/server/models/ 目录。');
  process.exit(1);
});
