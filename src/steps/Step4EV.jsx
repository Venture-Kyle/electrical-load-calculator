import { useMemo, useState } from 'react';
import { EV_CHARGER_OPTIONS } from '../data/loadLibrary';
import { calculateEVFeasibility, calculatePanelSlots } from '../utils/calculations';

export default function Step4EV({ project, updateProject, goNext, goPrev }) {
  const { ev, service, panel } = project;
  const [tandemOverride, setTandemOverride] = useState(0);

  const selectCharger = (option) => {
    updateProject(prev => ({
      ...prev,
      ev: { ...prev.ev, chargerOption: option },
    }));
  };

  const setCustomAmps = (amps) => {
    updateProject(prev => ({
      ...prev,
      ev: { ...prev.ev, customContinuousAmps: amps },
    }));
  };

  // Rev 7: charger count
  const setChargerCount = (count) => {
    updateProject(prev => ({
      ...prev,
      ev: { ...prev.ev, chargerCount: Math.max(1, Math.min(4, count)) },
    }));
  };

  const evResult = useMemo(() =>
    calculateEVFeasibility(project), [project]);

  const panelSlots = useMemo(() =>
    calculatePanelSlots(panel), [panel]);

  const recBadge = (rec) => {
    switch (rec) {
      case 'Add as-is':
        return <span className="badge badge-ok">Add As-Is</span>;
      case 'Feasible but borderline capacity':
        return <span className="badge badge-warning">Borderline</span>;
      case 'Requires tandems to free space':
        return <span className="badge badge-warning">Tandems Needed</span>;
      case 'Subpanel recommended':
        return <span className="badge badge-warning">Subpanel Needed</span>;
      case 'Service upgrade recommended':
        return <span className="badge badge-danger">Service Upgrade</span>;
      default:
        return <span className="badge badge-info">{rec}</span>;
    }
  };

  return (
    <>
      <div className="card">
        <h2>Step 4: EV Charger Feasibility</h2>
        <p className="text-sm text-muted mb-4">
          Select an EV charger option to evaluate capacity and panel space.
        </p>

        <div className="option-cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          {/* D1: No EV / Skip option */}
          <div
            className={`option-card ${ev.chargerOption === null ? 'selected' : ''}`}
            onClick={() => {
              updateProject(prev => ({
                ...prev,
                ev: { ...prev.ev, chargerOption: null },
              }));
            }}
          >
            <h4>No EV Charger</h4>
            <p>Skip EV charger evaluation. No charger will be added to the project.</p>
          </div>
          {EV_CHARGER_OPTIONS.map((option, i) => (
            <div
              key={i}
              className={`option-card ${ev.chargerOption?.label === option.label ? 'selected' : ''}`}
              onClick={() => selectCharger(option)}
            >
              <h4>{option.label}</h4>
              {!option.isCustom ? (
                <p>
                  {option.continuousAmps}A continuous
                  <br />
                  {option.recommendedBreakerAmps}A breaker (2P)
                  <br />
                  {(option.continuousAmps * service.serviceVoltage / 1000).toFixed(1)} kW
                </p>
              ) : (
                <p>Enter your own continuous amps</p>
              )}
            </div>
          ))}
        </div>

        {/* Rev 7: Number of EV chargers */}
        <div className="form-row mt-4">
          <div className="form-group">
            <label>Number of EV Chargers</label>
            <input
              type="number"
              value={ev.chargerCount || 1}
              onChange={e => setChargerCount(Number(e.target.value) || 1)}
              min={1}
              max={4}
              style={{ width: 100 }}
            />
            <div className="text-xs text-muted mt-2">
              Default is 1. Increase if home will have multiple EV chargers.
            </div>
          </div>
        </div>

        {ev.chargerOption?.isCustom && (
          <div className="form-row mt-4">
            <div className="form-group">
              <label>Continuous Amps</label>
              <input
                type="number"
                value={ev.customContinuousAmps || ''}
                onChange={e => setCustomAmps(Number(e.target.value) || 0)}
                min={1}
                max={100}
                placeholder="e.g., 40"
              />
            </div>
            <div className="form-group">
              <label>Required Breaker (125% rule)</label>
              <input
                type="text"
                value={ev.customContinuousAmps ? `${Math.ceil(ev.customContinuousAmps * 1.25 / 5) * 5}A 2-pole` : '--'}
                disabled
                style={{ background: '#f3f4f6' }}
              />
            </div>
          </div>
        )}

        {/* Rev 7: Existing EV note */}
        <div className="hint-panel mt-4">
          <strong>Existing EV charger?</strong> If the home already has an EV charger, add it as a
          normal load in the Load Table (Step 3) using the "EV Charger" category. This step evaluates
          feasibility for <em>new</em> EV charger installation.
        </div>
      </div>

      {evResult && (
        <div className="card">
          <h3>EV Charger Analysis {(ev.chargerCount || 1) > 1 ? `(${ev.chargerCount} Chargers)` : ''}</h3>

          <div className="result-grid mb-4">
            <div className="result-item">
              <div className="value">{evResult.continuousAmps}A</div>
              <div className="label">Continuous Draw{(ev.chargerCount || 1) > 1 ? ' (each)' : ''}</div>
              <div className="sub">{evResult.breakerAmps}A breaker required</div>
            </div>
            <div className="result-item">
              <div className="value">{(evResult.evWattsTotal / 1000).toFixed(1)} kW</div>
              <div className="label">Total EV Load</div>
              <div className="sub">
                {(ev.chargerCount || 1) > 1
                  ? `${(evResult.evWattsEach / 1000).toFixed(1)} kW each × ${ev.chargerCount}`
                  : `at ${service.serviceVoltage}V`}
              </div>
            </div>
            <div className="result-item">
              <div className="value">{evResult.necWithEV.serviceAmps}A</div>
              <div className="label">Service w/ EV</div>
              <div className="sub">
                of {service.mainBreakerAmps}A ({evResult.necWithEV.ratio}%)
              </div>
            </div>
            <div className="result-item">
              <div className="value">{evResult.availableSlots}</div>
              <div className="label">Available Slots</div>
              <div className="sub">Need {evResult.slotsNeeded} for EV</div>
            </div>
          </div>

          {/* Capacity check */}
          <div className="result-panel">
            <h4>Capacity Assessment</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', fontSize: 13 }}>
              <span className="text-muted">Without EV:</span>
              <span>{evResult.necWithoutEV.serviceAmps}A ({evResult.necWithoutEV.status})</span>
              <span className="text-muted">With EV:</span>
              <span>{evResult.necWithEV.serviceAmps}A ({evResult.necWithEV.status})</span>
              <span className="text-muted">Capacity Status:</span>
              <span>{evResult.necWithEV.status === 'OK' ? 'Sufficient' : evResult.necWithEV.status}</span>
            </div>
          </div>

          {/* Space check */}
          <div className="result-panel">
            <h4>Panel Space Assessment</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', fontSize: 13 }}>
              <span className="text-muted">Available Slots:</span>
              <span>{evResult.availableSlots}</span>
              <span className="text-muted">Slots Needed:</span>
              <span>{evResult.slotsNeeded} ({(ev.chargerCount || 1) > 1 ? `${ev.chargerCount} × 2-pole` : '2-pole breaker'})</span>
              <span className="text-muted">Has Space:</span>
              <span>{evResult.hasSpace ? 'Yes' : 'No'}</span>
              <span className="text-muted">Tandem Option:</span>
              <span>{evResult.canUseTandems ? 'Available' : 'Not available'}</span>
            </div>

            {!evResult.hasSpace && evResult.canUseTandems && (
              <div className="mt-4">
                <h4>Tandem Override</h4>
                <p className="text-sm text-muted mb-2">
                  If engineering confirms tandem breakers can free space:
                </p>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={tandemOverride > 0}
                    onChange={e => setTandemOverride(e.target.checked ? 1 : 0)}
                  />
                  Assume we can free {tandemOverride || 1} slot(s) using tandems
                </label>
                {tandemOverride > 0 && (
                  <div className="form-group mt-2" style={{ maxWidth: 200 }}>
                    <label>Slots to free</label>
                    <input
                      type="number"
                      value={tandemOverride}
                      onChange={e => setTandemOverride(Math.max(0, Number(e.target.value) || 0))}
                      min={1}
                      max={4}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Recommendation */}
          <div className="result-panel" style={{ borderColor: 'var(--blue-accent)', borderWidth: 2 }}>
            <h4>Recommendation</h4>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
              {recBadge(
                tandemOverride > 0 && !evResult.hasSpace && evResult.canUseTandems
                  ? 'Add as-is'
                  : evResult.recommendation
              )}
            </div>
            <p className="text-sm text-muted">
              {evResult.recommendation === 'Add as-is' && 'Panel has capacity and space for the selected EV charger.'}
              {evResult.recommendation === 'Feasible but borderline capacity' && 'Panel can physically accommodate but service utilization is high (>80%). Monitor other loads.'}
              {evResult.recommendation === 'Requires tandems to free space' && 'No open slots, but tandems can create space. Verify panel label for tandem-eligible positions.'}
              {evResult.recommendation === 'Subpanel recommended' && 'No open slots and no tandem option. A subpanel may be needed if capacity allows.'}
              {evResult.recommendation === 'Service upgrade recommended' && 'Adding the EV charger would exceed service capacity. Upgrade main service or consider load management.'}
            </p>
          </div>
        </div>
      )}

      <div className="step-nav">
        <button className="btn btn-secondary" onClick={goPrev}>
          &larr; Back
        </button>
        <button className="btn btn-primary btn-lg" onClick={goNext}>
          Next: Battery Sizing &rarr;
        </button>
      </div>
    </>
  );
}
