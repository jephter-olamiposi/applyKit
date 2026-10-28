/**
 * @fileoverview Candidate profile summary, editor, and data sovereignty manager for Side Panel.
 *
 * Enforces candidate data sovereignty (ADR-0001, ADR-0004):
 * - Direct local profile editing (identity, full address, work authorization, compensation, links)
 * - Saved answers management for zero-latency fast-path form answering
 * - One-click JSON backup export & restore
 * - Local data purge & factory reset with reactive UI reset
 */

import React, { useState, useEffect, useCallback } from 'react';
import type {
  CandidateProfileSummary,
  GetCandidateProfileResponse,
  SaveCandidateProfileResponse,
  ExportBackupResponse,
  ImportBackupResponse,
  ExportProfileYamlResponse,
  ImportProfileYamlResponse,
  IngestResumeRequest,
  IngestResumeResponse,
} from '../../messages/contracts.js';
import { sendToBackground } from '../../messages/bridge.js';
import {
  createEmptyProfile,
  createSkillId,
  normalizeSkillName,
  bootstrapProfileFromResume,
  type CandidateProfile,
  type CandidateSkill,
  type EmploymentPreference,
  type SkillCategory,
  type SkillProficiency,
  type TargetSeniority,
  formatPlace,
} from '@applykit/domain';

/** Answer to a yes/no question, or '' when the candidate hasn't answered. */
type YesNo = 'yes' | 'no' | '';

interface ProfileSummaryProps {
  readonly profile: CandidateProfileSummary | null;
  readonly loading: boolean;
  readonly onProfileUpdated: () => void;
}

interface SkillDraft {
  readonly id: string;
  name: string;
  category: SkillCategory;
  proficiency: SkillProficiency;
  yearsOfExperience: string;
}

/**
 * Candidate profile management and review component.
 */
export const ProfileSummary: React.FC<ProfileSummaryProps> = ({
  profile,
  loading,
  onProfileUpdated,
}) => {
  const [fullProfile, setFullProfile] = useState<CandidateProfile | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Identity Form States
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editHeadline, setEditHeadline] = useState('');
  const [editTargetSeniority, setEditTargetSeniority] = useState<TargetSeniority>('any');

  // Location Form States
  const [editCity, setEditCity] = useState('');
  const [editStateOrProvince, setEditStateOrProvince] = useState('');
  const [editCountry, setEditCountry] = useState('');
  const [editAddressLine1, setEditAddressLine1] = useState('');
  const [editPostalCode, setEditPostalCode] = useState('');

  // Work Authorization Form States
  // '' means "not answered yet"; the form filler leaves these questions for the candidate
  // until both are answered here.
  const [editIsAuthorized, setEditIsAuthorized] = useState<YesNo>('');
  const [editRequiresSponsorship, setEditRequiresSponsorship] = useState<YesNo>('');
  const [editVisaStatus, setEditVisaStatus] = useState('');

  // Compensation & Availability Form States
  const [editSalaryMin, setEditSalaryMin] = useState<number | string>('');
  const [editCurrency, setEditCurrency] = useState('USD');
  const [editNoticePeriodDays, setEditNoticePeriodDays] = useState<number | string>('');
  const [editEarliestStartDate, setEditEarliestStartDate] = useState('');
  const [editWorkplacePreference, setEditWorkplacePreference] = useState<
    'remote' | 'hybrid' | 'onsite' | 'any'
  >('remote');
  const [editEmploymentPreference, setEditEmploymentPreference] =
    useState<EmploymentPreference>('any');

  // Links Form States
  const [editLinkedin, setEditLinkedin] = useState('');
  const [editGithub, setEditGithub] = useState('');
  const [editPortfolio, setEditPortfolio] = useState('');

  // Skills
  const [editSkillDrafts, setEditSkillDrafts] = useState<SkillDraft[]>([]);

  // Master Resume Hub State
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [newResumeText, setNewResumeText] = useState('');
  const [, setNewResumeFileName] = useState('');
  const [isIngestingResume, setIsIngestingResume] = useState(false);

  const [saving, setSaving] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const loadFullProfile = useCallback(async () => {
    try {
      const res = await sendToBackground<
        { type: 'GET_CANDIDATE_PROFILE' },
        GetCandidateProfileResponse
      >({ type: 'GET_CANDIDATE_PROFILE' });

      if (res && res.profile) {
        setFullProfile(res.profile);
      }
    } catch {
      // Ignored if profile uninitialized
    }
  }, []);

  useEffect(() => {
    loadFullProfile();
  }, [loadFullProfile, profile]);

  const populateEditState = (p: CandidateProfile) => {
    setEditFirstName(p.identity.legalFirstName || '');
    setEditLastName(p.identity.legalLastName || '');
    setEditEmail(p.identity.email || '');
    setEditPhone(p.identity.phone || '');
    setEditHeadline(p.professional.headline || '');
    setEditTargetSeniority(p.professional.targetSeniority || 'any');

    setEditCity(p.identity.location?.city || '');
    setEditStateOrProvince(p.identity.location?.stateOrProvince || '');
    setEditCountry(p.identity.location?.country || '');
    setEditAddressLine1(p.identity.location?.addressLine1 || '');
    setEditPostalCode(p.identity.location?.postalCode || '');

    const confirmed = p.identity.workAuthorization?.confirmedByCandidate === true;
    setEditIsAuthorized(confirmed ? (p.identity.workAuthorization.isAuthorizedInCountry ? 'yes' : 'no') : '');
    setEditRequiresSponsorship(confirmed ? (p.identity.workAuthorization.requiresSponsorship ? 'yes' : 'no') : '');
    setEditVisaStatus(p.identity.workAuthorization?.visaStatus || '');

    setEditSalaryMin(p.professional.compensationExpectation?.targetSalaryMin ?? '');
    setEditCurrency(p.professional.compensationExpectation?.currency || 'USD');
    setEditNoticePeriodDays(p.professional.noticePeriodDays ?? '');
    setEditEarliestStartDate(p.professional.earliestStartDate || '');
    setEditWorkplacePreference(
      p.professional.workplacePreference === 'flexible'
        ? 'any'
        : p.professional.workplacePreference
    );
    setEditEmploymentPreference(p.professional.employmentPreference || 'any');

    setEditLinkedin(p.links?.linkedin || '');
    setEditGithub(p.links?.github || '');
    setEditPortfolio(p.links?.portfolio || p.links?.personalBlog || '');

    setEditSkillDrafts(
      p.skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        category: skill.category,
        proficiency: skill.proficiency,
        yearsOfExperience: skill.yearsOfExperience?.toString() || '',
      }))
    );
  };

  const startEdit = async () => {
    setActionStatus(null);
    try {
      const res = await sendToBackground<
        { type: 'GET_CANDIDATE_PROFILE' },
        GetCandidateProfileResponse
      >({ type: 'GET_CANDIDATE_PROFILE' });

      if (res && res.profile) {
        setFullProfile(res.profile);
        populateEditState(res.profile);
      } else {
        const empty = createEmptyProfile();
        populateEditState(empty);
      }
      setIsEditing(true);
    } catch {
      setIsEditing(true);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setActionStatus(null);

    try {
      let baseProfile: CandidateProfile = fullProfile ?? createEmptyProfile();

      const parsedSkills: CandidateSkill[] = editSkillDrafts
        .filter((skill) => skill.name.trim().length > 0)
        .map((skill) => {
          const existing = baseProfile.skills.find((candidateSkill) => candidateSkill.id === skill.id);
          const years = skill.yearsOfExperience.trim() ? Number(skill.yearsOfExperience) : undefined;
          return {
            id: existing?.id || createSkillId(),
            name: skill.name.trim(),
            normalizedName: normalizeSkillName(skill.name),
            category: skill.category,
            proficiency: skill.proficiency,
            yearsOfExperience: years !== undefined && Number.isFinite(years) && years >= 0 ? years : undefined,
            evidenceRefs: existing?.evidenceRefs || [],
          };
        });

      const numSalary = editSalaryMin !== '' ? Number(editSalaryMin) : undefined;
      const numNotice = editNoticePeriodDays !== '' ? Number(editNoticePeriodDays) : undefined;

      const updatedProfile: CandidateProfile = {
        ...baseProfile,
        identity: {
          ...baseProfile.identity,
          legalFirstName: editFirstName.trim(),
          legalLastName: editLastName.trim(),
          email: editEmail.trim(),
          phone: editPhone.trim(),
          location: {
            city: editCity.trim(),
            stateOrProvince: editStateOrProvince.trim() || undefined,
            country: editCountry.trim(),
            addressLine1: editAddressLine1.trim() || undefined,
            postalCode: editPostalCode.trim() || undefined,
          },
          workAuthorization: {
            isAuthorizedInCountry: editIsAuthorized === 'yes',
            requiresSponsorship: editRequiresSponsorship === 'yes',
            confirmedByCandidate: editIsAuthorized !== '' && editRequiresSponsorship !== '',
            visaStatus: editVisaStatus.trim() || undefined,
            authorizedCountries: editCountry.trim() ? [editCountry.trim()] : [],
          },
        },
        professional: {
          ...baseProfile.professional,
          headline: editHeadline.trim(),
          targetSeniority: editTargetSeniority,
          workplacePreference: editWorkplacePreference,
          employmentPreference: editEmploymentPreference,
          noticePeriodDays: numNotice,
          earliestStartDate: editEarliestStartDate.trim() || undefined,
          compensationExpectation: numSalary
            ? {
                targetSalaryMin: numSalary,
                currency: editCurrency.trim() || 'USD',
                period: 'annual',
                isNegotiable: true,
              }
            : undefined,
        },
        links: {
          ...baseProfile.links,
          linkedin: editLinkedin.trim() || undefined,
          github: editGithub.trim() || undefined,
          portfolio: editPortfolio.trim() || undefined,
        },
        skills: parsedSkills.length > 0 ? parsedSkills : baseProfile.skills,
        updatedAt: new Date().toISOString(),
      };

      const saveRes = await sendToBackground<
        { type: 'SAVE_CANDIDATE_PROFILE'; profile: CandidateProfile },
        SaveCandidateProfileResponse
      >({ type: 'SAVE_CANDIDATE_PROFILE', profile: updatedProfile });

      if (saveRes && saveRes.success) {
        setFullProfile(updatedProfile);
        setIsEditing(false);
        setActionStatus('Saved.');
        onProfileUpdated();
      } else {
        setActionStatus(`Could not save: ${saveRes?.error || 'try again.'}`);
      }
    } catch (err) {
      setActionStatus(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSavedAnswer = async (answerId: string) => {
    if (!fullProfile) return;
    const remaining = (fullProfile.savedAnswers || []).filter((ans) => ans.id !== answerId);
    const updated: CandidateProfile = {
      ...fullProfile,
      savedAnswers: remaining,
      updatedAt: new Date().toISOString(),
    };

    try {
      const res = await sendToBackground<
        { type: 'SAVE_CANDIDATE_PROFILE'; profile: CandidateProfile },
        SaveCandidateProfileResponse
      >({ type: 'SAVE_CANDIDATE_PROFILE', profile: updated });

      if (res && res.success) {
        setFullProfile(updated);
        setActionStatus('Answer deleted.');
        onProfileUpdated();
      }
    } catch (err) {
      setActionStatus(`Something went wrong: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleExport = async () => {
    setActionStatus(null);
    try {
      const res = await sendToBackground<
        { type: 'EXPORT_BACKUP' },
        ExportBackupResponse
      >({ type: 'EXPORT_BACKUP' });

      if (res && res.success && res.jsonString) {
        const blob = new Blob([res.jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `applykit-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setActionStatus('Backup downloaded.');
      } else {
        setActionStatus(`Could not create the backup: ${res?.error || 'try again.'}`);
      }
    } catch (err) {
      setActionStatus(`Could not create the backup: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setActionStatus(null);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const jsonString = event.target?.result as string;
        const res = await sendToBackground<
          { type: 'IMPORT_BACKUP'; jsonString: string },
          ImportBackupResponse
        >({ type: 'IMPORT_BACKUP', jsonString });

        if (res && res.success) {
          setActionStatus('Backup restored.');
          await loadFullProfile();
          onProfileUpdated();
        } else {
          setActionStatus(`Could not restore: ${res?.error || 'the file does not look like an ApplyKit backup.'}`);
        }
      } catch (err) {
        setActionStatus(`Could not restore: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleExportYaml = async () => {
    setActionStatus(null);
    try {
      const res = await sendToBackground<
        { type: 'EXPORT_PROFILE_YAML' },
        ExportProfileYamlResponse
      >({ type: 'EXPORT_PROFILE_YAML' });

      if (res && res.success && res.yaml) {
        const blob = new Blob([res.yaml], { type: 'text/yaml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res.filename || 'profile.yaml';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setActionStatus(`Downloaded ${res.filename || 'profile.yaml'}.`);
      } else {
        setActionStatus(`Could not export: ${res?.error || 'try again.'}`);
      }
    } catch (err) {
      setActionStatus(`Could not export: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleImportYaml = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setActionStatus(null);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const yamlContent = event.target?.result as string;
        const res = await sendToBackground<
          { type: 'IMPORT_PROFILE_YAML'; yamlContent: string },
          ImportProfileYamlResponse
        >({ type: 'IMPORT_PROFILE_YAML', yamlContent });

        if (res && res.success) {
          setActionStatus('Profile imported.');
          await loadFullProfile();
          onProfileUpdated();
        } else {
          setActionStatus(`Could not import: ${res?.error || 'the file is not valid YAML.'}`);
        }
      } catch (err) {
        setActionStatus(`Could not import: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleResumeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNewResumeFileName(file.name);
    const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
    const isDocx =
      file.name.toLowerCase().endsWith('.docx') ||
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    try {
      if (isPdf || isDocx) {
        const buffer = await file.arrayBuffer();
        const bootstrapped = await bootstrapProfileFromResume(buffer, file.name);
        setNewResumeText(bootstrapped.rawText);
      } else {
        const text = await file.text();
        setNewResumeText(text);
      }
    } catch (err) {
      setActionStatus(`Could not read that file: ${err instanceof Error ? err.message : String(err)}`);
    }
    e.target.value = '';
  };

  const handleApplyResumeUpdate = async () => {
    if (!newResumeText.trim()) return;
    setIsIngestingResume(true);
    setActionStatus(null);
    try {
      const res = await sendToBackground<IngestResumeRequest, IngestResumeResponse>({
        type: 'INGEST_RESUME_TEXT',
        rawText: newResumeText.trim(),
      });
      if (res && res.success) {
        setActionStatus(
          `Resume updated. ApplyKit read ${res.evidenceCount ?? 0} lines from it.`
        );
        setShowResumeModal(false);
        setNewResumeText('');
        setNewResumeFileName('');
        await loadFullProfile();
        onProfileUpdated();
      } else {
        setActionStatus(`Could not use this resume: ${res?.error || 'try again.'}`);
      }
    } catch (err) {
      setActionStatus(`Could not use this resume: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsIngestingResume(false);
    }
  };

  if (loading) {
    return <div className="loading-spinner">Loading profile...</div>;
  }

  const savedAnswersList = fullProfile?.savedAnswers || [];

  return (
    <div className="profile-summary-container">
      {actionStatus && <div className="ui-note" role="status" style={{ marginBottom: 12 }}>{actionStatus}</div>}

      {isEditing ? (
        <form onSubmit={handleSave} className="profile-edit-form">
          <h3 className="section-title">Edit your profile</h3>

          {/* Section: Basic Identity */}
          <div className="form-section-card">
            <h4 className="form-section-title">Personal identity and contact</h4>
            <div className="form-row-2col">
              <div className="form-group">
                <label className="form-label">First Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                  placeholder="e.g. Jane"
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Last Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                  placeholder="e.g. Doe"
                  required
                />
              </div>
            </div>

            <div className="form-row-2col">
              <div className="form-group">
                <label className="form-label">Email</label>
                <input
                  type="email"
                  className="form-input"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="e.g. jane@example.com"
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input
                  type="tel"
                  className="form-input"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="e.g. +1 555-019-2834"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Headline / Current Title</label>
              <input
                type="text"
                className="form-input"
                value={editHeadline}
                onChange={(e) => setEditHeadline(e.target.value)}
                placeholder="e.g. Senior Full Stack Engineer"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Target Role Level</label>
              <select
                className="form-select"
                value={editTargetSeniority}
                onChange={(e) => setEditTargetSeniority(e.target.value as TargetSeniority)}
              >
                <option value="any">Any level</option>
                <option value="intern">Internship</option>
                <option value="junior">Junior</option>
                <option value="mid">Mid-level</option>
                <option value="senior">Senior</option>
                <option value="staff">Staff</option>
                <option value="principal">Principal</option>
              </select>
              <small className="form-help">This controls targeting; it does not change your past job titles.</small>
            </div>
          </div>

          {/* Section: Location */}
          <div className="form-section-card">
            <h4 className="form-section-title">Location and residency</h4>
            <div className="form-row-2col">
              <div className="form-group">
                <label className="form-label">Country</label>
                <input
                  type="text"
                  className="form-input"
                  value={editCountry}
                  onChange={(e) => setEditCountry(e.target.value)}
                  placeholder="e.g. United States or Canada"
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">State / Province / Region</label>
                <input
                  type="text"
                  className="form-input"
                  value={editStateOrProvince}
                  onChange={(e) => setEditStateOrProvince(e.target.value)}
                  placeholder="e.g. California or Ontario"
                />
              </div>
            </div>

            <div className="form-row-2col">
              <div className="form-group">
                <label className="form-label">City</label>
                <input
                  type="text"
                  className="form-input"
                  value={editCity}
                  onChange={(e) => setEditCity(e.target.value)}
                  placeholder="e.g. San Francisco"
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Postal / Zip Code</label>
                <input
                  type="text"
                  className="form-input"
                  value={editPostalCode}
                  onChange={(e) => setEditPostalCode(e.target.value)}
                  placeholder="e.g. 94105"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Street Address (Optional)</label>
              <input
                type="text"
                className="form-input"
                value={editAddressLine1}
                onChange={(e) => setEditAddressLine1(e.target.value)}
                placeholder="e.g. 123 Market Street"
              />
            </div>
          </div>

          {/* Section: Work Authorization */}
          <div className="form-section-card">
            <h4 className="form-section-title">Work authorization</h4>
            <p className="ui-subtle" style={{ marginBottom: 8 }}>
              ApplyKit only answers these on forms once you've answered them here.
            </p>
            <label className="form-group">
              <span className="form-label">Can you legally work in the country you live in?</span>
              <select className="ui-select" value={editIsAuthorized} onChange={(e) => setEditIsAuthorized(e.target.value as YesNo)}>
                <option value="">Not answered</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label className="form-group">
              <span className="form-label">Will you need visa sponsorship, now or later?</span>
              <select
                className="ui-select"
                value={editRequiresSponsorship}
                onChange={(e) => setEditRequiresSponsorship(e.target.value as YesNo)}
              >
                <option value="">Not answered</option>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </label>
            <div className="form-group" style={{ marginTop: '8px' }}>
              <label className="form-label">Visa / Citizenship Status (Optional)</label>
              <input
                type="text"
                className="form-input"
                value={editVisaStatus}
                onChange={(e) => setEditVisaStatus(e.target.value)}
                placeholder="e.g. Citizen, Permanent Resident, H-1B, Work Permit"
              />
            </div>
          </div>

          {/* Section: Compensation & Availability */}
          <div className="form-section-card">
            <h4 className="form-section-title">Compensation and availability</h4>
            <div className="form-row-2col">
              <div className="form-group">
                <label className="form-label">Workplace Preference</label>
                <select
                  className="form-select"
                  value={editWorkplacePreference}
                  onChange={(e) =>
                    setEditWorkplacePreference(
                      e.target.value as 'remote' | 'hybrid' | 'onsite' | 'any'
                    )
                  }
                >
                  <option value="remote">Remote only</option>
                  <option value="hybrid">Hybrid only</option>
                  <option value="onsite">Onsite only</option>
                  <option value="any">Any workplace</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Employment Type</label>
                <select
                  className="form-select"
                  value={editEmploymentPreference}
                  onChange={(e) =>
                    setEditEmploymentPreference(e.target.value as EmploymentPreference)
                  }
                >
                  <option value="any">Any employment type</option>
                  <option value="full_time">Full time</option>
                  <option value="part_time">Part time</option>
                  <option value="contract">Contract</option>
                  <option value="internship">Internship</option>
                </select>
              </div>
            </div>
            <div className="form-row-2col">
              <div className="form-group">
                <label className="form-label">Target Salary (Min)</label>
                <input
                  type="number"
                  className="form-input"
                  value={editSalaryMin}
                  onChange={(e) => setEditSalaryMin(e.target.value)}
                  placeholder="e.g. 140000"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Currency</label>
                <select
                  className="form-select"
                  value={editCurrency}
                  onChange={(e) => setEditCurrency(e.target.value)}
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

            <div className="form-row-2col">
              <div className="form-group">
                <label className="form-label">Notice Period (Days)</label>
                <input
                  type="number"
                  className="form-input"
                  value={editNoticePeriodDays}
                  onChange={(e) => setEditNoticePeriodDays(e.target.value)}
                  placeholder="e.g. 14 (0 for immediate)"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Earliest Start Date</label>
                <input
                  type="text"
                  className="form-input"
                  value={editEarliestStartDate}
                  onChange={(e) => setEditEarliestStartDate(e.target.value)}
                  placeholder="e.g. Immediately or 2 weeks"
                />
              </div>
            </div>
          </div>

          {/* Section: Links */}
          <div className="form-section-card">
            <h4 className="form-section-title">Professional links</h4>
            <div className="form-group">
              <label className="form-label">LinkedIn URL</label>
              <input
                type="url"
                className="form-input"
                value={editLinkedin}
                onChange={(e) => setEditLinkedin(e.target.value)}
                placeholder="https://linkedin.com/in/username"
              />
            </div>
            <div className="form-group">
              <label className="form-label">GitHub URL</label>
              <input
                type="url"
                className="form-input"
                value={editGithub}
                onChange={(e) => setEditGithub(e.target.value)}
                placeholder="https://github.com/username"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Portfolio / Personal Site</label>
              <input
                type="url"
                className="form-input"
                value={editPortfolio}
                onChange={(e) => setEditPortfolio(e.target.value)}
                placeholder="https://example.com"
              />
            </div>
          </div>

          {/* Section: Skills */}
          <div className="form-section-card">
            <h4 className="form-section-title">Skills</h4>
            <p className="form-help">
              Add a skill only when you can stand behind it. Tailored resumes can include these confirmed skills.
            </p>
            {editSkillDrafts.map((skill, index) => (
              <div className="form-section-card" key={skill.id} style={{ marginBottom: '8px' }}>
                <div className="form-row-2col">
                  <div className="form-group">
                    <label className="form-label">Skill</label>
                    <input
                      type="text"
                      className="form-input"
                      value={skill.name}
                      onChange={(e) =>
                        setEditSkillDrafts((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, name: e.target.value } : item
                          )
                        )
                      }
                      placeholder="e.g. Go"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Category</label>
                    <select
                      className="form-select"
                      value={skill.category}
                      onChange={(e) =>
                        setEditSkillDrafts((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, category: e.target.value as SkillCategory }
                              : item
                          )
                        )
                      }
                    >
                      <option value="language">Programming language</option>
                      <option value="framework">Framework</option>
                      <option value="library">Library</option>
                      <option value="database">Database</option>
                      <option value="cloud_infrastructure">Cloud / infrastructure</option>
                      <option value="devops_tool">Tool</option>
                      <option value="architecture_pattern">Architecture</option>
                      <option value="soft_skill">Soft skill</option>
                      <option value="domain_expertise">Domain expertise</option>
                    </select>
                  </div>
                </div>
                <div className="form-row-2col">
                  <div className="form-group">
                    <label className="form-label">Level</label>
                    <select
                      className="form-select"
                      value={skill.proficiency}
                      onChange={(e) =>
                        setEditSkillDrafts((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, proficiency: e.target.value as SkillProficiency }
                              : item
                          )
                        )
                      }
                    >
                      <option value="beginner">Beginner</option>
                      <option value="intermediate">Intermediate</option>
                      <option value="advanced">Advanced</option>
                      <option value="expert">Expert</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Years used (optional)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      className="form-input"
                      value={skill.yearsOfExperience}
                      onChange={(e) =>
                        setEditSkillDrafts((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, yearsOfExperience: e.target.value }
                              : item
                          )
                        )
                      }
                      placeholder="e.g. 3"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-small btn-secondary"
                  onClick={() =>
                    setEditSkillDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))
                  }
                >
                  Remove skill
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-small btn-secondary"
              onClick={() =>
                setEditSkillDrafts((current) => [
                  ...current,
                  {
                    id: `new-skill-${Date.now()}-${current.length}`,
                    name: '',
                    category: 'language',
                    proficiency: 'intermediate',
                    yearsOfExperience: '',
                  },
                ])
              }
            >
              Add skill
            </button>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsEditing(false)}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </form>
      ) : (
        <div className="ui-stack">
          <section className="ui-card ui-stack" style={{ gap: 8 }} aria-label="About you">
            <div className="ui-spread" style={{ alignItems: 'flex-start' }}>
              <div>
                <h2 className="ui-title">{profile?.fullName || 'Your name'}</h2>
                <p className="ui-text">{profile?.headline || 'Add your current role'}</p>
              </div>
              <button type="button" className="ui-btn ui-btn-sm" onClick={startEdit}>
                Edit
              </button>
            </div>
            <dl className="ui-facts">
              <dt>Email</dt>
              <dd>{profile?.email || 'Not set'}</dd>
              <dt>Phone</dt>
              <dd>{fullProfile?.identity?.phone || 'Not set'}</dd>
              <dt>Location</dt>
              <dd>
                {formatPlace([
                  fullProfile?.identity?.location?.city,
                  fullProfile?.identity?.location?.stateOrProvince,
                  fullProfile?.identity?.location?.country,
                ]) || 'Not set'}
              </dd>
              <dt>Work permit</dt>
              <dd>
                {fullProfile?.identity?.workAuthorization?.confirmedByCandidate
                  ? `${fullProfile.identity.workAuthorization.isAuthorizedInCountry ? 'Can work where you live' : 'Cannot work where you live'}, ${
                      fullProfile.identity.workAuthorization.requiresSponsorship ? 'needs sponsorship' : 'no sponsorship needed'
                    }`
                  : 'Not answered yet'}
              </dd>
              {fullProfile?.professional?.compensationExpectation?.targetSalaryMin ? (
                <>
                  <dt>Salary floor</dt>
                  <dd>
                    {fullProfile.professional.compensationExpectation.currency || 'USD'}{' '}
                    {fullProfile.professional.compensationExpectation.targetSalaryMin.toLocaleString()} a year
                  </dd>
                </>
              ) : null}
              {fullProfile?.professional?.noticePeriodDays != null && (
                <>
                  <dt>Notice</dt>
                  <dd>{fullProfile.professional.noticePeriodDays === 0 ? 'Can start now' : `${fullProfile.professional.noticePeriodDays} days`}</dd>
                </>
              )}
            </dl>
            {!fullProfile?.identity?.location?.country?.trim() && (
              <div className="ui-note ui-note-warn">
                Add your country. Without it ApplyKit cannot tell which remote jobs are open to you.{' '}
                <button type="button" className="ui-link" onClick={startEdit}>
                  Add it
                </button>
              </div>
            )}
            {!fullProfile?.identity?.workAuthorization?.confirmedByCandidate && (
              <div className="ui-note ui-note-warn">
                Answer the work permit questions so ApplyKit can fill them on forms.{' '}
                <button type="button" className="ui-link" onClick={startEdit}>
                  Answer now
                </button>
              </div>
            )}
            {(fullProfile?.links?.linkedin || fullProfile?.links?.github || fullProfile?.links?.portfolio) && (
              <div className="ui-row" style={{ gap: 12 }}>
                {fullProfile.links.linkedin && (
                  <a className="ui-link" href={fullProfile.links.linkedin} target="_blank" rel="noreferrer">
                    LinkedIn
                  </a>
                )}
                {fullProfile.links.github && (
                  <a className="ui-link" href={fullProfile.links.github} target="_blank" rel="noreferrer">
                    GitHub
                  </a>
                )}
                {fullProfile.links.portfolio && (
                  <a className="ui-link" href={fullProfile.links.portfolio} target="_blank" rel="noreferrer">
                    Website
                  </a>
                )}
              </div>
            )}
          </section>

          {(() => {
            const masterDoc = fullProfile?.documents?.find((d) => d.isPrimaryResume || d.documentType === 'resume');
            return (
              <section className="ui-card ui-stack" style={{ gap: 8 }} aria-label="Your resume">
                <div className="ui-spread">
                  <div>
                    <h3 className="ui-card-title">Your resume</h3>
                    <p className="ui-subtle">
                      {masterDoc
                        ? `${masterDoc.fileName} · ${profile?.experienceCount ?? 0} roles · ${profile?.skillsCount ?? 0} skills`
                        : 'No resume added yet'}
                    </p>
                  </div>
                  <button type="button" className="ui-btn ui-btn-sm" onClick={() => setShowResumeModal(!showResumeModal)}>
                    {showResumeModal ? 'Close' : masterDoc ? 'Replace' : 'Add'}
                  </button>
                </div>

                {showResumeModal && (
                  <div className="ui-stack" style={{ gap: 8 }}>
                    <label>
                      <span className="ui-label">Upload a PDF, Word file, image or text file</span>
                      <input
                        type="file"
                        accept=".pdf,.docx,.png,.jpg,.jpeg,.webp,.txt,.md,.text,.json,application/pdf,image/*"
                        onChange={handleResumeUpload}
                      />
                    </label>
                    <textarea
                      className="ui-textarea"
                      rows={6}
                      placeholder="Or paste your resume text"
                      value={newResumeText}
                      onChange={(e) => setNewResumeText(e.target.value)}
                    />
                    <div className="ui-row" style={{ justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="ui-btn ui-btn-sm"
                        onClick={() => {
                          setShowResumeModal(false);
                          setNewResumeText('');
                        }}
                        disabled={isIngestingResume}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="ui-btn ui-btn-sm ui-btn-primary"
                        onClick={handleApplyResumeUpdate}
                        disabled={isIngestingResume || !newResumeText.trim()}
                      >
                        {isIngestingResume ? 'Reading...' : 'Use this resume'}
                      </button>
                    </div>
                  </div>
                )}

                {masterDoc?.extractedText && !showResumeModal && (
                  <details className="ui-details">
                    <summary>See the text ApplyKit read ({masterDoc.extractedText.split(/\s+/).length} words)</summary>
                    <div className="ui-pre">{masterDoc.extractedText}</div>
                  </details>
                )}
              </section>
            );
          })()}

          <section className="ui-card ui-stack" style={{ gap: 8 }} aria-label="Saved answers">
            <h3 className="ui-card-title">Saved answers ({savedAnswersList.length})</h3>
            <p className="ui-subtle">
              Answers you saved from the question helper. ApplyKit reuses them when a form asks the same thing.
            </p>
            {savedAnswersList.length > 0 && (
              <ul className="ui-list">
                {savedAnswersList.map((ans) => (
                  <li key={ans.id}>
                    <div className="ui-spread" style={{ alignItems: 'flex-start' }}>
                      <span style={{ color: 'var(--text)' }}>{ans.promptPatterns[0] || ans.canonicalKey}</span>
                      <button type="button" className="ui-link" onClick={() => handleDeleteSavedAnswer(ans.id)}>
                        Delete
                      </button>
                    </div>
                    <p className="ui-subtle">{ans.answerText}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <details className="ui-details ui-card">
            <summary>Import or export your profile</summary>
            <div className="ui-row">
              <button type="button" className="ui-btn ui-btn-sm" onClick={handleExport}>
                Download backup
              </button>
              <label className="ui-btn ui-btn-sm">
                Restore backup
                <input type="file" accept=".json,application/json" onChange={handleImport} style={{ display: 'none' }} />
              </label>
              <button type="button" className="ui-btn ui-btn-sm" onClick={handleExportYaml}>
                Export profile.yaml
              </button>
              <label className="ui-btn ui-btn-sm">
                Import profile.yaml
                <input type="file" accept=".yaml,.yml,text/yaml,text/plain" onChange={handleImportYaml} style={{ display: 'none' }} />
              </label>
            </div>
            <p className="ui-subtle" style={{ marginTop: 8 }}>To delete everything, go to Settings.</p>
          </details>
        </div>
      )}
    </div>
  );
};
