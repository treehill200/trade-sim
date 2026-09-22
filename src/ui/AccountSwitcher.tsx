import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { formatCents } from '@/chart/format';
import { useTrading } from '@/state/tradingStore';
import { unrealisedPnl } from '@/trading/engine';
import { currentQuote } from './useQuote';

/** Switch between named accounts, and add, rename or delete them. */
export function AccountSwitcher(): JSX.Element {
  const accounts = useTrading((s) => s.accounts);
  const activeId = useTrading((s) => s.activeId);
  const select = useTrading((s) => s.selectAccount);
  const addAccount = useTrading((s) => s.addAccount);
  const renameAccount = useTrading((s) => s.renameAccount);
  const deleteAccount = useTrading((s) => s.deleteAccount);

  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [anchor, setAnchor] = useState({ right: 0, bottom: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  /**
   * The popover is positioned in viewport coordinates.
   *
   * The account summary strip scrolls horizontally, so a popover in normal
   * flow would be clipped by it; and the strip sits at the bottom of the
   * window, so the list has to open upwards.
   */
  const openList = (): void => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      setAnchor({
        right: Math.max(8, window.innerWidth - rect.right),
        bottom: window.innerHeight - rect.top + 6,
      });
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setRenaming(null);
        setConfirmDelete(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const active = accounts.find((a) => a.id === activeId) ?? accounts[0];
  const quote = currentQuote();

  return (
    <div className="menu-anchor" ref={ref}>
      <button ref={buttonRef} className="account-switch" onClick={openList} title="Switch account">
        <span>{active?.name ?? 'Account'}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          className="menu-popover account-popover"
          style={{ right: anchor.right, bottom: anchor.bottom }}
        >
          {accounts.map((a) => {
            const equity = a.balanceCents + unrealisedPnl(a.position, quote.lastCents);
            if (renaming === a.id) {
              return (
                <div className="account-row" key={a.id}>
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        renameAccount(a.id, draft);
                        setRenaming(null);
                      }
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                  <button
                    title="Save"
                    onClick={() => {
                      renameAccount(a.id, draft);
                      setRenaming(null);
                    }}
                  >
                    <Check size={13} />
                  </button>
                </div>
              );
            }
            return (
              <div className={`account-row ${a.id === activeId ? 'selected' : ''}`} key={a.id}>
                <button
                  className="account-pick"
                  onClick={() => {
                    select(a.id);
                    setOpen(false);
                  }}
                >
                  <span className="account-row-name">{a.name}</span>
                  <span className="account-row-equity">{formatCents(equity)}</span>
                </button>
                <button
                  title="Rename"
                  onClick={() => {
                    setDraft(a.name);
                    setRenaming(a.id);
                  }}
                >
                  <Pencil size={12} />
                </button>
                {accounts.length > 1 &&
                  (confirmDelete === a.id ? (
                    <button
                      className="danger"
                      title="Confirm delete"
                      onClick={() => {
                        deleteAccount(a.id);
                        setConfirmDelete(null);
                      }}
                    >
                      <Check size={12} />
                    </button>
                  ) : (
                    <button className="danger" title="Delete" onClick={() => setConfirmDelete(a.id)}>
                      <Trash2 size={12} />
                    </button>
                  ))}
              </div>
            );
          })}
          <button
            className="menu-item"
            onClick={() => {
              addAccount(`Account ${accounts.length + 1}`);
              setOpen(false);
            }}
          >
            <Plus size={14} />
            <span>New account</span>
          </button>
        </div>
      )}
    </div>
  );
}
