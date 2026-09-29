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
  PurgeAllDataResponse,
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
  type SavedAnswer,
} from '@applykit/domain';

interface ProfileSummaryProps {
  readonly profile: CandidateProfileSummary | null;
  readonly loading: boolean;
  readonly onProfileUpdated: () => void;
  readonly onPurged?: () => void;
}

/**
 * Candidate profile management and review component.
 */
export const ProfileSummary: React.FC<ProfileSummaryProps> = ({
  profile,
  loading,
  onProfileUpdated,
  onPurged,
}) => {
  const [fullProfile, setFullProfile] = useState<CandidateProfile | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Identity Form States
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editHeadline, setEditHeadline] = useState('');

  // Location Form States
  const [editCity, setEditCity] = useState('');
  const [editStateOrProvince, setEditStateOrProvince] = useState('');
  const [editCountry, setEditCountry] = useState('');
  const [editAddressLine1, setEditAddressLine1] = useState('');
  const [editPostalCode, setEditPostalCode] = useState('');

  // Work Authorization Form States
  const [editIsAuthorized, setEditIsAuthorized] = useState(true);
  const [editRequiresSponsorship, setEditRequiresSponsorship] = useState(false);
  const [editVisaStatus, setEditVisaStatus] = useState('');

  // Compensation & Availability Form States
  const [editSalaryMin, setEditSalaryMin] = useState<number | string>('');
  const [editCurrency, setEditCurrency] = useState('USD');
  const [editNoticePeriodDays, setEditNoticePeriodDays] = useState<number | string>('');
  const [editEarliestStartDate, setEditEarliestStartDate] = useState('');

  // Links Form States
  const [editLinkedin, setEditLinkedin] = useState('');
  const [editGithub, setEditGithub] = useState('');
  const [editPortfolio, setEditPortfolio] = useState('');

  // Skills
  const [editSkills, setEditSkills] = useState('');

  // Master Resume Hub State
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [newResumeText, setNewResumeText] = useState('');
  const [newResumeFileName, setNewResumeFileName] = useState('');
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

    setEditCity(p.identity.location?.city || '');
    setEditStateOrProvince(p.identity.location?.stateOrProvince || '');
    setEditCountry(p.identity.location?.country || '');
    setEditAddressLine1(p.identity.location?.addressLine1 || '');
    setEditPostalCode(p.identity.location?.postalCode || '');

    setEditIsAuthorized(p.identity.workAuthorization?.isAuthorizedInCountry ?? true);
    setEditRequiresSponsorship(p.identity.workAuthorization?.requiresSponsorship ?? false);
    setEditVisaStatus(p.identity.workAuthorization?.visaStatus || '');

    setEditSalaryMin(p.professional.compensationExpectation?.targetSalaryMin ?? '');
    setEditCurrency(p.professional.compensationExpectation?.currency || 'USD');
    setEditNoticePeriodDays(p.professional.noticePeriodDays ?? '');
    setEditEarliestStartDate(p.professional.earliestStartDate || '');

    setEditLinkedin(p.links?.linkedin || '');
    setEditGithub(p.links?.github || '');
    setEditPortfolio(p.links?.portfolio || p.links?.personalBlog || '');

    setEditSkills(p.skills.map((s) => s.name).join(', '));
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

      // Parse comma-separated skills
      const skillNames = editSkills
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const parsedSkills: CandidateSkill[] = skillNames.map((name) => ({
        id: createSkillId(),
        name,
        normalizedName: normalizeSkillName(name),
        category: 'framework',
        proficiency: 'advanced',
        evidenceRefs: [],
      }));

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
            isAuthorizedInCountry: editIsAuthorized,
            requiresSponsorship: editRequiresSponsorship,
            visaStatus: editVisaStatus.trim() || undefined,
            authorizedCountries: editCountry.trim() ? [editCountry.trim()] : [],
          },
        },
        professional: {
          ...baseProfile.professional,
          headline: editHeadline.trim(),
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
        setActionStatus('Profile successfully updated.');
        onProfileUpdated();
      } else {
        setActionStatus(`Error saving profile: ${saveRes?.error || 'Unknown error'}`);
      }
    } catch (err) {
      setActionStatus(`Error saving profile: ${err instanceof Error ? err.message : String(err)}`);
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
        setActionStatus('Saved answer removed from profile.');
        onProfileUpdated();
      }
    } catch (err) {
      setActionStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
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
        setActionStatus('Backup JSON downloaded successfully.');
      } else {
        setActionStatus(`Export error: ${res?.error || 'Failed to export backup'}`);
      }
    } catch (err) {
      setActionStatus(`Export error: ${err instanceof Error ? err.message : String(err)}`);
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
          setActionStatus('Backup restored successfully.');
          await loadFullProfile();
          onProfileUpdated();
        } else {
          setActionStatus(`Import failed: ${res?.error || 'Malformed backup file'}`);
        }
      } catch (err) {
        setActionStatus(`Import error: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handlePurge = async () => {
    if (
      !window.confirm(
        'Are you sure you want to permanently delete all local candidate data, evidence, and configured keys? This cannot be undone.'
      )
    ) {
      return;
    }

    setActionStatus(null);
    try {
      const res = await sendToBackground<
        { type: 'PURGE_ALL_DATA' },
        PurgeAllDataResponse
      >({ type: 'PURGE_ALL_DATA' });

      if (res && res.success) {
        setActionStatus('All local candidate data wiped.');
        onProfileUpdated();
        onPurged?.();
      } else {
        setActionStatus(`Purge error: ${res?.error || 'Unknown error'}`);
      }
    } catch (err) {
      setActionStatus(`Purge error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleResumeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNewResumeFileName(file.name);
    const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';

    try {
      if (isPdf) {
        const buffer = await file.arrayBuffer();
        const bootstrapped = await bootstrapProfileFromResume(buffer, file.name);
        setNewResumeText(bootstrapped.rawText);
      } else {
        const text = await file.text();
        setNewResumeText(text);
      }
    } catch (err) {
      setActionStatus(`Failed to read resume file: ${err instanceof Error ? err.message : String(err)}`);
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
          `✓ Master Resume re-indexed! Decomposed ${res.evidenceCount ?? 0} evidence items & ${res.claimsCount ?? 0} verified claims.`
        );
        setShowResumeModal(false);
        setNewResumeText('');
        setNewResumeFileName('');
        await loadFullProfile();
        onProfileUpdated();
      } else {
        setActionStatus(`Resume update failed: ${res?.error || 'Unknown error'}`);
      }
    } catch (err) {
      setActionStatus(`Resume ingest error: ${err instanceof Error ? err.message : String(err)}`);
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
      {actionStatus && (
        <div className="status-banner">
          <p className="status-text">{actionStatus}</p>
        </div>
      )}

      {isEditing ? (
        <form onSubmit={handleSave} className="profile-edit-form">
          <h3 className="section-title">Edit Candidate Profile</h3>

          {/* Section: Basic Identity */}
          <div className="form-section-card">
            <h4 className="form-section-title">👤 Personal Identity & Contact</h4>
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
          </div>

          {/* Section: Location */}
          <div className="form-section-card">
            <h4 className="form-section-title">📍 Location & Residency</h4>
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
            <h4 className="form-section-title">🛡️ Work Authorization</h4>
            <div className="form-checkbox-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={editIsAuthorized}
                  onChange={(e) => setEditIsAuthorized(e.target.checked)}
                />
                Legally authorized to work in resident country
              </label>
            </div>
            <div className="form-checkbox-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={editRequiresSponsorship}
                  onChange={(e) => setEditRequiresSponsorship(e.target.checked)}
                />
                Requires visa sponsorship now or in the future
              </label>
            </div>
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
            <h4 className="form-section-title">💰 Compensation & Availability</h4>
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
            <h4 className="form-section-title">🔗 Professional Web Links</h4>
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
            <h4 className="form-section-title">⚡ Skills</h4>
            <div className="form-group">
              <label className="form-label">Skills (comma-separated)</label>
              <input
                type="text"
                className="form-input"
                value={editSkills}
                onChange={(e) => setEditSkills(e.target.value)}
                placeholder="e.g. TypeScript, React, Rust, PostgreSQL, Docker"
              />
            </div>
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
        <div className="profile-summary-card">
          <div className="profile-header">
            <div>
              <h2 className="profile-name">{profile?.fullName || 'Candidate'}</h2>
              <p className="profile-headline">{profile?.headline || 'No headline set'}</p>
              {profile?.email && <p className="profile-email">✉️ {profile.email}</p>}
              {fullProfile?.identity?.phone && (
                <p className="profile-email">📞 {fullProfile.identity.phone}</p>
              )}
              {fullProfile?.identity?.location && (
                <p className="profile-email">
                  📍 {[
                    fullProfile.identity.location.city,
                    fullProfile.identity.location.stateOrProvince,
                    fullProfile.identity.location.country,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              )}
            </div>
            <div className="profile-header-actions">
              <span
                className={`badge ${
                  profile?.isComplete ? 'badge-success' : 'badge-warning'
                }`}
              >
                {profile?.isComplete ? 'Verified Profile' : 'Setup Incomplete'}
              </span>
              <button
                type="button"
                className="btn btn-small btn-secondary"
                onClick={startEdit}
                style={{ marginTop: '0.5rem' }}
              >
                ✏️ Edit Profile
              </button>
            </div>
          </div>

          {/* Key Attributes Overview */}
          <div className="profile-stats-grid">
            <div className="stat-card">
              <span className="stat-value">{profile?.skillsCount ?? 0}</span>
              <span className="stat-label">Verified Skills</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{profile?.experienceCount ?? 0}</span>
              <span className="stat-label">Positions</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{savedAnswersList.length}</span>
              <span className="stat-label">Saved Answers</span>
            </div>
          </div>

          {/* Master Resume & Evidence Grounding Hub */}
          {(() => {
            const masterDoc = fullProfile?.documents?.find(
              (d) => d.isPrimaryResume || d.documentType === 'resume'
            );
            return (
              <div
                className="master-resume-card"
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '8px',
                  padding: '12px',
                  marginTop: '10px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '20px' }}>📄</span>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
                        Master Resume & Grounded Evidence
                      </h4>
                      <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#94a3b8' }}>
                        {masterDoc
                          ? `${masterDoc.fileName} • ${Math.max(1, Math.round(masterDoc.byteSize / 1024))} KB • Evidence-grounded`
                          : 'No master resume attached'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-small btn-secondary"
                    onClick={() => setShowResumeModal(!showResumeModal)}
                    style={{ fontSize: '11px' }}
                  >
                    {showResumeModal ? 'Close' : (masterDoc ? '🔄 Replace Resume' : '➕ Upload Resume')}
                  </button>
                </div>

                {showResumeModal && (
                  <div
                    style={{
                      marginTop: '12px',
                      paddingTop: '12px',
                      borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <label style={{ fontSize: '11px', fontWeight: 600, color: '#cbd5e1' }}>
                      Upload New Resume (.pdf, .png, .jpg, .txt, .md, .json) or Paste Below:
                    </label>
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.text,.json,application/pdf,image/*"
                      onChange={handleResumeUpload}
                      style={{ fontSize: '11px', color: '#94a3b8' }}
                    />
                    <textarea
                      className="form-textarea"
                      rows={5}
                      placeholder="Or paste full plain-text resume here..."
                      value={newResumeText}
                      onChange={(e) => setNewResumeText(e.target.value)}
                      style={{ fontSize: '11px' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                      <button
                        type="button"
                        className="btn btn-small btn-secondary"
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
                        className="btn btn-small btn-primary"
                        onClick={handleApplyResumeUpdate}
                        disabled={isIngestingResume || !newResumeText.trim()}
                      >
                        {isIngestingResume ? 'Re-indexing...' : '⚡ Re-Index Evidence Graph'}
                      </button>
                    </div>
                  </div>
                )}

                {masterDoc?.extractedText && !showResumeModal && (
                  <div style={{ marginTop: '8px' }}>
                    <details style={{ fontSize: '11px', color: '#cbd5e1' }}>
                      <summary style={{ cursor: 'pointer', color: '#60a5fa' }}>
                        View Extracted Resume Text ({masterDoc.extractedText.split(/\s+/).length} words)
                      </summary>
                      <pre
                        style={{
                          marginTop: '6px',
                          padding: '8px',
                          background: 'rgba(0, 0, 0, 0.3)',
                          borderRadius: '4px',
                          maxHeight: '140px',
                          overflowY: 'auto',
                          fontSize: '11px',
                          lineHeight: '1.4',
                          whiteSpace: 'pre-wrap',
                          color: '#e2e8f0',
                        }}
                      >
                        {masterDoc.extractedText}
                      </pre>
                    </details>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Work Authorization & Compensation Badges */}
          <div className="profile-details-strip">
            <div className="detail-item">
              <span className="detail-label">Work Auth:</span>
              <span className="detail-val">
                {fullProfile?.identity?.workAuthorization?.isAuthorizedInCountry ? '✅ Authorized' : '❌ Not Authorized'}
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Sponsorship:</span>
              <span className="detail-val">
                {fullProfile?.identity?.workAuthorization?.requiresSponsorship ? '⚠️ Needed' : '✅ Not Needed'}
              </span>
            </div>
            {fullProfile?.professional?.compensationExpectation?.targetSalaryMin && (
              <div className="detail-item">
                <span className="detail-label">Target Salary:</span>
                <span className="detail-val">
                  {fullProfile.professional.compensationExpectation.currency || 'USD'} {fullProfile.professional.compensationExpectation.targetSalaryMin.toLocaleString()}
                </span>
              </div>
            )}
            {fullProfile?.professional?.noticePeriodDays != null && (
              <div className="detail-item">
                <span className="detail-label">Notice:</span>
                <span className="detail-val">
                  {fullProfile.professional.noticePeriodDays === 0 ? 'Immediate' : `${fullProfile.professional.noticePeriodDays} days`}
                </span>
              </div>
            )}
          </div>

          {/* Links Row */}
          {(fullProfile?.links?.linkedin || fullProfile?.links?.github || fullProfile?.links?.portfolio) && (
            <div className="profile-links-row">
              {fullProfile.links.linkedin && (
                <a href={fullProfile.links.linkedin} target="_blank" rel="noreferrer" className="profile-link-badge">
                  🔗 LinkedIn
                </a>
              )}
              {fullProfile.links.github && (
                <a href={fullProfile.links.github} target="_blank" rel="noreferrer" className="profile-link-badge">
                  💻 GitHub
                </a>
              )}
              {fullProfile.links.portfolio && (
                <a href={fullProfile.links.portfolio} target="_blank" rel="noreferrer" className="profile-link-badge">
                  🌐 Portfolio
                </a>
              )}
            </div>
          )}

          {/* Reusable Saved Answers Section */}
          <div className="saved-answers-section">
            <h4 className="data-sovereignty-title">
              ⚡ Verified Saved Answers ({savedAnswersList.length})
            </h4>
            <p className="saved-answers-desc">
              These answers resolve automatically in 0ms without hitting external AI or requiring API keys.
            </p>

            {savedAnswersList.length === 0 ? (
              <p className="no-saved-answers-text">
                No custom saved answers yet. Use the ⚡ Instant Q&A Copilot to generate and save answers.
              </p>
            ) : (
              <div className="saved-answers-list">
                {savedAnswersList.map((ans) => (
                  <div key={ans.id} className="saved-answer-card">
                    <div className="saved-answer-header">
                      <span className="saved-answer-pattern">
                        {ans.promptPatterns[0] || ans.canonicalKey}
                      </span>
                      <button
                        type="button"
                        className="btn-delete-answer"
                        onClick={() => handleDeleteSavedAnswer(ans.id)}
                        title="Delete saved answer"
                      >
                        ✕
                      </button>
                    </div>
                    <p className="saved-answer-text">{ans.answerText}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Data Sovereignty & Factory Reset */}
          <div className="data-sovereignty-section">
            <h4 className="data-sovereignty-title">Data Sovereignty & Local Backup</h4>
            <div className="data-sovereignty-actions">
              <button
                type="button"
                className="btn btn-small btn-secondary"
                onClick={handleExport}
              >
                Export Backup (JSON)
              </button>
              <label className="btn btn-small btn-secondary file-upload-label">
                Import Backup
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImport}
                  style={{ display: 'none' }}
                />
              </label>
              <button
                type="button"
                className="btn btn-small btn-danger"
                onClick={handlePurge}
                title="Wipes all candidate profiles, evidence graph, and API credentials"
              >
                Factory Reset / Wipe All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
