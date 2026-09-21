import { ChevronsRight } from 'lucide-react';

/** Jump-back-to-now button, shown only when the chart is scrolled into history. */
export function ScrollToRealtime({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button className="scroll-realtime" onClick={onClick} title="Scroll to the most recent candle">
      <ChevronsRight size={16} strokeWidth={2.2} />
    </button>
  );
}
