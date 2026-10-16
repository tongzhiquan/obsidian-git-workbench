export function statusLabel(status: string, context?: 'conflict' | 'untracked'): { letter: string; kind: string; label: string } {
  if (context === 'conflict') return { letter: 'U', kind: 'conflict', label: '存在冲突（未合并）' };
  if (context === 'untracked' || status === '?') return { letter: 'U', kind: 'untracked', label: '未跟踪（尚未加入 Git）' };
  const labels: Record<string, [string, string]> = {
    A: ['added', '新增'], M: ['modified', '修改'], D: ['deleted', '删除'], R: ['renamed', '重命名'],
    C: ['copied', '复制'], T: ['modified', '文件类型变化'], U: ['conflict', '存在冲突（未合并）'],
  };
  const letter = status[0] ?? '?', entry = labels[letter];
  return { letter, kind: entry?.[0] ?? 'unknown', label: entry?.[1] ?? '其他变化' };
}
