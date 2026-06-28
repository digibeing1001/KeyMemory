// 检查关联表结构
const Database = require('/home/zexin/KeyMemory/packages/server/node_modules/better-sqlite3');
const db = new Database('/home/zexin/.keymemory/data.db', { readonly: true });

for (const t of ['memory_entities', 'memory_relations', 'memory_chunks', 'versions', 'embeddings', 'entities', 'relations']) {
  console.log('=== ' + t + ' ===');
  try {
    const cols = db.prepare('PRAGMA table_info(' + t + ')').all();
    console.log(cols.map(c => c.name + ':' + c.type).join(', '));
    const cnt = db.prepare('SELECT COUNT(*) as n FROM ' + t).get();
    console.log('  rows: ' + cnt.n);
  } catch (e) { console.log('  不存在: ' + e.message); }
}

db.close();
