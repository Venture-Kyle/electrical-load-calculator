import { useMemo, useState } from 'react';
import { calculateNECOptionalMethod, calculatePracticalLoad, calculateBatterySizing, calculateEVFeasibility, calculateModeledSlots } from '../utils/calculations';
import { generatePDF, copySummaryText, copyPromptText } from '../utils/exportUtils';

export default function Step7Summary({ project, goPrev, showToast }) {
  const { service, panel, loads, ev, battery } = project;
  const [showHelpPanel, setShowHelpPanel] = useState(false);

  const necResult = useMemo(() =>
    calculateNECOptionalMethod(loads, service), [loads, service]);
  const practical = useMemo(() =>
    calculatePracticalLoad(loads), [loads]);
  const evResult = useMemo(() =>
    calculateEVFeasibility(project), [project]);

  // Rev 8: use effective backup days
  const wholeBackupMode = battery.wholeHome.backupMode || '1';
  const wholeBackupDays = wholeBackupMode === 'custom' ? (battery.wholeHome.customDays || 1) : Number(wholeBackupMode);
  const wholeSolarOffset = (wholeBackupMode === 'custom' && battery.wholeHome.solarOffsetEnabled) ? (battery.wholeHome.solarOffsetPercent || 0) : 0;

  // Build proposed EV synthetic loads from Step 4 (mirrors Step 5 logic)
  const wholeProposedEVLoads = useMemo(() => {
    if (!ev.chargerOption || !battery.wholeHome.includeEV) return null;
    const charger = ev.chargerOption;
    const contAmps = charger.isCustom ? (ev.customContinuousAmps || 0) : charger.continuousAmps;
    const watts = contAmps * service.serviceVoltage;
    const count = ev.chargerCount || 1;
    const synth = [];
    for (let i = 0; i < count; i++) {
      synth.push({
        id: `_proposedEV_${i}`,
        category: 'EV Charger',
        breaker: { poles: 2 },
        usage: { assumedWatts: watts, hoursPerDay: 4, includeInBatteryCalc: true },
        motor: { isMotor: false, lra: null },
      });
    }
    return synth;
  }, [ev, service.serviceVoltage, battery.wholeHome.includeEV]);

  const batteryResult = useMemo(() =>
    calculateBatterySizing(loads, wholeBackupDays, {
      solarOffsetPercent: wholeSolarOffset,
      proposedEVLoads: wholeProposedEVLoads,
    }), [loads, wholeBackupDays, wholeSolarOffset, wholeProposedEVLoads]);

  const partialIds = useMemo(() =>
    Object.entries(battery.partialHome.selections || {})
      .filter(([, v]) => v.include)
      .map(([id]) => id),
    [battery.partialHome.selections]
  );

  const partialBackupMode = battery.partialHome.backupMode || '1';
  const partialBackupDays = partialBackupMode === 'custom' ? (battery.partialHome.customDays || 1) : Number(partialBackupMode);
  const partialSolarOffset = battery.partialHome.solarOffsetEnabled ? (battery.partialHome.solarOffsetPercent || 0) : 0;

  const partialResult = useMemo(() => {
    if (!battery.partialHome.enabled || partialIds.length === 0) return null;
    return calculateBatterySizing(loads, partialBackupDays, {
      includeLoadIds: partialIds,
      partialSelections: battery.partialHome.selections,
      solarOffsetPercent: partialSolarOffset,
    });
  }, [loads, battery.partialHome, partialIds, partialBackupDays, partialSolarOffset]);

  // Slot validation: compare modeled slots to Page 1 Total Available Panel Slots
  const modeledSlots = useMemo(() => calculateModeledSlots(loads), [loads]);
  const totalAvailableSlots = Math.max(0, panel.totalSlots - (panel.usedSlots + (panel.tandemSlotsUsed || 0)));
  const slotDelta = modeledSlots - totalAvailableSlots;

  // A2: Panel configuration warnings
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
      warns.push('Tandem breakers not allowed (or unknown), but Tandem Slots Used > 0.');
    }
    return warns;
  }, [panel]);

  // Rev 12: PDF error handling
  const handleExportPDF = () => {
    try {
      generatePDF(project);
      showToast('PDF exported successfully');
    } catch (err) {
      console.error('PDF export error:', err);
      showToast('PDF export failed: ' + (err.message || 'Unknown error'));
    }
  };

  const handleCopySummary = () => {
    const text = copySummaryText(project);
    navigator.clipboard.writeText(text).then(() => {
      showToast('Summary copied to clipboard');
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Summary copied to clipboard');
    });
  };

  const handleCopyPrompt = () => {
    const text = copyPromptText(project);
    navigator.clipboard.writeText(text).then(() => {
      showToast('Prompt copied to clipboard');
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Prompt copied to clipboard');
    });
  };

  const handlePrint = () => {
    window.print();
  };

  const statusBadge = (status) => {
    if (status === 'OK') return <span className="badge badge-ok">OK</span>;
    if (status === 'Borderline') return <span className="badge badge-warning">Borderline</span>;
    return <span className="badge badge-danger">Undersized</span>;
  };

  const sourceTagCounts = loads.reduce((acc, l) => {
    acc[l.sourceTag] = (acc[l.sourceTag] || 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <div className="card">
        <div className="card-header">
          <h2>Step 7: Final Summary & Export</h2>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={handleExportPDF} title="Generate a professional PDF report">Export PDF</button>
            <button className="btn btn-secondary btn-sm" onClick={handleCopySummary} title="Copy a plain-text summary to clipboard for emails/notes">Copy Summary</button>
            <button className="btn btn-secondary btn-sm" onClick={handleCopyPrompt} title="Copy a structured prompt for AI assistants (Claude, GPT, etc.)">Copy Prompt</button>
            <button className="btn btn-secondary btn-sm" onClick={handlePrint} title="Open browser print dialog with print-friendly formatting">Print</button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowHelpPanel(!showHelpPanel)}
              title="Help"
            >
              ?
            </button>
          </div>
        </div>

        {project.metadata.projectName && (
          <div className="mb-4">
            <h3 style={{ fontSize: 20, marginBottom: 4 }}>{project.metadata.projectName}</h3>
            {project.metadata.address && (
              <p className="text-sm text-muted">{project.metadata.address}</p>
            )}
            {project.metadata.squareFootage && (
              <p className="text-sm text-muted">{project.metadata.squareFootage} sq ft</p>
            )}
          </div>
        )}

        {/* Rev 13: Help panel */}
        {showHelpPanel && (
          <div className="hint-panel mb-4">
            <h4 style={{ marginBottom: 8 }}>Export Options</h4>
            <ul style={{ fontSize: 13, paddingLeft: 20, lineHeight: 1.8 }}>
              <li><strong>Export PDF</strong> — Generate a professional PDF report with all calculations, suitable for client presentation.</li>
              <li><strong>Copy Summary</strong> — Copy a plain-text summary to clipboard. Good for emails or notes.</li>
              <li><strong>Copy Prompt</strong> — Copy a structured prompt for AI assistants (Claude, GPT, etc.) for further analysis or proposal writing.</li>
              <li><strong>Print</strong> — Open the browser print dialog. Uses print-friendly CSS for clean output.</li>
            </ul>
          </div>
        )}
      </div>

      {/* Service & Panel */}
      <div className="card">
        <h3>Service & Panel Configuration</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px 24px', fontSize: 14 }}>
          <div>
            <span className="text-muted text-sm">Service Voltage</span>
            <div style={{ fontWeight: 600 }}>{service.serviceVoltage}V</div>
          </div>
          <div>
            <span className="text-muted text-sm">Main Breaker</span>
            <div style={{ fontWeight: 600 }}>{service.mainBreakerAmps}A</div>
          </div>
          <div>
            <span className="text-muted text-sm">Bus Rating</span>
            <div style={{ fontWeight: 600 }}>{service.busRatingAmps}A</div>
          </div>
          <div>
            <span className="text-muted text-sm">Total Slots</span>
            <div style={{ fontWeight: 600 }}>{panel.totalSlots}</div>
          </div>
          <div>
            <span className="text-muted text-sm">Used Slots</span>
            <div style={{ fontWeight: 600 }}>{panel.usedSlots}</div>
          </div>
          <div>
            <span className="text-muted text-sm">Tandems</span>
            <div style={{ fontWeight: 600 }}>{panel.tandemsAllowed}</div>
          </div>
        </div>

        {/* Slot Check: compare modeled slots to Page 1 Total Available Panel Slots */}
        <div className={`hint-panel mt-4 ${slotDelta !== 0 ? 'warning' : ''}`} style={{ marginBottom: panelWarnings.length > 0 ? 8 : 0 }}>
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
        {/* A2: Panel configuration warnings */}
        {panelWarnings.length > 0 && (
          <div className="hint-panel warning" style={{ marginBottom: 0 }}>
            <strong>⚠ Panel Warnings:</strong>
            <ul style={{ margin: '4px 0 0 16px', fontSize: 13 }}>
              {panelWarnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}
      </div>

      {/* Load Summary */}
      <div className="card">
        <h3>Load Summary</h3>
        <div className="result-grid mb-4">
          <div className="result-item">
            <div className="value">{loads.length}</div>
            <div className="label">Total Loads</div>
          </div>
          <div className="result-item">
            <div className="value">{practical.totalRunningKW.toFixed(1)}</div>
            <div className="label">kW Running</div>
          </div>
          <div className="result-item">
            <div className="value">{practical.totalDailyKWh.toFixed(1)}</div>
            <div className="label">kWh/Day</div>
          </div>
          <div className="result-item">
            <div className="value">{practical.motorLoads}</div>
            <div className="label">Motor Loads</div>
          </div>
        </div>

        {/* Source tag breakdown */}
        <div className="result-panel">
          <h4>Data Confidence</h4>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            {Object.entries(sourceTagCounts).map(([tag, count]) => (
              <div key={tag} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className={`source-tag ${tag.toLowerCase().replace(/[ -]/g, '-')}`}>
                  {tag}
                </span>
                <span className="text-sm">{count} load{count !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
          {sourceTagCounts['Assumed'] > 0 && (
            <p className="text-xs text-muted mt-2">
              {sourceTagCounts['Assumed']} load(s) using default assumed values. Consider verifying with actual data.
            </p>
          )}
        </div>
      </div>

      {/* Service Adequacy */}
      <div className="card">
        <h3>Service Adequacy</h3>
        <div className="result-grid mb-4">
          <div className="result-item">
            <div className="value">{necResult.totalDemandKVA.toFixed(1)}</div>
            <div className="label">kVA Demand (NEC)</div>
          </div>
          <div className="result-item">
            <div className="value">{necResult.serviceAmps}A</div>
            <div className="label">Service Amps</div>
            <div className="sub">of {service.mainBreakerAmps}A</div>
          </div>
          <div className="result-item">
            <div className="value">{necResult.ratio}%</div>
            <div className="label">Utilization</div>
            <div className="sub">{statusBadge(necResult.status)}</div>
          </div>
        </div>
        <div className="hint-panel">
          Estimate for planning; verify per code and site conditions.
        </div>
      </div>

      {/* EV Recommendation */}
      {evResult && (
        <div className="card">
          <h3>EV Charger Recommendation</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: 14, marginBottom: 12 }}>
            <div>
              <span className="text-muted text-sm">Charger</span>
              <div style={{ fontWeight: 600 }}>
                {ev.chargerOption?.label || 'Custom'} ({evResult.continuousAmps}A)
                {(ev.chargerCount || 1) > 1 ? ` × ${ev.chargerCount}` : ''}
              </div>
            </div>
            <div>
              <span className="text-muted text-sm">Required Breaker</span>
              <div style={{ fontWeight: 600 }}>{evResult.breakerAmps}A 2-pole{(ev.chargerCount || 1) > 1 ? ' each' : ''}</div>
            </div>
            <div>
              <span className="text-muted text-sm">Total EV Load</span>
              <div style={{ fontWeight: 600 }}>{(evResult.evWattsTotal / 1000).toFixed(1)} kW</div>
            </div>
            <div>
              <span className="text-muted text-sm">Recommendation</span>
              <div style={{ fontWeight: 600 }}>
                {evResult.recommendation === 'Add as-is' && <span className="badge badge-ok">Add As-Is</span>}
                {evResult.recommendation === 'Feasible but borderline capacity' && <span className="badge badge-warning">Borderline</span>}
                {evResult.recommendation === 'Requires tandems to free space' && <span className="badge badge-warning">Tandems Needed</span>}
                {evResult.recommendation === 'Subpanel recommended' && <span className="badge badge-warning">Subpanel</span>}
                {evResult.recommendation === 'Service upgrade recommended' && <span className="badge badge-danger">Service Upgrade</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Battery Summary - Whole Home */}
      <div className="card">
        <h3>Battery Sizing - Whole Home ({wholeBackupDays} Day{wholeBackupDays !== 1 ? 's' : ''} Backup{wholeSolarOffset > 0 ? `, ${wholeSolarOffset}% solar offset` : ''})</h3>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>System</th>
                <th>Units</th>
                <th>Total kWh</th>
                <th>Total kW</th>
                <th>Limited By</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Enphase IQ 5P</td>
                <td style={{ fontWeight: 600 }}>{batteryResult.enphase5P.count}</td>
                <td>{batteryResult.enphase5P.totalKWh}</td>
                <td>{batteryResult.enphase5P.totalKW.toFixed(1)}</td>
                <td>{batteryResult.enphase5P.limitedBy}</td>
                <td>{batteryResult.enphase5P.notFeasible ? <span className="badge badge-danger">Not Feasible</span> : <span className="badge badge-ok">OK</span>}</td>
              </tr>
              <tr>
                <td>Enphase IQ 10C</td>
                <td style={{ fontWeight: 600 }}>{batteryResult.enphase10C.count}</td>
                <td>{batteryResult.enphase10C.totalKWh}</td>
                <td>{batteryResult.enphase10C.totalKW.toFixed(1)}</td>
                <td>{batteryResult.enphase10C.limitedBy}</td>
                <td>{batteryResult.enphase10C.notFeasible ? <span className="badge badge-danger">Not Feasible</span> : <span className="badge badge-ok">OK</span>}</td>
              </tr>
              <tr>
                <td>Enphase Mixed</td>
                <td style={{ fontWeight: 600 }}>{batteryResult.enphase_mixed.count10C}x 10C + {batteryResult.enphase_mixed.count5P}x 5P</td>
                <td>{batteryResult.enphase_mixed.totalKWh}</td>
                <td>{batteryResult.enphase_mixed.totalKW.toFixed(1)}</td>
                <td>optimized</td>
                <td>{batteryResult.enphase_mixed.notFeasible ? <span className="badge badge-danger">Not Feasible</span> : <span className="badge badge-ok">OK</span>}</td>
              </tr>
              <tr>
                <td>Tesla PW3</td>
                <td style={{ fontWeight: 600 }}>{batteryResult.teslaPW3Only.count}</td>
                <td>{batteryResult.teslaPW3Only.totalKWh}</td>
                <td>{batteryResult.teslaPW3Only.totalKW.toFixed(1)}</td>
                <td>{batteryResult.teslaPW3Only.limitedBy}</td>
                <td>{batteryResult.teslaPW3Only.notFeasible ? <span className="badge badge-danger">Not Feasible</span> : <span className="badge badge-ok">OK</span>}</td>
              </tr>
              <tr>
                <td>Tesla PW3 + Exp</td>
                <td style={{ fontWeight: 600 }}>{batteryResult.teslaPW3WithExpansions.leaders} PW3 + {batteryResult.teslaPW3WithExpansions.expansions} Exp</td>
                <td>{batteryResult.teslaPW3WithExpansions.totalKWh}</td>
                <td>{batteryResult.teslaPW3WithExpansions.totalKW.toFixed(1)}</td>
                <td>energy + power</td>
                <td>{batteryResult.teslaPW3WithExpansions.notFeasible ? <span className="badge badge-danger">Not Feasible</span> : <span className="badge badge-ok">OK</span>}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Rev 11: Partial Home details in summary */}
      {partialResult && (
        <div className="card">
          <h3>Battery Sizing - Partial Home ({partialBackupDays} Day{partialBackupDays !== 1 ? 's' : ''} Backup{partialSolarOffset > 0 ? `, ${partialSolarOffset}% solar offset` : ''})</h3>

          {/* Show selected loads and their hours/day */}
          <div className="mb-4">
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Included Loads:</h4>
            <div className="table-scroll">
              <table className="data-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Load</th>
                    <th>Watts</th>
                    <th>Hrs/Day (Backup)</th>
                    <th>kWh/Day</th>
                  </tr>
                </thead>
                <tbody>
                  {loads.filter(l => partialIds.includes(l.id)).map(l => {
                    const sel = battery.partialHome.selections[l.id] || {};
                    return (
                      <tr key={l.id}>
                        <td>{l.description || l.category}</td>
                        <td>{l.usage.assumedWatts}W</td>
                        <td>{sel.hoursPerDay || l.usage.hoursPerDay}</td>
                        <td>{((sel.hoursPerDay || l.usage.hoursPerDay) * l.usage.assumedWatts / 1000).toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>System</th>
                  <th>Units</th>
                  <th>Total kWh</th>
                  <th>Total kW</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Enphase IQ 5P</td>
                  <td style={{ fontWeight: 600 }}>{partialResult.enphase5P.count}</td>
                  <td>{partialResult.enphase5P.totalKWh}</td>
                  <td>{partialResult.enphase5P.totalKW.toFixed(1)}</td>
                </tr>
                <tr>
                  <td>Enphase IQ 10C</td>
                  <td style={{ fontWeight: 600 }}>{partialResult.enphase10C.count}</td>
                  <td>{partialResult.enphase10C.totalKWh}</td>
                  <td>{partialResult.enphase10C.totalKW.toFixed(1)}</td>
                </tr>
                <tr>
                  <td>Tesla PW3</td>
                  <td style={{ fontWeight: 600 }}>{partialResult.teslaPW3Only.count}</td>
                  <td>{partialResult.teslaPW3Only.totalKWh}</td>
                  <td>{partialResult.teslaPW3Only.totalKW.toFixed(1)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <div className="card" style={{ background: '#fefce8', borderLeft: '4px solid #d97706' }}>
        <p className="text-sm" style={{ color: '#92400e' }}>
          <strong>Disclaimer:</strong> This report is an estimate for planning purposes only.
          All calculations should be verified per applicable codes (NEC, local amendments) and
          site conditions by a qualified electrician or engineer. Venture Home Solar assumes
          no liability for installations based on these estimates.
        </p>
      </div>

      <div className="card">
        <h3>Export Options</h3>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={handleExportPDF} title="Generate PDF report">
            Export PDF Report
          </button>
          <button className="btn btn-secondary" onClick={handleCopySummary} title="Copy plain-text summary">
            Copy Summary
          </button>
          <button className="btn btn-secondary" onClick={handleCopyPrompt} title="Copy AI-ready prompt">
            Copy Prompt
          </button>
          <button className="btn btn-secondary" onClick={handlePrint} title="Print this page">
            Print
          </button>
        </div>
      </div>

      <div className="step-nav">
        <button className="btn btn-secondary" onClick={goPrev}>
          &larr; Back
        </button>
        <div />
      </div>
    </>
  );
}
