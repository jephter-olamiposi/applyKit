/**
 * @fileoverview Interactive First-Run Onboarding Wizard.
 *
 * Welcomes new candidates and guides them through:
 * 1. Personal Identity & Work Authorization
 * 2. Experience & Evidence Graph Ingestion
 * 3. AI Provider Key Setup (with local-only option)
 * 4. Completion & Copilot Activation
 */

import React, { useState } from 'react';
import {
  createEmptyProfile,
  createProfileId,
  createSkillId,
  normalizeSkillName,
  type CandidateProfile,
  type AIProviderName,
} from '@applykit/domain';
import { sendToBackground } from '../../messages/bridge.js';
import type {
  SaveCandidateProfileRequest,
  SaveCandidateProfileResponse,
  IngestResumeRequest,
  IngestResumeResponse,
  SetApiKeyResponse,
} from '../../messages/contracts.js';

interface OnboardingWizardProps {
  onComplete: () => void;
  onCancel?: () => void;
}

type OnboardingStep = 1 | 2 | 3 | 4;

const SAMPLE_RESUME_TEXT = `Jane Developer
Senior Full-Stack Architect | TypeScript, React, Rust, PostgreSQL
Email: jane.dev@example.org | Location: San Francisco, CA

EXPERIENCE
Staff Engineer — Acme Cloud (2022 - Present)
• Led distributed database migration to PostgreSQL, migrating 4TB database cluster with zero downtime.
• Designed real-time event streaming pipeline processing 25,000 events/sec using TypeScript and Kafka.
• Mentored 12 engineers across architecture review and security best practices.

Senior Software Engineer — Platform Labs (2019 - 2022)
• Built customer-facing React SPA reducing latency by 45%.
• Implemented automated CI/CD pipeline achieving 99.9% release reliability.

SKILLS
TypeScript, React, Rust, Node.js, PostgreSQL, Distributed Systems, CI/CD, Architecture.`;

/**
 * Onboarding Wizard component for first-run configuration.
 */
export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  onComplete,
  onCancel,
}) => {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(1);

  // Step 1: Personal Identity
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [headline, setHeadline] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('United States');
  const [isAuthorized, setIsAuthorized] = useState(true);
  const [requiresSponsorship, setRequiresSponsorship] = useState(false);

  // Step 2: Evidence & Experience
  const [resumeText, setResumeText] = useState('');
  const [isIngestingEvidence, setIsIngestingEvidence] = useState(false);
  const [ingestStats, setIngestStats] = useState<{ evidenceCount: number; claimsCount: number } | null>(null);

  // Step 3: Provider Key
  const [selectedProvider, setSelectedProvider] = useState<AIProviderName>('openai');
  const [apiKey, setApiKey] = useState('');
  const [skipApiKey, setSkipApiKey] = useState(false);

  // Status & Errors
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleStep1Next = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      setErrorMsg('Please provide your first name, last name, and contact email.');
      return;
    }
    setErrorMsg(null);
    setCurrentStep(2);
  };

  const handleLoadSample = () => {
    setFirstName('Jane');
    setLastName('Developer');
    setHeadline('Senior Full-Stack Architect');
    setEmail('jane.dev@example.org');
    setPhone('+1 (555) 019-2834');
    setCity('San Francisco, CA');
    setCountry('United States');
    setResumeText(SAMPLE_RESUME_TEXT);
  };

  const handleStep2Next = async () => {
    setErrorMsg(null);
    if (resumeText.trim().length > 0) {
      setIsIngestingEvidence(true);
      try {
        const res = await sendToBackground<IngestResumeRequest, IngestResumeResponse>({
          type: 'INGEST_RESUME_TEXT',
          rawText: resumeText.trim(),
        });
        if (res && res.success) {
          setIngestStats({
            evidenceCount: res.evidenceCount ?? 0,
            claimsCount: res.claimsCount ?? 0,
          });
        }
      } catch (err) {
        setErrorMsg('Evidence processing notice: ' + (err instanceof Error ? err.message : String(err)));
      } finally {
        setIsIngestingEvidence(false);
      }
    }
    setCurrentStep(3);
  };

  const handleStep3Next = async () => {
    setErrorMsg(null);
    if (!skipApiKey && apiKey.trim().length > 0) {
      try {
        await sendToBackground<
          { type: 'SET_API_KEY'; provider: AIProviderName; apiKey: string },
          SetApiKeyResponse
        >({
          type: 'SET_API_KEY',
          provider: selectedProvider,
          apiKey: apiKey.trim(),
        });
      } catch (err) {
        setErrorMsg('Key save error: ' + (err instanceof Error ? err.message : String(err)));
        return;
      }
    }
    setCurrentStep(4);
  };

  const handleFinishOnboarding = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      // 1. Build and save the CandidateProfile aggregate
      const profileId = createProfileId('default_candidate');
      const base = createEmptyProfile(profileId);

      const customProfile: CandidateProfile = {
        ...base,
        identity: {
          ...base.identity,
          legalFirstName: firstName.trim(),
          legalLastName: lastName.trim(),
          preferredName: firstName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          location: {
            city: city.trim(),
            country: country.trim(),
          },
          workAuthorization: {
            isAuthorizedInCountry: isAuthorized,
            requiresSponsorship,
            authorizedCountries: [country.trim()],
          },
        },
        professional: {
          ...base.professional,
          headline: headline.trim() || 'Software Engineer',
        },
        skills: [
          {
            id: createSkillId(),
            name: 'TypeScript',
            normalizedName: normalizeSkillName('TypeScript'),
            category: 'language',
            proficiency: 'expert',
            evidenceRefs: [],
          },
          {
            id: createSkillId(),
            name: 'React',
            normalizedName: normalizeSkillName('React'),
            category: 'framework',
            proficiency: 'expert',
            evidenceRefs: [],
          },
        ],
      };

      const res = await sendToBackground<
        SaveCandidateProfileRequest,
        SaveCandidateProfileResponse
      >({
        type: 'SAVE_CANDIDATE_PROFILE',
        profile: customProfile,
      });

      if (!res.success) {
        throw new Error(res.error || 'Failed to persist candidate profile.');
      }

      // 2. Mark onboarding completed in chrome storage
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ applykit_onboarding_completed: true });
      }

      onComplete();
    } catch (err) {
      setErrorMsg('Onboarding error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="onboarding-container">
      {/* Header Banner */}
      <div className="onboarding-header">
        <div className="onboarding-brand">
          <div className="onboarding-logo-icon">🚀</div>
          <div>
            <h2 className="onboarding-title">Welcome to ApplyKit</h2>
            <p className="onboarding-tagline">
              Your local-first, privacy-respecting job application copilot.
            </p>
          </div>
        </div>
        {onCancel && (
          <button type="button" className="btn-close-onboarding" onClick={onCancel}>
            ✕
          </button>
        )}
      </div>

      {/* Stepper Progress Bar */}
      <div className="onboarding-stepper">
        <div className={`step-item ${currentStep >= 1 ? 'step-active' : ''} ${currentStep > 1 ? 'step-done' : ''}`}>
          <div className="step-circle">{currentStep > 1 ? '✓' : '1'}</div>
          <span className="step-label">Identity</span>
        </div>
        <div className="step-divider" />
        <div className={`step-item ${currentStep >= 2 ? 'step-active' : ''} ${currentStep > 2 ? 'step-done' : ''}`}>
          <div className="step-circle">{currentStep > 2 ? '✓' : '2'}</div>
          <span className="step-label">Evidence</span>
        </div>
        <div className="step-divider" />
        <div className={`step-item ${currentStep >= 3 ? 'step-active' : ''} ${currentStep > 3 ? 'step-done' : ''}`}>
          <div className="step-circle">{currentStep > 3 ? '✓' : '3'}</div>
          <span className="step-label">AI Key</span>
        </div>
        <div className="step-divider" />
        <div className={`step-item ${currentStep >= 4 ? 'step-active' : ''}`}>
          <div className="step-circle">4</div>
          <span className="step-label">Ready</span>
        </div>
      </div>

      {errorMsg && <div className="onboarding-error-alert">{errorMsg}</div>}

      {/* STEP 1: Personal Identity */}
      {currentStep === 1 && (
        <form onSubmit={handleStep1Next} className="onboarding-step-content">
          <div className="step-heading-row">
            <div>
              <h3 className="step-title">Candidate Profile & Identity</h3>
              <p className="step-desc">
                Stored exclusively in your local browser. Never shared or uploaded.
              </p>
            </div>
            <button
              type="button"
              className="btn-link-sample"
              onClick={handleLoadSample}
            >
              Fill Demo Data
            </button>
          </div>

          <div className="form-row-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="first-name">Legal First Name *</label>
              <input
                id="first-name"
                type="text"
                className="form-input"
                placeholder="Ada"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="last-name">Legal Last Name *</label>
              <input
                id="last-name"
                type="text"
                className="form-input"
                placeholder="Lovelace"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="headline">Professional Headline</label>
            <input
              id="headline"
              type="text"
              className="form-input"
              placeholder="Senior Software Architect"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
            />
          </div>

          <div className="form-row-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="email">Email Address *</label>
              <input
                id="email"
                type="email"
                className="form-input"
                placeholder="ada@example.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="phone">Phone Number</label>
              <input
                id="phone"
                type="tel"
                className="form-input"
                placeholder="+1 (555) 012-3456"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>

          <div className="form-row-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="city">City, State / Region</label>
              <input
                id="city"
                type="text"
                className="form-input"
                placeholder="San Francisco, CA"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="country">Country</label>
              <input
                id="country"
                type="text"
                className="form-input"
                placeholder="United States"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
            </div>
          </div>

          <div className="work-auth-card">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={isAuthorized}
                onChange={(e) => setIsAuthorized(e.target.checked)}
              />
              <span>Legally authorized to work in target country</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={requiresSponsorship}
                onChange={(e) => setRequiresSponsorship(e.target.checked)}
              />
              <span>Will require visa sponsorship now or in the future</span>
            </label>
          </div>

          <div className="onboarding-nav-row">
            <span />
            <button type="submit" className="btn-primary">
              Continue to Experience ➔
            </button>
          </div>
        </form>
      )}

      {/* STEP 2: Evidence & Experience Import */}
      {currentStep === 2 && (
        <div className="onboarding-step-content">
          <div className="step-heading-row">
            <div>
              <h3 className="step-title">Evidence Graph & Resume Import</h3>
              <p className="step-desc">
                Paste your resume or experience bullets to automatically seed your local Evidence Graph.
              </p>
            </div>
            {!resumeText && (
              <button
                type="button"
                className="btn-link-sample"
                onClick={() => setResumeText(SAMPLE_RESUME_TEXT)}
              >
                Insert Sample Resume
              </button>
            )}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="resume-textarea">Resume or Accomplishment Text</label>
            <textarea
              id="resume-textarea"
              className="form-textarea"
              rows={9}
              placeholder="Paste plain text resume, work experience bullets, or accomplishments here..."
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
            />
          </div>

          {ingestStats && (
            <div className="ingest-stats-pill">
              ✓ Successfully extracted {ingestStats.evidenceCount} atomic evidence items and {ingestStats.claimsCount} claims!
            </div>
          )}

          <div className="onboarding-nav-row">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setCurrentStep(1)}
              disabled={isIngestingEvidence}
            >
              ← Back
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleStep2Next}
              disabled={isIngestingEvidence}
            >
              {isIngestingEvidence ? 'Decomposing Evidence...' : 'Continue to AI Setup ➔'}
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: AI Provider Key */}
      {currentStep === 3 && (
        <div className="onboarding-step-content">
          <h3 className="step-title">AI Provider Key Configuration</h3>
          <p className="step-desc">
            ApplyKit uses your own provider API key. Keys are strictly isolated inside the Extension Service Worker background context (ADR-0002).
          </p>

          <div className="form-group">
            <label className="form-label" htmlFor="onboarding-provider-select">Select AI Provider</label>
            <select
              id="onboarding-provider-select"
              className="form-select"
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value as AIProviderName)}
              disabled={skipApiKey}
            >
              <option value="openai">OpenAI (GPT-4o, GPT-4o-mini)</option>
              <option value="anthropic">Anthropic (Claude 3.5 Sonnet)</option>
              <option value="gemini">Google Gemini (Gemini 1.5 Pro/Flash)</option>
              <option value="openrouter">OpenRouter (Unified Multi-Model)</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="onboarding-api-key">API Secret Key</label>
            <input
              id="onboarding-api-key"
              type="password"
              className="form-input"
              placeholder="Paste secret API key (sk-...)"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={skipApiKey}
            />
          </div>

          <label className="checkbox-row skip-key-toggle">
            <input
              type="checkbox"
              checked={skipApiKey}
              onChange={(e) => setSkipApiKey(e.target.checked)}
            />
            <span>Skip for now (I will configure my API key later in Settings)</span>
          </label>

          <div className="onboarding-nav-row">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setCurrentStep(2)}
            >
              ← Back
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleStep3Next}
            >
              Review & Complete ➔
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: Ready to Apply */}
      {currentStep === 4 && (
        <div className="onboarding-step-content">
          <div className="celebration-box">
            <span className="celebration-icon">🎉</span>
            <h3 className="celebration-title">You're All Set!</h3>
            <p className="celebration-subtitle">
              ApplyKit is configured and ready to assist with your real job applications.
            </p>
          </div>

          <div className="summary-checklist">
            <div className="checklist-item">
              <span className="check-icon">✓</span>
              <div>
                <strong>Candidate Identity:</strong> {firstName} {lastName} ({email})
              </div>
            </div>
            <div className="checklist-item">
              <span className="check-icon">✓</span>
              <div>
                <strong>Evidence Graph:</strong> {ingestStats ? `${ingestStats.evidenceCount} verified evidence items` : 'Initialized empty profile'}
              </div>
            </div>
            <div className="checklist-item">
              <span className="check-icon">✓</span>
              <div>
                <strong>AI Provider:</strong> {skipApiKey || !apiKey ? 'Offline / Local rules mode' : `${selectedProvider.toUpperCase()} configured`}
              </div>
            </div>
            <div className="checklist-item">
              <span className="check-icon">✓</span>
              <div>
                <strong>Submission Hard Gate:</strong> Programmatically enabled (Zero autonomous submit hazard)
              </div>
            </div>
          </div>

          <div className="quick-tip-card">
            <h4>💡 How to apply with ApplyKit:</h4>
            <ol>
              <li>Navigate to any job posting on Greenhouse, Workday, Lever, or Ashby.</li>
              <li>Click <strong>Extract Job</strong> in the Side Panel to parse requirements.</li>
              <li>Inspect <strong>Match & Gap Analysis</strong> to review evidence fit.</li>
              <li>Click <strong>Form Inspector</strong> to generate a safe, human-reviewed dry-run plan.</li>
            </ol>
          </div>

          <div className="onboarding-nav-row">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setCurrentStep(3)}
              disabled={isSubmitting}
            >
              ← Back
            </button>
            <button
              type="button"
              className="btn-primary btn-launch"
              onClick={handleFinishOnboarding}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Finalizing Setup...' : 'Launch ApplyKit Copilot 🚀'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
