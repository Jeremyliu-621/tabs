// ── Storage Keys ──────────────────────────────────────────────
export const STORAGE_KEYS = {
  TAB_EVENTS: 'tab_events',       // Array of raw tab event records
  SESSIONS: 'sessions',           // Array of detected browsing sessions
  PROJECTS: 'projects',           // Array of auto-detected / manual projects
  SETTINGS: 'settings',           // User preferences
  BLACKLIST: 'domain_blacklist',  // Array of blacklisted domain strings
  CLUSTERING_SETTINGS: 'clustering_settings', // User-editable clustering params
  LAST_ACTIVE_PROJECT: 'last_active_project',
  AI_CACHE: 'ai_cache',           // Cached AI refinement result + fingerprint
  AI_SETTINGS: 'ai_settings',     // { enabled: boolean }
};

// ── Tracking Thresholds ──────────────────────────────────────
export const TRACKING = {
  /** Minimum time (ms) a tab must be focused to count as "visited" */
  MIN_FOCUS_DURATION: 2000,

  /** Default gap (ms) between tab activity that defines a new session boundary */
  SESSION_GAP: 15 * 60 * 1000, // 15 minutes (user-editable)

  /** Debounce delay (ms) for rapid tab events */
  DEBOUNCE_DELAY: 500,
};

// ── Clustering Defaults ──────────────────────────────────────
// These are the defaults; user can override via Settings in the popup.
export const CLUSTERING = {
  /** Only process events from the last N ms */
  DATA_RETENTION: 7 * 24 * 60 * 60 * 1000, // 7 days

  /** Archive projects not accessed within this window */
  ARCHIVE_THRESHOLD: 7 * 24 * 60 * 60 * 1000, // 7 days

  /** Jaccard similarity threshold to merge session into existing project */
  OVERLAP_THRESHOLD: 0.8,

  /** Minimum domains in a session to create a project candidate */
  MIN_CLUSTER_SIZE: 2,

  /** Maximum auto-detected active projects to display */
  MAX_AUTO_PROJECTS: 10,
};

// ── Data Retention ───────────────────────────────────────────
export const RETENTION = {
  /** Max age (ms) for raw tab events before pruning */
  MAX_EVENT_AGE: 30 * 24 * 60 * 60 * 1000, // 30 days

  /** Max number of tab events to keep in storage */
  MAX_EVENTS: 10000,
};

// ── Tab Event Types ──────────────────────────────────────────
export const EVENT_TYPES = {
  CREATED: 'created',
  ACTIVATED: 'activated',
  UPDATED: 'updated',
  REMOVED: 'removed',
};

// ── URLs to ignore ───────────────────────────────────────────
export const IGNORED_URL_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'about:',
  'edge://',
  'brave://',
];

// ── AI Grouping ──────────────────────────────────────────────
export const AI = {
  /** Gemini model to use */
  MODEL: 'gemini-2.0-flash',

  /** Gemini REST API base URL */
  API_BASE: 'https://generativelanguage.googleapis.com/v1beta',

  /** Minimum interval (ms) between AI refinement calls */
  MIN_INTERVAL: 5 * 60 * 1000, // 5 minutes

  /** Maximum number of tabs to send per AI request (cost control) */
  MAX_TABS_PER_REQUEST: 80,
};
