/**
 * @fileoverview Candidate profile summary, editor, and data sovereignty manager for Side Panel.
 *
 * Enforces candidate data sovereignty (ADR-0001, ADR-0004):
 * - Direct local profile editing
 * - One-click JSON backup export
 * - Validated backup restore
 * - Local data purge
 */

import React, { useState } from 'react';
import type { CandidateProfileSummary, GetCandidateProfileResponse, SaveCandidateProfileResponse, ExportBackupResponse, ImportBackupResponse, PurgeAllDataResponse } from '../../messages/contracts.js';
import { sendToBackground } from '../../messages/bridge.js';
import {
  createEmptyProfile,
  createSkillId,
  normalizeSkillName,
  type CandidateProfile,
  type CandidateSkill,
} from '@applykit/domain';

interface ProfileSummaryProps {
  profile: CandidateProfileSummary | null;
  loading: boolean;
  onProfileUpdated: () => void;
}

export const ProfileSummary: React.FC<ProfileSummaryProps> = ({
  profile,
  loading,
  onProfileUpdated,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editHeadline, setEditHeadline] = useState('');
  const [editSkills, setEditSkills] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const startEdit = async () => {
    setActionStatus(null);
    try {
      const res = await sendToBackground<
        { type: 'GET_CANDIDATE_PROFILE' },
        GetCandidateProfileResponse
      >({ type: 'GET_CANDIDATE_PROFILE' });

      if (res && res.profile) {
        setEditFirstName(res.profile.identity.legalFirstName || '');
        setEditLastName(res.profile.identity.legalLastName || '');
        setEditEmail(res.profile.identity.email || '');
        setEditHeadline(res.profile.professional.headline || '');
        setEditSkills(res.profile.skills.map((s) => s.name).join(', '));
      } else {
        setEditFirstName('');
        setEditLastName('');
        setEditEmail(profile?.email || '');
        setEditHeadline(profile?.headline || '');
        setEditSkills('');
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
      // Fetch existing profile or create empty baseline
      let baseProfile: CandidateProfile;
      const res = await sendToBackground<
        { type: 'GET_CANDIDATE_PROFILE' },
        GetCandidateProfileResponse
      >({ type: 'GET_CANDIDATE_PROFILE' });

      if (res && res.profile) {
        baseProfile = res.profile;
      } else {
        baseProfile = createEmptyProfile();
      }

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

      const updatedProfile: CandidateProfile = {
        ...baseProfile,
        identity: {
          ...baseProfile.identity,
          legalFirstName: editFirstName.trim(),
          legalLastName: editLastName.trim(),
          email: editEmail.trim(),
        },
        professional: {
          ...baseProfile.professional,
          headline: editHeadline.trim(),
        },
        skills: parsedSkills,
        updatedAt: new Date().toISOString(),
      };

      const saveRes = await sendToBackground<
        { type: 'SAVE_CANDIDATE_PROFILE'; profile: CandidateProfile },
        SaveCandidateProfileResponse
      >({ type: 'SAVE_CANDIDATE_PROFILE', profile: updatedProfile });

      if (saveRes && saveRes.success) {
        setIsEditing(false);
        setActionStatus('Profile successfully saved locally.');
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
        a.download = `applykit-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setActionStatus('Backup exported successfully.');
      } else {
        setActionStatus(`Export failed: ${res?.error || 'Unknown error'}`);
      }
    } catch (err) {
      setActionStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setActionStatus(null);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (!content) return;

      try {
        const res = await sendToBackground<
          { type: 'IMPORT_BACKUP'; jsonString: string },
          ImportBackupResponse
        >({ type: 'IMPORT_BACKUP', jsonString: content });

        if (res && res.success) {
          setActionStatus('Backup restored successfully.');
          onProfileUpdated();
        } else {
          setActionStatus(`Restore failed: ${res?.error || 'Invalid backup schema'}`);
        }
      } catch (err) {
        setActionStatus(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsText(file);
    // Reset file input value
    e.target.value = '';
  };

  const handlePurge = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to purge all local ApplyKit data? This will permanently wipe your profile, saved jobs, evidence graph, and credentials from this browser.'
    );
    if (!confirmed) return;

    setActionStatus(null);
    try {
      const res = await sendToBackground<
        { type: 'PURGE_ALL_DATA' },
        PurgeAllDataResponse
      >({ type: 'PURGE_ALL_DATA' });

      if (res && res.success) {
        setActionStatus('All local data wiped.');
        onProfileUpdated();
      } else {
        setActionStatus(`Purge error: ${res?.error || 'Unknown error'}`);
      }
    } catch (err) {
      setActionStatus(`Purge error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (loading) {
    return <div className="loading-spinner">Loading profile...</div>;
  }

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
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-input"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
              placeholder="e.g. jane.doe@example.com"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Headline</label>
            <input
              type="text"
              className="form-input"
              value={editHeadline}
              onChange={(e) => setEditHeadline(e.target.value)}
              placeholder="e.g. Senior Distributed Systems Engineer"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Skills (comma-separated)</label>
            <input
              type="text"
              className="form-input"
              value={editSkills}
              onChange={(e) => setEditSkills(e.target.value)}
              placeholder="e.g. Rust, PostgreSQL, Kubernetes, TypeScript"
            />
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
              <p className="profile-headline">{profile?.headline || 'Ready to configure profile'}</p>
              {profile?.email && <p className="profile-email">{profile.email}</p>}
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
                Edit Profile
              </button>
            </div>
          </div>

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
              <span className="stat-value">{profile?.claimsCount ?? 0}</span>
              <span className="stat-label">Evidence Claims</span>
            </div>
          </div>

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
              >
                Wipe Local Data
              </button>
            </div>
          </div>

          <div className="security-notice">
            <p className="security-notice-title">Evidence-Backed Guarantee</p>
            <p className="security-notice-text">
              ApplyKit matches strictly against your verified claims. Data is stored locally on this device.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
