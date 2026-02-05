// Initial project state
export function createInitialProject() {
  return {
    metadata: {
      projectName: '',
      address: '',
      squareFootage: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    service: {
      serviceVoltage: 240,
      mainBreakerAmps: 200,
      busRatingAmps: 200,
    },
    panel: {
      totalSlots: 40,
      usedSlots: 20,
      tandemSlotsUsed: 0, // tandem slots currently occupied (each hosts 2 circuits)
      tandemsAllowed: 'Unknown',
      tandemPolicy: {
        allowedPositions: 'All slots',
        customMaxTandemSlots: null,
      },
    },
    loadEntryPath: null, // 'manual' or 'guided'
    guidedComplete: false,
    loads: [],
    ev: {
      includeInBackupDefault: false,
      chargerOption: null,
      customContinuousAmps: null,
      chargerCount: 1,
    },
    battery: {
      wholeHome: {
        backupDays: 1,
        backupMode: '1', // '1', '2', 'custom'
        customDays: 1,
        includeEV: false,
        solarOffsetPercent: 0,
        solarOffsetEnabled: false,
      },
      partialHome: {
        enabled: false,
        backupDays: 1,
        backupMode: '1',
        customDays: 1,
        selections: {},
        solarOffsetPercent: 0,
        solarOffsetEnabled: false,
      },
    },
  };
}

let nextLoadId = 1;

export function createLoadEntry(overrides = {}) {
  const id = `load_${nextLoadId++}_${Date.now()}`;
  return {
    id,
    circuitNumber: '',
    description: '',
    category: 'Other',
    isNECBaseline: false,
    breaker: {
      poles: 1,
      amps: 15,
      type: 'Standard', // 'Standard' or 'Tandem'
      voltageOverride: null,
    },
    // For tandem breakers: two circuits share one slot
    tandemCircuitB: null, // { description, category, amps, assumedWatts, hoursPerDay, isMotor, lra }
    usage: {
      assumedWatts: 500,
      hoursPerDay: 4,
      includeInServiceCalc: true,
      includeInBatteryCalc: true,
    },
    motor: {
      isMotor: false,
      nameplateKnown: false,
      lra: null,
      notes: '',
    },
    sourceTag: 'Assumed',
    _wattsManuallySet: false,
    ...overrides,
  };
}

// Create NEC baseline loads from square footage
export function createNECBaselineLoads(sqFt) {
  const sqFtNum = Number(sqFt) || 1500;
  const lightingWatts = Math.round(sqFtNum * 3); // NEC 220.12: 3 VA/sq ft
  return [
    createLoadEntry({
      description: 'NEC Baseline: General Lighting & Receptacles',
      category: 'General Lighting/Receptacles',
      isNECBaseline: true,
      breaker: { poles: 1, amps: 15, type: 'Standard', voltageOverride: null },
      usage: { assumedWatts: lightingWatts, hoursPerDay: 8, includeInServiceCalc: true, includeInBatteryCalc: true },
      motor: { isMotor: false, nameplateKnown: false, lra: null, notes: '' },
      sourceTag: 'Assumed',
    }),
    createLoadEntry({
      description: 'NEC Baseline: Small Appliance Circuit #1',
      category: 'Other',
      isNECBaseline: true,
      breaker: { poles: 1, amps: 20, type: 'Standard', voltageOverride: null },
      usage: { assumedWatts: 1500, hoursPerDay: 2, includeInServiceCalc: true, includeInBatteryCalc: true },
      motor: { isMotor: false, nameplateKnown: false, lra: null, notes: '' },
      sourceTag: 'Assumed',
    }),
    createLoadEntry({
      description: 'NEC Baseline: Small Appliance Circuit #2',
      category: 'Other',
      isNECBaseline: true,
      breaker: { poles: 1, amps: 20, type: 'Standard', voltageOverride: null },
      usage: { assumedWatts: 1500, hoursPerDay: 2, includeInServiceCalc: true, includeInBatteryCalc: true },
      motor: { isMotor: false, nameplateKnown: false, lra: null, notes: '' },
      sourceTag: 'Assumed',
    }),
    createLoadEntry({
      description: 'NEC Baseline: Laundry Circuit',
      category: 'Other',
      isNECBaseline: true,
      breaker: { poles: 1, amps: 20, type: 'Standard', voltageOverride: null },
      usage: { assumedWatts: 1500, hoursPerDay: 1, includeInServiceCalc: true, includeInBatteryCalc: true },
      motor: { isMotor: false, nameplateKnown: false, lra: null, notes: '' },
      sourceTag: 'Assumed',
    }),
  ];
}

export function resetLoadIdCounter() {
  nextLoadId = 1;
}
