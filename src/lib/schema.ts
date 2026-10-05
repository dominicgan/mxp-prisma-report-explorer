/**
 * Canonical schema for a Prisma Cloud vulnerability export.
 *
 * The explorer is header-driven, not position-driven: a column is located by
 * normalising its header text and looking it up in ALIASES. Re-exports with
 * reordered, renamed-in-case, or extra columns therefore land in the same
 * canonical fields, which is what makes a re-upload deterministic.
 */

export type FieldKind = 'string' | 'number' | 'date' | 'enum'

export interface FieldDef {
  /** Canonical key used everywhere downstream. */
  key: string
  /** Human label shown in the grid and facet panel. */
  label: string
  kind: FieldKind
  /** Header spellings seen in the wild, normalised via `normaliseHeader`. */
  aliases: string[]
  /** Offer this field as a facet (value-list filter) in the sidebar. */
  facet?: boolean
  /** Show this column in the grid by default. */
  primary?: boolean
  /** Grouping bucket for the column chooser / detail panel. */
  group: 'Finding' | 'Location' | 'Package' | 'Lifecycle' | 'Ownership' | 'Business'
}

export const FIELDS: FieldDef[] = [
  // --- Finding -----------------------------------------------------------
  { key: 'cve', label: 'CVE', kind: 'string', aliases: ['cve', 'cve id', 'cveid'], facet: true, primary: true, group: 'Finding' },
  { key: 'bulletin', label: 'Bulletin', kind: 'string', aliases: ['bulletin'], group: 'Finding' },
  { key: 'severity', label: 'Severity', kind: 'enum', aliases: ['severity'], facet: true, primary: true, group: 'Finding' },
  { key: 'cvss', label: 'CVSS', kind: 'number', aliases: ['cvss', 'cvss score'], primary: true, group: 'Finding' },
  { key: 'cvssSource', label: 'CVSS Source', kind: 'enum', aliases: ['cvss source'], facet: true, group: 'Finding' },
  { key: 'vulnerabilityCategory', label: 'Vuln Category', kind: 'enum', aliases: ['vulnerability category', 'vuln category'], facet: true, group: 'Finding' },
  { key: 'description', label: 'Description', kind: 'string', aliases: ['vulnerability description', 'description'], group: 'Finding' },
  { key: 'isExploitable', label: 'Exploitable', kind: 'enum', aliases: ['is exploitable', 'exploitable'], facet: true, primary: true, group: 'Finding' },
  { key: 'isPatchable', label: 'Patchable', kind: 'enum', aliases: ['is patchable', 'patchable'], facet: true, primary: true, group: 'Finding' },
  { key: 'status', label: 'Fix Status', kind: 'string', aliases: ['status'], group: 'Finding' },
  { key: 'kpiStatus', label: 'KPI Status', kind: 'enum', aliases: ['kpi status'], facet: true, group: 'Finding' },
  { key: 'count', label: 'Findings', kind: 'number', aliases: ['#', 'count', 'number of findings'], group: 'Finding' },

  // --- Location ----------------------------------------------------------
  { key: 'repo', label: 'Repo', kind: 'enum', aliases: ['repo', 'repository', 'image repo'], facet: true, primary: true, group: 'Location' },
  { key: 'registry', label: 'Registry', kind: 'enum', aliases: ['registry'], facet: true, group: 'Location' },
  { key: 'tag', label: 'Tag', kind: 'string', aliases: ['tag', 'image tag'], facet: true, primary: true, group: 'Location' },
  { key: 'imageId', label: 'Image ID', kind: 'string', aliases: ['image id', 'imageid'], group: 'Location' },
  { key: 'digestId', label: 'Digest', kind: 'string', aliases: ['digestid', 'digest id', 'digest'], group: 'Location' },
  { key: 'distro', label: 'Distro', kind: 'enum', aliases: ['distro', 'distribution'], facet: true, group: 'Location' },
  { key: 'hostName', label: 'Host', kind: 'enum', aliases: ['host name', 'hostname'], facet: true, group: 'Location' },
  { key: 'cluster', label: 'Cluster', kind: 'enum', aliases: ['cluster'], facet: true, group: 'Location' },
  { key: 'namespace', label: 'Namespace', kind: 'enum', aliases: ['namespace'], facet: true, primary: true, group: 'Location' },
  { key: 'environment', label: 'Environment', kind: 'enum', aliases: ['environment', 'env'], facet: true, primary: true, group: 'Location' },
  { key: 'ciStatus', label: 'CI Status', kind: 'enum', aliases: ['ci status'], facet: true, group: 'Location' },
  { key: 'facing', label: 'Facing', kind: 'enum', aliases: ['internal/external facing', 'internal external facing', 'facing'], facet: true, group: 'Location' },

  // --- Package -----------------------------------------------------------
  { key: 'packageName', label: 'Package', kind: 'enum', aliases: ['package name'], facet: true, primary: true, group: 'Package' },
  { key: 'packageVersion', label: 'Version', kind: 'string', aliases: ['package version'], primary: true, group: 'Package' },
  { key: 'packageType', label: 'Package Type', kind: 'enum', aliases: ['package type'], facet: true, group: 'Package' },
  { key: 'packageLicense', label: 'License', kind: 'enum', aliases: ['package license'], facet: true, group: 'Package' },
  { key: 'packagePath', label: 'Package Path', kind: 'string', aliases: ['package path'], group: 'Package' },
  { key: 'purl', label: 'PURL', kind: 'string', aliases: ['purl'], group: 'Package' },
  { key: 'applicationPath', label: 'Application Path', kind: 'string', aliases: ['application path'], group: 'Package' },

  // --- Lifecycle ---------------------------------------------------------
  { key: 'discovered', label: 'Discovered', kind: 'date', aliases: ['discovered', 'discovered on'], primary: true, group: 'Lifecycle' },
  { key: 'fixDate', label: 'Fix Date', kind: 'date', aliases: ['fix date'], group: 'Lifecycle' },
  { key: 'initialNotification', label: 'Notified', kind: 'date', aliases: ['initial notification'], group: 'Lifecycle' },
  { key: 'scanTime', label: 'Scan Time', kind: 'date', aliases: ['scan time'], group: 'Lifecycle' },

  // --- Ownership ---------------------------------------------------------
  { key: 'serviceOwner', label: 'Service Owner', kind: 'enum', aliases: ['service owner'], facet: true, group: 'Ownership' },
  { key: 'namespaceOwner', label: 'Namespace Owner', kind: 'enum', aliases: ['namespace owner'], facet: true, group: 'Ownership' },
  { key: 'namespaceOwnerSource', label: 'NS Owner Source', kind: 'enum', aliases: ['namespace owner source'], group: 'Ownership' },
  { key: 'namespaceAdminGroup', label: 'NS Admin Group', kind: 'enum', aliases: ['namespace administrator group'], facet: true, group: 'Ownership' },
  { key: 'namespaceAdminGroupSource', label: 'NS Admin Source', kind: 'enum', aliases: ['namespace administrator group source'], group: 'Ownership' },
  { key: 'clusterOwner', label: 'Cluster Owner', kind: 'enum', aliases: ['cluster owner'], facet: true, group: 'Ownership' },
  { key: 'clusterAdminGroup', label: 'Cluster Admin Group', kind: 'enum', aliases: ['cluster administrator group'], group: 'Ownership' },
  { key: 'clusterNamespaceOwner', label: 'Cluster/NS Owner', kind: 'enum', aliases: ['cluster/namespace owner', 'cluster namespace owner'], facet: true, group: 'Ownership' },
  { key: 'adminWorkGroup', label: 'Admin WorkGroup', kind: 'enum', aliases: ['administrator workgroup'], facet: true, group: 'Ownership' },
  { key: 'subscriptionOwner', label: 'Subscription Owner', kind: 'enum', aliases: ['subscription owner'], facet: true, group: 'Ownership' },
  { key: 'resourceGroupOwner', label: 'Resource Group Owner', kind: 'enum', aliases: ['resource group owner'], group: 'Ownership' },

  // --- Business ----------------------------------------------------------
  { key: 'serviceName', label: 'Service', kind: 'enum', aliases: ['service name'], facet: true, primary: true, group: 'Business' },
  { key: 'serviceNumber', label: 'Service Number', kind: 'enum', aliases: ['service number'], facet: true, group: 'Business' },
  { key: 'serviceCriticality', label: 'Criticality', kind: 'enum', aliases: ['service criticality'], facet: true, group: 'Business' },
  { key: 'ciNumber', label: 'CI Number', kind: 'enum', aliases: ['ci number'], facet: true, group: 'Business' },
  { key: 'cmdbCategory', label: 'CMDB Category', kind: 'enum', aliases: ['cmdb category'], facet: true, group: 'Business' },
  { key: 'cmdbSource', label: 'CMDB Source', kind: 'enum', aliases: ['cmdb source'], group: 'Business' },
  { key: 'subscriptionName', label: 'Subscription', kind: 'enum', aliases: ['subscription name'], facet: true, group: 'Business' },
  { key: 'resourceGroupName', label: 'Resource Group', kind: 'enum', aliases: ['resource group name'], facet: true, group: 'Business' },
  { key: 'grcBu', label: 'GRC BU', kind: 'enum', aliases: ['grc bu'], facet: true, group: 'Business' },
  { key: 'bu', label: 'BU', kind: 'enum', aliases: ['bu'], facet: true, group: 'Business' },
]

export const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]))

/** Lower-case, collapse whitespace, drop punctuation that varies between exports. */
export function normaliseHeader(raw: string): string {
  return String(raw ?? '')
    .replace(/ /g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
    .replace(/[.:]+$/g, '')
}

const ALIASES = new Map<string, string>()
for (const f of FIELDS) {
  ALIASES.set(normaliseHeader(f.label), f.key)
  for (const a of f.aliases) ALIASES.set(normaliseHeader(a), f.key)
}

export function resolveHeader(raw: string): string | undefined {
  return ALIASES.get(normaliseHeader(raw))
}

// --- Derived (computed, never read straight from the sheet) ---------------

export type Surface = 'Container' | 'Code' | 'Unknown'

export interface DerivedDef {
  key: string
  label: string
}

export const DERIVED: DerivedDef[] = [
  { key: 'surface', label: 'Surface' },
  { key: 'exploitable', label: 'Exploitable?' },
  { key: 'patchable', label: 'Patchable?' },
  { key: 'triage', label: 'Triage Class' },
  { key: 'ageDays', label: 'Age (days)' },
  { key: 'ageBucket', label: 'Age Bucket' },
  // Parsed out of the image tag; see `parseTag`.
  { key: 'tagStream', label: 'Tag Stream' },
  { key: 'tagVersion', label: 'Tag Version' },
  { key: 'tagBuild', label: 'Build Number' },
  { key: 'tagBuiltAt', label: 'Image Built' },
  { key: 'imageAgeDays', label: 'Image Age (days)' },
  { key: 'imageAgeBucket', label: 'Image Age' },
]

/** Derived keys that hold dates, so the columnar index types them correctly. */
export const DERIVED_DATE_KEYS = ['tagBuiltAt']
/** Derived keys that hold numbers. */
export const DERIVED_NUMBER_KEYS = ['ageDays', 'tagBuild', 'imageAgeDays']

export const SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low', 'Unknown'] as const
export type Severity = (typeof SEVERITY_ORDER)[number]

export function severityRank(s: string | undefined): number {
  const i = SEVERITY_ORDER.indexOf(normaliseSeverity(s) as Severity)
  return i === -1 ? SEVERITY_ORDER.length : i
}

export function normaliseSeverity(s: string | undefined): Severity {
  const v = String(s ?? '').trim().toLowerCase()
  if (v.startsWith('crit')) return 'Critical'
  if (v.startsWith('high') || v === 'important') return 'High'
  if (v.startsWith('med') || v === 'moderate') return 'Medium'
  if (v.startsWith('low') || v === 'minor') return 'Low'
  return 'Unknown'
}
