export function MobilePaletteAmbient({ className }: { className: string }) {
  return <span className={`dmex-mobile-palette-ambient ${className}`} aria-hidden="true">
    <span className="dmex-mobile-palette-field is-primary" />
    <span className="dmex-mobile-palette-field is-secondary" />
    <span className="dmex-mobile-palette-field is-tertiary" />
  </span>;
}
