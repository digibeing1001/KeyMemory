import { useState, useEffect, useCallback } from 'react';
import type { Project } from '@keymemory/shared';
import { listProjects } from '../lib/api';
import { Folder, ChevronRight, ChevronDown } from './Icons';

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

  // Create all nodes
  for (const project of projects) {
    nodeMap.set(project.id, { project, children: [] });
  }

  // Build parent-child relationships
  for (const project of projects) {
    const node = nodeMap.get(project.id)!;
    if (project.parentId) {
      const parent = nodeMap.get(project.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  // Sort by path
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

  return (
    <div>
      <div
        className="flex items-center gap-1 cursor-pointer select-none"
        style={{
          padding: '4px 8px',
          paddingLeft: 8 + level * 16,
          borderRadius: 'var(--radius-sm)',
          background: isActive ? 'var(--bg-hover)' : 'transparent',
          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontWeight: isActive ? 600 : 400,
          fontSize: 13,
          transition: 'all var(--transition-fast)',
        }}
        onClick={() => onSelectProject(node.project.id)}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)';
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.background = 'transparent';
        }}
      >
        {hasChildren ? (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.project.id);
            }}
            style={{ display: 'flex', alignItems: 'center', color: 'var(--text-muted)' }}
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        ) : (
          <span style={{ width: 14 }} />
        )}
        <span style={{ display: 'flex', alignItems: 'center', color: isActive ? 'var(--primary)' : 'var(--text-muted)' }}>
          <Folder size={14} />
        </span>
        <span className="truncate" style={{ flex: 1, minWidth: 0 }}>
          {node.project.name}
        </span>
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listProjects();
      setProjects(data);
      // Auto-expand root projects
      const roots = data.filter((p) => !p.parentId);
      setExpandedIds((prev) => {
        const next = new Set(prev);
        for (const r of roots) next.add(r.id);
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
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const tree = buildTree(projects);

  return (
    <div style={{ marginBottom: 16 }}>
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
        <span>项目</span>
        <button
          onClick={fetchProjects}
          style={{
            fontSize: 11,
            color: 'var(--primary)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          刷新
        </button>
      </div>

      {loading && projects.length === 0 && (
        <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>加载中...</div>
      )}

      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
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
      </div>

      {activeProjectId && (
        <div
          className="cursor-pointer"
          style={{
            padding: '4px 8px',
            marginTop: 4,
            fontSize: 12,
            color: 'var(--primary)',
            textAlign: 'center',
          }}
          onClick={() => onSelectProject(null)}
        >
          显示全部
        </div>
      )}
    </div>
  );
}
