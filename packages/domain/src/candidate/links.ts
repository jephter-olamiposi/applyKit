/**
 * Arbitrary titled external URL (e.g. Substack, Medium, personal projects).
 */
export interface CustomLink {
  readonly label: string;
  readonly url: string;
}

/**
 * Standard web and professional profile URLs associated with the candidate.
 */
export interface ProfileLinks {
  readonly github?: string;
  readonly linkedin?: string;
  readonly portfolio?: string;
  readonly personalBlog?: string;
  readonly twitterOrX?: string;
  readonly stackOverflow?: string;
  readonly customLinks: readonly CustomLink[];
}

/**
 * Resolves the most appropriate profile URL matching a given query or field label.
 * Case-insensitive heuristic matching handles common ATS form field names.
 */
export function findLinkForLabel(links: ProfileLinks, label: string): string | undefined {
  if (!label) return undefined;
  const normalized = label.toLowerCase();
  if (normalized.includes('linkedin') && links.linkedin) return links.linkedin;
  if (normalized.includes('github') && links.github) return links.github;
  if ((normalized.includes('portfolio') || normalized.includes('website')) && links.portfolio) return links.portfolio;
  if (normalized.includes('blog') && links.personalBlog) return links.personalBlog;
  if ((normalized.includes('twitter') || normalized.includes('x.com')) && links.twitterOrX) return links.twitterOrX;

  const custom = links.customLinks.find(
    (c) => c.label.toLowerCase().includes(normalized) || normalized.includes(c.label.toLowerCase())
  );
  return custom?.url;
}
