import { useMemo, useCallback } from 'react';
import { calculateBatterySizing } from '../utils/calculations';

export default function Step6BatteryPartial({ project, updateProject, goNext, goPrev }) {
  const { battery, loads } = project;
  const { partialHome } = battery;

  const togglePartialMode = useCallback((enabled) => {
    updateProject(prev => {
      const selections = { ...prev.battery.partialHome.selections };
      if (enabled) {
        // Initialize selections from existing loads
        prev.loads.forEach(l => {
          if (!selections[l.id]) {
            selections[l.id] = {
              include: l.usage.includeInBatteryCalc,
              hoursPerDay: l.usage.hoursPerDay,
            };
          }
        });
      }
      return {
        ...prev,
        battery: {
          ...prev.battery,
          partialHome: { ...prev.battery.partialHome, enabled, selections },
        },
      };
    });
  }, [updateProject]);

  const updatePartial = useCallback((field, value) => {
    updateProject(prev => ({
      ...prev,
      battery: {
        ...prev.battery,
        partialHome: { ...prev.battery.partialHome, [field]: value },
      },
    }));
  }, [updateProject]);

  const updateSelection = useCallback((loadId, field, value) => {
    updateProject(prev => ({
      ...prev,
      battery: {
        ...prev.battery,
        partialHome: {
          ...prev.battery.partialHome,
          selections: {
            ...prev.battery.partialHome.selections,
            [loadId]: {
              ...prev.battery.partialHome.selections[loadId],
              [field]: value,
            },
          },
        },
      },
    }));
  }, [updateProject]);

  // Get selected load IDs
  const selectedIds = useMemo(() =>
    Object.entries(partialHome.selections || {})
      .filter(([, v]) => v.include)
      .map(([id]) => id),
    [partialHome.selections]
  );

  // Rev 8: Duration - 1 day, 2 days, Custom only
  const backupMode = partialHome.backupMode || '1';
  const effectiveBackupDays = backupMode === 'custom' ? (partialHome.customDays || 1) : Number(backupMode);

  const handleModeChange = useCallback((mode) => {
    const days = mode === 'custom' ? (partialHome.customDays || 1) : Number(mode);
    updateProject(prev => ({
      ...prev,
      battery: {
        ...prev.battery,
        partialHome: {
          ...prev.battery.partialHome,
          backupMode: mode,
          backupDays: days,
        },
      },
    }));
  }, [updateProject, partialHome.customDays]);

  const handleCustomDaysChange = useCallback((days) => {
    updateProject(prev => ({
      ...prev,
      battery: {
        ...prev.battery,
        partialHome: {
          ...prev.battery.partialHome,
          customDays: days,
          backupDays: days,
        },
      },
    }));
  }, [updateProject]);

  // Rev 9: Solar offset optional on partial
  const solarOffset = partialHome.solarOffsetEnabled ? (partialHome.solarOffsetPercent || 0) : 0;

  // Rev 10: Reactive computation - recalculate whenever selections, days, or solar offset change
  const partialResult = useMemo(() => {
    if (!partialHome.enabled || selectedIds.length === 0) return null;
    return calculateBatterySizing(loads, effectiveBackupDays, {
      includeLoadIds: selectedIds,
      partialSelections: partialHome.selections,
      solarOffsetPercent: solarOffset,
    });
  }, [loads, effectiveBackupDays, partialHome.enabled, selectedIds, partialHome.selections, solarOffset]);

  return (
    <>
      <div className="card">
        <h2>Step 6: Battery Sizing (Partial Home)</h2>
        <p className="text-sm text-muted mb-4">
          Optionally size batteries for a subset of critical loads only.
        </p>

        {!partialHome.enabled ? (
          <div className="text-center" style={{ padding: '20px 0' }}>
            <p className="text-muted mb-4">
              Partial-home backup lets you select which loads to include,
              typically reducing battery count and cost.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => togglePartialMode(true)}
            >
              Enable Partial-Home Backup Sizing
            </button>
          </div>
        ) : (
          <>
            {/* Rev 8: Duration buttons */}
            <div className="form-row mb-4">
              <div className="form-group">
                <label>Backup Duration</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {['1', '2', 'custom'].map(mode => (
                    <button
                      key={mode}
                      className={`btn ${backupMode === mode ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => handleModeChange(mode)}
                      style={{ minWidth: 90 }}
                    >
                      {mode === '1' ? '1 Day' : mode === '2' ? '2 Days' : 'Custom'}
                    </button>
                  ))}
                </div>
              </div>
              {backupMode === 'custom' && (
                <div className="form-group">
                  <label>Custom Days</label>
                  <input
                    type="number"
                    value={partialHome.customDays || 1}
                    onChange={e => handleCustomDaysChange(Math.max(0.25, Number(e.target.value) || 1))}
                    min={0.25}
                    max={14}
                    step={0.25}
                    style={{ width: 120 }}
                  />
                </div>
              )}
              <div className="form-group" style={{ display: 'flex', alignItems: 'end', paddingBottom: 16 }}>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => togglePartialMode(false)}
                >
                  Disable Partial Mode
                </button>
              </div>
            </div>

            {/* Rev 9: Solar offset - optional on partial */}
            <div className="form-row mb-4">
              <div className="form-group">
                <label className="checkbox-label mb-2">
                  <input
                    type="checkbox"
                    checked={partialHome.solarOffsetEnabled || false}
                    onChange={e => updatePartial('solarOffsetEnabled', e.target.checked)}
                  />
                  Apply solar offset to reduce battery energy needs
                </label>
                {partialHome.solarOffsetEnabled && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="range"
                        min={0}
                        max={80}
                        step={5}
                        value={partialHome.solarOffsetPercent || 0}
                        onChange={e => updatePartial('solarOffsetPercent', Number(e.target.value))}
                        style={{ flex: 1 }}
                      />
                      <span style={{ fontWeight: 600, width: 50 }}>{partialHome.solarOffsetPercent || 0}%</span>
                    </div>
                    <div className="hint-panel mt-2" style={{ marginBottom: 0 }}>
                      Solar offset reduces energy (kWh) requirement by assuming solar covers some daytime load.
                      Does NOT reduce peak power requirements. Use conservatively (20-40% typical).
                      In snowy or cloudy states (e.g. northeast), use lower values (10-20%).
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Load selection table */}
            <h3>Select Loads for Partial Backup</h3>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Include</th>
                    <th>Load</th>
                    <th>Category</th>
                    <th>Running Watts</th>
                    <th>Hrs/Day (Backup)</th>
                    <th>Daily kWh</th>
                    <th>Motor</th>
                  </tr>
                </thead>
                <tbody>
                  {loads.map(load => {
                    const sel = partialHome.selections[load.id] || { include: false, hoursPerDay: load.usage.hoursPerDay };
                    const dailyKWh = sel.include ? (load.usage.assumedWatts * sel.hoursPerDay / 1000).toFixed(1) : '--';
                    return (
                      <tr key={load.id} style={{ opacity: sel.include ? 1 : 0.5 }}>
                        <td>
                          <input
                            type="checkbox"
                            checked={sel.include}
                            onChange={e => updateSelection(load.id, 'include', e.target.checked)}
                          />
                        </td>
                        <td>{load.description || load.category}</td>
                        <td className="text-sm text-muted">{load.category}</td>
                        <td>{load.usage.assumedWatts.toLocaleString()}W</td>
                        <td>
                          <input
                            type="number"
                            value={sel.hoursPerDay}
                            onChange={e => updateSelection(load.id, 'hoursPerDay', Math.max(0, Math.min(24, Number(e.target.value) || 0)))}
                            className="narrow"
                            disabled={!sel.include}
                            min={0}
                            max={24}
                            step={0.5}
                          />
                        </td>
                        <td>{dailyKWh}</td>
                        <td>{load.motor.isMotor ? 'Yes' : '--'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-2 text-sm text-muted">
              {selectedIds.length} of {loads.length} loads selected for partial backup
            </div>

            {/* Partial results - Rev 10: reactive updates */}
            {partialResult && selectedIds.length > 0 && (
              <>
                <div className="result-grid mt-4 mb-4">
                  <div className="result-item">
                    <div className="value">{partialResult.summary.totalEnergyNeededKWh}</div>
                    <div className="label">kWh Needed</div>
                    <div className="sub">
                      {effectiveBackupDays} day{effectiveBackupDays !== 1 ? 's' : ''} backup
                      {solarOffset > 0 ? ` (${solarOffset}% solar offset)` : ''}
                    </div>
                  </div>
                  <div className="result-item">
                    <div className="value">{partialResult.summary.peakPowerKW}</div>
                    <div className="label">Peak kW</div>
                  </div>
                  <div className="result-item">
                    <div className="value">{selectedIds.length}</div>
                    <div className="label">Loads Selected</div>
                  </div>
                </div>

                <h3>Partial-Home Battery Options</h3>
                <div className="battery-grid">
                  <BatteryCard
                    title="Enphase IQ 5P"
                    data={partialResult.enphase5P}
                  />
                  <BatteryCard
                    title="Enphase IQ 10C"
                    data={partialResult.enphase10C}
                  />
                  <BatteryCard
                    title="Mixed (10C + 5P)"
                    data={{
                      ...partialResult.enphase_mixed,
                      displayUnits: `${partialResult.enphase_mixed.count10C}x 10C + ${partialResult.enphase_mixed.count5P}x 5P`,
                      count: partialResult.enphase_mixed.totalUnits,
                    }}
                  />
                  <BatteryCard
                    title="Tesla Powerwall 3"
                    data={partialResult.teslaPW3Only}
                  />
                  <BatteryCard
                    title="PW3 + Expansions"
                    data={{
                      ...partialResult.teslaPW3WithExpansions,
                      displayUnits: `${partialResult.teslaPW3WithExpansions.leaders} PW3 + ${partialResult.teslaPW3WithExpansions.expansions} Exp`,
                      count: partialResult.teslaPW3WithExpansions.totalUnits,
                    }}
                  />
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className="step-nav">
        <button className="btn btn-secondary" onClick={goPrev}>
          &larr; Back
        </button>
        <button className="btn btn-primary btn-lg" onClick={goNext}>
          Next: Summary &rarr;
        </button>
      </div>
    </>
  );
}

function BatteryCard({ title, data }) {
  return (
    <div className="battery-card"
      style={data.notFeasible ? { opacity: 0.6, borderColor: '#dc2626' } : undefined}
    >
      {data.notFeasible && (
        <div style={{
          background: '#fee2e2', color: '#dc2626', fontSize: 11, fontWeight: 600,
          padding: '2px 8px', borderRadius: 4, marginBottom: 8, textAlign: 'center',
        }}>
          NOT FEASIBLE
        </div>
      )}
      <h4>{title}</h4>
      <div className="battery-stat">
        <span className="stat-label">Units</span>
        <span className="stat-value">{data.displayUnits || data.count}</span>
      </div>
      <div className="battery-stat">
        <span className="stat-label">Total Energy</span>
        <span className="stat-value">{data.totalKWh} kWh</span>
      </div>
      <div className="battery-stat">
        <span className="stat-label">Total Power</span>
        <span className="stat-value">{typeof data.totalKW === 'number' ? data.totalKW.toFixed(1) : data.totalKW} kW</span>
      </div>
      {data.limitedBy && (
        <div className="battery-stat">
          <span className="stat-label">Limited By</span>
          <span className="stat-value" style={{ textTransform: 'capitalize' }}>{data.limitedBy}</span>
        </div>
      )}
      {data.motorStartWarning && (
        <p className="text-xs mt-2" style={{ color: '#d97706' }}>
          {data.motorStartWarning}
        </p>
      )}
      {data.notFeasible && data.reason && (
        <p className="text-xs mt-2" style={{ color: '#dc2626' }}>
          {data.reason}
        </p>
      )}
    </div>
  );
}
