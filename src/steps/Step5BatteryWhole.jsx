import { useMemo } from 'react';
import { calculateBatterySizing } from '../utils/calculations';

export default function Step5BatteryWhole({ project, updateProject, goNext, goPrev }) {
  const { battery, loads, ev, service } = project;
  const { wholeHome } = battery;

  const updateWholeHome = (field, value) => {
    updateProject(prev => ({
      ...prev,
      battery: {
        ...prev.battery,
        wholeHome: { ...prev.battery.wholeHome, [field]: value },
      },
    }));
  };

  // Rev 8: Derive actual backupDays from backupMode
  const backupMode = wholeHome.backupMode || '1';
  const effectiveBackupDays = backupMode === 'custom' ? (wholeHome.customDays || 1) : Number(backupMode);

  const handleModeChange = (mode) => {
    const days = mode === 'custom' ? (wholeHome.customDays || 1) : Number(mode);
    updateProject(prev => ({
      ...prev,
      battery: {
        ...prev.battery,
        wholeHome: {
          ...prev.battery.wholeHome,
          backupMode: mode,
          backupDays: days,
        },
      },
    }));
  };

  const handleCustomDaysChange = (days) => {
    updateProject(prev => ({
      ...prev,
      battery: {
        ...prev.battery,
        wholeHome: {
          ...prev.battery.wholeHome,
          customDays: days,
          backupDays: days,
        },
      },
    }));
  };

  // Solar offset only when Custom
  const solarOffset = (backupMode === 'custom' && wholeHome.solarOffsetEnabled) ? (wholeHome.solarOffsetPercent || 0) : 0;

  // Build proposed EV synthetic loads from Step 4 selection
  const proposedEVLoads = useMemo(() => {
    if (!ev.chargerOption || !wholeHome.includeEV) return null;
    const charger = ev.chargerOption;
    const contAmps = charger.isCustom ? (ev.customContinuousAmps || 0) : charger.continuousAmps;
    const watts = contAmps * service.serviceVoltage;
    const count = ev.chargerCount || 1;
    const syntheticLoads = [];
    for (let i = 0; i < count; i++) {
      syntheticLoads.push({
        id: `_proposedEV_${i}`,
        description: `Proposed EV Charger ${count > 1 ? i + 1 : ''}`.trim(),
        category: 'EV Charger',
        breaker: { poles: 2, amps: Math.ceil(contAmps * 1.25 / 5) * 5, type: 'Standard' },
        usage: { assumedWatts: watts, hoursPerDay: 4, includeInBatteryCalc: true },
        motor: { isMotor: false, lra: null },
      });
    }
    return syntheticLoads;
  }, [ev, service.serviceVoltage, wholeHome.includeEV]);

  const batteryResult = useMemo(() =>
    calculateBatterySizing(loads, effectiveBackupDays, {
      solarOffsetPercent: solarOffset,
      proposedEVLoads,
    }), [loads, effectiveBackupDays, solarOffset, proposedEVLoads]);

  const BatteryCard = ({ title, data, recommended, extra }) => {
    const isFeasible = !data.notFeasible;
    return (
      <div className={`battery-card ${recommended && isFeasible ? 'recommended' : ''}`}
        style={data.notFeasible ? { opacity: 0.6, borderColor: '#dc2626' } : undefined}
      >
        {recommended && isFeasible && <div className="badge-recommended">Recommended</div>}
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
        {data.forEnergy !== undefined && (
          <div className="battery-stat">
            <span className="stat-label">For Energy</span>
            <span className="stat-value">{data.forEnergy} units</span>
          </div>
        )}
        {data.forPower !== undefined && (
          <div className="battery-stat">
            <span className="stat-label">For Power</span>
            <span className="stat-value">{data.forPower} units</span>
          </div>
        )}
        {data.forMotorStart > 0 && (
          <div className="battery-stat">
            <span className="stat-label">For Motor Start</span>
            <span className="stat-value">{data.forMotorStart} units</span>
          </div>
        )}
        {data.motorStartWarning && (
          <p className="text-xs text-muted mt-2" style={{ color: '#d97706' }}>
            {data.motorStartWarning}
          </p>
        )}
        {data.notFeasible && data.reason && (
          <p className="text-xs mt-2" style={{ color: '#dc2626' }}>
            {data.reason}
          </p>
        )}
        {extra}
      </div>
    );
  };

  // Determine recommended option (fewest total units, only feasible)
  const options = [
    { key: '5P', count: batteryResult.enphase5P.count, feasible: !batteryResult.enphase5P.notFeasible },
    { key: '10C', count: batteryResult.enphase10C.count, feasible: !batteryResult.enphase10C.notFeasible },
    { key: 'mixed', count: batteryResult.enphase_mixed.totalUnits, feasible: !batteryResult.enphase_mixed.notFeasible },
    { key: 'pw3', count: batteryResult.teslaPW3Only.count, feasible: !batteryResult.teslaPW3Only.notFeasible },
    { key: 'pw3exp', count: batteryResult.teslaPW3WithExpansions.totalUnits, feasible: !batteryResult.teslaPW3WithExpansions.notFeasible },
  ];
  const feasibleOptions = options.filter(o => o.feasible);
  const minUnits = feasibleOptions.length > 0 ? Math.min(...feasibleOptions.map(o => o.count)) : -1;

  return (
    <>
      <div className="card">
        <h2>Step 5: Battery Sizing (Whole Home)</h2>
        <p className="text-sm text-muted mb-4">
          Calculate battery requirements to back up the entire home.
        </p>

        {/* Duration - 1 day, 2 days, Custom only */}
        <div className="form-row">
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
                value={wholeHome.customDays || 1}
                onChange={e => handleCustomDaysChange(Math.max(0.25, Number(e.target.value) || 1))}
                min={0.25}
                max={14}
                step={0.25}
                style={{ width: 120 }}
              />
              <div className="text-xs text-muted mt-2">
                Enter fraction of days (e.g. 0.5 = 12 hours)
              </div>
            </div>
          )}
        </div>

        {/* Caveat for beyond 2 days */}
        {backupMode === 'custom' && (wholeHome.customDays || 1) > 2 && (
          <div className="hint-panel warning" style={{ marginBottom: 12 }}>
            <strong>Extended backup (&gt;2 days):</strong> Battery counts increase rapidly beyond 2 days.
            Consider partial-home backup (Step 6) for critical loads only, or factor in solar offset.
            Most residential battery systems are designed for 1-2 day outage coverage.
          </div>
        )}

        {/* Whole-home assumption note */}
        <div className="hint-panel" style={{ marginBottom: 12 }}>
          <strong>Assumption:</strong> Whole-home sizing includes all loads in the Step 3 load table.
          Daily energy is calculated as (watts &times; hrs/day) for each load. Peak power = sum of all running watts.
          This does NOT account for diversity factor — actual simultaneous demand may be lower.
        </div>

        <div className="form-row">
          <div className="form-group" style={{ display: 'flex', alignItems: 'end', paddingBottom: 16 }}>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={wholeHome.includeEV}
                onChange={e => updateWholeHome('includeEV', e.target.checked)}
              />
              Include proposed EV charger (from Step 4) in backup sizing
            </label>
            {!ev.chargerOption && (
              <span className="text-xs text-muted" style={{ marginLeft: 8 }}>No EV charger selected in Step 4</span>
            )}
          </div>
        </div>

        {/* Solar offset - only when Custom */}
        {backupMode === 'custom' && (
          <div className="form-row">
            <div className="form-group">
              <label className="checkbox-label mb-2">
                <input
                  type="checkbox"
                  checked={wholeHome.solarOffsetEnabled || false}
                  onChange={e => updateWholeHome('solarOffsetEnabled', e.target.checked)}
                />
                Apply solar offset to reduce battery energy needs
              </label>
              {wholeHome.solarOffsetEnabled && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="range"
                      min={0}
                      max={80}
                      step={5}
                      value={wholeHome.solarOffsetPercent || 0}
                      onChange={e => updateWholeHome('solarOffsetPercent', Number(e.target.value))}
                      style={{ flex: 1 }}
                    />
                    <span style={{ fontWeight: 600, width: 50 }}>{wholeHome.solarOffsetPercent || 0}%</span>
                  </div>
                  <div className="hint-panel mt-2" style={{ marginBottom: 0 }}>
                    Solar offset reduces the energy (kWh) requirement by assuming solar covers some
                    daytime load. Does NOT reduce peak power requirements. Use conservatively (20-40% typical).
                    <br /><strong>Planning estimate only — do not use for AHJ load calculations.</strong>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {loads.length > 0 && (
        <>
          {/* Summary stats */}
          <div className="card">
            <h3>Load Summary for Battery Sizing</h3>
            <div className="result-grid">
              <div className="result-item">
                <div className="value">{batteryResult.summary.totalEnergyNeededKWh}</div>
                <div className="label">kWh Needed</div>
                <div className="sub">
                  {effectiveBackupDays} day{effectiveBackupDays !== 1 ? 's' : ''} backup
                  {solarOffset > 0 ? ` (${solarOffset}% solar offset)` : ''}
                </div>
              </div>
              <div className="result-item">
                <div className="value">{batteryResult.summary.peakPowerKW}</div>
                <div className="label">Peak kW</div>
                <div className="sub">Total running load</div>
              </div>
              <div className="result-item">
                <div className="value">{batteryResult.summary.loadCount}</div>
                <div className="label">Loads Included</div>
                <div className="sub">{batteryResult.summary.largestLRA > 0 ? `Max LRA: ${batteryResult.summary.largestLRA}A` : 'No LRA data'}</div>
              </div>
            </div>

            {batteryResult.summary.hasUnknownMotorLRA && (
              <div className="hint-panel warning mt-4">
                Some motor loads have unknown LRA. Battery sizing uses conservative estimates for motor start capability.
                Enter LRA values in the load table for more accurate results.
              </div>
            )}
          </div>

          {/* Battery recommendations */}
          <div className="card">
            <h3>Enphase Battery Options</h3>
            <div className="battery-grid">
              <BatteryCard
                title="IQ Battery 5P Only"
                data={batteryResult.enphase5P}
                recommended={!batteryResult.enphase5P.notFeasible && batteryResult.enphase5P.count === minUnits}
              />
              <BatteryCard
                title="IQ Battery 10C Only"
                data={batteryResult.enphase10C}
                recommended={!batteryResult.enphase10C.notFeasible && batteryResult.enphase10C.count === minUnits}
              />
              <BatteryCard
                title="Mixed (10C + 5P)"
                data={{
                  ...batteryResult.enphase_mixed,
                  displayUnits: `${batteryResult.enphase_mixed.count10C}x 10C + ${batteryResult.enphase_mixed.count5P}x 5P`,
                  count: batteryResult.enphase_mixed.totalUnits,
                  limitedBy: 'optimized',
                }}
                recommended={!batteryResult.enphase_mixed.notFeasible && batteryResult.enphase_mixed.totalUnits === minUnits}
              />
            </div>
          </div>

          <div className="card">
            <h3>Tesla Battery Options</h3>
            <div className="battery-grid">
              <BatteryCard
                title="Powerwall 3 Only"
                data={batteryResult.teslaPW3Only}
                recommended={!batteryResult.teslaPW3Only.notFeasible && batteryResult.teslaPW3Only.count === minUnits}
              />
              <BatteryCard
                title="PW3 + Expansion Packs"
                data={{
                  ...batteryResult.teslaPW3WithExpansions,
                  displayUnits: `${batteryResult.teslaPW3WithExpansions.leaders} PW3 + ${batteryResult.teslaPW3WithExpansions.expansions} Exp`,
                  count: batteryResult.teslaPW3WithExpansions.totalUnits,
                  limitedBy: 'energy + power',
                }}
                recommended={!batteryResult.teslaPW3WithExpansions.notFeasible && batteryResult.teslaPW3WithExpansions.totalUnits === minUnits}
              />
            </div>

            <div className="hint-panel mt-4">
              PW3 Expansion packs add energy only (no additional inverter power).
              Max 3 expansions per PW3 leader. Max 4 PW3 leaders total.
            </div>
          </div>
        </>
      )}

      {loads.length === 0 && (
        <div className="card text-center" style={{ padding: '40px' }}>
          <p className="text-muted">No loads entered. Go back to Step 3 to add loads.</p>
        </div>
      )}

      <div className="step-nav">
        <button className="btn btn-secondary" onClick={goPrev}>
          &larr; Back
        </button>
        <button className="btn btn-primary btn-lg" onClick={goNext}>
          Next: Partial Home Battery &rarr;
        </button>
      </div>
    </>
  );
}
