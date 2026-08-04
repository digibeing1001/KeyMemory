/**
 * KM-410：迁移（migration）路由（从 rest.ts 拆出）
 */
import type { FastifyInstance } from 'fastify';
import type { Layer } from '@keymemory/shared';
import { discoverMigrationSources, migrateMemoriesFromPath, migrateMigrationSources, previewMigrationSource } from '../../core/migration.js';
import { assertSafeImportPath, createMigrationBackup } from './shared.js';

export function registerMigrationRoutes(app: FastifyInstance): void {
  app.post('/api/migration/import-file', async (request, reply) => {
    const body = request.body as {
      filePath?: string;
      format?: 'auto' | 'json' | 'jsonl' | 'markdown' | 'text';
      source?: string;
      defaultLayer?: Layer;
      defaultProjectPath?: string;
      runDream?: boolean;
      dryRun?: boolean;
      createBackupBeforeImport?: boolean;
    };
    if (!body.filePath) {
      reply.code(400);
      return { error: 'filePath is required' };
    }
    try {
      assertSafeImportPath(body.filePath);
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
    try {
      const backup = createMigrationBackup(body.createBackupBeforeImport, body.dryRun);
      const result = await migrateMemoriesFromPath(body.filePath, {
        format: body.format,
        source: body.source,
        defaultLayer: body.defaultLayer,
        defaultProjectPath: body.defaultProjectPath,
        runDream: body.runDream,
        dryRun: body.dryRun,
      });
      return { ...result, backup };
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.get('/api/migration/sources', async (request) => {
    const query = request.query as Record<string, string>;
    const roots = query.root
      ? query.root.split(/[;,]/g).map(root => root.trim()).filter(Boolean)
      : undefined;
    return discoverMigrationSources({
      roots,
      includeHome: query.includeHome !== 'false',
      includeMissing: query.includeMissing === 'true',
      maxFilesPerDirectory: query.maxFiles ? parseInt(query.maxFiles, 10) : undefined,
    });
  });

  /**
   * 只读预览某个已发现迁移来源的导入结果（AG3）：逐条展示将迁移内容、
   * 去重跳过与重复候选，不写入任何数据。maxItems 默认 50，上限 500。
   */
  app.get('/api/migration/sources/:sourceId/preview', async (request, reply) => {
    const { sourceId } = request.params as { sourceId: string };
    const query = request.query as Record<string, string>;
    const roots = query.root
      ? query.root.split(/[;,]/g).map(root => root.trim()).filter(Boolean)
      : undefined;
    const sources = discoverMigrationSources({ roots, includeHome: query.includeHome !== 'false' });
    const candidate = sources.find(item => item.id === sourceId);
    if (!candidate) {
      reply.code(404);
      return { error: `Migration source not found: ${sourceId}` };
    }
    const maxItems = query.maxItems ? Math.min(Math.max(parseInt(query.maxItems, 10) || 50, 1), 500) : undefined;
    return previewMigrationSource(candidate, maxItems ? { maxItems } : undefined);
  });

  app.post('/api/migration/import-path', async (request, reply) => {
    const body = request.body as {
      path?: string;
      format?: 'auto' | 'json' | 'jsonl' | 'markdown' | 'text';
      source?: string;
      defaultLayer?: Layer;
      defaultProjectPath?: string;
      recursive?: boolean;
      maxFiles?: number;
      runDream?: boolean;
      dryRun?: boolean;
      createBackupBeforeImport?: boolean;
    };
    if (!body.path) {
      reply.code(400);
      return { error: 'path is required' };
    }
    try {
      assertSafeImportPath(body.path);
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
    try {
      const backup = createMigrationBackup(body.createBackupBeforeImport, body.dryRun);
      const result = await migrateMemoriesFromPath(body.path, {
        format: body.format,
        source: body.source,
        defaultLayer: body.defaultLayer,
        defaultProjectPath: body.defaultProjectPath,
        recursive: body.recursive,
        maxFiles: body.maxFiles,
        runDream: body.runDream,
        dryRun: body.dryRun,
      });
      return { ...result, backup };
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.post('/api/migration/import-discovered', async (request, reply) => {
    const body = request.body as {
      root?: string;
      includeHome?: boolean;
      minConfidence?: number;
      defaultLayer?: Layer;
      defaultProjectPath?: string;
      maxFiles?: number;
      runDream?: boolean;
      dryRun?: boolean;
      createBackupBeforeImport?: boolean;
    };
    try {
      const roots = body.root
        ? body.root.split(/[;,]/g).map(root => root.trim()).filter(Boolean)
        : undefined;
      const minConfidence = body.minConfidence ?? 0.7;
      const sources = discoverMigrationSources({ roots, includeHome: body.includeHome !== false })
        .filter(source => source.confidence >= minConfidence);
      const backup = createMigrationBackup(body.createBackupBeforeImport, body.dryRun);
      const result = await migrateMigrationSources(sources, {
        defaultLayer: body.defaultLayer,
        defaultProjectPath: body.defaultProjectPath,
        maxFiles: body.maxFiles,
        runDream: body.runDream,
        dryRun: body.dryRun,
      });
      return { ...result, backup, sources };
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });
}
