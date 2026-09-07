import React, { useEffect, useRef } from "react";

interface WizardNavProps {
  activeStep: number;
  setActiveStep: (s: number) => void;
}

export const WizardNav: React.FC<WizardNavProps> = ({ activeStep, setActiveStep }) => {
  // These were onClick-only <div>s with no keyboard access at all — the
  // primary wizard step navigation (explicitly called out by the accessibility audit)
  // was mouse-only. role="tab"/aria-selected + a real key handler mirrors
  // the WAI-ARIA APG tabs pattern (this genuinely is a set of mutually
  // exclusive views, i.e. tabs), with Enter/Space to activate and
  // Left/Right arrow keys to move between steps like a native tablist.
  const stepDefs = [
    { step: 1, label: "Kadro & Uygunluk" },
    { step: 2, label: "Ay Seçimi & Özel Günler" },
    { step: 3, label: "Planla & Dışa Aktar" }
  ];

  const tabRefs = useRef<Array<HTMLDivElement | null>>([]);
  const prevActiveStepRef = useRef(activeStep);

  // Roving tabindex requires DOM focus to actually follow the active tab,
  // not just its visual/aria state — found this the hard way via a live
  // keyboard walkthrough: without this, pressing ArrowRight
  // updated `activeStep` and the DOM's tabIndex/aria-selected correctly, but
  // real browser focus stayed on the ORIGINAL tab div. A second ArrowLeft
  // then fired on that stale div's own onKeyDown closure (step=1, not the
  // now-active step=2), so `step > 1` was false and nothing happened —
  // arrow-key navigation broke after exactly one press.
  //
  // Only focus when activeStep actually CHANGED from its previous value,
  // rather than a simple "skip the first effect run" ref flag — this app
  // renders under <React.StrictMode> (see main.tsx), which intentionally
  // double-invokes effects on mount in dev to surface exactly this class of
  // bug: a naive "ran once already" boolean gets flipped by the first of the
  // two mount invocations, so the second one runs as if it weren't the
  // first anymore and steals focus onto the page on load. Comparing against
  // the last-seen value survives the double-invoke because both mount calls
  // see the same (unchanged) activeStep.
  useEffect(() => {
    if (prevActiveStepRef.current !== activeStep) {
      tabRefs.current[activeStep - 1]?.focus();
    }
    prevActiveStepRef.current = activeStep;
  }, [activeStep]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, step: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setActiveStep(step);
    } else if (e.key === "ArrowRight" && step < 3) {
      e.preventDefault();
      setActiveStep(step + 1);
    } else if (e.key === "ArrowLeft" && step > 1) {
      e.preventDefault();
      setActiveStep(step - 1);
    }
  };

  return (
    <nav className="wizard-steps" role="tablist" aria-label="Nöbet çizelgesi sihirbazı adımları">
      {stepDefs.map(({ step, label }) => {
        const isActive = activeStep === step;
        const isCompleted = activeStep > step;
        return (
          <div
            key={step}
            ref={(el) => { tabRefs.current[step - 1] = el; }}
            className={`step-indicator ${isActive ? 'active' : isCompleted ? 'completed' : ''}`}
            onClick={() => setActiveStep(step)}
            onKeyDown={(e) => handleKeyDown(e, step)}
            style={{ cursor: "pointer" }}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
          >
            <div className="step-number" aria-hidden="true">{step}</div>
            <span>{label}</span>
          </div>
        );
      })}
    </nav>
  );
};
