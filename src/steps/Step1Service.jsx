import { MAIN_BREAKER_OPTIONS } from '../data/loadLibrary';

export default function Step1Service({ project, updateProject, goNext }) {
  const { service, panel, metadata } = project;

  const update = (section, field, value) => {
    updateProject(prev => ({
      ...prev,
      [section]: { ...prev[section], [field]: value },
    }));
  };

  const updatePanel = (field, value) => {
    updateProject(prev => ({
      ...prev,
      panel: { ...prev.panel, [field]: value },
    }));
  };

  const updateTandemPolicy = (field, value) => {
    updateProject(prev => ({
      ...prev,
      panel: {
        ...prev.panel,
        tandemPolicy: { ...prev.panel.tandemPolicy, [field]: value },
      },
    }));
  };

  const updateMeta = (field, value) => {
    updateProject(prev => ({
      ...prev,
      metadata: { ...prev.metadata, [field]: value },
    }));
  };

  // Derived: physical slots still available after regular + tandem breakers
  const totalAvailableSlots = Math.max(0, panel.totalSlots - (panel.usedSlots + (panel.tandemSlotsUsed || 0)));

  // A2: Compute max tandem-capable slots for validation warnings
  const maxTandemSlots = panel.tandemsAllowed === 'Allowed'
    ? (panel.tandemPolicy.allowedPositions === 'All slots' ? panel.totalSlots
      : panel.tandemPolicy.allowedPositions === 'Bottom half only' ? Math.floor(panel.totalSlots / 2)
      : (panel.tandemPolicy.customMaxTandemSlots || 0))
    : 0;

  // A2: Validation warnings (non-blocking)
  const warnings = [];
  if (panel.usedSlots > panel.totalSlots) {
    warnings.push('Used Spaces exceeds Total Panel Spaces. Check panel configuration.');
  }
  if ((panel.tandemSlotsUsed || 0) > maxTandemSlots && panel.tandemsAllowed === 'Allowed') {
    warnings.push(`Tandem Slots Used (${panel.tandemSlotsUsed}) exceeds Max Tandem-Capable Slots (${maxTandemSlots}).`);
  }
  if (panel.tandemsAllowed !== 'Allowed' && (panel.tandemSlotsUsed || 0) > 0) {
    warnings.push('Tandem breakers are not allowed (or unknown), but Tandem Slots Used is greater than 0.');
  }

  return (
    <>
      <div className="card">
        <h2>Step 1: Service & Panel Setup</h2>
        <p className="text-sm text-muted mb-4">
          Enter your electrical service and panel information. These values drive all downstream calculations.
        </p>

        <h3>Project Info</h3>
        <div className="form-row">
          <div className="form-group">
            <label>Project Name</label>
            <input
              type="text"
              value={metadata.projectName}
              onChange={e => updateMeta('projectName', e.target.value)}
              placeholder="e.g., Smith Residence"
            />
          </div>
          <div className="form-group">
            <label>Address (optional)</label>
            <input
              type="text"
              value={metadata.address}
              onChange={e => updateMeta('address', e.target.value)}
              placeholder="e.g., 123 Main St"
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Square Footage</label>
            <input
              type="number"
              value={metadata.squareFootage || ''}
              onChange={e => updateMeta('squareFootage', e.target.value)}
              placeholder="e.g., 2000"
              min={0}
            />
            <div className="hint-panel mt-2" style={{ marginBottom: 0 }}>
              Tip: Find square footage on Redfin/Zillow/county assessor/MLS listing. Used for NEC baseline lighting load (3 VA/sq ft).
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Electrical Service</h3>
        <div className="form-row">
          <div className="form-group">
            <label>Service Voltage</label>
            <select
              value={service.serviceVoltage}
              onChange={e => update('service', 'serviceVoltage', Number(e.target.value))}
            >
              <option value={240}>240V (Standard Residential)</option>
              <option value={208}>208V (Multi-family / Commercial)</option>
            </select>
          </div>
          <div className="form-group">
            <label>Main Breaker (Amps)</label>
            <select
              value={service.mainBreakerAmps}
              onChange={e => {
                const amps = Number(e.target.value);
                updateProject(prev => ({
                  ...prev,
                  service: {
                    ...prev.service,
                    mainBreakerAmps: amps,
                    busRatingAmps: prev.service.busRatingAmps === prev.service.mainBreakerAmps ? amps : prev.service.busRatingAmps,
                  },
                }));
              }}
            >
              {MAIN_BREAKER_OPTIONS.map(a => (
                <option key={a} value={a}>{a}A</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Bus Rating (Amps)</label>
            <select
              value={service.busRatingAmps}
              onChange={e => update('service', 'busRatingAmps', Number(e.target.value))}
            >
              {MAIN_BREAKER_OPTIONS.map(a => (
                <option key={a} value={a}>{a}A</option>
              ))}
            </select>
          </div>
        </div>

      </div>

      <div className="card">
        <h3>Panel Configuration</h3>
        <div className="form-row">
          <div className="form-group">
            <label>Total Panel Spaces</label>
            <input
              type="number"
              min={2}
              max={84}
              value={panel.totalSlots}
              onChange={e => updatePanel('totalSlots', Math.max(2, Number(e.target.value) || 0))}
            />
            <div className="text-xs text-muted mt-2">
              Physical spaces in the panel (count from panel directory/label).
            </div>
          </div>
          <div className="form-group">
            <label>Used Spaces (Currently Occupied)</label>
            <input
              type="number"
              min={0}
              max={200}
              value={panel.usedSlots}
              onChange={e => updatePanel('usedSlots', Math.max(0, Number(e.target.value) || 0))}
            />
            <div className="text-xs text-muted mt-2">
              How many physical spaces have breakers installed.
            </div>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Tandem Slots Currently Used</label>
            <input
              type="number"
              min={0}
              max={200}
              value={panel.tandemSlotsUsed || 0}
              onChange={e => updatePanel('tandemSlotsUsed', Math.max(0, Number(e.target.value) || 0))}
            />
            <div className="text-xs text-muted mt-2">
              Each tandem slot hosts 2 circuits in 1 space. Enter how many spaces have tandem breakers.
            </div>
          </div>
        </div>

        {/* A2: Validation warnings */}
        {warnings.length > 0 && (
          <div className="hint-panel warning mt-2" style={{ marginBottom: 8 }}>
            <strong>⚠ Panel Configuration Warnings:</strong>
            <ul style={{ margin: '4px 0 0 16px', fontSize: 13 }}>
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}

        <div className="form-group">
          <label>Tandem Breakers Allowed?</label>
          <select
            value={panel.tandemsAllowed}
            onChange={e => updatePanel('tandemsAllowed', e.target.value)}
          >
            <option value="Allowed">Allowed</option>
            <option value="Not allowed">Not allowed</option>
            <option value="Unknown">Unknown</option>
          </select>
        </div>

        {panel.tandemsAllowed === 'Unknown' && (
          <div className="hint-panel warning">
            Tandem policy unknown. For conservative estimates, we assume tandems are not allowed.
            Check the panel label or directory for tandem-eligible slot positions.
          </div>
        )}

        {panel.tandemsAllowed === 'Allowed' && (
          <div className="form-row">
            <div className="form-group">
              <label>Tandem Allowed Positions</label>
              <select
                value={panel.tandemPolicy.allowedPositions}
                onChange={e => updateTandemPolicy('allowedPositions', e.target.value)}
              >
                <option value="All slots">All slots</option>
                <option value="Bottom half only">Bottom half only</option>
                <option value="Custom">Custom</option>
              </select>
            </div>
            {panel.tandemPolicy.allowedPositions === 'Custom' && (
              <div className="form-group">
                <label>Max Tandem-Capable Slots</label>
                <input
                  type="number"
                  min={0}
                  max={panel.totalSlots}
                  value={panel.tandemPolicy.customMaxTandemSlots || ''}
                  onChange={e => updateTandemPolicy('customMaxTandemSlots', Number(e.target.value) || 0)}
                />
              </div>
            )}
          </div>
        )}

        {/* Summary output: Total Available Panel Slots */}
        <div className="form-group" style={{ marginTop: 8 }}>
          <label>Total Available Panel Slots</label>
          <input
            type="number"
            value={totalAvailableSlots}
            disabled
            style={{ background: '#f3f4f6', maxWidth: 200 }}
          />
          <div className="text-xs text-muted mt-2">
            = Total Panel Spaces ({panel.totalSlots}) − Used Spaces ({panel.usedSlots}) − Tandem Slots Used ({panel.tandemSlotsUsed || 0})
          </div>
        </div>
      </div>

      <div className="step-nav">
        <div />
        <button className="btn btn-primary btn-lg" onClick={goNext}>
          Next: Choose Load Entry Path &rarr;
        </button>
      </div>
    </>
  );
}
