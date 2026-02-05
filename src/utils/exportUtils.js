import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { calculateNECOptionalMethod, calculatePracticalLoad, calculateBatterySizing, calculateEVFeasibility, calculateModeledSlots } from './calculations';

// Save project to localStorage (legacy single-project key)
const STORAGE_KEY = 'electrical-load-calc-project';
// E3: Named project list storage key
const PROJECTS_LIST_KEY = 'electrical-load-calc-projects-list';

export function saveProjectToLocalStorage(project) {
  try {
    const data = JSON.stringify(project);
    localStorage.setItem(STORAGE_KEY, data);
    return true;
  } catch (err) {
    console.error('Failed to save to localStorage:', err);
    return false;
  }
}

export function loadProjectFromLocalStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    return JSON.parse(data);
  } catch (err) {
    console.error('Failed to load from localStorage:', err);
    return null;
  }
}

export function clearProjectFromLocalStorage() {
  localStorage.removeItem(STORAGE_KEY);
}

// E3: Named project list — save multiple projects with name + timestamp
export function getSavedProjectsList() {
  try {
    const data = localStorage.getItem(PROJECTS_LIST_KEY);
    if (!data) return [];
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export function saveNamedProject(project) {
  try {
    const list = getSavedProjectsList();
    const name = project.metadata?.projectName || 'Untitled Project';
    const entry = {
      id: `proj_${Date.now()}`,
      name,
      savedAt: new Date().toISOString(),
      loadCount: project.loads?.length || 0,
      data: project,
    };
    // Replace if same name exists, otherwise add
    const existingIdx = list.findIndex(p => p.name === name);
    if (existingIdx >= 0) {
      list[existingIdx] = entry;
    } else {
      list.unshift(entry); // newest first
    }
    localStorage.setItem(PROJECTS_LIST_KEY, JSON.stringify(list));
    // Also save as "current" project
    saveProjectToLocalStorage(project);
    return true;
  } catch (err) {
    console.error('Failed to save named project:', err);
    return false;
  }
}

export function loadNamedProject(id) {
  const list = getSavedProjectsList();
  const entry = list.find(p => p.id === id);
  return entry ? entry.data : null;
}

export function deleteNamedProject(id) {
  try {
    const list = getSavedProjectsList().filter(p => p.id !== id);
    localStorage.setItem(PROJECTS_LIST_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

// Export project as JSON
export function exportJSON(project) {
  const data = JSON.stringify(project, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.metadata.projectName || 'electrical-load-calc'}_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Import project from JSON
export function importJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        resolve(data);
      } catch (err) {
        reject(new Error('Invalid JSON file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

// Helper: get effective backup days from battery config
function getEffectiveBackupDays(batterySection) {
  const mode = batterySection.backupMode || '1';
  return mode === 'custom' ? (batterySection.customDays || 1) : Number(mode);
}

function getSolarOffset(batterySection, requireCustom = false) {
  if (requireCustom && (batterySection.backupMode || '1') !== 'custom') return 0;
  return batterySection.solarOffsetEnabled ? (batterySection.solarOffsetPercent || 0) : 0;
}

// Build proposed EV synthetic loads from Step 4 when toggle is ON
function buildProposedEVLoads(project) {
  const { ev, service, battery } = project;
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
}

// Copy summary text
export function copySummaryText(project) {
  const necResult = calculateNECOptionalMethod(project.loads, project.service);
  const practical = calculatePracticalLoad(project.loads);
  const evResult = calculateEVFeasibility(project);
  const modeledSlots = calculateModeledSlots(project.loads);

  const wholeBackupDays = getEffectiveBackupDays(project.battery.wholeHome);
  const wholeSolarOffset = getSolarOffset(project.battery.wholeHome, true);

  const batteryResult = calculateBatterySizing(
    project.loads,
    wholeBackupDays,
    { solarOffsetPercent: wholeSolarOffset, proposedEVLoads: buildProposedEVLoads(project) }
  );

  let text = `ELECTRICAL LOAD CALCULATOR SUMMARY\n`;
  text += `${'='.repeat(45)}\n\n`;

  if (project.metadata.projectName) text += `Project: ${project.metadata.projectName}\n`;
  if (project.metadata.address) text += `Address: ${project.metadata.address}\n`;
  if (project.metadata.squareFootage) text += `Square Footage: ${project.metadata.squareFootage}\n`;
  text += `Date: ${new Date().toLocaleDateString()}\n\n`;

  text += `SERVICE & PANEL\n`;
  text += `-`.repeat(30) + `\n`;
  text += `Service Voltage: ${project.service.serviceVoltage}V\n`;
  text += `Main Breaker: ${project.service.mainBreakerAmps}A\n`;
  text += `Bus Rating: ${project.service.busRatingAmps}A\n`;
  text += `Panel Slots: ${project.panel.usedSlots} used / ${project.panel.totalSlots} total\n`;
  text += `Modeled Slots: ${modeledSlots} (delta: ${modeledSlots - project.panel.usedSlots})\n`;
  text += `Tandems: ${project.panel.tandemsAllowed}\n\n`;

  text += `LOAD SUMMARY\n`;
  text += `-`.repeat(30) + `\n`;
  text += `Total Loads: ${project.loads.length}\n`;
  text += `Total Running Watts: ${practical.totalRunningWatts.toLocaleString()}W (${practical.totalRunningKW.toFixed(1)} kW)\n`;
  text += `Total Daily Energy: ${practical.totalDailyKWh.toFixed(1)} kWh/day\n\n`;

  text += `SERVICE ADEQUACY (NEC Optional Method)\n`;
  text += `-`.repeat(30) + `\n`;
  text += `Estimated Demand: ${necResult.totalDemandKVA.toFixed(1)} kVA\n`;
  text += `Estimated Service Amps: ${necResult.serviceAmps}A\n`;
  text += `Status: ${necResult.status} (${necResult.ratio}% of main breaker)\n\n`;

  if (evResult) {
    text += `EV CHARGER\n`;
    text += `-`.repeat(30) + `\n`;
    text += `Charger: ${project.ev.chargerOption?.label || 'Custom'} (${evResult.continuousAmps}A continuous)`;
    if ((project.ev.chargerCount || 1) > 1) text += ` × ${project.ev.chargerCount}`;
    text += `\n`;
    text += `Total EV Load: ${(evResult.evWattsTotal / 1000).toFixed(1)} kW\n`;
    text += `Required Breaker: ${evResult.breakerAmps}A 2-pole\n`;
    text += `Recommendation: ${evResult.recommendation}\n\n`;
  }

  text += `BATTERY SIZING (Whole Home - ${wholeBackupDays} day backup`;
  if (wholeSolarOffset > 0) text += `, ${wholeSolarOffset}% solar offset`;
  text += `)\n`;
  text += `-`.repeat(30) + `\n`;
  text += `Energy Needed: ${batteryResult.summary.totalEnergyNeededKWh} kWh\n`;
  text += `Peak Power: ${batteryResult.summary.peakPowerKW} kW\n`;
  text += `Enphase 5P: ${batteryResult.enphase5P.count} units (${batteryResult.enphase5P.totalKWh} kWh / ${batteryResult.enphase5P.totalKW.toFixed(1)} kW)${batteryResult.enphase5P.notFeasible ? ' [NOT FEASIBLE]' : ''}\n`;
  text += `Enphase 10C: ${batteryResult.enphase10C.count} units (${batteryResult.enphase10C.totalKWh} kWh / ${batteryResult.enphase10C.totalKW.toFixed(1)} kW)${batteryResult.enphase10C.notFeasible ? ' [NOT FEASIBLE]' : ''}\n`;
  text += `Tesla PW3: ${batteryResult.teslaPW3Only.count} units (${batteryResult.teslaPW3Only.totalKWh} kWh / ${batteryResult.teslaPW3Only.totalKW.toFixed(1)} kW)${batteryResult.teslaPW3Only.notFeasible ? ' [NOT FEASIBLE]' : ''}\n`;
  if (batteryResult.teslaPW3WithExpansions.expansions > 0) {
    text += `Tesla PW3 + Exp: ${batteryResult.teslaPW3WithExpansions.leaders} leaders + ${batteryResult.teslaPW3WithExpansions.expansions} expansions (${batteryResult.teslaPW3WithExpansions.totalKWh} kWh)${batteryResult.teslaPW3WithExpansions.notFeasible ? ' [NOT FEASIBLE]' : ''}\n`;
  }

  // Rev 11: Partial home details
  if (project.battery.partialHome.enabled) {
    const partialIds = Object.entries(project.battery.partialHome.selections || {})
      .filter(([, v]) => v.include)
      .map(([id]) => id);

    if (partialIds.length > 0) {
      const partialBackupDays = getEffectiveBackupDays(project.battery.partialHome);
      const partialSolarOffset = getSolarOffset(project.battery.partialHome);
      const partialResult = calculateBatterySizing(
        project.loads,
        partialBackupDays,
        { includeLoadIds: partialIds, partialSelections: project.battery.partialHome.selections, solarOffsetPercent: partialSolarOffset }
      );

      text += `\nBATTERY SIZING (Partial Home - ${partialBackupDays} day backup`;
      if (partialSolarOffset > 0) text += `, ${partialSolarOffset}% solar offset`;
      text += `)\n`;
      text += `-`.repeat(30) + `\n`;

      const partialLoads = project.loads.filter(l => partialIds.includes(l.id));
      text += `Included loads (${partialLoads.length}):\n`;
      partialLoads.forEach(l => {
        const sel = project.battery.partialHome.selections[l.id] || {};
        text += `  - ${l.description || l.category}: ${l.usage.assumedWatts}W, ${sel.hoursPerDay || l.usage.hoursPerDay}h/day\n`;
      });

      text += `Energy Needed: ${partialResult.summary.totalEnergyNeededKWh} kWh\n`;
      text += `Peak Power: ${partialResult.summary.peakPowerKW} kW\n`;
      text += `Enphase 5P: ${partialResult.enphase5P.count} units\n`;
      text += `Enphase 10C: ${partialResult.enphase10C.count} units\n`;
      text += `Tesla PW3: ${partialResult.teslaPW3Only.count} units\n`;
    }
  }

  text += `\n---\nGenerated by Venture Home Electrical Load Calculator\n`;
  text += `Estimate for planning; verify per code and site conditions.\n`;

  return text;
}

// Rev 13: Copy prompt text
export function copyPromptText(project) {
  const summary = copySummaryText(project);
  let prompt = `I have the following electrical load calculator data for a residential project. Please analyze and help me write a proposal.\n\n`;
  prompt += summary;
  prompt += `\n\nFull load details:\n`;
  project.loads.forEach(l => {
    prompt += `- ${l.description || l.category}: ${l.usage.assumedWatts}W, ${l.breaker.poles}P/${l.breaker.amps}A, ${l.usage.hoursPerDay}h/day, ${l.sourceTag}${l.motor.isMotor ? ', motor' : ''}${l.isNECBaseline ? ' [NEC baseline]' : ''}\n`;
  });
  prompt += `\nPlease provide a summary suitable for a solar + battery proposal.`;
  return prompt;
}

// Generate PDF report - Rev 12: error handling with try/catch
export function generatePDF(project) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width;
  let y = 20;

  const necResult = calculateNECOptionalMethod(project.loads, project.service);
  const practical = calculatePracticalLoad(project.loads);
  const evResult = calculateEVFeasibility(project);
  const modeledSlots = calculateModeledSlots(project.loads);

  const wholeBackupDays = getEffectiveBackupDays(project.battery.wholeHome);
  const wholeSolarOffset = getSolarOffset(project.battery.wholeHome, true);
  const batteryResult = calculateBatterySizing(
    project.loads,
    wholeBackupDays,
    { solarOffsetPercent: wholeSolarOffset, proposedEVLoads: buildProposedEVLoads(project) }
  );

  // Header
  doc.setFillColor(20, 40, 80);
  doc.rect(0, 0, pageWidth, 35, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.text('Electrical Load Calculator Report', pageWidth / 2, 15, { align: 'center' });
  doc.setFontSize(10);
  doc.text('Venture Home Solar', pageWidth / 2, 23, { align: 'center' });
  doc.setFontSize(8);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth / 2, 30, { align: 'center' });

  doc.setTextColor(0, 0, 0);
  y = 45;

  // Project Info
  if (project.metadata.projectName || project.metadata.address) {
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('Project Information', 14, y);
    y += 7;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    if (project.metadata.projectName) {
      doc.text(`Project: ${project.metadata.projectName}`, 14, y);
      y += 5;
    }
    if (project.metadata.address) {
      doc.text(`Address: ${project.metadata.address}`, 14, y);
      y += 5;
    }
    if (project.metadata.squareFootage) {
      doc.text(`Square Footage: ${project.metadata.squareFootage}`, 14, y);
      y += 5;
    }
    y += 5;
  }

  // Service & Panel
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Service & Panel Configuration', 14, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    head: [['Parameter', 'Value']],
    body: [
      ['Service Voltage', `${project.service.serviceVoltage}V`],
      ['Main Breaker', `${project.service.mainBreakerAmps}A`],
      ['Bus Rating', `${project.service.busRatingAmps}A`],
      ['Panel Slots', `${project.panel.usedSlots} used / ${project.panel.totalSlots} total`],
      ['Modeled Slots', `${modeledSlots} (delta: ${modeledSlots - project.panel.usedSlots})`],
      ['Tandems', project.panel.tandemsAllowed],
    ],
    theme: 'striped',
    headStyles: { fillColor: [20, 40, 80] },
    margin: { left: 14 },
    tableWidth: pageWidth - 28,
  });
  y = (doc.lastAutoTable || doc.previousAutoTable).finalY + 10;

  // Load Table
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Load Schedule', 14, y);
  y += 3;

  const loadRows = project.loads.map(l => [
    l.description || l.category,
    `${l.breaker.poles}P / ${l.breaker.amps}A${l.breaker.type === 'Tandem' ? ' (T)' : ''}`,
    `${l.usage.assumedWatts.toLocaleString()}W`,
    `${l.usage.hoursPerDay}h`,
    `${(l.usage.assumedWatts * l.usage.hoursPerDay / 1000).toFixed(1)} kWh`,
    l.sourceTag,
  ]);

  autoTable(doc, {
    startY: y,
    head: [['Load', 'Breaker', 'Watts', 'Hrs/Day', 'Daily kWh', 'Source']],
    body: loadRows,
    theme: 'striped',
    headStyles: { fillColor: [20, 40, 80] },
    margin: { left: 14 },
    tableWidth: pageWidth - 28,
    styles: { fontSize: 8 },
  });
  y = (doc.lastAutoTable || doc.previousAutoTable).finalY + 5;

  // Totals row
  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  doc.text(`Total: ${practical.totalRunningWatts.toLocaleString()}W (${practical.totalRunningKW.toFixed(1)} kW) | Daily: ${practical.totalDailyKWh.toFixed(1)} kWh`, 14, y);
  y += 10;

  // Check if we need a new page
  if (y > 240) {
    doc.addPage();
    y = 20;
  }

  // Service Adequacy
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Service Adequacy Analysis', 14, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    head: [['Metric', 'Value']],
    body: [
      ['NEC Optional Method Demand', `${necResult.totalDemandKVA.toFixed(1)} kVA`],
      ['Estimated Service Amps', `${necResult.serviceAmps}A`],
      ['Main Breaker Capacity', `${project.service.mainBreakerAmps}A`],
      ['Utilization', `${necResult.ratio}%`],
      ['Status', necResult.status],
    ],
    theme: 'striped',
    headStyles: { fillColor: [20, 40, 80] },
    margin: { left: 14 },
    tableWidth: pageWidth - 28,
    didParseCell: function(data) {
      if (data.row.index === 4 && data.column.index === 1) {
        const statusColor = necResult.status === 'OK' ? [0, 128, 0]
          : necResult.status === 'Borderline' ? [200, 150, 0]
          : [200, 0, 0];
        data.cell.styles.textColor = statusColor;
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });
  y = (doc.lastAutoTable || doc.previousAutoTable).finalY + 10;

  // EV Charger
  if (evResult) {
    if (y > 230) { doc.addPage(); y = 20; }
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('EV Charger Feasibility', 14, y);
    y += 3;

    autoTable(doc, {
      startY: y,
      head: [['Parameter', 'Value']],
      body: [
        ['Charger', `${project.ev.chargerOption?.label || 'Custom'}${(project.ev.chargerCount || 1) > 1 ? ` × ${project.ev.chargerCount}` : ''}`],
        ['Continuous Amps', `${evResult.continuousAmps}A`],
        ['Required Breaker', `${evResult.breakerAmps}A 2-pole`],
        ['Total EV Load', `${(evResult.evWattsTotal / 1000).toFixed(1)} kW`],
        ['Panel Space', evResult.hasSpace ? 'Available' : 'Not available'],
        ['Recommendation', evResult.recommendation],
      ],
      theme: 'striped',
      headStyles: { fillColor: [20, 40, 80] },
      margin: { left: 14 },
      tableWidth: pageWidth - 28,
    });
    y = (doc.lastAutoTable || doc.previousAutoTable).finalY + 10;
  }

  // Battery Sizing - Whole Home
  if (y > 200) { doc.addPage(); y = 20; }
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  let batteryTitle = `Battery Sizing - Whole Home (${wholeBackupDays} Day Backup`;
  if (wholeSolarOffset > 0) batteryTitle += `, ${wholeSolarOffset}% solar`;
  batteryTitle += ')';
  doc.text(batteryTitle, 14, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    head: [['System', 'Units', 'Total kWh', 'Total kW', 'Limited By', 'Status']],
    body: [
      [
        'Enphase IQ 5P',
        batteryResult.enphase5P.count,
        batteryResult.enphase5P.totalKWh,
        batteryResult.enphase5P.totalKW.toFixed(1),
        batteryResult.enphase5P.limitedBy,
        batteryResult.enphase5P.notFeasible ? 'NOT FEASIBLE' : 'OK',
      ],
      [
        'Enphase IQ 10C',
        batteryResult.enphase10C.count,
        batteryResult.enphase10C.totalKWh,
        batteryResult.enphase10C.totalKW.toFixed(1),
        batteryResult.enphase10C.limitedBy,
        batteryResult.enphase10C.notFeasible ? 'NOT FEASIBLE' : 'OK',
      ],
      [
        'Enphase Mixed',
        `${batteryResult.enphase_mixed.count10C}x 10C + ${batteryResult.enphase_mixed.count5P}x 5P`,
        batteryResult.enphase_mixed.totalKWh,
        batteryResult.enphase_mixed.totalKW.toFixed(1),
        'optimized',
        batteryResult.enphase_mixed.notFeasible ? 'NOT FEASIBLE' : 'OK',
      ],
      [
        'Tesla PW3 Only',
        batteryResult.teslaPW3Only.count,
        batteryResult.teslaPW3Only.totalKWh,
        batteryResult.teslaPW3Only.totalKW.toFixed(1),
        batteryResult.teslaPW3Only.limitedBy,
        batteryResult.teslaPW3Only.notFeasible ? 'NOT FEASIBLE' : 'OK',
      ],
      [
        'Tesla PW3 + Exp',
        `${batteryResult.teslaPW3WithExpansions.leaders} PW3 + ${batteryResult.teslaPW3WithExpansions.expansions} Exp`,
        batteryResult.teslaPW3WithExpansions.totalKWh,
        batteryResult.teslaPW3WithExpansions.totalKW.toFixed(1),
        'energy + power',
        batteryResult.teslaPW3WithExpansions.notFeasible ? 'NOT FEASIBLE' : 'OK',
      ],
    ],
    theme: 'striped',
    headStyles: { fillColor: [20, 40, 80] },
    margin: { left: 14 },
    tableWidth: pageWidth - 28,
    styles: { fontSize: 9 },
  });
  y = (doc.lastAutoTable || doc.previousAutoTable).finalY + 10;

  // Rev 11: Partial home details in PDF
  if (project.battery.partialHome.enabled) {
    const partialIds = Object.entries(project.battery.partialHome.selections || {})
      .filter(([, v]) => v.include)
      .map(([id]) => id);

    if (partialIds.length > 0) {
      const partialBackupDays = getEffectiveBackupDays(project.battery.partialHome);
      const partialSolarOffset = getSolarOffset(project.battery.partialHome);
      const partialResult = calculateBatterySizing(
        project.loads,
        partialBackupDays,
        {
          includeLoadIds: partialIds,
          partialSelections: project.battery.partialHome.selections,
          solarOffsetPercent: partialSolarOffset,
        }
      );

      if (y > 200) { doc.addPage(); y = 20; }
      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      let partialTitle = `Battery Sizing - Partial Home (${partialBackupDays} Day Backup`;
      if (partialSolarOffset > 0) partialTitle += `, ${partialSolarOffset}% solar`;
      partialTitle += ')';
      doc.text(partialTitle, 14, y);
      y += 5;

      // Included loads detail table
      const partialLoads = project.loads.filter(l => partialIds.includes(l.id));
      const partialLoadRows = partialLoads.map(l => {
        const sel = project.battery.partialHome.selections[l.id] || {};
        const hrs = sel.hoursPerDay || l.usage.hoursPerDay;
        return [l.description || l.category, `${l.usage.assumedWatts}W`, `${hrs}h`, `${(l.usage.assumedWatts * hrs / 1000).toFixed(1)} kWh`];
      });

      autoTable(doc, {
        startY: y,
        head: [['Included Load', 'Watts', 'Hrs/Day', 'Daily kWh']],
        body: partialLoadRows,
        theme: 'striped',
        headStyles: { fillColor: [20, 40, 80] },
        margin: { left: 14 },
        tableWidth: pageWidth - 28,
        styles: { fontSize: 8 },
      });
      y = (doc.lastAutoTable || doc.previousAutoTable).finalY + 5;

      autoTable(doc, {
        startY: y,
        head: [['System', 'Units', 'Total kWh', 'Total kW']],
        body: [
          ['Enphase IQ 5P', partialResult.enphase5P.count, partialResult.enphase5P.totalKWh, partialResult.enphase5P.totalKW.toFixed(1)],
          ['Enphase IQ 10C', partialResult.enphase10C.count, partialResult.enphase10C.totalKWh, partialResult.enphase10C.totalKW.toFixed(1)],
          ['Tesla PW3', partialResult.teslaPW3Only.count, partialResult.teslaPW3Only.totalKWh, partialResult.teslaPW3Only.totalKW.toFixed(1)],
        ],
        theme: 'striped',
        headStyles: { fillColor: [20, 40, 80] },
        margin: { left: 14 },
        tableWidth: pageWidth - 28,
      });
      y = (doc.lastAutoTable || doc.previousAutoTable).finalY + 10;
    }
  }

  // Confidence Legend
  if (y > 250) { doc.addPage(); y = 20; }
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text('Source Tag Legend', 14, y);
  y += 5;
  doc.setFontSize(8);
  doc.setFont(undefined, 'normal');
  doc.text('Assumed - Default value from load library, not verified', 14, y); y += 4;
  doc.text('Breaker-based - Calculated from breaker size and utilization factor', 14, y); y += 4;
  doc.text('Nameplate - From equipment nameplate data', 14, y); y += 4;
  doc.text('User-entered - Manually entered by user', 14, y); y += 8;

  // Disclaimer
  doc.setFontSize(7);
  doc.setTextColor(100, 100, 100);
  doc.text('DISCLAIMER: This report is an estimate for planning purposes only. All calculations should be verified', 14, y); y += 3;
  doc.text('per applicable codes (NEC, local amendments) and site conditions by a qualified electrician or engineer.', 14, y); y += 3;
  doc.text('Venture Home Solar assumes no liability for installations based on these estimates.', 14, y);

  // Save
  const filename = `${project.metadata.projectName || 'electrical-load-report'}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
