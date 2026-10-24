interface ToggleSwitchProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

export function ToggleSwitch({ label, checked, disabled, onChange }: ToggleSwitchProps) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked}
    className="audio-toggle-switch" disabled={disabled} onClick={() => onChange(!checked)}>
    <span className="audio-toggle-track"><span className="audio-toggle-thumb" /></span>
  </button>;
}
