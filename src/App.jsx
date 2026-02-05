import { useState, useCallback, useRef, useEffect } from 'react';
import './App.css';
import { createInitialProject, resetLoadIdCounter } from './data/initialState';
import { importJSON, exportJSON, loadProjectFromLocalStorage, saveProjectToLocalStorage, saveNamedProject, getSavedProjectsList, loadNamedProject, deleteNamedProject } from './utils/exportUtils';
import Stepper from './components/Stepper';
import Step1Service from './steps/Step1Service';
import Step2LoadEntry from './steps/Step2LoadEntry';
import Step3LoadTable from './steps/Step3LoadTable';
import Step4EV from './steps/Step4EV';
import Step5BatteryWhole from './steps/Step5BatteryWhole';
import Step6BatteryPartial from './steps/Step6BatteryPartial';
import Step7Summary from './steps/Step7Summary';

const STEPS = [
  { label: 'Service', shortLabel: 'Service' },
  { label: 'Entry Path', shortLabel: 'Entry' },
  { label: 'Load Table', shortLabel: 'Loads' },
  { label: 'EV Charger', shortLabel: 'EV' },
  { label: 'Battery (Whole)', shortLabel: 'Whole' },
  { label: 'Battery (Partial)', shortLabel: 'Partial' },
  { label: 'Summary', shortLabel: 'Summary' },
];

function App() {
  const [project, setProject] = useState(createInitialProject);
  const [currentStep, setCurrentStep] = useState(0);
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Auto-load saved project from localStorage on mount
  useEffect(() => {
    const saved = loadProjectFromLocalStorage();
    if (saved && saved.metadata && saved.metadata.projectName) {
      setProject(saved);
      showToast(`Loaded saved project: ${saved.metadata.projectName}`);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateProject = useCallback((updater) => {
    setProject(prev => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      next.metadata = { ...next.metadata, updatedAt: new Date().toISOString() };
      return next;
    });
  }, []);

  const goNext = useCallback(() => {
    setCurrentStep(s => Math.min(s + 1, STEPS.length - 1));
  }, []);

  const goPrev = useCallback(() => {
    setCurrentStep(s => Math.max(s - 1, 0));
  }, []);

  const goToStep = useCallback((step) => {
    setCurrentStep(step);
  }, []);

  const handleNewProject = useCallback(() => {
    if (window.confirm('Start a new project? Current data will be lost.')) {
      resetLoadIdCounter();
      setProject(createInitialProject());
      setCurrentStep(0);
      showToast('New project created');
    }
  }, [showToast]);

  const handleImportJSON = useCallback(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = await importJSON(file);
      setProject(data);
      setCurrentStep(0);
      showToast('Project imported successfully');
    } catch (err) {
      showToast('Failed to import: ' + err.message);
    }
    e.target.value = '';
  }, [showToast]);

  const handleExportJSON = useCallback(() => {
    exportJSON(project);
    showToast('JSON exported');
  }, [project, showToast]);

  // Global Save / Load
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [savedProjects, setSavedProjects] = useState([]);

  const handleSaveProject = useCallback(() => {
    const success = saveNamedProject(project);
    if (success) {
      showToast(`Saved: ${project.metadata?.projectName || 'Untitled Project'}`);
    } else {
      showToast('Failed to save project');
    }
  }, [project, showToast]);

  const handleOpenLoadModal = useCallback(() => {
    setSavedProjects(getSavedProjectsList());
    setShowLoadModal(true);
  }, []);

  const handleLoadProject = useCallback((id) => {
    const data = loadNamedProject(id);
    if (data) {
      setProject(data);
      setCurrentStep(0);
      showToast(`Loaded: ${data.metadata?.projectName || 'Untitled'}`);
      setShowLoadModal(false);
    } else {
      showToast('Failed to load project');
    }
  }, [showToast]);

  const handleDeleteSaved = useCallback((id, name) => {
    if (window.confirm(`Delete saved project "${name}"?`)) {
      deleteNamedProject(id);
      setSavedProjects(getSavedProjectsList());
      showToast(`Deleted: ${name}`);
    }
  }, [showToast]);

  const stepProps = {
    project,
    updateProject,
    goNext,
    goPrev,
    goToStep,
    showToast,
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0: return <Step1Service {...stepProps} />;
      case 1: return <Step2LoadEntry {...stepProps} />;
      case 2: return <Step3LoadTable {...stepProps} />;
      case 3: return <Step4EV {...stepProps} />;
      case 4: return <Step5BatteryWhole {...stepProps} />;
      case 5: return <Step6BatteryPartial {...stepProps} />;
      case 6: return <Step7Summary {...stepProps} />;
      default: return null;
    }
  };

  return (
    <>
      <header className="app-header">
        <div>
          <h1>Electrical Load Calculator<span className="brand">Venture Home Solar</span></h1>
        </div>
        <div className="header-actions">
          <button className="btn btn-header" onClick={handleNewProject}>New</button>
          <button className="btn btn-header" onClick={handleSaveProject}>Save</button>
          <button className="btn btn-header" onClick={handleOpenLoadModal}>Load</button>
          <button className="btn btn-header" onClick={() => fileInputRef.current?.click()}>Import</button>
          <button className="btn btn-header" onClick={handleExportJSON}>Export</button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleImportJSON}
          />
        </div>
      </header>

      <div className="app-container">
        <Stepper steps={STEPS} currentStep={currentStep} onStepClick={goToStep} />
        {renderStep()}
      </div>

      {/* Global Load Project Modal */}
      {showLoadModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'white', borderRadius: 12, padding: 28, maxWidth: 560, width: '90%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)', maxHeight: '80vh', overflowY: 'auto',
          }}>
            <h3 style={{ marginBottom: 12 }}>Load Saved Project</h3>
            {savedProjects.length === 0 ? (
              <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>No saved projects found. Use "Save" to save your current project first.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {savedProjects.map(p => (
                  <div key={p.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px', border: '1px solid #e5e7eb', borderRadius: 8,
                    background: '#f9fafb',
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>
                        {new Date(p.savedAt).toLocaleString()} &middot; {p.loadCount} load{p.loadCount !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={() => handleLoadProject(p.id)}>Load</button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleDeleteSaved(p.id, p.name)}
                      style={{ color: '#dc2626', fontSize: 14 }}
                      title="Delete saved project"
                    >🗑</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button className="btn btn-ghost" onClick={() => setShowLoadModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

export default App;
