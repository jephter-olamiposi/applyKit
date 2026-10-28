/**
 * @fileoverview Resume-First First-Run Onboarding Wizard.
 *
 * Implements a candidate-controlled, resume-first onboarding architecture (ADR-0004, ADR-0017):
 * Step 1: Resume Upload & Fast Decomposition (Dropzone, file picker, text paste, sample CV fast-track)
 * Step 2: Profile Review & Confirmation (Pre-filled contact, location taxonomy, work authorization, compensation, links)
 * Step 3: Provider setup (isolated background key storage, BYOK, or offline rules)
 * Step 4: Ready to Apply & Copilot Activation (Summary checklist, Hard gate badge, activation)
 *
 * Design rationale: Inverting onboarding to be resume-first grounds the entire EvidenceGraph from
 * day one, eliminating manual form entry for 80% of candidate attributes.
 */

import React, { useState } from 'react';
import {
  createEmptyProfile,
  createProfileId,
  createDocumentId,
  parsePlainTextResume,
  bootstrapProfileFromResume,
  type CandidateProfile,
  type AIProviderName,
  type DocumentReference,
} from '@applykit/domain';
import { sendToBackground } from '../../messages/bridge.js';
import type {
  SaveCandidateProfileRequest,
  SaveCandidateProfileResponse,
  IngestResumeRequest,
  IngestResumeResponse,
  CommitBootstrappedProfileRequest,
  CommitBootstrappedProfileResponse,
  SetApiKeyResponse,
  GetCandidateProfileResponse,
} from '../../messages/contracts.js';

interface OnboardingWizardProps {
  readonly onComplete: () => void;
  readonly onCancel?: () => void;
}

type OnboardingStep = 1 | 2 | 3 | 4;

const COMMON_COUNTRIES = [
  'United States',
  'United Kingdom',
  'Canada',
  'Nigeria',
  'Germany',
  'India',
  'Australia',
  'France',
  'Netherlands',
  'Brazil',
  'Singapore',
  'Ireland',
  'South Africa',
  'Kenya',
  'Ghana',
  'Spain',
  'Switzerland',
  'Sweden',
  'Poland',
  'Japan',
  'Mexico',
  'Italy',
  'United Arab Emirates',
  'New Zealand',
  'Portugal',
  'Norway',
  'Denmark',
  'Finland',
  'Belgium',
  'Austria',
  'Argentina',
  'Chile',
  'Colombia',
  'Egypt',
  'Indonesia',
  'Israel',
  'Malaysia',
  'Pakistan',
  'Philippines',
  'Saudi Arabia',
  'South Korea',
  'Turkey',
  'Vietnam',
] as const;

const SAMPLE_RESUME_TEXT = `Jane Developer
jane.dev@example.org | +1 (555) 019-2834 | San Francisco, CA
https://linkedin.com/in/janedev | https://github.com/janedev | https://janedev.dev

PROFESSIONAL SUMMARY
Senior Full-Stack Architect with 6+ years of experience architecting distributed cloud systems and high-throughput web applications using TypeScript, React, Rust, and PostgreSQL.

WORK EXPERIENCE
Staff Software Engineer — CloudScale Systems (2022 - Present) | San Francisco, CA
• Architected a real-time event streaming pipeline processing 30,000 requests/sec with 99.999% uptime.
• Led zero-downtime database migration of a 5TB PostgreSQL cluster, reducing query latency by 45%.
• Mentored 8 engineers across architecture design reviews and automated CI/CD practices.

Senior Software Engineer — Apex Labs (2019 - 2022) | Remote
• Built customer-facing React SPA reducing front-end bundle load time by 50%.
• Designed automated test suite and GitHub Actions pipeline achieving 99.9% build reliability.

SKILLS
Languages: TypeScript, Rust, Python, Go, SQL
Frameworks: React, Next.js, Node.js, Axum, Express
Databases: PostgreSQL, Redis, MongoDB
Tools & Cloud: AWS, Docker, Kubernetes, CI/CD, Git

EDUCATION
B.S. in Computer Science — University of California, Berkeley (2019)`;

/**
 * Resume-First onboarding wizard component.
 */
export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  onComplete,
  onCancel,
}) => {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(1);

  // Step 1: Resume Upload & Parsing State
  const [resumeText, setResumeText] = useState('');
  const [resumeFileName, setResumeFileName] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [ingestStats, setIngestStats] = useState<{ evidenceCount: number; claimsCount: number } | null>(null);
  const [reviewWarnings, setReviewWarnings] = useState<readonly string[]>([]);

  // Step 2: Contact, Location, Work Authorization & Compensation State
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [headline, setHeadline] = useState('');

  const [country, setCountry] = useState('');
  const [stateOrProvince, setStateOrProvince] = useState('');
  const [city, setCity] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [postalCode, setPostalCode] = useState('');

  // '' = not answered. Unanswered questions are left for the candidate on every form.
  const [isAuthorized, setIsAuthorized] = useState<'yes' | 'no' | ''>('');
  const [requiresSponsorship, setRequiresSponsorship] = useState<'yes' | 'no' | ''>('');
  const [visaStatus, setVisaStatus] = useState('');

  const [targetSalaryMin, setTargetSalaryMin] = useState<number | string>('');
  const [currency, setCurrency] = useState('USD');
  const [noticePeriodDays, setNoticePeriodDays] = useState<number | string>('');
  const [earliestStartDate, setEarliestStartDate] = useState('');

  const [linkedin, setLinkedin] = useState('');
  const [github, setGithub] = useState('');
  const [portfolio, setPortfolio] = useState('');

  // Step 3: AI Provider Setup State
  const [selectedProvider, setSelectedProvider] = useState<AIProviderName>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [skipApiKey, setSkipApiKey] = useState(false);

  // Execution & Status State
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isCheckingKey, setIsCheckingKey] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ---------------------------------------------------------------------------
  // Step 1 Handlers: Parse, Decompose Evidence & Advance
  // ---------------------------------------------------------------------------

  /**
   * Parses raw resume text, populates profile form fields, and indexes into EvidenceGraph.
   */
  const handleParseResume = async (rawOverride?: string, fileNameOverride?: string) => {
    const raw = (rawOverride ?? resumeText).trim();
    if (!raw) {
      setErrorMsg('Add your resume file or paste the text first.');
      return;
    }

    setIsParsing(true);
    setErrorMsg(null);

    try {
      const parsed = parsePlainTextResume(raw);
      setReviewWarnings(parsed.reviewWarnings);

      if (parsed.identity.fullName) {
        const parts = parsed.identity.fullName.trim().split(/\s+/);
        if (parts.length > 0) setFirstName(parts[0] || '');
        if (parts.length > 1) setLastName(parts.slice(1).join(' '));
      }
      if (parsed.identity.email) setEmail(parsed.identity.email);
      if (parsed.identity.phone) setPhone(parsed.identity.phone);

      if (parsed.identity.location) {
        const locParts = parsed.identity.location.split(',').map((p) => p.trim()).filter(Boolean);
        if (locParts.length >= 3) {
          setCity(locParts[0] || '');
          setStateOrProvince(locParts[1] || '');
          setCountry(locParts.slice(2).join(', '));
        } else if (locParts.length === 2) {
          setCity(locParts[0] || '');
          const second = locParts[1] || '';
          const matchedCountry = COMMON_COUNTRIES.find(
            (c) => c.toLowerCase() === second.toLowerCase()
          );
          if (matchedCountry) {
            setCountry(matchedCountry);
          } else if (second.length <= 3) {
            setStateOrProvince(second);
            setCountry('United States');
          } else {
            setCountry(second);
          }
        } else if (locParts.length === 1) {
          setCity(locParts[0] || '');
        }
      }

      if (parsed.experiences.length > 0 && parsed.experiences[0]?.title) {
        setHeadline(parsed.experiences[0].title);
      } else if (parsed.summary) {
        setHeadline(parsed.summary.split('\n')[0]?.slice(0, 60) || '');
      }

      if (parsed.identity.links.linkedin) setLinkedin(parsed.identity.links.linkedin);
      if (parsed.identity.links.github) setGithub(parsed.identity.links.github);
      if (parsed.identity.links.portfolio) setPortfolio(parsed.identity.links.portfolio);

      setResumeText(raw);
      if (fileNameOverride) {
        setResumeFileName(fileNameOverride);
      } else if (!resumeFileName) {
        setResumeFileName('Master_Resume.txt');
      }
      setCurrentStep(2);

      // Grounding invariant: Decompose resume into EvidenceGraph in background worker
      const res = await sendToBackground<IngestResumeRequest, IngestResumeResponse>({
        type: 'INGEST_RESUME_TEXT',
        rawText: raw,
      });

      if (res && res.success) {
        setIngestStats({
          evidenceCount: res.evidenceCount ?? 0,
          claimsCount: res.claimsCount ?? 0,
        });
      }

    } catch (err) {
      setErrorMsg('Could not read the resume: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsParsing(false);
    }
  };

  const populateFromCandidateProfile = (p: CandidateProfile, raw: string, fileName?: string) => {
    if (p.identity.legalFirstName) setFirstName(p.identity.legalFirstName);
    if (p.identity.legalLastName) setLastName(p.identity.legalLastName);
    if (p.identity.email) setEmail(p.identity.email);
    if (p.identity.phone) setPhone(p.identity.phone);
    if (p.identity.location?.city) setCity(p.identity.location.city);
    if (p.identity.location?.stateOrProvince) setStateOrProvince(p.identity.location.stateOrProvince);
    if (p.identity.location?.country) setCountry(p.identity.location.country);
    if (p.professional.headline) setHeadline(p.professional.headline);
    if (p.links.linkedin) setLinkedin(p.links.linkedin);
    if (p.links.github) setGithub(p.links.github);
    if (p.links.portfolio) setPortfolio(p.links.portfolio);
    setResumeText(raw);
    if (fileName) setResumeFileName(fileName);
  };

  /**
   * Processes incoming resume file (PDF, DOCX, TXT, MD, JSON) client-side.
   */
  const processIncomingResumeFile = async (file: File) => {
    setResumeFileName(file.name);
    setIsParsing(true);
    setErrorMsg(null);

    const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
    const isDocx =
      file.name.toLowerCase().endsWith('.docx') ||
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    try {
      if (isPdf || isDocx) {
        const buffer = await file.arrayBuffer();
        const bootstrapped = await bootstrapProfileFromResume(buffer, file.name);
        setReviewWarnings(bootstrapped.parsed.reviewWarnings);
        if (
          bootstrapped.rawText.trim().length < 32 ||
          (!bootstrapped.profile.identity.email &&
            !bootstrapped.profile.identity.legalFirstName &&
            bootstrapped.profile.experiences.length === 0 &&
            bootstrapped.profile.skills.length === 0)
        ) {
          throw new Error(
            'The document text could not be read reliably. Try exporting the resume as a text-based PDF or DOCX, then upload it again.'
          );
        }
        populateFromCandidateProfile(bootstrapped.profile, bootstrapped.rawText, file.name);

        const res = await sendToBackground<CommitBootstrappedProfileRequest, CommitBootstrappedProfileResponse>({
          type: 'COMMIT_BOOTSTRAPPED_PROFILE',
          profile: bootstrapped.profile,
          evidence: [...bootstrapped.evidence],
        });

        if (!res?.success) {
          throw new Error(res?.error || 'the file could not be read.');
        }
        setIngestStats({
          evidenceCount: bootstrapped.evidence.length,
          claimsCount: bootstrapped.profile.claims.length,
        });
        setCurrentStep(2);
      } else {
        const text = await file.text();
        if (text.trim()) {
          setResumeText(text);
          await handleParseResume(text, file.name);
        }
      }
    } catch (err) {
      setErrorMsg('Could not read the resume: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsParsing(false);
    }
  };

  /**
   * Handles local file reading via FileReader without external network dependencies.
   */
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void processIncomingResumeFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    void processIncomingResumeFile(file);
  };

  const handleSampleResume = () => {
    setResumeText(SAMPLE_RESUME_TEXT);
    setResumeFileName('Sample_Resume.txt');
    void handleParseResume(SAMPLE_RESUME_TEXT, 'Sample_Resume.txt');
  };

  const handleSkipToManual = () => {
    setErrorMsg(null);
    setCurrentStep(2);
  };

  // ---------------------------------------------------------------------------
  // Step 2 Handlers: Identity & Preferences Validation
  // ---------------------------------------------------------------------------

  const handleStep2Next = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      setErrorMsg('Add your first name, last name and email.');
      return;
    }
    setErrorMsg(null);
    setCurrentStep(3);
  };

  // ---------------------------------------------------------------------------
  // Step 3 Handlers: AI Provider Isolation & Configuration
  // ---------------------------------------------------------------------------

  const handleStep3Next = async () => {
    setErrorMsg(null);
    if (!skipApiKey && apiKey.trim().length > 0) {
      try {
        // The service worker checks the key with the provider before saving it, so a
        // mistyped key is caught here rather than on the first draft.
        setIsCheckingKey(true);
        const res = await sendToBackground<
          { type: 'SET_API_KEY'; provider: AIProviderName; apiKey: string },
          SetApiKeyResponse
        >({
          type: 'SET_API_KEY',
          provider: selectedProvider,
          apiKey: apiKey.trim(),
        });
        setIsCheckingKey(false);
        if (!res.success) {
          setErrorMsg(`${res.error || 'That key did not work.'} You can also skip this and add a key later in Settings.`);
          return;
        }
      } catch (err) {
        setIsCheckingKey(false);
        setErrorMsg('Could not save the key: ' + (err instanceof Error ? err.message : String(err)));
        return;
      }
    }
    setCurrentStep(4);
  };

  // ---------------------------------------------------------------------------
  // Step 4 Handlers: Final Profile Save & Hard Gate Activation
  // ---------------------------------------------------------------------------

  const handleFinishOnboarding = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      // 1. Fetch existing background profile to preserve evidence-derived skills and claims
      let baseProfile: CandidateProfile | null = null;
      try {
        const fetched = await sendToBackground<
          { type: 'GET_CANDIDATE_PROFILE' },
          GetCandidateProfileResponse
        >({ type: 'GET_CANDIDATE_PROFILE' });
        baseProfile = fetched?.profile ?? null;
      } catch {
        baseProfile = null;
      }

      const existingProfile = baseProfile && baseProfile.id
        ? baseProfile
        : createEmptyProfile(createProfileId('default_candidate'));

      const numSalary = targetSalaryMin !== '' ? Number(targetSalaryMin) : undefined;
      const numNotice = noticePeriodDays !== '' ? Number(noticePeriodDays) : undefined;

      // Construct primary master resume document if resume text is present
      const masterDoc: DocumentReference | undefined = resumeText.trim()
        ? {
            id: createDocumentId(),
            fileName: resumeFileName || 'Master_Resume.txt',
            documentType: 'resume',
            storageKey: `doc_resume_${existingProfile.id}`,
            mimeType: 'text/plain',
            byteSize: typeof TextEncoder !== 'undefined'
              ? new TextEncoder().encode(resumeText).length
              : resumeText.length,
            sha256Checksum: 'local_parsed_v1',
            uploadedAt: new Date().toISOString(),
            extractedText: resumeText,
            isPrimaryResume: true,
          }
        : existingProfile.documents.find((d) => d.isPrimaryResume);

      const documents: readonly DocumentReference[] = masterDoc
        ? [masterDoc, ...existingProfile.documents.filter((d) => d.id !== masterDoc.id)]
        : existingProfile.documents;

      const completeProfile: CandidateProfile = {
        ...existingProfile,
        identity: {
          ...existingProfile.identity,
          legalFirstName: firstName.trim(),
          legalLastName: lastName.trim(),
          preferredName: firstName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          location: {
            city: city.trim(),
            stateOrProvince: stateOrProvince.trim() || undefined,
            country: country.trim(),
            addressLine1: addressLine1.trim() || undefined,
            postalCode: postalCode.trim() || undefined,
          },
          workAuthorization: {
            isAuthorizedInCountry: isAuthorized === 'yes',
            requiresSponsorship: requiresSponsorship === 'yes',
            confirmedByCandidate: isAuthorized !== '' && requiresSponsorship !== '',
            visaStatus: visaStatus.trim() || undefined,
            authorizedCountries: country.trim() ? [country.trim()] : [],
          },
        },
        professional: {
          ...existingProfile.professional,
          headline: headline.trim() || existingProfile.professional.headline || '',
          noticePeriodDays: numNotice ?? existingProfile.professional.noticePeriodDays,
          earliestStartDate: earliestStartDate.trim() || existingProfile.professional.earliestStartDate,
          compensationExpectation: numSalary
            ? {
                targetSalaryMin: numSalary,
                currency: currency.trim() || 'USD',
                period: 'annual',
                isNegotiable: true,
              }
            : existingProfile.professional.compensationExpectation,
        },
        links: {
          ...existingProfile.links,
          linkedin: linkedin.trim() || existingProfile.links.linkedin,
          github: github.trim() || existingProfile.links.github,
          portfolio: portfolio.trim() || existingProfile.links.portfolio,
          customLinks: existingProfile.links.customLinks || [],
        },
        documents,
        updatedAt: new Date().toISOString(),
      };

      const res = await sendToBackground<
        SaveCandidateProfileRequest,
        SaveCandidateProfileResponse
      >({
        type: 'SAVE_CANDIDATE_PROFILE',
        profile: completeProfile,
      });

      if (!res.success) {
        throw new Error(res.error || 'your profile could not be saved.');
      }

      // Mark onboarding completed in Chrome local storage
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ applykit_onboarding_completed: true });
      }

      onComplete();
    } catch (err) {
      setErrorMsg('Something went wrong: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="onboarding-container">
      {/* Header Banner */}
      <div className="onboarding-header">
        <div className="onboarding-brand">
          <div>
            <h2 className="onboarding-title">Set up ApplyKit</h2>
            <p className="onboarding-tagline">Takes about two minutes. Everything stays in this browser.</p>
          </div>
        </div>
        {onCancel && (
          <button type="button" className="btn-close-onboarding" onClick={onCancel} title="Close onboarding">
            ×
          </button>
        )}
      </div>

      {/* Stepper Progress Bar */}
      <div className="onboarding-stepper" role="progressbar" aria-valuenow={currentStep} aria-valuemin={1} aria-valuemax={4}>
        <div className={`step-item ${currentStep >= 1 ? 'step-active' : ''} ${currentStep > 1 ? 'step-done' : ''}`}>
          <div className="step-circle">1</div>
          <span className="step-label">Resume</span>
        </div>
        <div className="step-divider" />
        <div className={`step-item ${currentStep >= 2 ? 'step-active' : ''} ${currentStep > 2 ? 'step-done' : ''}`}>
          <div className="step-circle">2</div>
          <span className="step-label">Details</span>
        </div>
        <div className="step-divider" />
        <div className={`step-item ${currentStep >= 3 ? 'step-active' : ''} ${currentStep > 3 ? 'step-done' : ''}`}>
          <div className="step-circle">3</div>
          <span className="step-label">AI (optional)</span>
        </div>
        <div className="step-divider" />
        <div className={`step-item ${currentStep >= 4 ? 'step-active' : ''}`}>
          <div className="step-circle">4</div>
          <span className="step-label">Done</span>
        </div>
      </div>

      {/* Step 3 shows its key error under the key field instead. */}
      {errorMsg && currentStep !== 3 && <div className="onboarding-error-alert" role="alert">{errorMsg}</div>}

      {/* =========================================================================
          STEP 1: Resume Upload & Fast Decomposition (Hero Step)
          ========================================================================= */}
      {currentStep === 1 && (
        <div className="onboarding-step-content">
          <div className="step-heading-row">
            <div>
              <h3 className="step-title">Start with your resume</h3>
              <p className="step-desc">
                ApplyKit only ever uses what's in your resume, so this is the one thing it needs. Drop the file in or paste the text.
              </p>
            </div>
            <button
              type="button"
              id="btn-sample-resume"
              className="btn-link-sample"
              onClick={handleSampleResume}
              disabled={isParsing}
            >
              Try a sample resume
            </button>
          </div>

          {/* Drag & Drop File Upload Dropzone */}
          <div
            className={`resume-dropzone ${isDragOver ? 'dragover' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById('resume-file-input')?.click()}
          >
            <input
              id="resume-file-input"
              type="file"
              accept=".pdf,.docx,.png,.jpg,.jpeg,.webp,.txt,.md,.text,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
            
            <p className="resume-dropzone-title">
              {resumeFileName ? resumeFileName : 'Drop your resume here, or click to choose a file'}
            </p>
            <p className="resume-dropzone-sub">
              PDF, Word, image or text. It's read on your computer, not uploaded.
            </p>
          </div>

          {/* Paste Resume Textarea */}
          <div className="form-group" style={{ marginTop: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label className="form-label" htmlFor="resume-textarea" style={{ margin: 0 }}>
                Or paste the text
              </label>
              {resumeText.trim() && (
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                  {resumeText.trim().split(/\s+/).length} words
                </span>
              )}
            </div>
            <textarea
              id="resume-textarea"
              className="form-textarea"
              rows={7}
              placeholder="Or paste your resume text here"
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
            />
          </div>

          {ingestStats && (
            <div className="ingest-stats-pill">
              Extracted {ingestStats.evidenceCount} evidence items and {ingestStats.claimsCount} verified claims.
            </div>
          )}

          {/* Navigation Controls */}
          <div className="onboarding-nav-row" style={{ marginTop: '12px' }}>
            <button
              type="button"
              id="btn-skip-manual"
              className="btn-secondary"
              onClick={handleSkipToManual}
              disabled={isParsing}
            >
              Type my details instead
            </button>
            <button
              type="button"
              id="btn-parse-resume"
              className="btn-primary"
              onClick={() => handleParseResume()}
              disabled={isParsing || !resumeText.trim()}
            >
              {isParsing ? 'Reading your resume...' : 'Continue'}
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          STEP 2: Profile Review & Confirmation
          ========================================================================= */}
      {currentStep === 2 && (
        <div className="onboarding-step-content">
          <div className="step-heading-row">
            <div>
              <h3 className="step-title">Check your details</h3>
              <p className="step-desc">
                Filled in from your resume. Fix anything that's off; these go straight into application forms.
              </p>
            </div>
          </div>

          {ingestStats && (
            <div className="ingest-stats-pill" style={{ margin: '0 0 4px 0' }}>
              Read {ingestStats.evidenceCount} lines from your resume.
            </div>
          )}
          {reviewWarnings.length > 0 && (
            <div className="resume-review-warning" role="status">
              <strong>Please check:</strong>
              <ul>
                {reviewWarnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </div>
          )}

          <form onSubmit={handleStep2Next} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Identity Group */}
            <div className="form-row-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="first-name">First name *</label>
                <input
                  id="first-name"
                  type="text"
                  required
                  className="form-input"
                  placeholder="e.g. Jane"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="last-name">Last name *</label>
                <input
                  id="last-name"
                  type="text"
                  required
                  className="form-input"
                  placeholder="e.g. Developer"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>

            <div className="form-row-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="email">Email *</label>
                <input
                  id="email"
                  type="email"
                  required
                  className="form-input"
                  placeholder="jane.dev@example.org"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="phone">Phone, with country code</label>
                <input
                  id="phone"
                  type="tel"
                  className="form-input"
                  placeholder="Include the country code, e.g. +234"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="headline">Current role</label>
              <input
                id="headline"
                type="text"
                className="form-input"
                placeholder="e.g. Senior Full-Stack Engineer"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
              />
            </div>

            {/* Location Taxonomy */}
            <div className="form-row-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="country">Country</label>
                <input
                  id="country"
                  type="text"
                  list="country-list"
                  className="form-input"
                  placeholder="Type or select country..."
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                />
                <datalist id="country-list">
                  {COMMON_COUNTRIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="state-province">State or region</label>
                <input
                  id="state-province"
                  type="text"
                  className="form-input"
                  placeholder="e.g. California or Lagos"
                  value={stateOrProvince}
                  onChange={(e) => setStateOrProvince(e.target.value)}
                />
              </div>
            </div>

            <div className="form-row-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="city">City</label>
                <input
                  id="city"
                  type="text"
                  className="form-input"
                  placeholder="e.g. San Francisco"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="postal-code">Postcode</label>
                <input
                  id="postal-code"
                  type="text"
                  className="form-input"
                  placeholder="e.g. 94105"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="street-address">Street address (optional)</label>
              <input
                id="street-address"
                type="text"
                className="form-input"
                placeholder="e.g. 100 Market Street"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
              />
            </div>

            {/* Work Authorization Card */}
            <div className="work-auth-card" style={{ marginTop: '4px' }}>
              <h4 className="work-auth-title">Work permit</h4>
              <p className="ui-subtle" style={{ marginBottom: 8 }}>
                Leave these as “Not answered” and ApplyKit will skip them on forms so you answer them yourself.
              </p>
              <label className="form-group">
                <span className="form-label">Can you legally work in the country you live in?</span>
                <select id="work-auth-select" className="ui-select" value={isAuthorized} onChange={(e) => setIsAuthorized(e.target.value as 'yes' | 'no' | '')}>
                  <option value="">Not answered</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label className="form-group">
                <span className="form-label">Will you need visa sponsorship, now or later?</span>
                <select
                  id="sponsor-select"
                  className="ui-select"
                  value={requiresSponsorship}
                  onChange={(e) => setRequiresSponsorship(e.target.value as 'yes' | 'no' | '')}
                >
                  <option value="">Not answered</option>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </label>
              <div className="form-group" style={{ marginTop: '8px' }}>
                <label className="form-label" htmlFor="visa-status">Visa or citizenship status (optional)</label>
                <input
                  id="visa-status"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Citizen, Permanent Resident, H-1B, Work Permit"
                  value={visaStatus}
                  onChange={(e) => setVisaStatus(e.target.value)}
                />
              </div>
            </div>

            {/* Compensation & Availability */}
            <div className="form-row-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="target-salary">Lowest yearly salary you would accept</label>
                <input
                  id="target-salary"
                  type="number"
                  className="form-input"
                  placeholder="e.g. 130000"
                  value={targetSalaryMin}
                  onChange={(e) => setTargetSalaryMin(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="currency">Currency</label>
                <select
                  id="currency"
                  className="form-select"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="CAD">CAD (C$)</option>
                  <option value="NGN">NGN (₦)</option>
                  <option value="INR">INR (₹)</option>
                  <option value="AUD">AUD (A$)</option>
                </select>
              </div>
            </div>

            <div className="form-row-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="notice-days">Notice period in days</label>
                <input
                  id="notice-days"
                  type="number"
                  className="form-input"
                  placeholder="0 if you can start now"
                  value={noticePeriodDays}
                  onChange={(e) => setNoticePeriodDays(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="earliest-start">Earliest start</label>
                <input
                  id="earliest-start"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Immediately or 2 weeks"
                  value={earliestStartDate}
                  onChange={(e) => setEarliestStartDate(e.target.value)}
                />
              </div>
            </div>

            {/* Web Links */}
            <div className="form-group">
              <label className="form-label" htmlFor="linkedin-url">LinkedIn</label>
              <input
                id="linkedin-url"
                type="url"
                className="form-input"
                placeholder="https://linkedin.com/in/username"
                value={linkedin}
                onChange={(e) => setLinkedin(e.target.value)}
              />
            </div>

            <div className="form-row-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="github-url">GitHub</label>
                <input
                  id="github-url"
                  type="url"
                  className="form-input"
                  placeholder="https://github.com/username"
                  value={github}
                  onChange={(e) => setGithub(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="portfolio-url">Website</label>
                <input
                  id="portfolio-url"
                  type="url"
                  className="form-input"
                  placeholder="https://yourname.dev"
                  value={portfolio}
                  onChange={(e) => setPortfolio(e.target.value)}
                />
              </div>
            </div>

            <div className="onboarding-nav-row" style={{ marginTop: '16px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setCurrentStep(1)}
              >
                Back
              </button>
              <button type="submit" className="btn-primary">
                Continue
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =========================================================================
          STEP 3: AI Provider Key Configuration
          ========================================================================= */}
      {currentStep === 3 && (
        <div className="onboarding-step-content">
          <h3 className="step-title">Add an AI key (optional)</h3>
          <p className="step-desc">
            Everything works without one. A key lets ApplyKit draft answers to open questions on forms. It's stored encrypted in this browser and web pages can't read it.
          </p>

          {/* Gemini setup callout */}
          <div className="free-gemini-box">
            <div className="free-gemini-header">
              <div>
                <h4 className="free-gemini-title">Easiest: a free Google Gemini key</h4>
                <p className="free-gemini-desc">
                  Google AI Studio gives free keys, no card needed.
                </p>
              </div>
            </div>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="btn-get-gemini-key"
            >
              Get a free Gemini key
            </a>
          </div>

          <div className="form-group" style={{ marginTop: '12px' }}>
            <label className="form-label" htmlFor="onboarding-provider-select">Provider</label>
            <select
              id="onboarding-provider-select"
              className="form-select"
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value as AIProviderName)}
              disabled={skipApiKey}
            >
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic Claude</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </div>

          <div className="form-group">
            <div className="label-with-toggle">
              <label className="form-label" htmlFor="onboarding-api-key">API key</label>
              <button
                type="button"
                className="btn-toggle-mask"
                onClick={() => setShowApiKey(!showApiKey)}
                disabled={skipApiKey}
              >
                {showApiKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              id="onboarding-api-key"
              type={showApiKey ? 'text' : 'password'}
              className="form-input"
              placeholder={skipApiKey ? 'Skipped' : 'Paste your key'}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                if (errorMsg) setErrorMsg(null);
              }}
              disabled={skipApiKey}
              aria-invalid={Boolean(errorMsg)}
              aria-describedby={errorMsg ? 'onboarding-key-error' : undefined}
            />
            {errorMsg && (
              <p id="onboarding-key-error" className="key-field-error" role="alert">
                {errorMsg}
              </p>
            )}
          </div>

          {/* Local Rules Only / Skip Checkbox */}
          <div className="skip-api-box">
            <label className="checkbox-row skip-key-toggle">
              <input
                type="checkbox"
                checked={skipApiKey}
                onChange={(e) => setSkipApiKey(e.target.checked)}
              />
              <span>Skip this. I can add a key later in Settings.</span>
            </label>
          </div>

          <div className="onboarding-nav-row" style={{ marginTop: '16px' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setCurrentStep(2)}
            >
              Back
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleStep3Next}
              disabled={isCheckingKey}
            >
              {isCheckingKey ? 'Checking your key...' : 'Review and complete'}
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          STEP 4: Ready to Apply & Copilot Activation
          ========================================================================= */}
      {currentStep === 4 && (
        <div className="onboarding-step-content">
          <div className="celebration-box">
            <h3 className="celebration-title">You're set up</h3>
            <p className="celebration-subtitle">
              Here's what ApplyKit will use. You can change any of it in Profile.
            </p>
          </div>

          <div className="summary-checklist">
            <div className="checklist-item">
              <div>
                <strong>You:</strong> {firstName} {lastName} ({email})
              </div>
            </div>
            {city && (
              <div className="checklist-item">
                <div>
                  <strong>Location:</strong> {city}{stateOrProvince ? `, ${stateOrProvince}` : ''}{country ? `, ${country}` : ''}
                </div>
              </div>
            )}
            <div className="checklist-item">
              <div>
                <strong>Work permit:</strong>{' '}
                {isAuthorized === '' || requiresSponsorship === ''
                  ? 'Not answered. You can answer later in Profile.'
                  : `${isAuthorized === 'yes' ? 'Can work where you live' : 'Cannot work where you live'}, ${requiresSponsorship === 'yes' ? 'needs sponsorship' : 'no sponsorship needed'}`}
              </div>
            </div>
            <div className="checklist-item">
              <div>
                <strong>Resume:</strong> {ingestStats ? `${ingestStats.evidenceCount} lines read` : resumeText ? 'Added' : 'Not added yet'}
              </div>
            </div>
            <div className="checklist-item">
              <div>
                <strong>AI:</strong> {skipApiKey || !apiKey ? 'Not set up (everything else still works)' : 'Key saved'}
              </div>
            </div>
          </div>

          <div className="quick-tip-card">
            <h4>How it works</h4>
            <ol>
              <li>Open a job posting and press <strong>Read the job on this page</strong>.</li>
              <li>See how you fit, then get a resume tailored to it.</li>
              <li>On the application form, press <strong>Fill the form</strong>. You always press Submit yourself.</li>
            </ol>
          </div>

          <div className="onboarding-nav-row" style={{ marginTop: '16px' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setCurrentStep(3)}
              disabled={isSubmitting}
            >
              Back
            </button>
            <button
              type="button"
              className="btn-primary btn-launch"
              onClick={handleFinishOnboarding}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving...' : 'Open workspace'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
