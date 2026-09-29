import { describe, it, expect } from 'vitest';
import {
  generateResumePdfBlob,
  generateCoverLetterPdfBlob,
  tailorCandidateResume,
  generateGroundedCoverLetter,
  createEmptyProfile,
  createProfileId,
  createExperienceId,
  createProjectId,
  createSkillId,
  createJobPostingId,
  createRequirementId,
  normalizeSkillName,
  buildEvidenceGraph,
  type JobPosting,
  type CandidateProfile,
} from '../index.js';

describe('PDF Exporter & Canonical Role Tailoring Test Suite', () => {
  // Canonical Distributed Systems Engineer Job Specification
  const canonicalJob: JobPosting = {
    id: createJobPostingId('canonical_4581200'),
    url: 'https://canonical.com/careers/4581200',
    title: 'Distributed Systems Engineer',
    companyName: 'Canonical',
    location: 'Home based - Worldwide (EMEA)',
    workplaceType: 'remote',
    employmentType: 'full_time',
    parsedAt: '2026-09-28T18:00:00Z',
    rawDescription:
      'Canonical is looking for a Distributed Systems Engineer to design, architect, and build streaming data services using Go and Python for the Snappy/Ubuntu IoT ecosystem.',
    metadata: {
      requisitionId: '981',
      source: 'canonical_careers',
    },
    requirements: [
      {
        id: createRequirementId('req_go_python'),
        rawText: 'Design and architect scalable backend services and streaming pipelines using Go or Python',
        normalizedSkillOrCompetency: 'go',
        category: 'technical_skill',
        importance: 'required',
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId('req_distributed_systems'),
        rawText: 'Deep expertise in distributed systems and high-throughput low-latency data pipelines',
        normalizedSkillOrCompetency: 'distributed systems',
        category: 'technical_skill',
        importance: 'required',
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId('req_streaming'),
        rawText: 'Proven expertise with data streaming technologies including MQTT, Kafka, or RabbitMQ',
        normalizedSkillOrCompetency: 'kafka',
        category: 'technical_skill',
        importance: 'required',
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId('req_opentelemetry'),
        rawText: 'Observability tools and telemetry pipelines (OpenTelemetry)',
        normalizedSkillOrCompetency: 'opentelemetry',
        category: 'technical_skill',
        importance: 'preferred',
        isRequired: false,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId('req_ubuntu_linux'),
        rawText: 'Familiarity with Ubuntu and Linux as development and deployment platform',
        normalizedSkillOrCompetency: 'linux',
        category: 'technical_skill',
        importance: 'preferred',
        isRequired: false,
        matchedEvidenceIds: [],
      },
    ],
  };

  // Synthetic Verified Distributed Systems Candidate Profile (No personal PII)
  const candidateProfile: CandidateProfile = {
    ...createEmptyProfile(createProfileId('prof_dist_engineer')),
    identity: {
      legalFirstName: 'Morgan',
      legalLastName: 'Reed',
      email: 'morgan.reed@example.com',
      phone: '+44 20 7946 0991',
      location: { city: 'London', stateOrProvince: 'Greater London', country: 'United Kingdom' },
      workAuthorization: {
        isAuthorizedInCountry: true,
        requiresSponsorship: false,
        authorizedCountries: ['United Kingdom', 'European Union'],
      },
    },
    professional: {
      headline: 'Principal Distributed Systems & Cloud Infrastructure Engineer',
      summary: 'Specialist in high-throughput streaming architectures, distributed consensus, and IoT telemetry.',
      currentTitle: 'Senior Distributed Systems Engineer',
      totalYearsOfExperience: 8,
      primaryRoles: ['Distributed Systems Engineer', 'Backend Infrastructure Architect'],
      targetRoles: ['Distributed Systems Engineer'],
      preferredLocations: ['Remote (EMEA)'],
      workplacePreference: 'remote',
      isOpenToRelocation: false,
    },
    links: {
      linkedin: 'https://linkedin.com/in/morgan-reed-synthetic',
      github: 'https://github.com/morgan-reed-synthetic',
      portfolio: 'https://morganreed-synthetic.dev',
      customLinks: [],
    },
    skills: [
      { id: createSkillId(), name: 'Go', normalizedName: normalizeSkillName('Go'), category: 'language', proficiency: 'expert', yearsOfExperience: 6, evidenceRefs: [] },
      { id: createSkillId(), name: 'Python', normalizedName: normalizeSkillName('Python'), category: 'language', proficiency: 'expert', yearsOfExperience: 7, evidenceRefs: [] },
      { id: createSkillId(), name: 'Kafka', normalizedName: normalizeSkillName('Kafka'), category: 'cloud_infrastructure', proficiency: 'expert', yearsOfExperience: 5, evidenceRefs: [] },
      { id: createSkillId(), name: 'Distributed Systems', normalizedName: normalizeSkillName('Distributed Systems'), category: 'architecture_pattern', proficiency: 'expert', yearsOfExperience: 8, evidenceRefs: [] },
      { id: createSkillId(), name: 'Linux', normalizedName: normalizeSkillName('Linux'), category: 'devops_tool', proficiency: 'expert', yearsOfExperience: 8, evidenceRefs: [] },
      { id: createSkillId(), name: 'OpenTelemetry', normalizedName: normalizeSkillName('OpenTelemetry'), category: 'devops_tool', proficiency: 'advanced', yearsOfExperience: 3, evidenceRefs: [] },
      { id: createSkillId(), name: 'MQTT', normalizedName: normalizeSkillName('MQTT'), category: 'cloud_infrastructure', proficiency: 'advanced', yearsOfExperience: 4, evidenceRefs: [] },
      { id: createSkillId(), name: 'Docker', normalizedName: normalizeSkillName('Docker'), category: 'devops_tool', proficiency: 'expert', yearsOfExperience: 6, evidenceRefs: [] },
      { id: createSkillId(), name: 'Kubernetes', normalizedName: normalizeSkillName('Kubernetes'), category: 'cloud_infrastructure', proficiency: 'advanced', yearsOfExperience: 5, evidenceRefs: [] },
    ],
    experiences: [
      {
        id: createExperienceId('exp_cloud_telemetry'),
        company: 'Apex Telemetry Systems',
        title: 'Senior Distributed Systems Architect',
        employmentType: 'full_time',
        location: 'Remote',
        isRemote: true,
        startDate: '2022-01-01',
        isCurrent: true,
        description: 'Led distributed telemetry data plane processing over 250,000 events/second.',
        highlights: [
          'Architected real-time streaming pipeline using Go and Apache Kafka processing 250k events/second with sub-15ms p99 latency.',
          'Integrated OpenTelemetry across 45 microservices running on Ubuntu Linux, improving MTTR by 42%.',
          'Designed decentralized MQTT broker topology reducing edge device disconnection rates by 68%.',
          'Enforced end-to-end TLS 1.3 encryption and mutual certificate authentication for 100k connected IoT nodes.',
        ],
        technologiesUsed: ['Go', 'Kafka', 'MQTT', 'OpenTelemetry', 'Ubuntu Linux', 'Docker'],
        evidenceRefs: [],
      },
      {
        id: createExperienceId('exp_cloud_backend'),
        company: 'Global Cloud Platform Corp',
        title: 'Distributed Systems Engineer',
        employmentType: 'full_time',
        location: 'London, UK',
        isRemote: false,
        startDate: '2018-06-01',
        endDate: '2021-12-31',
        isCurrent: false,
        description: 'Engineered multi-region consensus and reliable distributed data stores.',
        highlights: [
          'Engineered distributed Raft-based consensus metadata store in Python and Go, achieving 99.999% availability.',
          'Optimized Linux kernel networking socket parameters to handle 50,000 concurrent persistent TCP connections per host.',
          'Automated CI/CD validation on Ubuntu Server, cutting release deployment turnaround from 4 hours to 18 minutes.',
        ],
        technologiesUsed: ['Python', 'Go', 'Linux', 'PostgreSQL', 'Consensus'],
        evidenceRefs: [],
      },
    ],
    projects: [
      {
        id: createProjectId('proj_distributed_broker'),
        title: 'OpenEdge Telemetry Broker',
        role: 'Creator & Lead Maintainer',
        description: 'High-throughput lightweight MQTT / Kafka bridge tailored for resource-constrained edge devices.',
        url: 'https://openedge-telemetry.synthetic.org',
        repoUrl: 'https://github.com/morgan-reed-synthetic/openedge-telemetry',
        technologiesUsed: ['Go', 'Kafka', 'MQTT', 'Linux', 'eBPF'],
        highlights: [
          'Engineered lightweight zero-allocation binary protocol parser in Go capable of 800k msgs/sec on single core.',
          'Published production Docker container for Ubuntu Core with automated testing on ARM64 and x86_64 architectures.',
        ],
        evidenceRefs: [],
      },
    ],
    education: [
      {
        id: 'edu_1' as any,
        institution: 'Imperial College London',
        degree: 'Master of Science',
        fieldOfStudy: 'Advanced Computing (Distributed Systems)',
        startDate: '2016-09-01',
        endDate: '2017-06-30',
        isCompleted: true,
        gpa: 'Distinction',
        honors: ['Dean\'s List for Excellence in Systems Engineering'],
        relevantCoursework: ['Distributed Algorithms', 'Fault-Tolerant Systems', 'Network Security'],
        activities: [],
        evidenceRefs: [],
      },
    ],
    documents: [
      {
        id: 'doc_cert_cka' as any,
        fileName: 'Certified-Kubernetes-Administrator-CKA.pdf',
        documentType: 'certification_credential',
        storageKey: 'storage_cka_cert',
        mimeType: 'application/pdf',
        byteSize: 102400,
        sha256Checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        uploadedAt: '2025-05-15T12:00:00Z',
      },
    ],
  };

  const emptyGraph = buildEvidenceGraph([], []);

  it('tailors candidate resume accurately for Canonical Distributed Systems Engineer role', () => {
    const tailored = tailorCandidateResume(canonicalJob, candidateProfile, emptyGraph, {
      templateId: 'modern',
      onePageFit: false,
    });

    expect(tailored.targetJobTitle).toBe('Distributed Systems Engineer');
    expect(tailored.companyName).toBe('Canonical');
    expect(tailored.experiences.length).toBe(2);
    expect(tailored.projects.length).toBe(1);

    // Verify skills matching
    expect(tailored.skills.matchedRequired).toContain('Go');
    expect(tailored.skills.matchedRequired).toContain('Distributed Systems');
    expect(tailored.skills.matchedRequired).toContain('Kafka');

    // Verify quality audit
    expect(tailored.qualityAudit).toBeDefined();
    expect(tailored.qualityAudit?.overallScore).toBeGreaterThanOrEqual(80);
  });

  it('generates a valid, readable PDF blob with magic %PDF header for all 4 templates', async () => {
    const tailored = tailorCandidateResume(canonicalJob, candidateProfile, emptyGraph, {
      onePageFit: false,
    });

    const templates = ['modern', 'classic', 'minimalist', 'compact'] as const;

    for (const templateId of templates) {
      const pdfBlob = await generateResumePdfBlob(tailored, candidateProfile, {
        templateId,
        onePageFit: false,
      });

      expect(pdfBlob).toBeDefined();
      expect(pdfBlob.size).toBeGreaterThan(1000);
      expect(pdfBlob.type).toBe('application/pdf');

      // Verify %PDF- magic bytes
      const arrayBuffer = await pdfBlob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const header = String.fromCharCode(...bytes.slice(0, 5));
      expect(header).toBe('%PDF-');
    }
  });

  it('renders multi-page comprehensive resume including education, projects, and certifications', async () => {
    const tailored = tailorCandidateResume(canonicalJob, candidateProfile, emptyGraph, {
      onePageFit: false,
    });

    const fullBlob = await generateResumePdfBlob(tailored, candidateProfile, {
      templateId: 'modern',
      onePageFit: false,
    });

    expect(fullBlob.size).toBeGreaterThan(2000);
  });

  it('renders compact 1-page resume when onePageFit is explicitly enabled', async () => {
    const tailoredOnePage = tailorCandidateResume(canonicalJob, candidateProfile, emptyGraph, {
      onePageFit: true,
      templateId: 'compact',
    });

    const compactBlob = await generateResumePdfBlob(tailoredOnePage, candidateProfile, {
      templateId: 'compact',
      onePageFit: true,
    });

    expect(compactBlob.size).toBeGreaterThan(1000);
    expect(compactBlob.type).toBe('application/pdf');
  });

  it('generates tailored cover letter and exports to valid PDF blob', async () => {
    const letter = generateGroundedCoverLetter(canonicalJob, candidateProfile, emptyGraph, {
      tone: 'technical',
    });

    expect(letter.targetJobTitle).toBe('Distributed Systems Engineer');
    expect(letter.companyName).toBe('Canonical');

    const letterBlob = await generateCoverLetterPdfBlob(letter);
    expect(letterBlob).toBeDefined();
    expect(letterBlob.size).toBeGreaterThan(1000);
    expect(letterBlob.type).toBe('application/pdf');

    const buffer = await letterBlob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const header = String.fromCharCode(...bytes.slice(0, 5));
    expect(header).toBe('%PDF-');
  });

  it('renders tailored resume with custom spacing density and neutral header options', async () => {
    const tailored = tailorCandidateResume(canonicalJob, candidateProfile, emptyGraph);

    // Tight density with neutral header (showTargetBadge: false)
    const tightBlob = await generateResumePdfBlob(tailored, candidateProfile, {
      templateId: 'modern',
      density: 'tight',
      showTargetBadge: false,
    });
    expect(tightBlob).toBeDefined();
    expect(tightBlob.size).toBeGreaterThan(1000);
    expect(tightBlob.type).toBe('application/pdf');

    // Relaxed density with explicit target badge
    const relaxedBlob = await generateResumePdfBlob(tailored, candidateProfile, {
      templateId: 'classic',
      density: 'relaxed',
      showTargetBadge: true,
    });
    expect(relaxedBlob).toBeDefined();
    expect(relaxedBlob.size).toBeGreaterThan(1000);
    expect(relaxedBlob.type).toBe('application/pdf');
  });
});
