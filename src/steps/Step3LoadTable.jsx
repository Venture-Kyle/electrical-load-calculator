import { useState, useMemo, useCallback, useEffect } from 'react';
import { LOAD_LIBRARY, LOAD_CATEGORIES, BREAKER_AMP_OPTIONS } from '../data/loadLibrary';
import { createLoadEntry, createNECBaselineLoads } from '../data/initialState';
import { calculateNECOptionalMethod, calculatePracticalLoad, calculateModeledSlots, getLoadVoltage } from '../utils/calculations';

// Shared function: apply category-level assumed defaults to a load row.
// Called when a row is created via addLoad AND when the category dropdown changes.
function applyCategoryDefaults(load, categoryKey) {
  const lib = LOAD_LIBRARY.find(l => l.category === categoryKey);
  if (!lib) return load; // unknown category — leave as-is

  return {
    ...load,
    category: categoryKey,
    breaker: {
      ...load.breaker,
      poles: lib.poles,
      amps: lib.amps,
      type: lib.poles === 2 ? 'Standard' : load.breaker.type,
    },
    usage: {
      ...load.usage,
      assumedWatts: lib.assumedWatts,
      hoursPerDay: lib.hoursPerDay,
    },
    motor: {
      ...load.motor,
      isMotor: lib.isMotor,
      lra: lib.defaultLRA || null,
    },
    sourceTag: 'Assumed',
    _wattsManuallySet: false,
    // Clear tandem B if switching to 2-pole
    tandemCircuitB: lib.poles === 2 ? null : load.tandemCircuitB,
  };
}

// Category-specific tooltips for field guidance
const CATEGORY_TOOLTIPS = {
  [LOAD_CATEGORIES.LIGHTING]: 'NEC 220.12: 3 VA/sq ft for general lighting. Adjust watts if actual fixture survey available.',
  [LOAD_CATEGORIES.DRYER]: 'NEC demand: 5000W minimum. Check nameplate for actual rating.',
  [LOAD_CATEGORIES.RANGE]: 'NEC Table 220.55 applies. 8-12 kW typical. Enter nameplate if known.',
  [LOAD_CATEGORIES.COOKTOP]: 'Separate cooktop: 6-7 kW typical. Combined with wall oven per NEC 220.55.',
  [LOAD_CATEGORIES.AC_CONDENSER]: 'LRA matters for battery sizing. Check nameplate or compressor data plate for LRA.',
  [LOAD_CATEGORIES.HEAT_PUMP]: 'Similar to AC condenser. LRA critical for battery motor start capability.',
  [LOAD_CATEGORIES.WELL_PUMP]: 'Motor load — LRA can be 3-6x running amps. Check pump controller nameplate.',
  [LOAD_CATEGORIES.WATER_HEATER]: '4500W standard. Heat pump water heaters are ~500W running.',
  [LOAD_CATEGORIES.HOT_TUB]: '240V/50A typical. Heater + pump combined. Check GFCI breaker requirement.',
  [LOAD_CATEGORIES.POOL_EQUIPMENT]: 'Variable speed pumps draw less. Enter actual running watts if known.',
  [LOAD_CATEGORIES.REFRIGERATOR]: 'Running watts ~150-250W. Compressor start surge 3-5x. 24h/day operation.',
  [LOAD_CATEGORIES.FREEZER]: 'Similar to refrigerator. ~100-200W running, 24h/day.',
};

// C3: Per-field "If unknown, assume:" defaults by category
// Returns tooltip strings for watts, hours, and amps fields
function getFieldDefaults(category) {
  const lib = LOAD_LIBRARY.find(l => l.category === category);
  if (!lib) return { watts: 'If unknown, assume: 500W', hours: 'If unknown, assume: 4 hrs/day', amps: 'If unknown, assume: 15A' };
  return {
    watts: `If unknown, assume: ${lib.assumedWatts.toLocaleString()}W`,
    hours: `If unknown, assume: ${lib.hoursPerDay} hrs/day`,
    amps: `If unknown, assume: ${lib.amps}A`,
    lra: lib.defaultLRA ? `If unknown, assume: ${lib.defaultLRA}A LRA` : 'LRA — check motor nameplate',
  };
}

export default function Step3LoadTable({ project, updateProject, goNext, goPrev }) {
  const { loads, service, panel } = project;
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [tooltipLoad, setTooltipLoad] = useState(null);

  // C2: Ensure exactly 4 NEC baseline loads exist — deduplicate on every mount/navigation
  useEffect(() => {
    const existingBaselines = loads.filter(l => l.isNECBaseline);
    if (existingBaselines.length === 4) return; // Already correct

    if (existingBaselines.length === 0) {
      // No baselines — add fresh set
      const baselines = createNECBaselineLoads(project.metadata.squareFootage);
      updateProject(prev => ({
        ...prev,
        loads: [...baselines, ...prev.loads.filter(l => !l.isNECBaseline)],
      }));
    } else if (existingBaselines.length > 4) {
      // Too many baselines — deduplicate: keep the first 4
      const seenDescriptions = new Set();
      const uniqueBaselines = [];
      for (const bl of existingBaselines) {
        const key = bl.description || bl.category;
        if (!seenDescriptions.has(key) && uniqueBaselines.length < 4) {
          seenDescriptions.add(key);
          uniqueBaselines.push(bl);
        }
      }
      const nonBaselines = loads.filter(l => !l.isNECBaseline);
      updateProject(prev => ({
        ...prev,
        loads: [...uniqueBaselines, ...nonBaselines],
      }));
    }
    // If < 4 baselines but > 0, leave as-is (user may have intentionally edited)
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateLoad = useCallback((id, field, value) => {
    updateProject(prev => ({
      ...prev,
      loads: prev.loads.map(l => {
        if (l.id !== id) return l;
        const updated = { ...l };

        // Track if NEC baseline was edited
        if (l.isNECBaseline && !updated._necEdited) {
          if (field.startsWith('usage.') || field.startsWith('breaker.amps')) {
            updated._necEdited = true;
          }
        }

        // When category changes, apply shared defaults
        if (field === 'category') {
          return applyCategoryDefaults(updated, value);
        }

        if (field.startsWith('breaker.')) {
          const key = field.split('.')[1];
          updated.breaker = { ...updated.breaker, [key]: value };
          updated.sourceTag = 'User-entered';

          // Auto-calc watts from breaker if watts not manually set
          if (!updated._wattsManuallySet && (key === 'amps' || key === 'poles')) {
            const lib = LOAD_LIBRARY.find(lib => lib.category === updated.category);
            const uf = lib ? lib.utilizationFactor : 0.5;
            const volts = getLoadVoltage(updated, prev.service.serviceVoltage);
            updated.usage = {
              ...updated.usage,
              assumedWatts: Math.round(volts * updated.breaker.amps * uf),
            };
          }

          // If changing to tandem and it's 1P, auto-create tandemCircuitB if missing
          if (key === 'type' && value === 'Tandem' && updated.breaker.poles === 1 && !updated.tandemCircuitB) {
            updated.tandemCircuitB = {
              description: 'Tandem Circuit B',
              category: LOAD_CATEGORIES.OTHER,
              amps: 15,
              assumedWatts: 500,
              hoursPerDay: 4,
              isMotor: false,
              lra: null,
            };
          }
          // Clear tandem B if switching back to standard
          if (key === 'type' && value === 'Standard') {
            updated.tandemCircuitB = null;
          }
          // Force Standard if switching to 2P
          if (key === 'poles' && value === 2) {
            updated.breaker = { ...updated.breaker, poles: 2, type: 'Standard' };
            updated.tandemCircuitB = null;
          }
        } else if (field.startsWith('usage.')) {
          const key = field.split('.')[1];
          updated.usage = { ...updated.usage, [key]: value };
          // Direct edits to watts or hours => USER
          if (key === 'assumedWatts' || key === 'hoursPerDay') {
            if (key === 'assumedWatts') updated._wattsManuallySet = true;
            updated.sourceTag = 'User-entered';
          }
        } else if (field.startsWith('motor.')) {
          const key = field.split('.')[1];
          updated.motor = { ...updated.motor, [key]: value };
          // Direct edits to motor/LRA => USER
          if (key === 'isMotor' || key === 'lra') {
            updated.sourceTag = 'User-entered';
          }
        } else if (field.startsWith('tandemB.')) {
          const key = field.split('.')[1];
          updated.tandemCircuitB = { ...(updated.tandemCircuitB || {}), [key]: value };
        } else {
          updated[field] = value;
        }

        return updated;
      }),
    }));
  }, [updateProject]);

  const removeLoad = useCallback((id) => {
    const load = loads.find(l => l.id === id);
    if (load?.isNECBaseline) return;
    updateProject(prev => ({
      ...prev,
      loads: prev.loads.filter(l => l.id !== id),
    }));
  }, [updateProject, loads]);

  const addLoad = useCallback((category) => {
    const lib = LOAD_LIBRARY.find(l => l.category === category);
    const entry = lib
      ? createLoadEntry({
          description: lib.description,
          category: lib.category,
          breaker: { poles: lib.poles, amps: lib.amps, type: 'Standard', voltageOverride: null },
          usage: {
            assumedWatts: lib.assumedWatts,
            hoursPerDay: lib.hoursPerDay,
            includeInServiceCalc: true,
            includeInBatteryCalc: category !== LOAD_CATEGORIES.EV_CHARGER,
          },
          motor: { isMotor: lib.isMotor, nameplateKnown: false, lra: lib.defaultLRA || null, notes: '' },
          sourceTag: 'Assumed',
        })
      : createLoadEntry({ category });

    updateProject(prev => ({ ...prev, loads: [...prev.loads, entry] }));
    setShowAddMenu(false);
  }, [updateProject]);

  const addCustomLoad = useCallback(() => {
    const entry = createLoadEntry({
      description: 'Custom Load',
      category: LOAD_CATEGORIES.OTHER,
    });
    updateProject(prev => ({ ...prev, loads: [...prev.loads, entry] }));
  }, [updateProject]);

  // Compute results
  const necResult = useMemo(() =>
    calculateNECOptionalMethod(loads, service), [loads, service]);
  const practicalResult = useMemo(() =>
    calculatePracticalLoad(loads), [loads]);

  // Slot validation: compare modeled slots to Page 1 Total Available Panel Slots
  const modeledSlots = useMemo(() => calculateModeledSlots(loads), [loads]);
  const totalAvailableSlots = Math.max(0, panel.totalSlots - (panel.usedSlots + (panel.tandemSlotsUsed || 0)));
  const slotDelta = modeledSlots - totalAvailableSlots;

  // A2: Panel configuration warnings (shared logic with Step 1)
  const panelWarnings = useMemo(() => {
    const warns = [];
    const maxTandemSlots = panel.tandemsAllowed === 'Allowed'
      ? (panel.tandemPolicy.allowedPositions === 'All slots' ? panel.totalSlots
        : panel.tandemPolicy.allowedPositions === 'Bottom half only' ? Math.floor(panel.totalSlots / 2)
        : (panel.tandemPolicy.customMaxTandemSlots || 0))
      : 0;
    if (panel.usedSlots > panel.totalSlots) {
      warns.push('Used Spaces exceeds Total Panel Spaces.');
    }
    if ((panel.tandemSlotsUsed || 0) > maxTandemSlots && panel.tandemsAllowed === 'Allowed') {
      warns.push(`Tandem Slots Used (${panel.tandemSlotsUsed}) exceeds Max Tandem-Capable Slots (${maxTandemSlots}).`);
    }
    if (panel.tandemsAllowed !== 'Allowed' && (panel.tandemSlotsUsed || 0) > 0) {
      warns.push('Tandem breakers are not allowed (or unknown), but Tandem Slots Used > 0.');
    }
    return warns;
  }, [panel]);

  const statusBadge = (status) => {
    if (status === 'OK') return <span className="badge badge-ok">OK</span>;
    if (status === 'Borderline') return <span className="badge badge-warning">Borderline</span>;
    return <span className="badge badge-danger">Undersized</span>;
  };

  const sourceTagClass = (tag) => {
    switch (tag) {
      case 'User-entered': return 'source-tag user-entered';
      case 'Nameplate': return 'source-tag nameplate';
      default: return 'source-tag assumed';
    }
  };

  const categoryOptions = Object.values(LOAD_CATEGORIES);

  return (
    <>
      <div className="card">
        <div className="hint-panel" style={{ marginBottom: 12 }}>
          2-pole loads use {service.serviceVoltage}V (service voltage). 1-pole loads use 120V. You can override voltage per circuit below.
        </div>

        <div className="card-header">
          <h2>Step 3: Load Table & Service Adequacy</h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ position: 'relative' }}>
              <button className="btn btn-primary btn-sm" onClick={() => setShowAddMenu(!showAddMenu)}>
                + Add Load
              </button>
              {showAddMenu && (
                <div style={{
                  position: 'absolute', right: 0, top: '100%', marginTop: 4,
                  background: 'white', border: '1px solid #e5e7eb', borderRadius: 8,
                  boxShadow: '0 10px 25px rgba(0,0,0,0.15)', zIndex: 50,
                  maxHeight: 400, overflowY: 'auto', width: 260,
                }}>
                  {LOAD_LIBRARY.map(lib => (
                    <div
                      key={lib.category}
                      style={{ padding: '8px 14px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f3f4f6' }}
                      onClick={() => addLoad(lib.category)}
                      onMouseEnter={e => e.target.style.background = '#f3f4f6'}
                      onMouseLeave={e => e.target.style.background = 'white'}
                    >
                      {lib.description}
                      <span style={{ float: 'right', color: '#9ca3af', fontSize: 11 }}>
                        {lib.assumedWatts}W
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button className="btn btn-secondary btn-sm" onClick={addCustomLoad}>
              + Custom
            </button>
          </div>
        </div>

        {loads.length === 0 ? (
          <div className="text-center" style={{ padding: '40px 0' }}>
            <p className="text-muted">No loads added yet. Use the buttons above or go back to Step 2.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Poles</th>
                  <th>Type</th>
                  <th>Amps</th>
                  <th>Watts</th>
                  <th>Hrs/Day</th>
                  <th>kWh/Day</th>
                  <th>Motor</th>
                  <th>LRA</th>
                  <th className="sticky-right"></th>
                </tr>
              </thead>
              <tbody>
                {loads.map(load => {
                  const dailyKWh = (load.usage.assumedWatts * load.usage.hoursPerDay / 1000).toFixed(1);
                  const isTandem = load.breaker.type === 'Tandem';
                  const catTooltip = CATEGORY_TOOLTIPS[load.category];
                  const isNECEdited = load.isNECBaseline && load._necEdited;
                  const fieldDefs = getFieldDefaults(load.category); // C3: per-field tooltips
                  return [
                    <tr key={load.id} style={load.isNECBaseline ? { background: isNECEdited ? '#fefce8' : '#f0fdf4' } : undefined}>
                      <td>
                        <input
                          type="text"
                          value={load.description}
                          onChange={e => updateLoad(load.id, 'description', e.target.value)}
                          style={{ width: 150, minWidth: 120 }}
                          placeholder="Description"
                        />
                        {load.isNECBaseline && !isNECEdited && (
                          <span style={{ fontSize: 10, color: '#16a34a', display: 'block' }}>NEC Required</span>
                        )}
                        {isNECEdited && (
                          <span style={{ fontSize: 10, color: '#d97706', display: 'block' }}>NEC (Edited)</span>
                        )}
                        {catTooltip && (
                          <span
                            style={{ fontSize: 11, color: '#9ca3af', cursor: 'help', marginLeft: 4 }}
                            title={catTooltip}
                            onMouseEnter={() => setTooltipLoad(load.id)}
                            onMouseLeave={() => setTooltipLoad(null)}
                          >
                            &#9432;
                          </span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <select
                            value={load.category}
                            onChange={e => updateLoad(load.id, 'category', e.target.value)}
                            style={{ width: 130 }}
                            disabled={load.isNECBaseline && !load._necEdited}
                          >
                            {categoryOptions.map(c => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                          <span className={sourceTagClass(load.sourceTag)} style={{ flexShrink: 0 }}>
                            {load.isNECBaseline ? 'NEC' : load.sourceTag === 'User-entered' ? 'USER' : 'ASSU'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <select
                          value={load.breaker.poles}
                          onChange={e => updateLoad(load.id, 'breaker.poles', Number(e.target.value))}
                          className="narrow"
                        >
                          <option value={1}>1P</option>
                          <option value={2}>2P</option>
                        </select>
                      </td>
                      <td>
                        {load.breaker.poles === 1 ? (
                          <select
                            value={load.breaker.type}
                            onChange={e => updateLoad(load.id, 'breaker.type', e.target.value)}
                            className="narrow"
                            style={{ width: 85 }}
                          >
                            <option value="Standard">Std</option>
                            <option value="Tandem">Tandem</option>
                          </select>
                        ) : (
                          <span className="text-sm text-muted" style={{ display: 'inline-block', padding: '4px 0' }}>Std</span>
                        )}
                      </td>
                      <td>
                        <select
                          value={load.breaker.amps}
                          onChange={e => updateLoad(load.id, 'breaker.amps', Number(e.target.value))}
                          className="narrow"
                          title={fieldDefs.amps}
                        >
                          {BREAKER_AMP_OPTIONS.map(a => (
                            <option key={a} value={a}>{a}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          value={load.usage.assumedWatts}
                          onChange={e => updateLoad(load.id, 'usage.assumedWatts', Math.max(0, Number(e.target.value) || 0))}
                          className="medium"
                          min={0}
                          title={fieldDefs.watts}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          value={load.usage.hoursPerDay}
                          onChange={e => updateLoad(load.id, 'usage.hoursPerDay', Math.max(0, Math.min(24, Number(e.target.value) || 0)))}
                          className="narrow"
                          min={0}
                          max={24}
                          step={0.5}
                          title={fieldDefs.hours}
                        />
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{dailyKWh}</td>
                      <td>
                        <input
                          type="checkbox"
                          checked={load.motor.isMotor}
                          onChange={e => updateLoad(load.id, 'motor.isMotor', e.target.checked)}
                        />
                      </td>
                      <td className="lra-cell">
                        {load.motor.isMotor ? (
                          <>
                            <input
                              type="number"
                              value={load.motor.lra || ''}
                              onChange={e => updateLoad(load.id, 'motor.lra', e.target.value ? Number(e.target.value) : null)}
                              className="lra-input"
                              min={0}
                              placeholder="LRA"
                              title={fieldDefs.lra}
                            />
                            {!load.motor.lra && (
                              <span style={{ fontSize: 9, color: '#d97706', display: 'block', lineHeight: 1.2 }}>
                                est.
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-muted" style={{ fontSize: 11 }}>--</span>
                        )}
                      </td>
                      <td className="sticky-right" style={load.isNECBaseline ? { background: isNECEdited ? '#fefce8' : '#f0fdf4' } : undefined}>
                        {!load.isNECBaseline ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => removeLoad(load.id)}
                            title={isTandem ? 'Delete load and its tandem pair' : 'Delete load'}
                            style={{ color: '#dc2626', fontSize: 15 }}
                          >
                            🗑
                          </button>
                        ) : (
                          <span
                            style={{ color: '#d1d5db', fontSize: 15, cursor: 'not-allowed' }}
                            title="NEC baseline loads cannot be deleted"
                          >
                            🗑
                          </span>
                        )}
                      </td>
                    </tr>,
                    // Tandem sub-row showing second circuit — editable
                    isTandem && load.tandemCircuitB ? (
                      <tr key={`${load.id}_tandemB`} style={{ background: '#fafafa', fontSize: 12 }}>
                        <td style={{ paddingLeft: 32 }}>
                          <input
                            type="text"
                            value={load.tandemCircuitB.description || ''}
                            onChange={e => updateLoad(load.id, 'tandemB.description', e.target.value)}
                            style={{ width: 130, fontSize: 12, fontStyle: 'italic' }}
                            placeholder="Tandem Circuit B"
                          />
                        </td>
                        <td>
                          <select
                            value={load.tandemCircuitB.category || LOAD_CATEGORIES.OTHER}
                            onChange={e => updateLoad(load.id, 'tandemB.category', e.target.value)}
                            style={{ width: 120, fontSize: 11 }}
                          >
                            {categoryOptions.map(c => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </td>
                        <td colSpan={1} style={{ color: '#6b7280', fontSize: 11 }}>1P</td>
                        <td style={{ color: '#6b7280', fontSize: 11 }}>Pair</td>
                        <td>
                          <select
                            value={load.tandemCircuitB.amps || 15}
                            onChange={e => updateLoad(load.id, 'tandemB.amps', Number(e.target.value))}
                            className="narrow"
                            style={{ fontSize: 11 }}
                          >
                            {BREAKER_AMP_OPTIONS.filter(a => a <= 30).map(a => (
                              <option key={a} value={a}>{a}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            value={load.tandemCircuitB.assumedWatts || 0}
                            onChange={e => updateLoad(load.id, 'tandemB.assumedWatts', Math.max(0, Number(e.target.value) || 0))}
                            className="medium"
                            style={{ fontSize: 11 }}
                            min={0}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={load.tandemCircuitB.hoursPerDay || 0}
                            onChange={e => updateLoad(load.id, 'tandemB.hoursPerDay', Math.max(0, Math.min(24, Number(e.target.value) || 0)))}
                            className="narrow"
                            style={{ fontSize: 11 }}
                            min={0}
                            max={24}
                            step={0.5}
                          />
                        </td>
                        <td style={{ color: '#6b7280', fontSize: 11 }}>
                          {load.tandemCircuitB.assumedWatts && load.tandemCircuitB.hoursPerDay
                            ? (load.tandemCircuitB.assumedWatts * load.tandemCircuitB.hoursPerDay / 1000).toFixed(1)
                            : '--'}
                        </td>
                        <td colSpan={3}></td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 600, background: '#f3f4f6' }}>
                  <td colSpan={5} style={{ textAlign: 'right' }}>Totals:</td>
                  <td>{practicalResult.totalRunningWatts.toLocaleString()}W</td>
                  <td></td>
                  <td>{practicalResult.totalDailyKWh.toFixed(1)}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Tooltip panel for category info */}
        {tooltipLoad && CATEGORY_TOOLTIPS[loads.find(l => l.id === tooltipLoad)?.category] && (
          <div className="hint-panel mt-2" style={{ fontSize: 12, marginBottom: 0 }}>
            {CATEGORY_TOOLTIPS[loads.find(l => l.id === tooltipLoad)?.category]}
          </div>
        )}

        {/* Slot Check: compare modeled slots to Page 1 Total Available Panel Slots */}
        {loads.length > 0 && (
          <div className="mt-4">
            <div className={`hint-panel ${slotDelta !== 0 ? 'warning' : ''}`} style={{ marginBottom: 0 }}>
              {slotDelta === 0 ? (
                <strong>Slot Check: Matches Page 1 Total Available Panel Slots.</strong>
              ) : (
                <>
                  <strong>Slot Check: Does NOT match Page 1 Total Available Panel Slots</strong>
                  {' '}(Modeled: {modeledSlots} | Expected: {totalAvailableSlots} | &Delta; = {Math.abs(slotDelta)}).
                  {' '}Please double check panel info and load entries.
                </>
              )}
            </div>
          </div>
        )}

        {/* A2: Panel configuration warnings */}
        {panelWarnings.length > 0 && (
          <div className="hint-panel warning mt-4" style={{ marginBottom: 0 }}>
            <strong>⚠ Panel Warnings:</strong>
            <ul style={{ margin: '4px 0 0 16px', fontSize: 13 }}>
              {panelWarnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}

        {loads.some(l => l.motor.isMotor) && (
          <div className="hint-panel mt-4" style={{ marginBottom: 0 }}>
            <strong>Motor loads detected.</strong> Enter LRA (Locked Rotor Amps) in the LRA column for accurate battery motor-start sizing.
            {loads.filter(l => l.motor.isMotor && !l.motor.lra).length > 0 && (
              <span style={{ color: '#d97706' }}>
                {' '}{loads.filter(l => l.motor.isMotor && !l.motor.lra).length} motor load(s) missing LRA — conservative estimates will be used.
              </span>
            )}
          </div>
        )}
      </div>

      {/* Service Adequacy Results */}
      {loads.length > 0 && (
        <div className="card">
          <h3>Service Adequacy Analysis</h3>

          <div className="result-grid mb-4">
            <div className="result-item">
              <div className="value">{necResult.totalDemandKVA.toFixed(1)}</div>
              <div className="label">kVA Demand (NEC)</div>
              <div className="sub">Optional Method</div>
            </div>
            <div className="result-item">
              <div className="value">{necResult.serviceAmps}A</div>
              <div className="label">Estimated Service Amps</div>
              <div className="sub">of {service.mainBreakerAmps}A main</div>
            </div>
            <div className="result-item">
              <div className="value">{necResult.ratio}%</div>
              <div className="label">Utilization</div>
              <div className="sub">{statusBadge(necResult.status)}</div>
            </div>
            <div className="result-item">
              <div className="value">{practicalResult.totalRunningKW.toFixed(1)}</div>
              <div className="label">kW Total (Practical)</div>
              <div className="sub">Sum of running watts</div>
            </div>
          </div>

          <div className="result-panel">
            <h4>NEC Optional Method Breakdown</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', fontSize: 13 }}>
              <span className="text-muted">General + Small Appliance:</span>
              <span>{(necResult.breakdown.generalAndSmallAppliance / 1000).toFixed(1)} kVA</span>
              <span className="text-muted">Fixed Appliances:</span>
              <span>{(necResult.breakdown.fixedAppliances / 1000).toFixed(1)} kVA</span>
              <span className="text-muted">Cooking:</span>
              <span>{(necResult.breakdown.cooking / 1000).toFixed(1)} kVA</span>
              <span className="text-muted">Dryer:</span>
              <span>{(necResult.breakdown.dryer / 1000).toFixed(1)} kVA</span>
              <span className="text-muted">HVAC (largest):</span>
              <span>{(necResult.breakdown.hvac / 1000).toFixed(1)} kVA</span>
              <span className="text-muted">Other Large Loads:</span>
              <span>{(necResult.breakdown.otherLarge / 1000).toFixed(1)} kVA</span>
            </div>
          </div>

          <div className="hint-panel">
            Estimate for planning purposes. Verify per NEC and local code amendments by a qualified electrician.
          </div>

          {loads.some(l => l.sourceTag === 'Assumed') && (
            <div className="hint-panel warning">
              Some loads use assumed values (not verified). Review and update watts where actual data is available.
            </div>
          )}
        </div>
      )}

      <div className="step-nav">
        <button className="btn btn-secondary" onClick={goPrev}>
          &larr; Back
        </button>
        <button className="btn btn-primary btn-lg" onClick={goNext} disabled={loads.length === 0}>
          Next: EV Charger &rarr;
        </button>
      </div>
    </>
  );
}
