/** External vulnerability databases a CVE id can be looked up in. */
export interface CveSource {
  id: string
  label: string
  /** Short blurb shown in the picker. */
  hint: string
  url: (cve: string) => string
}

export const CVE_PATTERN = /^CVE-\d{4}-\d{4,}$/i

export function isCve(v: unknown): boolean {
  return typeof v === 'string' && CVE_PATTERN.test(v.trim())
}

export const CVE_SOURCES: CveSource[] = [
  {
    id: 'nvd',
    label: 'NVD',
    hint: 'NIST National Vulnerability Database - CVSS vectors, CWE, references',
    url: (c) => `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(c)}`,
  },
  {
    id: 'mitre',
    label: 'MITRE',
    hint: 'The CVE Program record itself - canonical description',
    url: (c) => `https://www.cve.org/CVERecord?id=${encodeURIComponent(c)}`,
  },
  {
    id: 'cisa-kev',
    label: 'CISA KEV',
    hint: 'Known Exploited Vulnerabilities catalogue - search for active exploitation',
    url: (c) => `https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=${encodeURIComponent(c)}`,
  },
  {
    id: 'osv',
    label: 'OSV',
    hint: 'Open Source Vulnerabilities - affected version ranges per ecosystem',
    url: (c) => `https://osv.dev/vulnerability/${encodeURIComponent(c)}`,
  },
  {
    id: 'ghsa',
    label: 'GitHub Advisory',
    hint: 'GitHub Advisory Database - package-level fix guidance',
    url: (c) => `https://github.com/advisories?query=${encodeURIComponent(c)}`,
  },
  {
    id: 'epss',
    label: 'FIRST EPSS',
    hint: 'Exploit Prediction Scoring System - probability of exploitation',
    url: (c) => `https://api.first.org/data/v1/epss?cve=${encodeURIComponent(c)}`,
  },
]

export const DEFAULT_CVE_SOURCE = 'nvd'

export function cveUrl(cve: string, sourceId: string = DEFAULT_CVE_SOURCE): string {
  const src = CVE_SOURCES.find((s) => s.id === sourceId) ?? CVE_SOURCES[0]
  return src.url(cve.trim().toUpperCase())
}

/**
 * Non-CVE identifiers (internal bulletins like `SW-Bulletin-4105464`) have no
 * public database, so they render as plain text rather than a dead link.
 */
export function bulletinIsLinkable(bulletin: string): boolean {
  return isCve(bulletin)
}
