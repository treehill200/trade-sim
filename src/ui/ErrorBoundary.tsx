import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react';
import { startOver } from './recover';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * The last line of defence: catch a render error and offer a way out.
 *
 * Without this, a single bad render leaves a blank white page, which tells the
 * user nothing and gives them nothing to do. A component that crashes once has
 * usually been handed state it cannot read, so the two things worth offering
 * are a reload and a clean slate.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the stack in the console for anyone who opens it; the card below is
    // for everyone else.
    console.error('Trading Sim crashed:', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash-screen">
        <div className="crash-card">
          <div className="crash-title">
            <AlertTriangle size={18} />
            <span>Trading Sim hit a problem</span>
          </div>
          <p className="crash-text">
            Something in the app stopped working. Reloading usually fixes it. If it keeps
            happening, clearing the saved data will start a brand new market from scratch —
            you will lose your accounts, drawings and history.
          </p>
          <pre className="crash-detail">{error.message}</pre>
          <div className="crash-actions">
            <button className="primary-button" onClick={() => window.location.reload()}>
              <RotateCcw size={14} /> Reload the page
            </button>
            <button className="text-button danger" onClick={() => void startOver()}>
              <Trash2 size={13} /> Clear saved data and start over
            </button>
          </div>
        </div>
      </div>
    );
  }
}
