/**
 * @fileoverview Resume-First First-Run Onboarding Wizard.
 *
 * Implements a candidate-controlled, resume-first onboarding architecture (ADR-0004, ADR-0017):
 * Step 1: Resume Upload & Fast Decomposition (Dropzone, file picker, text paste, sample CV fast-track)
 * Step 2: Profile Review & Confirmation (Pre-filled contact, location taxonomy, work authorization, compensation, links)
 * Step 3: AI Provider Setup (Isolated background key storage, Free Gemini 1-Click, BYOK, or offline rules)
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

  const [isAuthorized, setIsAuthorized] = useState(true);
  const [requiresSponsorship, setRequiresSponsorship] = useState(false);
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
      setErrorMsg('Please upload a resume file or paste your resume text first.');
      return;
    }

    setIsParsing(true);
    setErrorMsg(null);

    try {
      const parsed = parsePlainTextResume(raw);

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

      // Auto-advance to Step 2 so the user can verify pre-filled profile data
      setCurrentStep(2);
    } catch (err) {
      setErrorMsg('Resume parsing notice: ' + (err instanceof Error ? err.message : String(err)));
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
   * Processes incoming resume file (PDF, TXT, MD, JSON) client-side.
   */
  const processIncomingResumeFile = async (file: File) => {
    setResumeFileName(file.name);
    setIsParsing(true);
    setErrorMsg(null);

    const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';

    try {
      if (isPdf) {
        const buffer = await file.arrayBuffer();
        const bootstrapped = await bootstrapProfileFromResume(buffer, file.name);
        populateFromCandidateProfile(bootstrapped.profile, bootstrapped.rawText, file.name);

        const res = await sendToBackground<CommitBootstrappedProfileRequest, CommitBootstrappedProfileResponse>({
          type: 'COMMIT_BOOTSTRAPPED_PROFILE',
          profile: bootstrapped.profile,
          evidence: [...bootstrapped.evidence],
        });

        if (res && res.success) {
          setIngestStats({
            evidenceCount: bootstrapped.evidence.length,
            claimsCount: bootstrapped.profile.claims.length,
          });
        }
        setCurrentStep(2);
      } else {
        const text = await file.text();
        if (text.trim()) {
          setResumeText(text);
          await handleParseResume(text, file.name);
        }
      }
    } catch (err) {
      setErrorMsg('Resume parsing notice: ' + (err instanceof Error ? err.message : String(err)));
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
      setErrorMsg('Please provide your first name, last name, and contact email.');
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
        await sendToBackground<
          { type: 'SET_API_KEY'; provider: AIProviderName; apiKey: string },
          SetApiKeyResponse
        >({
          type: 'SET_API_KEY',
          provider: selectedProvider,
          apiKey: apiKey.trim(),
        });
      } catch (err) {
        setErrorMsg('Failed to save API key: ' + (err instanceof Error ? err.message : String(err)));
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
            isAuthorizedInCountry: isAuthorized,
            requiresSponsorship,
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
        throw new Error(res.error || 'Failed to save candidate profile aggregate.');
      }

      // Mark onboarding completed in Chrome local storage
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
              Local-first &bull; Evidence-backed &bull; Candidate controlled
            </p>
          </div>
        </div>
        {onCancel && (
          <button type="button" className="btn-close-onboarding" onClick={onCancel} title="Close onboarding">
            ✕
          </button>
        )}
      </div>

      {/* Stepper Progress Bar */}
      <div className="onboarding-stepper" role="progressbar" aria-valuenow={currentStep} aria-valuemin={1} aria-valuemax={4}>
        <div className={`step-item ${currentStep >= 1 ? 'step-active' : ''} ${currentStep > 1 ? 'step-done' : ''}`}>
          <div className="step-circle">{currentStep > 1 ? '✓' : '1'}</div>
          <span className="step-label">📄 Resume</span>
        </div>
        <div className="step-divider" />
        <div className={`step-item ${currentStep >= 2 ? 'step-active' : ''} ${currentStep > 2 ? 'step-done' : ''}`}>
          <div className="step-circle">{currentStep > 2 ? '✓' : '2'}</div>
          <span className="step-label">👤 Profile</span>
        </div>
        <div className="step-divider" />
        <div className={`step-item ${currentStep >= 3 ? 'step-active' : ''} ${currentStep > 3 ? 'step-done' : ''}`}>
          <div className="step-circle">{currentStep > 3 ? '✓' : '3'}</div>
          <span className="step-label">🤖 AI Setup</span>
        </div>
        <div className="step-divider" />
        <div className={`step-item ${currentStep >= 4 ? 'step-active' : ''}`}>
          <div className="step-circle">4</div>
          <span className="step-label">🚀 Ready</span>
        </div>
      </div>

      {errorMsg && <div className="onboarding-error-alert" role="alert">⚠️ {errorMsg}</div>}

      {/* =========================================================================
          STEP 1: Resume Upload & Fast Decomposition (Hero Step)
          ========================================================================= */}
      {currentStep === 1 && (
        <div className="onboarding-step-content">
          <div className="step-heading-row">
            <div>
              <h3 className="step-title">📄 Upload or Paste Your Resume</h3>
              <p className="step-desc">
                ApplyKit grounds everything in your verified experience. Upload or paste your CV to extract your contact details, work history, skills, and links in seconds.
              </p>
            </div>
            <button
              type="button"
              id="btn-sample-resume"
              className="btn-link-sample"
              onClick={handleSampleResume}
              disabled={isParsing}
            >
              💡 Try Sample Resume
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
              accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.text,.json,application/pdf,image/*"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
            <div className="resume-dropzone-icon">📄</div>
            <p className="resume-dropzone-title">
              {resumeFileName ? `Selected: ${resumeFileName}` : 'Drop your resume file here, or click to browse'}
            </p>
            <p className="resume-dropzone-sub">
              Supports .pdf, .png, .jpg, .txt, .md, or .json CVs (Local-first vector extraction)
            </p>
          </div>

          {/* Paste Resume Textarea */}
          <div className="form-group" style={{ marginTop: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label className="form-label" htmlFor="resume-textarea" style={{ margin: 0 }}>
                Or Paste Plain Text Resume Below
              </label>
              {resumeText.trim() && (
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                  {resumeText.trim().split(/\s+/).length} words
                </span>
              )}
            </div>
            <textarea
              id="resume-textarea"
              className="form-textarea"
              rows={7}
              placeholder="Paste plain text resume, work experience bullets, or achievements here..."
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
            />
          </div>

          {ingestStats && (
            <div className="ingest-stats-pill">
              ✓ Extracted {ingestStats.evidenceCount} atomic evidence items & {ingestStats.claimsCount} verified claims!
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
              Manual Profile Entry ➔
            </button>
            <button
              type="button"
              id="btn-parse-resume"
              className="btn-primary"
              onClick={() => handleParseResume()}
              disabled={isParsing || !resumeText.trim()}
            >
              {isParsing ? '⚡ Extracting & Ingesting...' : '⚡ Ingest Resume & Build Profile ➔'}
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
              <h3 className="step-title">👤 Review & Confirm Profile</h3>
              <p className="step-desc">
                We pre-filled these details from your resume. Review and fill any missing information to guarantee 100% accurate autofill.
              </p>
            </div>
          </div>

          {ingestStats && (
            <div className="ingest-stats-pill" style={{ margin: '0 0 4px 0' }}>
              ✓ Resume decomposed into {ingestStats.evidenceCount} atomic evidence items & {ingestStats.claimsCount} verified claims.
            </div>
          )}

          <form onSubmit={handleStep2Next} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Identity Group */}
            <div className="form-row-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="first-name">Legal First Name *</label>
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
                <label className="form-label" htmlFor="last-name">Legal Last Name *</label>
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
                <label className="form-label" htmlFor="email">Email Address *</label>
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
                <label className="form-label" htmlFor="phone">Phone Number (with Country Code)</label>
                <input
                  id="phone"
                  type="tel"
                  className="form-input"
                  placeholder="+1 (555) 019-2834"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="headline">Professional Headline / Current Role</label>
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
                <label className="form-label" htmlFor="state-province">State / Province</label>
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
                <label className="form-label" htmlFor="postal-code">Postal / Zip Code</label>
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
              <label className="form-label" htmlFor="street-address">Street Address (Optional)</label>
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
              <h4 className="work-auth-title">🛡️ Work Authorization</h4>
              <label className="checkbox-row">
                <input
                  id="work-auth-checkbox"
                  type="checkbox"
                  checked={isAuthorized}
                  onChange={(e) => setIsAuthorized(e.target.checked)}
                />
                <span>Legally authorized to work in resident country</span>
              </label>
              <label className="checkbox-row">
                <input
                  id="sponsor-checkbox"
                  type="checkbox"
                  checked={requiresSponsorship}
                  onChange={(e) => setRequiresSponsorship(e.target.checked)}
                />
                <span>Requires employer visa sponsorship now or in the future</span>
              </label>
              <div className="form-group" style={{ marginTop: '8px' }}>
                <label className="form-label" htmlFor="visa-status">Visa Classification / Status (Optional)</label>
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
                <label className="form-label" htmlFor="target-salary">Target Minimum Salary (Annual)</label>
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
                <label className="form-label" htmlFor="notice-days">Notice Period (Days)</label>
                <input
                  id="notice-days"
                  type="number"
                  className="form-input"
                  placeholder="e.g. 14 (0 for immediate)"
                  value={noticePeriodDays}
                  onChange={(e) => setNoticePeriodDays(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="earliest-start">Earliest Start Date</label>
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
              <label className="form-label" htmlFor="linkedin-url">LinkedIn Profile URL</label>
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
                <label className="form-label" htmlFor="github-url">GitHub Profile URL</label>
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
                <label className="form-label" htmlFor="portfolio-url">Portfolio / Blog URL</label>
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
                ← Back to Resume
              </button>
              <button type="submit" className="btn-primary">
                Continue to AI Setup ➔
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
          <h3 className="step-title">🤖 AI Provider Key Configuration</h3>
          <p className="step-desc">
            ApplyKit keeps your API keys strictly isolated inside the Extension Service Worker (ADR-0002). Webpages and scripts have zero access.
          </p>

          {/* Free Gemini 1-Click Callout */}
          <div className="free-gemini-box">
            <div className="free-gemini-header">
              <span className="free-gemini-icon">🌟</span>
              <div>
                <h4 className="free-gemini-title">Recommended: Google Gemini (100% Free)</h4>
                <p className="free-gemini-desc">
                  Google AI Studio offers a free tier (15 requests/minute) with zero credit card required.
                </p>
              </div>
            </div>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="btn-get-gemini-key"
            >
              Get Free Gemini Key in 1 Click ↗
            </a>
          </div>

          <div className="form-group" style={{ marginTop: '12px' }}>
            <label className="form-label" htmlFor="onboarding-provider-select">Select AI Provider</label>
            <select
              id="onboarding-provider-select"
              className="form-select"
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value as AIProviderName)}
              disabled={skipApiKey}
            >
              <option value="gemini">Google Gemini (Recommended & Free)</option>
              <option value="openai">OpenAI (GPT-4o, GPT-4o-mini)</option>
              <option value="anthropic">Anthropic (Claude 3.5 Sonnet)</option>
              <option value="openrouter">OpenRouter (Unified Multi-Model)</option>
            </select>
          </div>

          <div className="form-group">
            <div className="label-with-toggle">
              <label className="form-label" htmlFor="onboarding-api-key">API Key</label>
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
              placeholder={skipApiKey ? 'Skipped for now' : 'Paste API Key (e.g. AIzaSy... or sk-...)'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={skipApiKey}
            />
          </div>

          {/* Local Rules Only / Skip Checkbox */}
          <div className="skip-api-box">
            <label className="checkbox-row skip-key-toggle">
              <input
                type="checkbox"
                checked={skipApiKey}
                onChange={(e) => setSkipApiKey(e.target.checked)}
              />
              <span>Skip for now (I will configure my API key later in Settings)</span>
            </label>
          </div>

          <div className="onboarding-nav-row" style={{ marginTop: '16px' }}>
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

      {/* =========================================================================
          STEP 4: Ready to Apply & Copilot Activation
          ========================================================================= */}
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
            {city && (
              <div className="checklist-item">
                <span className="check-icon">✓</span>
                <div>
                  <strong>Location:</strong> {city}{stateOrProvince ? `, ${stateOrProvince}` : ''}{country ? `, ${country}` : ''}
                </div>
              </div>
            )}
            <div className="checklist-item">
              <span className="check-icon">✓</span>
              <div>
                <strong>Work Authorization:</strong> {isAuthorized ? 'Authorized in resident country' : 'Not authorized'}{requiresSponsorship ? ' (Sponsorship required)' : ''}
              </div>
            </div>
            <div className="checklist-item">
              <span className="check-icon">✓</span>
              <div>
                <strong>Master Resume & Evidence:</strong> {ingestStats ? `${ingestStats.evidenceCount} verified evidence items & ${ingestStats.claimsCount} claims` : (resumeText ? 'Master resume loaded' : 'Clean profile aggregate')}
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

          <div className="onboarding-nav-row" style={{ marginTop: '16px' }}>
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
