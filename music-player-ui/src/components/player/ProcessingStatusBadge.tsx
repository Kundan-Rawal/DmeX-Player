import { Disc3, LoaderCircle, Power, Settings2 } from 'lucide-react';
import type { ProcessingStatus } from '../../config/soundSelection';
import './ProcessingStatusBadge.css';

export function ProcessingStatusBadge({ status, onToggle, disabled = false, className = '' }: {
  status: ProcessingStatus; onToggle: () => void; disabled?: boolean; className?: string;
}) {
  const action = status.kind === 'raw' ? 'Bypass All is active' : status.kind === 'manual'
    ? 'Restore original processing and selected preset' : status.categoryEnabled ? 'Disable original processing' : 'Enable original processing';
  const Icon = status.kind === 'raw' ? Power : status.kind === 'manual' ? Settings2 : status.kind === 'pending' ? LoaderCircle : Disc3;
  return <button type="button" className={`processing-status-badge ${className}`} data-processing-kind={status.kind}
    aria-label={`Active sound: ${status.label}. ${action}`} aria-pressed={status.kind === 'automatic' && status.categoryEnabled}
    aria-busy={status.kind === 'pending'} title={`${status.label}. ${action}`} disabled={disabled || status.kind === 'pending'} onClick={onToggle}>
    <Icon size={14} aria-hidden="true" /><span className="processing-category">{status.category || (status.pill ? '' : status.label)}</span>
    {status.pill && <span className="processing-pill">{status.category ? '+ ' : ''}{status.pill}</span>}
  </button>;
}
