export default function Stepper({ steps, currentStep, onStepClick }) {
  return (
    <div className="stepper">
      {steps.map((step, i) => {
        const isCompleted = i < currentStep;
        const isActive = i === currentStep;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
            <div
              className={`stepper-step ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
              onClick={() => onStepClick(i)}
            >
              <div className="step-number">
                {isCompleted ? '\u2713' : i + 1}
              </div>
              <span className="step-label">{step.shortLabel || step.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`stepper-line ${isCompleted ? 'completed' : ''}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
