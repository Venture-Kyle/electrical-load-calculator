import { BATTERY_SPECS } from '../data/loadLibrary';

// Calculate voltage for a load based on service and breaker config
export function getLoadVoltage(load, serviceVoltage) {
  if (load.breaker.voltageOverride) return load.breaker.voltageOverride;
  return load.breaker.poles === 1 ? 120 : serviceVoltage;
}

// Calculate breaker-based estimated watts
export function calculateBreakerWatts(load, serviceVoltage, utilizationFactor = 0.5) {
  const volts = getLoadVoltage(load, serviceVoltage);
  return Math.round(volts * load.breaker.amps * utilizationFactor);
}

// Panel slot calculations
export function calculatePanelSlots(panel) {
  const availableSlots = panel.totalSlots - panel.usedSlots;

  let tandemCapableSlots = 0;
  if (panel.tandemsAllowed === 'Allowed') {
    switch (panel.tandemPolicy.allowedPositions) {
      case 'All slots':
        tandemCapableSlots = panel.totalSlots;
        break;
      case 'Bottom half only':
        tandemCapableSlots = Math.floor(panel.totalSlots / 2);
        break;
      case 'Custom':
        tandemCapableSlots = panel.tandemPolicy.customMaxTandemSlots || 0;
        break;
    }
  }

  return {
    availableSlots,
    tandemCapableSlots,
    canFreeSlotsWithTandems: panel.tandemsAllowed === 'Allowed' && tandemCapableSlots > 0,
  };
}

// Compute modeled slot usage from loads for slot reconciliation (rev 5)
export function calculateModeledSlots(loads) {
  let modeledSlots = 0;
  for (const load of loads) {
    if (load.breaker.type === 'Tandem') {
      modeledSlots += 1; // tandem = 1 slot, 2 circuits
    } else {
      modeledSlots += load.breaker.poles === 2 ? 2 : 1;
    }
  }
  return modeledSlots;
}

// NEC Optional Method (simplified) - 220.82/220.83
// Rev 6: service calc uses ALL loads (no per-row includeInServiceCalc filter)
export function calculateNECOptionalMethod(loads, service, sqFt = null) {
  // Step 1: General lighting & receptacles at 3 VA/sq ft
  let generalLoadVA = 0;
  if (sqFt && sqFt > 0) {
    generalLoadVA = sqFt * 3;
  } else {
    const lightingLoads = loads.filter(l => l.category === 'General Lighting/Receptacles');
    generalLoadVA = lightingLoads.reduce((sum, l) => sum + l.usage.assumedWatts, 0);
    if (generalLoadVA === 0) generalLoadVA = 4500;
  }

  // Step 2: Small appliance + laundry circuits (NEC 220.52)
  const smallApplianceVA = 3000;
  const laundryVA = 1500;

  // Step 3: Apply demand factor to general + small appliance + laundry
  const generalTotal = generalLoadVA + smallApplianceVA + laundryVA;
  let demandGeneral;
  if (generalTotal <= 10000) {
    demandGeneral = generalTotal;
  } else {
    demandGeneral = 10000 + (generalTotal - 10000) * 0.4;
  }

  // Step 4: Fixed appliances (no includeInServiceCalc filter)
  const fixedCategories = [
    'Dishwasher', 'Garbage Disposal', 'Microwave', 'Clothes Washer',
    'Water Heater (Electric)', 'Dehumidifier',
  ];
  const fixedLoads = loads.filter(l =>
    fixedCategories.some(c => l.category.includes(c.replace('Electric ', '')))
  );
  let fixedLoadVA = fixedLoads.reduce((sum, l) => sum + l.usage.assumedWatts, 0);
  if (fixedLoads.length >= 4) {
    fixedLoadVA *= 0.75;
  }

  // Step 5: Cooking
  const cookingLoads = loads.filter(l =>
    (l.category === 'Range/Oven' || l.category === 'Cooktop')
  );
  let cookingDemand = 0;
  if (cookingLoads.length > 0) {
    const totalCookingWatts = cookingLoads.reduce((sum, l) => sum + l.usage.assumedWatts, 0);
    if (cookingLoads.length === 1 && totalCookingWatts <= 12000) {
      cookingDemand = 8000;
    } else {
      cookingDemand = totalCookingWatts * 0.65;
    }
  }

  // Step 6: Dryer
  const dryerLoads = loads.filter(l => l.category === 'Electric Dryer');
  let dryerDemand = 0;
  if (dryerLoads.length > 0) {
    dryerDemand = Math.max(5000, dryerLoads.reduce((sum, l) => sum + l.usage.assumedWatts, 0));
  }

  // Step 7: HVAC
  const coolingLoads = loads.filter(l =>
    (l.category === 'AC Condenser' || l.category === 'Heat Pump' || l.category === 'Air Handler')
  );
  const coolingVA = coolingLoads.reduce((sum, l) => sum + l.usage.assumedWatts, 0);

  const heatingLoads = loads.filter(l =>
    l.category.includes('Furnace') || l.category.includes('Boiler')
  );
  const heatingVA = heatingLoads.reduce((sum, l) => sum + l.usage.assumedWatts, 0);
  const hvacDemand = Math.max(coolingVA, heatingVA);

  // Step 8: Other large loads (all remaining)
  const otherLargeLoads = loads.filter(l =>
    !fixedCategories.some(c => l.category.includes(c.replace('Electric ', ''))) &&
    !cookingLoads.includes(l) &&
    !dryerLoads.includes(l) &&
    !coolingLoads.includes(l) &&
    !heatingLoads.includes(l) &&
    l.category !== 'General Lighting/Receptacles' &&
    l.category !== 'EV Charger'
  );
  const otherLargeVA = otherLargeLoads.reduce((sum, l) => sum + l.usage.assumedWatts, 0);

  // EV load
  const evLoads = loads.filter(l => l.category === 'EV Charger');
  const evVA = evLoads.reduce((sum, l) => sum + l.usage.assumedWatts, 0);

  const totalDemandVA = demandGeneral + fixedLoadVA + cookingDemand + dryerDemand + hvacDemand + otherLargeVA + evVA;
  const serviceAmps = totalDemandVA / service.serviceVoltage;

  let status = 'OK';
  const ratio = serviceAmps / service.mainBreakerAmps;
  if (ratio > 1.0) status = 'Undersized';
  else if (ratio > 0.8) status = 'Borderline';

  return {
    totalDemandVA,
    totalDemandKVA: totalDemandVA / 1000,
    serviceAmps: Math.round(serviceAmps * 10) / 10,
    status,
    ratio: Math.round(ratio * 100),
    breakdown: {
      generalAndSmallAppliance: Math.round(demandGeneral),
      fixedAppliances: Math.round(fixedLoadVA),
      cooking: Math.round(cookingDemand),
      dryer: Math.round(dryerDemand),
      hvac: Math.round(hvacDemand),
      otherLarge: Math.round(otherLargeVA),
      ev: Math.round(evVA),
    },
  };
}

// Practical summed model (for battery sizing)
// Rev 6: no includeInServiceCalc filter when includeLoadIds is null
export function calculatePracticalLoad(loads, includeLoadIds = null) {
  let filteredLoads = includeLoadIds
    ? loads.filter(l => includeLoadIds.includes(l.id))
    : loads;

  const totalRunningWatts = filteredLoads.reduce((sum, l) => sum + l.usage.assumedWatts, 0);
  const totalDailyWh = filteredLoads.reduce((sum, l) =>
    sum + (l.usage.assumedWatts * l.usage.hoursPerDay), 0);

  const motorLoads = filteredLoads.filter(l => l.motor.isMotor);
  const largestMotorWatts = motorLoads.reduce((max, l) => Math.max(max, l.usage.assumedWatts), 0);
  const largestMotorLRA = motorLoads.reduce((max, l) => Math.max(max, l.motor.lra || 0), 0);

  return {
    totalRunningWatts,
    totalRunningKW: totalRunningWatts / 1000,
    totalDailyWh,
    totalDailyKWh: totalDailyWh / 1000,
    largestMotorWatts,
    largestMotorLRA,
    motorLoads: motorLoads.length,
  };
}

// Battery sizing calculation - Rev 10: fix scaling, max config, notFeasible
// Rev 9: solar offset support
export function calculateBatterySizing(loads, backupDays, options = {}) {
  const { includeLoadIds = null, solarOffsetPercent = 0, proposedEVLoads = null } = options;

  let filteredLoads = loads.filter(l => {
    if (includeLoadIds) return includeLoadIds.includes(l.id);
    if (!l.usage.includeInBatteryCalc) return false;
    // Existing EV charger loads in Step 3 are always included in whole-home sizing
    return true;
  });

  // Append proposed EV charger(s) from Step 4 when toggle is ON
  if (proposedEVLoads && proposedEVLoads.length > 0) {
    filteredLoads = [...filteredLoads, ...proposedEVLoads];
  }

  // Apply partial home custom hours
  if (options.partialSelections) {
    filteredLoads = filteredLoads.map(l => {
      const sel = options.partialSelections[l.id];
      if (sel) {
        return { ...l, usage: { ...l.usage, hoursPerDay: sel.hoursPerDay } };
      }
      return l;
    });
  }

  const practicalLoad = calculatePracticalLoad(filteredLoads);
  let totalEnergyNeededKWh = practicalLoad.totalDailyKWh * backupDays;

  // Apply solar offset
  if (solarOffsetPercent > 0) {
    totalEnergyNeededKWh = totalEnergyNeededKWh * (1 - solarOffsetPercent / 100);
  }
  totalEnergyNeededKWh = Math.max(0, totalEnergyNeededKWh);

  const peakPowerKW = practicalLoad.totalRunningKW;

  const motorLoads = filteredLoads.filter(l => l.motor.isMotor);
  const largestLRA = motorLoads.reduce((max, l) => Math.max(max, l.motor.lra || 0), 0);
  const hasUnknownMotorLRA = motorLoads.some(l => !l.motor.lra && l.motor.isMotor);

  const results = {};

  // Helper: check if exceeds max config
  const checkFeasibility = (count, maxUnits, label) => {
    if (count > maxUnits) {
      return { notFeasible: true, reason: `Exceeds maximum configuration (${maxUnits} ${label} max)` };
    }
    return { notFeasible: false };
  };

  // Enphase 5P
  const e5p = BATTERY_SPECS.enphase5P;
  const e5pForEnergy = Math.ceil(totalEnergyNeededKWh / e5p.usableKWh);
  const e5pForPower = Math.ceil(peakPowerKW / e5p.continuousKW);
  const e5pCount = Math.max(e5pForEnergy, e5pForPower, 1);
  const e5pFeasibility = checkFeasibility(e5pCount, e5p.maxUnits, 'units');
  results.enphase5P = {
    count: e5pFeasibility.notFeasible ? e5pCount : Math.min(e5pCount, e5p.maxUnits),
    forEnergy: e5pForEnergy,
    forPower: e5pForPower,
    totalKWh: Math.min(e5pCount, e5p.maxUnits) * e5p.usableKWh,
    totalKW: Math.min(e5pCount, e5p.maxUnits) * e5p.continuousKW,
    limitedBy: e5pForEnergy >= e5pForPower ? 'Energy' : 'Power',
    motorStartWarning: hasUnknownMotorLRA ? 'Motor start capability not rated for 5P. Verify with Enphase.' : null,
    ...e5pFeasibility,
  };

  // Enphase 10C
  const e10c = BATTERY_SPECS.enphase10C;
  const e10cForEnergy = Math.ceil(totalEnergyNeededKWh / e10c.usableKWh);
  const e10cForPower = Math.ceil(peakPowerKW / e10c.continuousKW);
  let e10cForMotor = 0;
  if (largestLRA > 0) {
    e10cForMotor = Math.ceil(largestLRA / e10c.motorStartLRA);
  }
  const e10cCount = Math.max(e10cForEnergy, e10cForPower, e10cForMotor, 1);
  const e10cFeasibility = checkFeasibility(e10cCount, e10c.maxUnits, 'units');
  const e10cLimitedBy = e10cForEnergy >= e10cForPower && e10cForEnergy >= e10cForMotor ? 'Energy'
    : e10cForPower >= e10cForMotor ? 'Power' : 'Motor Start';
  results.enphase10C = {
    count: e10cFeasibility.notFeasible ? e10cCount : Math.min(e10cCount, e10c.maxUnits),
    forEnergy: e10cForEnergy,
    forPower: e10cForPower,
    forMotorStart: e10cForMotor,
    totalKWh: Math.min(e10cCount, e10c.maxUnits) * e10c.usableKWh,
    totalKW: Math.min(e10cCount, e10c.maxUnits) * e10c.continuousKW,
    limitedBy: e10cLimitedBy,
    motorStartWarning: hasUnknownMotorLRA ? 'Some motor loads have unknown LRA. Conservative estimates applied.' : null,
    ...e10cFeasibility,
  };

  // Enphase Mixed
  const mixedPowerUnits10C = Math.max(e10cForPower, e10cForMotor, 1);
  const mixedEnergyFrom10C = mixedPowerUnits10C * e10c.usableKWh;
  const remainingEnergy = Math.max(0, totalEnergyNeededKWh - mixedEnergyFrom10C);
  const additional5P = remainingEnergy > 0 ? Math.ceil(remainingEnergy / e5p.usableKWh) : 0;
  const mixedTotal = mixedPowerUnits10C + additional5P;
  const mixedFeasible = mixedTotal <= e10c.maxUnits + e5p.maxUnits;
  results.enphase_mixed = {
    count10C: mixedPowerUnits10C,
    count5P: additional5P,
    totalUnits: mixedTotal,
    totalKWh: mixedPowerUnits10C * e10c.usableKWh + additional5P * e5p.usableKWh,
    totalKW: mixedPowerUnits10C * e10c.continuousKW + additional5P * e5p.continuousKW,
    notFeasible: !mixedFeasible,
    reason: !mixedFeasible ? 'Exceeds maximum combined unit count' : undefined,
  };

  // Tesla Powerwall 3
  const pw3 = BATTERY_SPECS.teslaPW3;
  const pw3exp = BATTERY_SPECS.teslaPW3Expansion;

  const pw3ForPower = Math.ceil(peakPowerKW / pw3.continuousKW);
  let pw3ForMotor = 0;
  if (largestLRA > 0) {
    pw3ForMotor = Math.ceil(largestLRA / pw3.motorStartLRA);
  }
  const pw3Leaders = Math.max(pw3ForPower, pw3ForMotor, 1);
  const pw3LeadersCapped = Math.min(pw3Leaders, pw3.maxLeaders);

  // PW3 only (no expansions) - Rev 10: don't cap at maxLeaders if energy needs more
  const pw3OnlyForEnergy = Math.ceil(totalEnergyNeededKWh / pw3.usableKWh);
  const pw3OnlyCount = Math.max(pw3OnlyForEnergy, pw3LeadersCapped);
  const pw3OnlyFeasibility = checkFeasibility(pw3OnlyCount, pw3.maxLeaders, 'PW3');
  const pw3OnlyCapped = Math.min(pw3OnlyCount, pw3.maxLeaders);
  const pw3OnlyLimitedBy = pw3OnlyForEnergy >= pw3ForPower && pw3OnlyForEnergy >= pw3ForMotor ? 'Energy'
    : pw3ForPower >= pw3ForMotor ? 'Power' : 'Motor Start';
  results.teslaPW3Only = {
    count: pw3OnlyFeasibility.notFeasible ? pw3OnlyCount : pw3OnlyCapped,
    forEnergy: pw3OnlyForEnergy,
    forPower: pw3ForPower,
    forMotorStart: pw3ForMotor,
    totalKWh: pw3OnlyCapped * pw3.usableKWh,
    totalKW: pw3OnlyCapped * pw3.continuousKW,
    limitedBy: pw3OnlyLimitedBy,
    motorStartWarning: hasUnknownMotorLRA ? 'Some motor loads have unknown LRA. Conservative estimates applied.' : null,
    ...pw3OnlyFeasibility,
  };

  // Tesla PW3 + Expansions - Rev 10: properly scale
  const leaderEnergyKWh = pw3LeadersCapped * pw3.usableKWh;
  const remainingEnergyTesla = Math.max(0, totalEnergyNeededKWh - leaderEnergyKWh);
  const expansionsNeeded = remainingEnergyTesla > 0 ? Math.ceil(remainingEnergyTesla / pw3exp.usableKWh) : 0;
  const maxExpansions = pw3LeadersCapped * pw3exp.maxPerLeader;
  const expansionsCapped = Math.min(expansionsNeeded, maxExpansions);
  const totalTeslaUnits = pw3LeadersCapped + expansionsCapped;
  const teslaExceedsMax = expansionsNeeded > maxExpansions;

  results.teslaPW3WithExpansions = {
    leaders: pw3LeadersCapped,
    expansions: expansionsCapped,
    totalUnits: totalTeslaUnits,
    totalKWh: pw3LeadersCapped * pw3.usableKWh + expansionsCapped * pw3exp.usableKWh,
    totalKW: pw3LeadersCapped * pw3.continuousKW,
    exceedsMax: teslaExceedsMax,
    notFeasible: teslaExceedsMax,
    reason: teslaExceedsMax ? `Needs ${expansionsNeeded} expansions but max is ${maxExpansions} (${pw3exp.maxPerLeader} per leader)` : undefined,
  };

  results.summary = {
    totalEnergyNeededKWh: Math.round(totalEnergyNeededKWh * 10) / 10,
    peakPowerKW: Math.round(peakPowerKW * 10) / 10,
    backupDays,
    solarOffsetPercent,
    loadCount: filteredLoads.length,
    largestLRA,
    hasUnknownMotorLRA,
  };

  return results;
}

// EV feasibility check - Rev 7: support chargerCount
export function calculateEVFeasibility(project) {
  const { service, panel, ev, loads } = project;
  if (!ev.chargerOption) return null;

  const charger = ev.chargerOption;
  const continuousAmps = charger.isCustom ? (ev.customContinuousAmps || 0) : charger.continuousAmps;
  const breakerAmps = charger.isCustom
    ? Math.ceil(continuousAmps * 1.25 / 5) * 5
    : charger.recommendedBreakerAmps;
  const count = ev.chargerCount || 1;

  // Watts per charger
  const evWattsEach = continuousAmps * service.serviceVoltage;
  const evWattsTotal = evWattsEach * count;

  // Service capacity check (all loads + EV)
  const necResult = calculateNECOptionalMethod(loads, service);

  // Add EV as synthetic loads
  const evSyntheticLoads = [];
  for (let i = 0; i < count; i++) {
    evSyntheticLoads.push({
      category: 'EV Charger',
      usage: { assumedWatts: evWattsEach, includeInServiceCalc: true },
      breaker: { poles: 2 },
      motor: { isMotor: false },
    });
  }
  const necWithEV = calculateNECOptionalMethod([...loads, ...evSyntheticLoads], service);

  // D2: Space check — derive used spaces from actual loads if available
  const modeledUsedSlots = loads.length > 0 ? calculateModeledSlots(loads) : panel.usedSlots;
  const computedAvailableSlots = Math.max(0, panel.totalSlots - modeledUsedSlots);
  const panelSlots = calculatePanelSlots(panel);
  const slotsNeeded = 2 * count; // each EV is 2-pole
  const hasSpace = computedAvailableSlots >= slotsNeeded;

  let recommendation;
  if (necWithEV.status === 'Undersized') {
    recommendation = 'Service upgrade recommended';
  } else if (!hasSpace && !panelSlots.canFreeSlotsWithTandems) {
    recommendation = 'Subpanel recommended';
  } else if (!hasSpace && panelSlots.canFreeSlotsWithTandems) {
    recommendation = 'Requires tandems to free space';
  } else if (necWithEV.status === 'Borderline') {
    recommendation = 'Feasible but borderline capacity';
  } else {
    recommendation = 'Add as-is';
  }

  return {
    continuousAmps,
    breakerAmps,
    evWattsEach,
    evWattsTotal,
    evWatts: evWattsTotal,
    chargerCount: count,
    slotsNeeded,
    hasSpace,
    canUseTandems: panelSlots.canFreeSlotsWithTandems,
    necWithoutEV: necResult,
    necWithEV: necWithEV,
    recommendation,
    availableSlots: computedAvailableSlots,
  };
}
