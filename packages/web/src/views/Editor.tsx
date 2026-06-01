import type { Layer, Memory } from '@keymemory/shared';
import MarkdownEditor from '../components/MarkdownEditor';
import { useI18n } from '../i18n';

interface EditorProps {
  memory: Memory | null;
  isCreating: boolean;
  loading?: boolean;
  onSave: (data: { title: string; content: string; layer: Layer; projectId?: string; tags?: string[]; source?: string; metadata?: Record<string, unknown> }) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  onMoveLayer: (id: string, layer: Layer) => void;
  onCancelCreate: () => void;
}

export default function Editor({
  memory,
  isCreating,
  loading,
  onSave,
  onCancelCreate,
}: EditorProps) {
  const { t } = useI18n();

  if (!isCreating && !memory) return null;

  return (
    <div className="flex h-full flex-col animate-fade-in">
      <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          {isCreating ? t('editor.new') : t('editor.edit')}
        </h2>
      </div>
      <MarkdownEditor
        memory={memory}
        onSave={onSave}
        onCancel={onCancelCreate}
        loading={loading}
      />
    </div>
  );
}
