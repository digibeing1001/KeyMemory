import { useState, useCallback } from 'react';
import type { Layer } from '@keymemory/shared';
import { useMemoryStore } from './hooks/useMemoryStore';
import { ToastProvider, useToast } from './components/Toast';
import Layout from './components/Layout';
import LayerNav from './components/LayerNav';
import MemoryList from './components/MemoryList';
import Editor from './views/Editor';
import ConfirmDialog from './components/ConfirmDialog';

function AppInner() {
  const store = useMemoryStore();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState<{
    open: boolean;
    title: string;
    message: string;
    danger: boolean;
    onConfirm: () => void;
  }>({ open: false, title: '', message: '', danger: false, onConfirm: () => {} });

  const showConfirm = useCallback(
    (title: string, message: string, onConfirm: () => void, danger = false) => {
      setConfirm({ open: true, title, message, danger, onConfirm });
    },
    [],
  );

  const handleSave = useCallback(
    async (data: { title: string; content: string; layer: Layer; project?: string }) => {
      try {
        await store.save(data);
        toast(store.selectedMemory ? '记忆已更新' : '记忆已创建', 'success');
      } catch (err) {
        toast('保存失败，请重试', 'error');
      }
    },
    [store, toast],
  );

  const handleDelete = useCallback(
    (id: string) => {
      showConfirm('删除记忆', '确定要删除这条记忆吗？此操作不可撤销。', async () => {
        try {
          await store.deleteMemory(id);
          toast('记忆已删除', 'success');
        } catch {
          toast('删除失败，请重试', 'error');
        }
      }, true);
    },
    [store, toast, showConfirm],
  );

  const handleArchive = useCallback(
    (id: string) => {
      showConfirm('归档记忆', '确定要归档这条记忆吗？', async () => {
        try {
          await store.archiveMemory(id);
          toast('记忆已归档', 'success');
        } catch {
          toast('归档失败，请重试', 'error');
        }
      });
    },
    [store, toast, showConfirm],
  );

  const handleMoveLayer = useCallback(
    async (id: string, layer: Layer) => {
      try {
        await store.moveLayer(id, layer);
        toast('层级已移动', 'success');
      } catch {
        toast('移动失败，请重试', 'error');
      }
    },
    [store, toast],
  );

  return (
    <Layout
      onSearch={store.search}
      onClearSearch={store.clearSearch}
      onCreateNew={store.createNew}
      healthOk={store.healthOk}
      loading={store.loading}
    >
      <div className="w-[200px] shrink-0 border-r" style={{ borderColor: 'var(--border)' }}>
        <LayerNav
          activeLayer={store.selectedLayer}
          onSelectLayer={store.selectLayer}
          layerStats={store.layerStats}
        />
      </div>

      <div className="w-[280px] shrink-0 border-r" style={{ borderColor: 'var(--border)' }}>
        <MemoryList
          memories={store.memories}
          selectedId={store.selectedId}
          onSelect={store.selectMemory}
          loading={store.loading}
          searchQuery={store.searchQuery}
        />
      </div>

      <div className="flex-1">
        <Editor
          memory={store.selectedMemory}
          isCreating={store.isCreating}
          loading={store.loading}
          onSave={handleSave}
          onDelete={handleDelete}
          onArchive={handleArchive}
          onMoveLayer={handleMoveLayer}
          onCancelCreate={store.cancelCreate}
        />
      </div>

      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        danger={confirm.danger}
        confirmLabel={confirm.danger ? '删除' : '确认'}
        onConfirm={() => {
          confirm.onConfirm();
          setConfirm((prev) => ({ ...prev, open: false }));
        }}
        onCancel={() => setConfirm((prev) => ({ ...prev, open: false }))}
      />
    </Layout>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
