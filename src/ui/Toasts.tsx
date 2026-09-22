import { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useNotices, type Notice, type NoticeTone } from '@/state/notifications';

const ICONS: Record<NoticeTone, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

/** How long a notice stays before dismissing itself. */
const LIFETIME_MS: Record<NoticeTone, number> = {
  info: 3200,
  success: 3200,
  warning: 5000,
  error: 7000,
};

export function Toasts(): JSX.Element {
  const notices = useNotices((s) => s.notices);
  return (
    <div className="toasts">
      {notices.map((n) => (
        <Toast key={n.id} notice={n} />
      ))}
    </div>
  );
}

function Toast({ notice }: { notice: Notice }): JSX.Element {
  const dismiss = useNotices((s) => s.dismiss);
  const Icon = ICONS[notice.tone];

  useEffect(() => {
    const id = setTimeout(() => dismiss(notice.id), LIFETIME_MS[notice.tone]);
    return () => clearTimeout(id);
  }, [notice.id, notice.tone, dismiss]);

  return (
    <div className={`toast toast-${notice.tone}`} role="status">
      <Icon size={16} />
      <div className="toast-text">
        <strong>{notice.title}</strong>
        {notice.body && <span>{notice.body}</span>}
      </div>
      <button className="toast-close" onClick={() => dismiss(notice.id)} aria-label="Dismiss">
        <X size={13} />
      </button>
    </div>
  );
}
