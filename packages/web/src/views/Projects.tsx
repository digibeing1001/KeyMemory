import type { Memory } from '@keymemory/shared';

interface ProjectsProps {
  memories: Memory[];
  activeProject: string | null;
  onSelectProject: (project: string | null) => void;
}

export default function Projects({ memories, activeProject, onSelectProject }: ProjectsProps) {
  const projectMap = new Map<string, number>();
  for (const m of memories) {
    if (m.project) {
      projectMap.set(m.project, (projectMap.get(m.project) || 0) + 1);
    }
  }

  const projects = Array.from(projectMap.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">项目</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <button
          onClick={() => onSelectProject(null)}
          className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
            activeProject === null
              ? 'bg-gray-100 font-medium text-gray-900'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <span className="flex-1 text-left">全部项目</span>
        </button>

        {projects.length === 0 ? (
          <p className="py-8 text-center text-xs text-gray-400">暂无项目</p>
        ) : (
          projects.map(([name, count]) => (
            <button
              key={name}
              onClick={() => onSelectProject(activeProject === name ? null : name)}
              className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                activeProject === name
                  ? 'bg-purple-50 font-medium text-purple-700'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span className="flex-1 text-left">{name}</span>
              <span className="text-xs text-gray-400">{count}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
