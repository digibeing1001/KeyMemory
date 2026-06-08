import { useState, useEffect, useCallback } from 'react';
import type { Project } from '@keymemory/shared';
import { listProjects } from '../lib/api';
import { Folder, ChevronRight, ChevronDown } from './Icons';
import { useI18n } from '../i18n';

interface ProjectTreeProps {
  activeProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
  refreshToken?: number;
}

interface TreeNode {
  project: Project;
  children: TreeNode[];
}

function buildTree(projects: Project[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const project of projects) {
    nodeMap.set(project.id, { project, children: [] });
  }

  for (const project of projects) {
    const node = nodeMap.get(project.id)!;
    if (!project.parentId) {
      roots.push(node);
      continue;
    }
    const parent = nodeMap.get(project.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  roots.sort((a, b) => a.project.path.localeCompare(b.project.path));
  for (const node of nodeMap.values()) {
    node.children.sort((a, b) => a.project.path.localeCompare(b.project.path));
  }
  return roots;
}

function TreeItem({
  node,
  level,
  activeProjectId,
  onSelectProject,
  expandedIds,
  onToggleExpand,
}: {
  node: TreeNode;
  level: number;
  activeProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
}) {
  const isExpanded = expandedIds.has(node.project.id);
  const isActive = activeProjectId === node.project.id;
  const hasChildren = node.children.length > 0;
  const childCount = node.children.length;

  return (
    <div>
      <div
        className="project-tree-item flex items-center gap-1 select-none"
        style={{
          width: '100%',
          padding: '4px 8px',
          paddingLeft: 8 + level * 16,
          borderRadius: 'var(--radius-sm)',
          border: 'none',
          background: isActive ? 'var(--bg-hover)' : 'transparent',
          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontWeight: isActive ? 650 : 400,
          fontSize: 13,
          textAlign: 'left',
          minHeight: 30,
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="project-tree-expand"
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.project.name}`}
            aria-expanded={isExpanded}
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpand(node.project.id);
            }}
            style={{ display: 'flex', alignItems: 'center', color: 'var(--text-muted)' }}
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span style={{ width: 14 }} />
        )}
        <button
          type="button"
          className="project-tree-select"
          onClick={() => onSelectProject(node.project.id)}
        >
          <Folder size={14} style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }} />
          <span className="truncate" style={{ flex: 1, minWidth: 0 }}>
            {node.project.name}
          </span>
          {childCount > 0 && (
            <span className="project-tree-count">
              {childCount}
            </span>
          )}
        </button>
      </div>
      {isExpanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeItem
              key={child.project.id}
              node={child}
              level={level + 1}
              activeProjectId={activeProjectId}
              onSelectProject={onSelectProject}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProjectTree({ activeProjectId, onSelectProject, refreshToken = 0 }: ProjectTreeProps) {
  const { t } = useI18n();
  const [projects, setProjects] = useState<Project[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listProjects();
      setProjects(data);
      const parentIds = new Set(data.map((project) => project.parentId).filter((id): id is string => Boolean(id)));
      setExpandedIds((prev) => {
        const next = new Set(prev);
        for (const project of data) {
          if (parentIds.has(project.id)) next.add(project.id);
        }
        return next;
      });
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects, refreshToken]);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const tree = buildTree(projects);

  return (
    <div className="project-tree-section" style={{ marginBottom: 16 }}>
      <div
        className="flex items-center justify-between"
        style={{
          padding: '8px 12px',
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        <span>{t('sidebar.projects')}</span>
        <button type="button" className="project-tree-refresh" onClick={fetchProjects} style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {t('common.refresh')}
        </button>
      </div>

      {loading && projects.length === 0 && (
        <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>{t('common.loading')}</div>
      )}

      <div className="project-tree-list">
        {tree.map((node) => (
          <TreeItem
            key={node.project.id}
            node={node}
            level={0}
            activeProjectId={activeProjectId}
            onSelectProject={onSelectProject}
            expandedIds={expandedIds}
            onToggleExpand={handleToggleExpand}
          />
        ))}
        {!loading && tree.length === 0 && (
          <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
            {t('project.empty')}
          </div>
        )}
      </div>

      {activeProjectId && (
        <button
          type="button"
          className="project-tree-clear"
          style={{
            width: '100%',
            border: 'none',
            background: 'transparent',
            padding: '6px 8px',
            marginTop: 4,
            fontSize: 12,
            color: 'var(--accent)',
            cursor: 'pointer',
          }}
          onClick={() => onSelectProject(null)}
        >
          {t('common.all')}
        </button>
      )}
    </div>
  );
}
