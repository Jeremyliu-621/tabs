// ── Storage Keys ──────────────────────────────────────────────
export const STORAGE_KEYS = {
  TAB_EVENTS: 'tab_events',       // Array of raw tab event records
  SESSIONS: 'sessions',           // Array of detected browsing sessions
  PROJECTS: 'projects',           // Array of auto-detected / manual projects
  SETTINGS: 'settings',           // User preferences
  LAST_ACTIVE_PROJECT: 'last_active_project',
};

// ── Tracking Thresholds ──────────────────────────────────────
export const TRACKING = {
  /** Minimum time (ms) a tab must be focused to count as "visited" */
  MIN_FOCUS_DURATION: 2000,

  /** Gap (ms) between tab activity that defines a new session boundary */
  SESSION_GAP: 30 * 60 * 1000, // 30 minutes

  /** Window (ms) for grouping co-opened tabs into a cluster */
  CLUSTER_WINDOW: 5 * 60 * 1000, // 5 minutes

  /** Debounce delay (ms) for rapid tab events */
  DEBOUNCE_DELAY: 500,
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
