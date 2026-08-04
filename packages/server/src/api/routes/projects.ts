/**
 * KM-410：项目与项目建议路由（从 rest.ts 拆出）
 */
import type { FastifyInstance } from 'fastify';
import { createProject, getProject, listProjects, updateProject, deleteProject, moveProject, getProjectPath, getProjectDescendants, getProjectMemories, listProjectSuggestions, acceptProjectSuggestion, rejectProjectSuggestion } from '../../core/project.js';
import { getDatabase } from '../../db/sqlite.js';
import { callerIsAdminOrAnonymous, filterMemoriesByOwner, getCaller, requireAdmin } from './shared.js';

export function registerProjectRoutes(app: FastifyInstance): void {
  app.get('/api/projects', async (request) => {
    const caller = getCaller(request);
    const projects = listProjects();
    return filterMemoriesByOwner(projects, caller, 'projects');
  });

  app.post('/api/projects', async (request, reply) => {
    const input = request.body as { name: string; parentId?: string | null; description?: string };
    if (!input.name) {
      reply.code(400);
      return { error: 'Project name is required' };
    }
    // 透传 caller userId 到 createProject,使项目写入 owner_user_id
    const caller = getCaller(request);
    const project = createProject({ ...input, ...(caller?.userId ? { ownerUserId: caller.userId } : {}) });
    reply.code(201);
    return project;
  });

  app.get('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = getProject(id);
    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }
    return project;
  });

  app.put('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = request.body as { name?: string; description?: string };
    const project = updateProject(id, input);
    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }
    return project;
  });

  app.delete('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;
    const strategy = query.strategy === 'promote' ? 'promote' : 'cascade';
    const ok = deleteProject(id, strategy);
    if (!ok) {
      reply.code(404);
      return { error: 'Project not found' };
    }
    return { success: true };
  });

  app.post('/api/projects/:id/move', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { parentId } = request.body as { parentId?: string | null };
    const project = moveProject(id, parentId ?? null);
    if (!project) {
      reply.code(400);
      return { error: 'Invalid move' };
    }
    return project;
  });

  app.get('/api/projects/:id/children', async (request, reply) => {
    const { id } = request.params as { id: string };
    const caller = getCaller(request);
    return filterMemoriesByOwner(listProjects(id), caller, 'projects');
  });

  app.get('/api/projects/:id/descendants', async (request, reply) => {
    const { id } = request.params as { id: string };
    return getProjectDescendants(id);
  });

  app.get('/api/projects/:id/path', async (request, reply) => {
    const { id } = request.params as { id: string };
    return getProjectPath(id);
  });

  app.get('/api/projects/:id/memories', async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;
    return getProjectMemories(id, {
      layer: query.layer,
      includeDescendants: query.includeDescendants === 'true',
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
  });

  // Project Suggestion routes
  app.get('/api/project-suggestions', async (request) => {
    const query = request.query as Record<string, string>;
    const suggestions = listProjectSuggestions(query.status as 'pending' | 'accepted' | 'rejected' | undefined);
    const caller = getCaller(request);
    if (callerIsAdminOrAnonymous(caller)) return suggestions;
    // member/exec/pm:只看涉及自己拥有项目(或 owner 为 NULL 的旧项目)的建议
    const db = getDatabase();
    const uid = caller!.userId;
    return suggestions.filter((s) => {
      if (!s.projectIds || s.projectIds.length === 0) return true;
      const placeholders = s.projectIds.map(() => '?').join(',');
      const rows = db.prepare(`SELECT owner_user_id FROM projects WHERE id IN (${placeholders})`).all(...s.projectIds) as { owner_user_id: string | null }[];
      // 至少一个项目是该 caller 拥有或 owner 为 NULL(旧数据)时保留
      return rows.some(r => !r.owner_user_id || r.owner_user_id === uid);
    });
  });

  app.post('/api/project-suggestions/:id/accept', async (request, reply) => {
    // 项目结构调整,限 admin
    if (!requireAdmin(reply, getCaller(request))) return;
    const { id } = request.params as { id: string };
    const body = request.body as { customName?: string };
    const result = acceptProjectSuggestion(id, body?.customName);
    if (!result.success) {
      reply.code(400);
      return { error: result.error };
    }
    return result;
  });

  app.post('/api/project-suggestions/:id/reject', async (request, reply) => {
    // 项目结构调整,限 admin
    if (!requireAdmin(reply, getCaller(request))) return;
    const { id } = request.params as { id: string };
    const ok = rejectProjectSuggestion(id);
    if (!ok) {
      reply.code(400);
      return { error: 'Suggestion not found or already processed' };
    }
    return { success: true };
  });
}
