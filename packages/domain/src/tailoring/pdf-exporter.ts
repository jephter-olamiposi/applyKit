import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font, renderToStream } from '@react-pdf/renderer';
import type { TailoredCoverLetter } from './tailoring-types.js';
import type { TailoredResume } from './tailoring-types.js';

Font.register({
  family: 'Helvetica',
  src: 'Helvetica',
});

const coverLetterStyles = StyleSheet.create({
  page: {
    padding: 50,
    fontFamily: 'Helvetica',
    fontSize: 11,
    lineHeight: 1.6,
    color: '#1a1a2e',
  },
  header: {
    marginBottom: 24,
  },
  date: {
    marginBottom: 12,
    fontSize: 10,
    color: '#666',
  },
  recipient: {
    marginBottom: 24,
  },
  greeting: {
    marginBottom: 16,
  },
  paragraph: {
    marginBottom: 14,
    textAlign: 'justify',
  },
  closing: {
    marginTop: 24,
  },
});

const resumeStyles = StyleSheet.create({
  page: {
    padding: 50,
    fontFamily: 'Helvetica',
    fontSize: 10,
    lineHeight: 1.5,
    color: '#1a1a2e',
  },
  name: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  title: {
    fontSize: 12,
    color: '#444',
    marginBottom: 4,
  },
  contact: {
    fontSize: 9,
    color: '#666',
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    paddingBottom: 2,
  },
  experience: {
    marginBottom: 12,
  },
  expHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  expTitle: {
    fontWeight: 'bold',
  },
  expCompany: {
    color: '#444',
  },
  expDates: {
    fontSize: 9,
    color: '#888',
  },
  bullet: {
    marginLeft: 12,
    marginBottom: 3,
  },
  bulletText: {
    fontSize: 10,
  },
  skills: {
    marginTop: 8,
  },
  skillTag: {
    fontSize: 9,
    backgroundColor: '#f0f0f0',
    padding: 2,
    marginRight: 4,
    marginBottom: 4,
    borderRadius: 3,
  },
  project: {
    marginBottom: 8,
  },
  projectTitle: {
    fontWeight: 'bold',
    fontSize: 10,
  },
  projectTech: {
    fontSize: 9,
    color: '#666',
    marginBottom: 2,
  },
});

function formatDate(isoString?: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  } catch {
    return isoString;
  }
}

function renderCoverLetterParagraph(text: string) {
  return React.createElement(Text, { style: coverLetterStyles.paragraph },
    text.split('\n').map((line, i) => (
      React.createElement(Text, { key: i }, line, React.createElement(Text, { style: { marginBottom: 4 } }))
    ))
  );
}

function buildCoverLetterDocument(letter: TailoredCoverLetter) {
  const formatRecipient = (recipient: string) => {
    const lines = recipient.split('\n').map(l => l.trim()).filter(Boolean);
    return lines.map(l => React.createElement(Text, { key: l }, l));
  };

  return React.createElement(Document, {},
    React.createElement(Page, { size: 'LETTER', style: coverLetterStyles.page },
      React.createElement(View, { style: coverLetterStyles.header },
        React.createElement(Text, { style: coverLetterStyles.date }, new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })),
        React.createElement(View, { style: coverLetterStyles.recipient }, formatRecipient(letter.companyName))
      ),
      React.createElement(Text, { style: coverLetterStyles.greeting }, 'Dear Hiring Team,'),
      renderCoverLetterParagraph(letter.openingParagraph),
      letter.bodyParagraphs.map((p, i) => (
        React.createElement(Text, { key: i, style: coverLetterStyles.paragraph }, p.paragraphText)
      )),
      React.createElement(View, { style: coverLetterStyles.closing },
        letter.closingParagraph.split('\n').map((line, i) => (
          React.createElement(Text, { key: i }, line)
        ))
      )
    )
  );
}

function buildResumeDocument(resume: TailoredResume) {
  const formatDate = (isoString?: string): string => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    } catch {
      return isoString;
    }
  };

  return React.createElement(Document, {},
    React.createElement(Page, { size: 'LETTER', style: resumeStyles.page },
      React.createElement(Text, { style: resumeStyles.name }, resume.targetJobTitle),
      React.createElement(Text, { style: resumeStyles.title }, resume.companyName),
      React.createElement(View, { style: resumeStyles.contact },
        React.createElement(Text, {}, `Tailored Resume • ${new Date().toLocaleDateString()}`)
      ),

      React.createElement(Text, { style: resumeStyles.sectionTitle }, 'PROFESSIONAL SUMMARY'),
      React.createElement(Text, { style: coverLetterStyles.paragraph }, resume.tailoredSummary),

      React.createElement(Text, { style: resumeStyles.sectionTitle }, 'EXPERIENCE'),
      resume.experiences.map((exp, i) =>
        React.createElement(View, { key: i, style: resumeStyles.experience },
          React.createElement(View, { style: resumeStyles.expHeader },
            React.createElement(Text, { style: resumeStyles.expTitle }, exp.title),
            React.createElement(Text, { style: resumeStyles.expCompany }, exp.company)
          ),
          React.createElement(Text, { style: resumeStyles.expDates },
            `${formatDate(exp.startDate)} - ${exp.isCurrent ? 'Present' : formatDate(exp.endDate)}`
          ),
          exp.rankedHighlights.map((h, j) =>
            React.createElement(Text, { key: j, style: resumeStyles.bullet },
              React.createElement(Text, { style: resumeStyles.bulletText }, `• ${h.text}`)
            )
          )
        )
      ),

      React.createElement(Text, { style: resumeStyles.sectionTitle }, 'PROJECTS'),
      resume.projects.map((proj, i) =>
        React.createElement(View, { key: i, style: resumeStyles.project },
          React.createElement(Text, { style: resumeStyles.projectTitle }, proj.title),
          React.createElement(Text, { style: resumeStyles.projectTech }, proj.technologiesUsed.join(', ')),
          proj.rankedHighlights.map((h, j) =>
            React.createElement(Text, { key: j, style: [resumeStyles.bullet, resumeStyles.bulletText] }, `• ${h.text}`)
          )
        )
      ),

      React.createElement(Text, { style: resumeStyles.sectionTitle }, 'SKILLS'),
      React.createElement(View, { style: resumeStyles.skills },
        [
          ...resume.skills.matchedRequired.map(s => React.createElement(Text, { key: s, style: resumeStyles.skillTag }, s)),
          ...resume.skills.matchedPreferred.map(s => React.createElement(Text, { key: s, style: resumeStyles.skillTag }, s)),
          ...resume.skills.additionalSkills.map(s => React.createElement(Text, { key: s, style: resumeStyles.skillTag }, s)),
        ]
      )
    )
  );
}

export async function generateCoverLetterPdfBlob(letter: TailoredCoverLetter): Promise<Blob> {
  const stream = await renderToStream(buildCoverLetterDocument(letter));
  
  return new Promise<Blob>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    stream.on('data', (chunk: Uint8Array) => chunks.push(chunk));
    stream.on('end', () => resolve(new Blob(chunks, { type: 'application/pdf' })));
    stream.on('error', reject);
  });
}

export async function generateResumePdfBlob(resume: TailoredResume): Promise<Blob> {
  const stream = await renderToStream(buildResumeDocument(resume));
  
  return new Promise<Blob>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    stream.on('data', (chunk: Uint8Array) => chunks.push(chunk));
    stream.on('end', () => resolve(new Blob(chunks, { type: 'application/pdf' })));
    stream.on('error', reject);
  });
}