import { describe, it, expect } from 'vitest';
import { resolveProfileValueForField } from '../form/canonical-fields.js';
import { parsePlainTextResume } from '../evidence/parser.js';
import { createProfileFromParsedResume } from '../evidence/decomposer.js';

describe('Work authorization answers', () => {
  const { profile } = createProfileFromParsedResume(parsePlainTextResume('Jane Doe\njane@example.com\nLagos, Nigeria\n'));

  it('leaves legal questions blank until the candidate answers them', () => {
    expect(resolveProfileValueForField(profile, 'visa_sponsorship')).toBeUndefined();
    expect(resolveProfileValueForField(profile, 'work_authorization')).toBeUndefined();
  });

  it('fills them once the candidate has confirmed', () => {
    const confirmed = {
      ...profile,
      identity: {
        ...profile.identity,
        workAuthorization: { ...profile.identity.workAuthorization, requiresSponsorship: true, confirmedByCandidate: true },
      },
    };
    expect(resolveProfileValueForField(confirmed, 'visa_sponsorship')).toBe('Yes');
  });
});
