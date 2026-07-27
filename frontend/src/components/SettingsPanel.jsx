export function SettingsPanel({
  open,
  onClose,
  accentColor,
  onAccentColorChange,
  sensitivity,
  onSensitivityChange,
}) {
  if (!open) return null;

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h2>Settings</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </div>

        <div className="settings-field">
          <label htmlFor="accent-color-input">Accent color</label>
          <div className="settings-color-row">
            <input
              id="accent-color-input"
              type="color"
              value={accentColor}
              onChange={(e) => onAccentColorChange(e.target.value)}
            />
            <span className="settings-hint">{accentColor}</span>
          </div>
        </div>

        <div className="settings-field">
          <label htmlFor="sensitivity-input">
            Mic sensitivity{" "}
            <span className="settings-hint">
              ({sensitivity <= 3 ? "low" : sensitivity <= 7 ? "medium" : "high"})
            </span>
          </label>
          <input
            id="sensitivity-input"
            type="range"
            min="1"
            max="10"
            step="1"
            value={sensitivity}
            onChange={(e) => onSensitivityChange(Number(e.target.value))}
          />
          <p className="settings-hint">
            Higher sensitivity picks up quieter speech, but may also trigger on
            background noise.
          </p>
        </div>
      </div>
    </div>
  );
}
