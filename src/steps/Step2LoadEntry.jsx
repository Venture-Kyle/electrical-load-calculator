import { useState, useCallback, useMemo } from 'react';
import { LOAD_LIBRARY, LOAD_CATEGORIES } from '../data/loadLibrary';
import { createLoadEntry, createNECBaselineLoads } from '../data/initialState';

export default function Step2LoadEntry({ project, updateProject, goNext, goPrev }) {
  const { loadEntryPath } = project;
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [pendingCategories, setPendingCategories] = useState(null);

  const setPath = useCallback((path) => {
    updateProject(prev => ({ ...prev, loadEntryPath: path }));
  }, [updateProject]);

  // Build new loads from guided selections
  const buildGuidedLoads = useCallback((selectedCategories) => {
    const newLoads = [];
    const sqFt = project.metadata.squareFootage;
    const baselines = createNECBaselineLoads(sqFt);
    newLoads.push(...baselines);

    for (const cat of selectedCategories) {
      const lib = LOAD_LIBRARY.find(l => l.category === cat);
      if (!lib) continue;
      newLoads.push(createLoadEntry({
        description: lib.description,
        category: lib.category,
        breaker: {
          poles: lib.poles,
          amps: lib.amps,
          type: 'Standard',
          voltageOverride: null,
        },
        usage: {
          assumedWatts: lib.assumedWatts,
          hoursPerDay: lib.hoursPerDay,
          includeInServiceCalc: true,
          includeInBatteryCalc: cat !== LOAD_CATEGORIES.EV_CHARGER,
        },
        motor: {
          isMotor: lib.isMotor,
          nameplateKnown: false,
          lra: lib.defaultLRA || null,
          notes: '',
        },
        sourceTag: 'Assumed',
      }));
    }
    return newLoads;
  }, [project.metadata.squareFootage]);

  // B1: Check if any loads exist (manual edits or non-NEC) before completing guided
  // Shows confirmation modal whenever user has existing work that would be affected
  const handleGuidedComplete = useCallback((selectedCategories) => {
    const existingNonBaseline = project.loads.filter(l => !l.isNECBaseline);
    const hasEditedNEC = project.loads.some(l => l.isNECBaseline && l._necEdited);
    const hasExistingWork = existingNonBaseline.length > 0 || hasEditedNEC;
    if (hasExistingWork) {
      // Show Replace/Merge modal — user has work that would be affected
      setPendingCategories(selectedCategories);
      setShowMergeModal(true);
    } else {
      // No conflict — just replace all
      const newLoads = buildGuidedLoads(selectedCategories);
      updateProject(prev => ({
        ...prev,
        loads: newLoads,
        guidedComplete: true,
      }));
      goNext();
    }
  }, [updateProject, project.loads, buildGuidedLoads, goNext]);

  const handleMergeReplace = useCallback(() => {
    const newLoads = buildGuidedLoads(pendingCategories);
    updateProject(prev => ({
      ...prev,
      loads: newLoads,
      guidedComplete: true,
    }));
    setShowMergeModal(false);
    setPendingCategories(null);
    goNext();
  }, [updateProject, buildGuidedLoads, pendingCategories, goNext]);

  const handleMergeMerge = useCallback(() => {
    const newLoads = buildGuidedLoads(pendingCategories);
    updateProject(prev => {
      // Keep existing non-NEC loads, replace NEC baselines
      const existingNonBaseline = prev.loads.filter(l => !l.isNECBaseline);
      return {
        ...prev,
        loads: [...newLoads, ...existingNonBaseline],
        guidedComplete: true,
      };
    });
    setShowMergeModal(false);
    setPendingCategories(null);
    goNext();
  }, [updateProject, buildGuidedLoads, pendingCategories, goNext]);

  return (
    <>
      <div className="card">
        <h2>Step 2: Choose Load Entry Path</h2>
        <p className="text-sm text-muted mb-4">
          How would you like to enter the home's electrical loads?
        </p>

        <div className="option-cards">
          <div
            className={`option-card ${loadEntryPath === 'manual' ? 'selected' : ''}`}
            onClick={() => setPath('manual')}
          >
            <h4>Manual Panel Entry</h4>
            <p>
              Enter circuits directly from a panel photo or directory.
              Best for engineering with panel access.
            </p>
          </div>
          <div
            className={`option-card ${loadEntryPath === 'guided' ? 'selected' : ''}`}
            onClick={() => setPath('guided')}
          >
            <h4>Guided Questionnaire</h4>
            <p>
              Answer questions about appliances in the home.
              Uses assumption-based defaults. Good for quick estimates.
            </p>
          </div>
        </div>
      </div>

      {loadEntryPath === 'guided' && !project.guidedComplete && (
        <GuidedQuestionnaire
          project={project}
          onComplete={handleGuidedComplete}
        />
      )}

      {loadEntryPath === 'guided' && project.guidedComplete && (
        <div className="card">
          <div className="hint-panel" style={{ background: '#f0fdf4', borderColor: '#22c55e' }}>
            <strong>Guided questionnaire completed.</strong> {project.loads.length} loads generated.
            Click Next to review and edit in the Load Table.
          </div>
        </div>
      )}

      {/* Replace/Merge Modal */}
      {showMergeModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'white', borderRadius: 12, padding: 28, maxWidth: 520, width: '90%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }}>
            <h3 style={{ marginBottom: 12 }}>Existing Loads Found</h3>
            <p className="text-sm text-muted mb-4">
              You have {project.loads.filter(l => !l.isNECBaseline).length} non-baseline load(s)
              {project.loads.some(l => l.isNECBaseline && l._necEdited) ? ' and edited NEC baselines' : ''} in the project.
              Running the guided questionnaire will generate new loads. How should existing loads be handled?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button className="btn btn-primary" onClick={handleMergeReplace}>
                Replace &mdash; Remove non-NEC loads, regenerate NEC baselines
              </button>
              <button className="btn btn-secondary" onClick={handleMergeMerge}>
                Merge &mdash; Keep existing non-NEC loads, refresh NEC baselines
              </button>
              <button className="btn btn-ghost" onClick={() => { setShowMergeModal(false); setPendingCategories(null); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="step-nav">
        <button className="btn btn-secondary" onClick={goPrev}>
          &larr; Back
        </button>
        <button
          className="btn btn-primary btn-lg"
          onClick={goNext}
          disabled={!loadEntryPath}
        >
          Next: Load Table &rarr;
        </button>
      </div>
    </>
  );
}

// Typeform-style guided questionnaire sub-component
function GuidedQuestionnaire({ project, onComplete }) {
  const questions = [
    { category: LOAD_CATEGORIES.REFRIGERATOR, label: 'Does the home have a refrigerator?', icon: '🧊' },
    { category: LOAD_CATEGORIES.DRYER, label: 'Does the home have an electric dryer?', icon: '👕' },
    { category: LOAD_CATEGORIES.RANGE, label: 'Does the home have an electric range/oven?', icon: '🍳' },
    { category: LOAD_CATEGORIES.COOKTOP, label: 'Does the home have a separate electric cooktop?', icon: '🔥' },
    { category: LOAD_CATEGORIES.MICROWAVE, label: 'Does the home have a microwave?', icon: '📡' },
    { category: LOAD_CATEGORIES.DISHWASHER, label: 'Does the home have a dishwasher?', icon: '🍽️' },
    { category: LOAD_CATEGORIES.DISPOSAL, label: 'Does the home have a garbage disposal?', icon: '♻️' },
    { category: LOAD_CATEGORIES.WASHER, label: 'Does the home have a clothes washer?', icon: '🧺' },
    { category: LOAD_CATEGORIES.FREEZER, label: 'Does the home have a standalone freezer?', icon: '❄️' },
    { category: LOAD_CATEGORIES.WATER_HEATER, label: 'Does the home have an electric water heater?', icon: '🚿' },
    { category: LOAD_CATEGORIES.FURNACE_BLOWER, label: 'Does the home have a gas furnace with blower?', icon: '🌡️' },
    { category: LOAD_CATEGORIES.AC_CONDENSER, label: 'Does the home have central AC?', icon: '❄️' },
    { category: LOAD_CATEGORIES.AIR_HANDLER, label: 'Does the home have an air handler / fan coil?', icon: '💨' },
    { category: LOAD_CATEGORIES.HEAT_PUMP, label: 'Does the home have a heat pump?', icon: '🔄' },
    { category: LOAD_CATEGORIES.WELL_PUMP, label: 'Does the home have a well pump?', icon: '💧' },
    { category: LOAD_CATEGORIES.SUMP_PUMP, label: 'Does the home have a sump pump?', icon: '🔧' },
    { category: LOAD_CATEGORIES.DEHUMIDIFIER, label: 'Does the home have a dehumidifier?', icon: '💦' },
    { category: LOAD_CATEGORIES.POOL_EQUIPMENT, label: 'Does the home have pool equipment?', icon: '🏊' },
    { category: LOAD_CATEGORIES.HOT_TUB, label: 'Does the home have a hot tub / spa?', icon: '♨️' },
    { category: LOAD_CATEGORIES.WORKSHOP, label: 'Does the home have workshop / garage circuits?', icon: '🔨' },
  ];

  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState({});
  const [isComplete, setIsComplete] = useState(false);

  const totalQuestions = questions.length;
  const progress = ((currentQ) / totalQuestions) * 100;

  // answer: true (Yes), false (No), 'unknown' (Unknown — include with assumed defaults)
  const handleAnswer = (answer) => {
    const q = questions[currentQ];
    const newAnswers = { ...answers, [q.category]: answer };
    setAnswers(newAnswers);

    if (currentQ < totalQuestions - 1) {
      setCurrentQ(currentQ + 1);
    } else {
      // Done — show review
      setIsComplete(true);
    }
  };

  const handleBack = () => {
    if (currentQ > 0) {
      setCurrentQ(currentQ - 1);
    }
  };

  const handleFinish = () => {
    // Include both "Yes" and "Unknown" answers as selected
    const selected = Object.entries(answers)
      .filter(([, v]) => v === true || v === 'unknown')
      .map(([cat]) => cat);
    onComplete(selected);
  };

  const selectedCount = useMemo(() =>
    Object.values(answers).filter(v => v === true || v === 'unknown').length,
    [answers]
  );

  if (isComplete) {
    const yesItems = Object.entries(answers)
      .filter(([, v]) => v === true)
      .map(([cat]) => {
        const q = questions.find(q => q.category === cat);
        return q ? q.icon + ' ' + (LOAD_LIBRARY.find(l => l.category === cat)?.description || cat) : cat;
      });

    const unknownItems = Object.entries(answers)
      .filter(([, v]) => v === 'unknown')
      .map(([cat]) => {
        const q = questions.find(q => q.category === cat);
        return q ? q.icon + ' ' + (LOAD_LIBRARY.find(l => l.category === cat)?.description || cat) : cat;
      });

    const selectedItems = [...yesItems, ...unknownItems];

    const skippedItems = Object.entries(answers)
      .filter(([, v]) => v === false)
      .map(([cat]) => {
        return LOAD_LIBRARY.find(l => l.category === cat)?.description || cat;
      });

    return (
      <div className="card">
        <h3>Review Your Selections</h3>
        <p className="text-sm text-muted mb-4">
          The following loads will be added to your project, plus 4 NEC baseline loads
          (General Lighting, Small Appliance #1, Small Appliance #2, Laundry).
        </p>

        {yesItems.length > 0 && (
          <div className="mb-4">
            <h4 style={{ color: '#16a34a', fontSize: 14, marginBottom: 8 }}>
              Confirmed ({yesItems.length} appliances):
            </h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {yesItems.map((item, i) => (
                <span key={i} style={{
                  background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6,
                  padding: '4px 10px', fontSize: 13,
                }}>
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}

        {unknownItems.length > 0 && (
          <div className="mb-4">
            <h4 style={{ color: '#d97706', fontSize: 14, marginBottom: 8 }}>
              Unknown / Assumed ({unknownItems.length}):
            </h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {unknownItems.map((item, i) => (
                <span key={i} style={{
                  background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 6,
                  padding: '4px 10px', fontSize: 13,
                }}>
                  {item}
                </span>
              ))}
            </div>
            <p className="text-xs text-muted mt-2">
              These loads will be included with assumed default values. Verify in the load table.
            </p>
          </div>
        )}

        {skippedItems.length > 0 && (
          <div className="mb-4">
            <h4 style={{ color: '#9ca3af', fontSize: 14, marginBottom: 8 }}>
              Not included ({skippedItems.length}):
            </h4>
            <p className="text-sm text-muted">{skippedItems.join(', ')}</p>
          </div>
        )}

        <div className="hint-panel">
          Total loads to generate: {selectedItems.length + 4} (including 4 NEC baselines).
          You can add, remove, or edit any load in Step 3.
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button
            className="btn btn-secondary"
            onClick={() => { setIsComplete(false); setCurrentQ(0); }}
          >
            Start Over
          </button>
          <button className="btn btn-primary btn-lg" onClick={handleFinish}>
            Generate Loads &amp; Continue &rarr;
          </button>
        </div>
      </div>
    );
  }

  const currentQuestion = questions[currentQ];

  return (
    <div className="card">
      {/* Progress bar */}
      <div style={{
        width: '100%', height: 6, background: '#e5e7eb', borderRadius: 3, marginBottom: 24,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${progress}%`, height: '100%', background: 'var(--blue-accent)',
          borderRadius: 3, transition: 'width 0.3s ease',
        }} />
      </div>

      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <span className="text-sm text-muted">
          Question {currentQ + 1} of {totalQuestions}
        </span>
      </div>

      {/* Question */}
      <div style={{ textAlign: 'center', padding: '20px 0 32px' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>{currentQuestion.icon}</div>
        <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
          {currentQuestion.label}
        </h3>
        <p className="text-sm text-muted">
          {LOAD_LIBRARY.find(l => l.category === currentQuestion.category)?.hint || ''}
        </p>
      </div>

      {/* Answer buttons */}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 24, flexWrap: 'wrap' }}>
        <button
          className={`btn btn-lg ${answers[currentQuestion.category] === true ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => handleAnswer(true)}
          style={{ minWidth: 100, fontSize: 16 }}
        >
          Yes
        </button>
        <button
          className={`btn btn-lg ${answers[currentQuestion.category] === false ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => handleAnswer(false)}
          style={{ minWidth: 100, fontSize: 16 }}
        >
          No
        </button>
        <button
          className={`btn btn-lg ${answers[currentQuestion.category] === 'unknown' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => handleAnswer('unknown')}
          style={{ minWidth: 100, fontSize: 16 }}
          title="Include with assumed defaults — verify later in the load table"
        >
          Unknown
        </button>
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleBack}
          disabled={currentQ === 0}
        >
          &larr; Previous
        </button>
        <span className="text-sm text-muted">
          {selectedCount} selected so far
        </span>
        {currentQ > 0 && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setIsComplete(true)}
          >
            Skip to review &rarr;
          </button>
        )}
      </div>
    </div>
  );
}
