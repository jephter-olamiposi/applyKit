/**
 * @fileoverview Deterministic job requirement extraction and normalization engine.
 *
 * Normalizes raw job posting text and HTML into categorized, prioritized Requirement models
 * without relying on external AI calls by default.
 */

import {
  type Requirement,
  type RequirementCategory,
  type Importance,
  createRequirementId,
} from '@applykit/domain';

export interface NormalizedJobSections {
  readonly responsibilities: readonly string[];
  readonly requirements: readonly Requirement[];
}

/**
 * Extracts structured job sections (responsibilities and requirements) by parsing
 * semantic heading cues (e.g. "Responsibilities", "Qualifications", "Nice to Have").
 *
 * Distinguishes between required and preferred qualifications by tracking heading context,
 * ensuring accurate candidate gap analysis without hallucinations.
 */
export function extractStructuredSections(container: Element): NormalizedJobSections {
  const responsibilities: string[] = [];
  const requirements: Requirement[] = [];

  const headingSelector = 'h1, h2, h3, h4, h5, h6, .section-title, p > strong, p > b';
  const headings = Array.from(container.querySelectorAll(headingSelector));

  if (headings.length === 0) {
    const rawItems = extractListItems(container);
    return {
      responsibilities: [],
      requirements: normalizeRequirementsList(rawItems, 'required'),
    };
  }

  const processedLists = new Set<Element>();

  for (const heading of headings) {
    const headingText = heading.textContent?.trim() || '';
    if (!headingText) continue;

    let sectionType: 'responsibilities' | 'required' | 'preferred' | 'ignore' = 'ignore';

    if (/\b(nice\s+to\s+have|preferred|bonus|plus|desirable|optional)\b/i.test(headingText)) {
      sectionType = 'preferred';
    } else if (/\b(responsibilit\w*|duties|what\s+you('ll|\s+will)\s+do|the\s+role|about\s+the\s+role)\b/i.test(headingText)) {
      sectionType = 'responsibilities';
    } else if (/\b(requirement\w*|qualification\w*|what\s+you\s+(bring|need)|must\s+have|who\s+you\s+are|basic\s+qualification\w*)\b/i.test(headingText)) {
      sectionType = 'required';
    }

    if (sectionType === 'ignore') {
      continue;
    }

    const sectionItems: string[] = [];

    // Check Lever-style container wrapping heading and list
    const sectionWrapper = heading.closest('.section-wrapper');
    if (sectionWrapper && sectionWrapper !== container) {
      const lists = sectionWrapper.querySelectorAll('ul, ol');
      lists.forEach((listEl) => {
        if (!processedLists.has(listEl)) {
          processedLists.add(listEl);
          sectionItems.push(...extractListItems(listEl));
        }
      });
    }

    // Scan sibling elements following heading until next heading
    if (sectionItems.length === 0) {
      let current: Element | null = heading.nextElementSibling;
      if (!current && heading.parentElement && heading.parentElement !== container) {
        current = heading.parentElement.nextElementSibling;
      }

      while (current) {
        if (current.matches(headingSelector) || current.querySelector(headingSelector)) {
          break;
        }

        const tag = current.tagName.toUpperCase();
        if (tag === 'UL' || tag === 'OL') {
          if (!processedLists.has(current)) {
            processedLists.add(current);
            sectionItems.push(...extractListItems(current));
          }
        } else {
          const nestedLists = current.querySelectorAll('ul, ol');
          nestedLists.forEach((list) => {
            if (!processedLists.has(list)) {
              processedLists.add(list);
              sectionItems.push(...extractListItems(list));
            }
          });
        }

        current = current.nextElementSibling;
      }
    }

    if (sectionItems.length > 0) {
      if (sectionType === 'responsibilities') {
        responsibilities.push(...sectionItems);
      } else if (sectionType === 'preferred') {
        requirements.push(...normalizeRequirementsList(sectionItems, 'preferred'));
      } else if (sectionType === 'required') {
        requirements.push(...normalizeRequirementsList(sectionItems, 'required'));
      }
    }
  }

  // Check if any lists were not captured by heading scanning (e.g. lists before the first heading)
  const allLists = Array.from(container.querySelectorAll('ul, ol'));
  const uncapturedItems: string[] = [];
  for (const listEl of allLists) {
    if (!processedLists.has(listEl)) {
      processedLists.add(listEl);
      uncapturedItems.push(...extractListItems(listEl));
    }
  }
  if (uncapturedItems.length > 0) {
    requirements.unshift(...normalizeRequirementsList(uncapturedItems, 'required'));
  }

  if (requirements.length === 0) {
    const rawItems = extractListItems(container);
    return {
      responsibilities,
      requirements: normalizeRequirementsList(rawItems, 'required'),
    };
  }

  return { responsibilities, requirements };
}

/**
 * Extracts bullet points and text items from an HTML container element or raw text string.
 */
export function extractListItems(container: Element | string): string[] {
  if (typeof container === 'string') {
    return container
      .split('\n')
      .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter((line) => line.length > 5);
  }

  const items: string[] = [];
  const listElements = container.querySelectorAll('li');

  if (listElements.length > 0) {
    listElements.forEach((el) => {
      const text = el.textContent?.trim();
      if (text && text.length > 0) {
        items.push(text);
      }
    });
    return items;
  }

  // Fallback to paragraph or line break splits if no <li> tags exist
  const paragraphs = container.querySelectorAll('p');
  paragraphs.forEach((p) => {
    const text = p.textContent?.trim();
    if (text && text.length > 5) {
      items.push(text);
    }
  });

  return items;
}

/**
 * Categorizes a requirement statement using deterministic keyword and pattern matching.
 */
export function classifyRequirementCategory(text: string): RequirementCategory {
  const lower = text.toLowerCase();

  if (/(\d+)\+?\s*years?|\byears\s+of\s+experience\b/i.test(lower)) {
    return 'experience_level';
  }

  if (/\b(bachelor|master|phd|degree|b\.s\.|m\.s\.|diploma)\b/i.test(lower)) {
    return 'education_credential';
  }

  if (/\b(authorized|authorization|sponsorship|visa|work permit|clearance|citizen)\b/i.test(lower)) {
    return 'legal_authorization';
  }

  if (/\b(certified|certification|aws certified|cka|cissp|pmp)\b/i.test(lower)) {
    return 'certification';
  }

  if (/\b(communication|verbal|written|collaborat\w*|mentor\w*|leadership|leader\w*|interpersonal|team\s*player)\b/i.test(lower)) {
    return 'soft_skill';
  }

  if (/\b(hipaa|fintech|banking|bank\w*|payment\w*|swift|iso\s*20022|healthcare|compliance|pci-dss|gdpr|fda|clinical)\b/i.test(lower)) {
    return 'domain_knowledge';
  }

  return 'technical_skill';
}

/**
 * Extracts explicit minimum years of experience required from text statements.
 */
export function extractYearsRequired(text: string): number | undefined {
  const match = text.match(/(\d+)\+?\s*years?/i);
  if (match && match[1]) {
    const years = parseInt(match[1], 10);
    return isNaN(years) ? undefined : years;
  }
  return undefined;
}

/**
 * Generates a concise normalized competency key for semantic candidate matching.
 */
export function extractCompetencyKey(text: string): string {
  let cleaned = text.trim();
  const prefixes = [
    /^\d+\+?\s*years?\s+(of\s+)?(professional\s+)?(software\s+)?experience\s+(in|with|building|developing|designing|engineering)?\s*/i,
    /^at\s+least\s+\d+\s+years\s+(of\s+)?(experience\s+(in|with|building|developing)?)?\s*/i,
    /^minimum\s+\d+\s+years\s+(of\s+)?(experience\s+(in|with|building|developing)?)?\s*/i,
    /^(strong\s+proficiency\s+with|proficiency\s+in|hands-on\s+experience\s+with|experience\s+(with|in|creating(\s+and\s+managing)?|building|developing|designing|architecting|using|deploying|working\s+with)?|familiarity\s+with|knowledge\s+of)\s*/i,
    /^(must\s+have|ability\s+to|demonstrated\s+experience\s+in|proven\s+track\s+record\s+in)\s*/i,
    /^(strong\s+competency\s+in|solid\s+skillset\s+in|deep\s+understanding\s+of|strong\s+understanding\s+of)\s*(writing|building|developing)?\s*/i,
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of prefixes) {
      if (prefix.test(cleaned)) {
        cleaned = cleaned.replace(prefix, '').trim();
        changed = true;
      }
    }
  }

  // Strip trailing periods or punctuation
  cleaned = cleaned.replace(/[.:;]+$/, '').trim();

  // Remove rating indicators like (10/10)
  cleaned = cleaned.replace(/\s*\(\d+\/\d+\)\s*/g, ' ').trim();

  // If there is an elaboration clause like "Node.js with deep understanding...", isolate core subject
  const withMatch = cleaned.match(/^([^,;]+?)\s+(?:with|including)\s+/i);
  if (withMatch && withMatch[1] && withMatch[1].trim().length > 1) {
    cleaned = withMatch[1].trim();
  }

  // Take the primary clause before commas, semicolons, or conjunctions
  const clauses = cleaned.split(/[,;]|\band\b/i);
  let primary = clauses[0]?.trim();
  // Preserve coordinate adjectives (e.g., "modular, maintainable code")
  if (primary && /^(modular|scalable|clean|robust|modern)$/i.test(primary) && clauses[1]) {
    primary = `${primary}, ${clauses[1].trim()}`;
  }

  return primary && primary.length > 0 ? primary : text.slice(0, 50).trim();
}

/**
 * Normalizes raw requirement bullet strings into structured Requirement domain models.
 *
 * @param rawItems Array of raw requirement statements from the job posting.
 * @param defaultImportance The default importance tier to assign if not explicitly qualified.
 */
export function normalizeRequirementsList(
  rawItems: readonly string[],
  defaultImportance: Importance = 'required'
): Requirement[] {
  return rawItems.map((rawText) => {
    const category = classifyRequirementCategory(rawText);
    const yearsRequired = extractYearsRequired(rawText);
    const normalizedSkillOrCompetency = extractCompetencyKey(rawText);

    // Heuristically adjust importance if bullet contains qualifying language
    let importance = defaultImportance;
    const lower = rawText.toLowerCase();
    if (/\b(nice\s+to\s+have|bonus|preferred|plus|advantage)\b/i.test(lower)) {
      importance = 'preferred';
    } else if (/\b(strongly\s+preferred|highly\s+desired)\b/i.test(lower)) {
      importance = 'strongly_preferred';
    } else if (/\b(must\s+have|required|mandatory|essential)\b/i.test(lower)) {
      importance = 'required';
    }

    const isRequired = importance === 'required' || importance === 'strongly_preferred';

    return {
      id: createRequirementId(),
      rawText,
      normalizedSkillOrCompetency,
      category,
      importance,
      ...(yearsRequired !== undefined ? { yearsRequired } : {}),
      isRequired,
      matchedEvidenceIds: [],
    };
  });
}
