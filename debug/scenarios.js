/**
 * Test Scenario Library — 8 stress tests for AI clustering (50-250 tabs each).
 *
 * Each scenario returns { name, description, simulates, timespan, events[] }.
 * Events follow the schema: { id, type, domain, url, title, timestamp, tabId, focusDuration }.
 */

// ── Helpers ──────────────────────────────────────────────────
 
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

let _nextTabId = 1000;
let _nextEventId = 1;

function resetIds() {
    _nextTabId = 1000;
    _nextEventId = 1;
}

function makeTabId() {
    return _nextTabId++;
}

function makeEventId() {
    return `evt-${_nextEventId++}`;
}

function extractDomain(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return url;
    }
}

/**
 * Generate a session of tab events with focus durations.
 */
function generateSession(startTime, tabs) {
    const events = [];
    let t = startTime;

    for (const tab of tabs) {
        const tabId = makeTabId();
        const domain = extractDomain(tab.url);
        const focusMs = tab.focusMs || (30000 + Math.floor(Math.random() * 120000));

        events.push({
            id: makeEventId(),
            type: 'activated',
            domain,
            url: tab.url,
            title: tab.title,
            timestamp: t,
            tabId,
            focusDuration: focusMs,
        });

        t += focusMs + (3000 + Math.floor(Math.random() * 8000));
    }

    return events;
}

/**
 * Add background noise tabs (Spotify, social media).
 */
function addBackgroundNoise(events, now, days, includeSpotify = true) {
    const spotifyTab = makeTabId();
    
    if (includeSpotify) {
        for (let day = 0; day < days; day++) {
            for (let hour = 9; hour < 21; hour += 4) {
                events.push({
                    id: makeEventId(),
                    type: 'activated',
                    domain: 'open.spotify.com',
                    url: 'https://open.spotify.com/playlist/daily-mix',
                    title: 'Daily Mix - Spotify',
                    timestamp: now - day * DAY + hour * HOUR,
                    tabId: spotifyTab,
                    focusDuration: 180000,
                });
            }
        }
    }
    
    // Short distractions
    const distractions = [
        { url: 'https://youtube.com/shorts/abc123', title: 'YouTube Shorts', focusMs: 15000 },
        { url: 'https://instagram.com', title: 'Instagram', focusMs: 25000 },
        { url: 'https://twitter.com/home', title: 'Twitter', focusMs: 40000 },
    ];
    
    for (let i = 0; i < days * 2; i++) {
        const d = distractions[Math.floor(Math.random() * distractions.length)];
        events.push({
            id: makeEventId(),
            type: 'activated',
            domain: extractDomain(d.url),
            url: d.url,
            title: d.title,
            timestamp: now - Math.floor(Math.random() * days) * DAY + Math.floor(Math.random() * 12) * HOUR,
            tabId: makeTabId(),
            focusDuration: d.focusMs,
        });
    }
}

// ══════════════════════════════════════════════════════════════
// SCENARIO 1: Engineering Student (~50 tabs)
// ══════════════════════════════════════════════════════════════

function engineeringStudent() {
    resetIds();
    const now = Date.now();
    const events = [];
    
    // ECE110 - Signals (Day 1-2)
    const ece110 = [
        { url: 'https://quercus.utoronto.ca/courses/ECE110', title: 'ECE110 - Signals', focusMs: 180000 },
        { url: 'https://quercus.utoronto.ca/courses/ECE110/assignments', title: 'ECE110 Assignments', focusMs: 120000 },
        { url: 'https://quercus.utoronto.ca/courses/ECE110/files/lecture1.pdf', title: 'ECE110 Lecture 1', focusMs: 300000 },
        { url: 'https://quercus.utoronto.ca/courses/ECE110/files/lecture2.pdf', title: 'ECE110 Lecture 2', focusMs: 240000 },
        { url: 'https://overleaf.com/project/ece110-lab1', title: 'ECE110 Lab Report 1', focusMs: 600000 },
        { url: 'https://matlab.com/simulation', title: 'MATLAB Simulator', focusMs: 480000 },
        { url: 'https://wolframalpha.com', title: 'Wolfram Alpha', focusMs: 120000 },
        { url: 'https://youtube.com/watch?v=signals-tutorial', title: 'Signals Tutorial - YouTube', focusMs: 900000 },
    ];
    events.push(...generateSession(now - 2 * DAY + 9 * HOUR, ece110));
    events.push(...generateSession(now - 1 * DAY + 10 * HOUR, ece110.slice(0, 5)));
    
    // APS105 - C Programming (Day 1-2)
    const aps105 = [
        { url: 'https://quercus.utoronto.ca/courses/APS105', title: 'APS105 - Computer Fundamentals', focusMs: 180000 },
        { url: 'https://quercus.utoronto.ca/courses/APS105/assignments', title: 'APS105 Assignments', focusMs: 120000 },
        { url: 'https://quercus.utoronto.ca/courses/APS105/files/lecture1.pdf', title: 'APS105 Lecture 1', focusMs: 300000 },
        { url: 'https://onlinegdb.com/c-compiler', title: 'Online C Compiler', focusMs: 600000 },
        { url: 'https://cplusplus.com/reference', title: 'C++ Reference', focusMs: 180000 },
        { url: 'https://stackoverflow.com/questions/tagged/c', title: 'Stack Overflow - C', focusMs: 300000 },
    ];
    events.push(...generateSession(now - 2 * DAY + 14 * HOUR, aps105));
    events.push(...generateSession(now - 1 * DAY + 15 * HOUR, aps105.slice(0, 4)));
    
    // MAT292 - Calculus (Day 1)
    const mat292 = [
        { url: 'https://quercus.utoronto.ca/courses/MAT292', title: 'MAT292 - Calculus', focusMs: 180000 },
        { url: 'https://quercus.utoronto.ca/courses/MAT292/files/lecture1.pdf', title: 'MAT292 Lecture 1', focusMs: 360000 },
        { url: 'https://khanacademy.org/math/calculus', title: 'Khan Academy - Calculus', focusMs: 480000 },
        { url: 'https://wolframalpha.com', title: 'Wolfram Alpha', focusMs: 180000 },
    ];
    events.push(...generateSession(now - 1 * DAY + 19 * HOUR, mat292));
    
    addBackgroundNoise(events, now, 2);
    
    return {
        name: 'Engineering Student',
        description: '3 courses (ECE110, APS105, MAT292) with labs, assignments, and study resources',
        simulates: 'Course separation with shared tools (Quercus, Wolfram Alpha)',
        timespan: '2 days',
        events,
    };
}

// ══════════════════════════════════════════════════════════════
// SCENARIO 2: Startup Founder (~80 tabs)
// ══════════════════════════════════════════════════════════════

function startupFounder() {
    resetIds();
    const now = Date.now();
    const events = [];
    
    // Product Development
    const product = [
        { url: 'https://figma.com/startup-mvp', title: 'MVP Designs - Figma', focusMs: 720000 },
        { url: 'https://figma.com/startup-wireframes', title: 'Wireframes - Figma', focusMs: 540000 },
        { url: 'https://github.com/my-startup/app', title: 'Startup App - GitHub', focusMs: 600000 },
        { url: 'https://github.com/my-startup/app/pulls', title: 'Pull Requests', focusMs: 300000 },
        { url: 'https://vercel.com/my-startup', title: 'Vercel Dashboard', focusMs: 180000 },
        { url: 'http://localhost:3000', title: 'Local Dev', focusMs: 900000 },
        { url: 'https://stripe.com/docs/api', title: 'Stripe API Docs', focusMs: 480000 },
    ];
    events.push(...generateSession(now - 3 * DAY + 9 * HOUR, product));
    events.push(...generateSession(now - 2 * DAY + 10 * HOUR, product));
    events.push(...generateSession(now - 1 * DAY + 9 * HOUR, product));
    
    // Fundraising
    const fundraising = [
        { url: 'https://docs.google.com/presentation/pitch-deck', title: 'Pitch Deck - Google Slides', focusMs: 900000 },
        { url: 'https://docs.google.com/spreadsheets/financial-model', title: 'Financial Model', focusMs: 720000 },
        { url: 'https://crunchbase.com/investors', title: 'Crunchbase - Investors', focusMs: 360000 },
        { url: 'https://linkedin.com/search/people', title: 'LinkedIn - Investors', focusMs: 420000 },
        { url: 'https://ycombinator.com/apply', title: 'Y Combinator Apply', focusMs: 300000 },
        { url: 'https://techcrunch.com', title: 'TechCrunch', focusMs: 180000 },
    ];
    events.push(...generateSession(now - 3 * DAY + 14 * HOUR, fundraising));
    events.push(...generateSession(now - 1 * DAY + 14 * HOUR, fundraising.slice(0, 4)));
    
    // Marketing
    const marketing = [
        { url: 'https://twitter.com/startup', title: 'Startup Twitter', focusMs: 300000 },
        { url: 'https://buffer.com', title: 'Buffer - Schedule Posts', focusMs: 240000 },
        { url: 'https://canva.com/social-posts', title: 'Canva - Social Posts', focusMs: 480000 },
        { url: 'https://mailchimp.com/campaigns', title: 'Mailchimp Campaigns', focusMs: 360000 },
        { url: 'https://analytics.google.com', title: 'Google Analytics', focusMs: 300000 },
    ];
    events.push(...generateSession(now - 2 * DAY + 16 * HOUR, marketing));
    
    // Legal/Admin
    const legal = [
        { url: 'https://stripe.com/atlas', title: 'Stripe Atlas', focusMs: 420000 },
        { url: 'https://clerky.com', title: 'Clerky - Legal Docs', focusMs: 360000 },
        { url: 'https://mercury.com/dashboard', title: 'Mercury Banking', focusMs: 240000 },
    ];
    events.push(...generateSession(now - 2 * DAY + 19 * HOUR, legal));
    
    addBackgroundNoise(events, now, 3);
    
    return {
        name: 'Startup Founder',
        description: 'Product development, fundraising, marketing, and legal/admin tasks',
        simulates: 'Multiple business functions with shared tools (Google Docs, Canva)',
        timespan: '3 days',
        events,
    };
}

// ══════════════════════════════════════════════════════════════
// SCENARIO 3: Content Creator (~100 tabs)
// ══════════════════════════════════════════════════════════════

function contentCreator() {
    resetIds();
    const now = Date.now();
    const events = [];
    
    // YouTube Channel
    const youtube = [
        { url: 'https://studio.youtube.com/channel/analytics', title: 'YouTube Studio - Analytics', focusMs: 360000 },
        { url: 'https://studio.youtube.com/channel/videos', title: 'YouTube Studio - Videos', focusMs: 300000 },
        { url: 'https://studio.youtube.com/video/edit/abc123', title: 'Edit Video - YouTube', focusMs: 600000 },
        { url: 'https://youtube.com/watch?v=competitor-video', title: 'Competitor Analysis', focusMs: 480000 },
        { url: 'https://tubebuddy.com/dashboard', title: 'TubeBuddy Dashboard', focusMs: 240000 },
        { url: 'https://socialblade.com/youtube', title: 'Social Blade - YouTube', focusMs: 180000 },
    ];
    events.push(...generateSession(now - 4 * DAY + 10 * HOUR, youtube));
    events.push(...generateSession(now - 2 * DAY + 10 * HOUR, youtube));
    events.push(...generateSession(now - 1 * DAY + 10 * HOUR, youtube.slice(0, 4)));
    
    // Video Editing
    const editing = [
        { url: 'https://drive.google.com/drive/folders/raw-footage', title: 'Raw Footage - Drive', focusMs: 300000 },
        { url: 'https://drive.google.com/drive/folders/edited', title: 'Edited Videos - Drive', focusMs: 240000 },
        { url: 'https://frame.io/projects/current', title: 'Frame.io - Current Project', focusMs: 480000 },
        { url: 'https://artlist.io/royalty-free-music', title: 'Artlist - Music', focusMs: 420000 },
        { url: 'https://elements.envato.com', title: 'Envato Elements', focusMs: 360000 },
        { url: 'https://pinterest.com/video-ideas', title: 'Pinterest - Video Ideas', focusMs: 300000 },
    ];
    events.push(...generateSession(now - 3 * DAY + 14 * HOUR, editing));
    events.push(...generateSession(now - 1 * DAY + 14 * HOUR, editing));
    
    // Sponsorships
    const sponsorships = [
        { url: 'https://gmail.com', title: 'Gmail - Brand Deals', focusMs: 300000 },
        { url: 'https://docs.google.com/spreadsheets/brand-tracker', title: 'Brand Deal Tracker', focusMs: 480000 },
        { url: 'https://grin.co/dashboard', title: 'GRIN - Influencer Platform', focusMs: 360000 },
        { url: 'https://famebit.com', title: 'Famebit - Sponsorships', focusMs: 300000 },
    ];
    events.push(...generateSession(now - 4 * DAY + 16 * HOUR, sponsorships));
    events.push(...generateSession(now - 2 * DAY + 16 * HOUR, sponsorships));
    
    // Instagram Content
    const instagram = [
        { url: 'https://instagram.com/creator-account', title: 'Instagram Creator', focusMs: 420000 },
        { url: 'https://business.instagram.com/insights', title: 'Instagram Insights', focusMs: 300000 },
        { url: 'https://canva.com/instagram-posts', title: 'Canva - Instagram Posts', focusMs: 600000 },
        { url: 'https://canva.com/instagram-stories', title: 'Canva - Stories', focusMs: 480000 },
        { url: 'https://later.com/schedule', title: 'Later - Schedule', focusMs: 360000 },
    ];
    events.push(...generateSession(now - 3 * DAY + 18 * HOUR, instagram));
    events.push(...generateSession(now - 1 * DAY + 18 * HOUR, instagram));
    
    // TikTok
    const tiktok = [
        { url: 'https://tiktok.com/creator', title: 'TikTok Creator Portal', focusMs: 300000 },
        { url: 'https://tiktok.com/analytics', title: 'TikTok Analytics', focusMs: 240000 },
        { url: 'https://capcut.com/editor', title: 'CapCut Editor', focusMs: 720000 },
    ];
    events.push(...generateSession(now - 2 * DAY + 20 * HOUR, tiktok));
    
    addBackgroundNoise(events, now, 4);
    
    return {
        name: 'Content Creator',
        description: 'YouTube channel, video editing, sponsorships, Instagram, and TikTok content',
        simulates: 'Multiple platforms with shared tools (Canva, Google Drive)',
        timespan: '4 days',
        events,
    };
}

// ══════════════════════════════════════════════════════════════
// SCENARIO 4: Data Scientist (~120 tabs)
// ══════════════════════════════════════════════════════════════

function dataScientist() {
    resetIds();
    const now = Date.now();
    const events = [];
    
    // ML Research Project
    const mlResearch = [
        { url: 'https://arxiv.org/abs/2401.01234', title: 'Attention Is All You Need v3', focusMs: 600000 },
        { url: 'https://arxiv.org/abs/2401.05678', title: 'Scaling Laws for LLMs', focusMs: 540000 },
        { url: 'https://arxiv.org/abs/2401.09012', title: 'Vision Transformers Survey', focusMs: 480000 },
        { url: 'https://paperswithcode.com/method/transformer', title: 'Papers With Code', focusMs: 360000 },
        { url: 'https://scholar.google.com/scholar?q=transformers', title: 'Google Scholar', focusMs: 300000 },
        { url: 'https://huggingface.co/docs/transformers', title: 'HuggingFace Docs', focusMs: 420000 },
        { url: 'https://github.com/huggingface/transformers', title: 'HuggingFace GitHub', focusMs: 480000 },
    ];
    events.push(...generateSession(now - 5 * DAY + 9 * HOUR, mlResearch));
    events.push(...generateSession(now - 3 * DAY + 9 * HOUR, mlResearch));
    events.push(...generateSession(now - 1 * DAY + 9 * HOUR, mlResearch.slice(0, 5)));
    
    // Jupyter Notebooks
    const notebooks = [
        { url: 'http://localhost:8888/notebooks/data-analysis.ipynb', title: 'Data Analysis Notebook', focusMs: 1200000 },
        { url: 'http://localhost:8888/notebooks/model-training.ipynb', title: 'Model Training', focusMs: 900000 },
        { url: 'http://localhost:8888/notebooks/evaluation.ipynb', title: 'Model Evaluation', focusMs: 720000 },
        { url: 'https://colab.research.google.com/drive/abc123', title: 'Colab - Experiments', focusMs: 1080000 },
        { url: 'https://kaggle.com/competitions/current', title: 'Kaggle Competition', focusMs: 600000 },
    ];
    events.push(...generateSession(now - 4 * DAY + 14 * HOUR, notebooks));
    events.push(...generateSession(now - 2 * DAY + 14 * HOUR, notebooks));
    events.push(...generateSession(now - 1 * DAY + 14 * HOUR, notebooks.slice(0, 3)));
    
    // Data Engineering
    const dataEng = [
        { url: 'https://console.cloud.google.com/bigquery', title: 'BigQuery Console', focusMs: 480000 },
        { url: 'https://console.cloud.google.com/storage', title: 'Cloud Storage', focusMs: 300000 },
        { url: 'https://console.aws.amazon.com/s3', title: 'AWS S3', focusMs: 360000 },
        { url: 'https://app.snowflake.com/worksheets', title: 'Snowflake Worksheets', focusMs: 540000 },
        { url: 'https://app.databricks.com/notebooks', title: 'Databricks Notebooks', focusMs: 720000 },
    ];
    events.push(...generateSession(now - 4 * DAY + 16 * HOUR, dataEng));
    events.push(...generateSession(now - 2 * DAY + 16 * HOUR, dataEng));
    
    // Documentation
    const docs = [
        { url: 'https://pandas.pydata.org/docs', title: 'Pandas Docs', focusMs: 300000 },
        { url: 'https://numpy.org/doc', title: 'NumPy Docs', focusMs: 240000 },
        { url: 'https://scikit-learn.org/stable/documentation', title: 'Scikit-learn Docs', focusMs: 360000 },
        { url: 'https://pytorch.org/docs', title: 'PyTorch Docs', focusMs: 420000 },
        { url: 'https://tensorflow.org/api_docs', title: 'TensorFlow Docs', focusMs: 300000 },
        { url: 'https://stackoverflow.com/questions/tagged/python', title: 'Stack Overflow - Python', focusMs: 240000 },
    ];
    events.push(...generateSession(now - 3 * DAY + 19 * HOUR, docs));
    events.push(...generateSession(now - 1 * DAY + 19 * HOUR, docs));
    
    addBackgroundNoise(events, now, 5);
    
    return {
        name: 'Data Scientist',
        description: 'ML research, Jupyter notebooks, data engineering, and documentation',
        simulates: 'Research workflow with shared tools (Google Cloud, Stack Overflow)',
        timespan: '5 days',
        events,
    };
}

// ══════════════════════════════════════════════════════════════
// SCENARIO 5: Freelance Designer (~150 tabs)
// ══════════════════════════════════════════════════════════════

function freelanceDesigner() {
    resetIds();
    const now = Date.now();
    const events = [];
    
    // Client A: SaaS Redesign
    const clientA = [
        { url: 'https://figma.com/acme-saas-redesign', title: 'Acme SaaS Redesign', focusMs: 900000 },
        { url: 'https://figma.com/acme-components', title: 'Acme Component Library', focusMs: 720000 },
        { url: 'https://figma.com/acme-icons', title: 'Acme Icons', focusMs: 480000 },
        { url: 'https://slack.com/acme-workspace', title: 'Acme Slack', focusMs: 300000 },
        { url: 'https://notion.com/acme-project', title: 'Acme Project Notes', focusMs: 360000 },
        { url: 'https://acme-saas.com/dashboard', title: 'Acme Dashboard', focusMs: 420000 },
        { url: 'https://dribbble.com/search/saas-dashboard', title: 'Dribbble - SaaS Inspiration', focusMs: 540000 },
    ];
    events.push(...generateSession(now - 5 * DAY + 9 * HOUR, clientA));
    events.push(...generateSession(now - 4 * DAY + 10 * HOUR, clientA));
    events.push(...generateSession(now - 2 * DAY + 9 * HOUR, clientA.slice(0, 5)));
    
    // Client B: E-commerce Brand
    const clientB = [
        { url: 'https://figma.com/boutique-brand', title: 'Boutique Brand Identity', focusMs: 840000 },
        { url: 'https://figma.com/boutique-packaging', title: 'Boutique Packaging', focusMs: 720000 },
        { url: 'https://figma.com/boutique-web', title: 'Boutique Website', focusMs: 600000 },
        { url: 'https://slack.com/boutique-workspace', title: 'Boutique Slack', focusMs: 240000 },
        { url: 'https://pinterest.com/fashion-branding', title: 'Pinterest - Fashion', focusMs: 480000 },
        { url: 'https://behance.net/search/branding', title: 'Behance - Branding', focusMs: 420000 },
    ];
    events.push(...generateSession(now - 4 * DAY + 14 * HOUR, clientB));
    events.push(...generateSession(now - 3 * DAY + 14 * HOUR, clientB));
    events.push(...generateSession(now - 1 * DAY + 14 * HOUR, clientB.slice(0, 4)));
    
    // Client C: Mobile App
    const clientC = [
        { url: 'https://figma.com/fitness-app-ui', title: 'Fitness App UI', focusMs: 780000 },
        { url: 'https://figma.com/fitness-app-prototype', title: 'Fitness App Prototype', focusMs: 600000 },
        { url: 'https://figma.com/fitness-icons', title: 'Fitness App Icons', focusMs: 420000 },
        { url: 'https://slack.com/fitness-workspace', title: 'Fitness App Slack', focusMs: 180000 },
        { url: 'https://mobbin.com/browse/ios/apps', title: 'Mobbin - iOS Apps', focusMs: 540000 },
    ];
    events.push(...generateSession(now - 3 * DAY + 16 * HOUR, clientC));
    events.push(...generateSession(now - 2 * DAY + 16 * HOUR, clientC));
    events.push(...generateSession(now - 1 * DAY + 16 * HOUR, clientC.slice(0, 3)));
    
    // Personal Portfolio
    const portfolio = [
        { url: 'https://figma.com/my-portfolio', title: 'My Portfolio - Figma', focusMs: 600000 },
        { url: 'https://webflow.com/designer/portfolio', title: 'Portfolio - Webflow', focusMs: 720000 },
        { url: 'https://dribbble.com/my-profile', title: 'My Dribbble Profile', focusMs: 300000 },
        { url: 'https://behance.net/my-profile', title: 'My Behance Profile', focusMs: 240000 },
    ];
    events.push(...generateSession(now - 4 * DAY + 19 * HOUR, portfolio));
    events.push(...generateSession(now - 2 * DAY + 19 * HOUR, portfolio));
    
    // Inspiration/Learning
    const inspiration = [
        { url: 'https://awwwards.com', title: 'Awwwards', focusMs: 420000 },
        { url: 'https://siteinspire.com', title: 'Site Inspire', focusMs: 360000 },
        { url: 'https://land-book.com', title: 'Land-book', focusMs: 300000 },
        { url: 'https://youtube.com/watch?v=figma-tutorial', title: 'Figma Tutorial', focusMs: 900000 },
    ];
    events.push(...generateSession(now - 5 * DAY + 20 * HOUR, inspiration));
    events.push(...generateSession(now - 3 * DAY + 20 * HOUR, inspiration));
    
    addBackgroundNoise(events, now, 5);
    
    return {
        name: 'Freelance Designer',
        description: '3 client projects (SaaS, E-commerce, Mobile) plus portfolio and inspiration',
        simulates: 'Multi-client design work with shared tools (Figma, Slack, Pinterest)',
        timespan: '5 days',
        events,
    };
}

// ══════════════════════════════════════════════════════════════
// SCENARIO 6: Full-Stack Developer (~180 tabs)
// ══════════════════════════════════════════════════════════════

function fullStackDeveloper() {
    resetIds();
    const now = Date.now();
    const events = [];
    
    // Main Project: E-commerce Platform
    const ecommerce = [
        { url: 'https://github.com/my-ecommerce/frontend', title: 'E-commerce Frontend', focusMs: 900000 },
        { url: 'https://github.com/my-ecommerce/frontend/pulls', title: 'Frontend PRs', focusMs: 300000 },
        { url: 'https://github.com/my-ecommerce/backend', title: 'E-commerce Backend', focusMs: 840000 },
        { url: 'https://github.com/my-ecommerce/backend/issues', title: 'Backend Issues', focusMs: 360000 },
        { url: 'http://localhost:3000', title: 'Frontend Local', focusMs: 1200000 },
        { url: 'http://localhost:8080/api', title: 'Backend Local', focusMs: 900000 },
        { url: 'https://vercel.com/my-ecommerce', title: 'Vercel Deployment', focusMs: 240000 },
        { url: 'https://sentry.io/my-ecommerce', title: 'Sentry Errors', focusMs: 420000 },
    ];
    events.push(...generateSession(now - 6 * DAY + 9 * HOUR, ecommerce));
    events.push(...generateSession(now - 5 * DAY + 9 * HOUR, ecommerce));
    events.push(...generateSession(now - 4 * DAY + 9 * HOUR, ecommerce));
    events.push(...generateSession(now - 2 * DAY + 9 * HOUR, ecommerce.slice(0, 6)));
    events.push(...generateSession(now - 1 * DAY + 9 * HOUR, ecommerce.slice(0, 6)));
    
    // Side Project: CLI Tool
    const cliTool = [
        { url: 'https://github.com/my-cli-tool', title: 'CLI Tool - GitHub', focusMs: 720000 },
        { url: 'https://github.com/my-cli-tool/src', title: 'CLI Source Code', focusMs: 600000 },
        { url: 'https://npmjs.com/package/my-cli-tool', title: 'CLI Tool - npm', focusMs: 180000 },
        { url: 'https://nodejs.org/api/cli', title: 'Node.js CLI API', focusMs: 360000 },
    ];
    events.push(...generateSession(now - 5 * DAY + 19 * HOUR, cliTool));
    events.push(...generateSession(now - 3 * DAY + 19 * HOUR, cliTool));
    events.push(...generateSession(now - 1 * DAY + 19 * HOUR, cliTool.slice(0, 2)));
    
    // Open Source Contribution
    const openSource = [
        { url: 'https://github.com/vercel/next.js', title: 'Next.js - GitHub', focusMs: 480000 },
        { url: 'https://github.com/vercel/next.js/issues', title: 'Next.js Issues', focusMs: 360000 },
        { url: 'https://github.com/vercel/next.js/pulls', title: 'Next.js PRs', focusMs: 420000 },
        { url: 'https://nextjs.org/docs', title: 'Next.js Docs', focusMs: 540000 },
    ];
    events.push(...generateSession(now - 4 * DAY + 14 * HOUR, openSource));
    events.push(...generateSession(now - 2 * DAY + 14 * HOUR, openSource));
    
    // Documentation & Learning
    const docs = [
        { url: 'https://react.dev', title: 'React Docs', focusMs: 420000 },
        { url: 'https://typescriptlang.org/docs', title: 'TypeScript Docs', focusMs: 360000 },
        { url: 'https://tailwindcss.com/docs', title: 'Tailwind Docs', focusMs: 300000 },
        { url: 'https://prisma.io/docs', title: 'Prisma Docs', focusMs: 480000 },
        { url: 'https://stackoverflow.com/questions/tagged/react', title: 'Stack Overflow - React', focusMs: 300000 },
        { url: 'https://stackoverflow.com/questions/tagged/typescript', title: 'Stack Overflow - TS', focusMs: 240000 },
        { url: 'https://youtube.com/watch?v=nextjs-tutorial', title: 'Next.js Tutorial', focusMs: 1200000 },
    ];
    events.push(...generateSession(now - 6 * DAY + 16 * HOUR, docs));
    events.push(...generateSession(now - 4 * DAY + 16 * HOUR, docs));
    events.push(...generateSession(now - 2 * DAY + 16 * HOUR, docs.slice(0, 4)));
    
    addBackgroundNoise(events, now, 6);
    
    return {
        name: 'Full-Stack Developer',
        description: 'E-commerce platform, CLI side project, open source, and documentation',
        simulates: 'Multi-project development with shared tools (GitHub, Stack Overflow)',
        timespan: '6 days',
        events,
    };
}

// ══════════════════════════════════════════════════════════════
// SCENARIO 7: Product Manager (~200 tabs)
// ══════════════════════════════════════════════════════════════

function productManager() {
    resetIds();
    const now = Date.now();
    const events = [];
    
    // Product A: Core Platform
    const productA = [
        { url: 'https://linear.app/team/product-a', title: 'Product A - Linear', focusMs: 600000 },
        { url: 'https://linear.app/team/product-a/roadmap', title: 'Product A Roadmap', focusMs: 480000 },
        { url: 'https://figma.com/product-a-specs', title: 'Product A Specs - Figma', focusMs: 540000 },
        { url: 'https://notion.com/product-a-prd', title: 'Product A PRD', focusMs: 720000 },
        { url: 'https://notion.com/product-a-research', title: 'Product A Research', focusMs: 420000 },
        { url: 'https://amplitude.com/product-a', title: 'Product A Analytics', focusMs: 480000 },
        { url: 'https://mixpanel.com/product-a', title: 'Product A Mixpanel', focusMs: 360000 },
        { url: 'https://slack.com/product-a-channel', title: 'Product A Slack', focusMs: 300000 },
    ];
    events.push(...generateSession(now - 6 * DAY + 9 * HOUR, productA));
    events.push(...generateSession(now - 5 * DAY + 9 * HOUR, productA));
    events.push(...generateSession(now - 3 * DAY + 9 * HOUR, productA));
    events.push(...generateSession(now - 1 * DAY + 9 * HOUR, productA.slice(0, 6)));
    
    // Product B: Mobile App
    const productB = [
        { url: 'https://linear.app/team/product-b', title: 'Product B - Linear', focusMs: 540000 },
        { url: 'https://linear.app/team/product-b/backlog', title: 'Product B Backlog', focusMs: 420000 },
        { url: 'https://figma.com/product-b-mobile', title: 'Product B Mobile - Figma', focusMs: 600000 },
        { url: 'https://notion.com/product-b-prd', title: 'Product B PRD', focusMs: 660000 },
        { url: 'https://amplitude.com/product-b', title: 'Product B Analytics', focusMs: 360000 },
        { url: 'https://slack.com/product-b-channel', title: 'Product B Slack', focusMs: 240000 },
    ];
    events.push(...generateSession(now - 5 * DAY + 14 * HOUR, productB));
    events.push(...generateSession(now - 4 * DAY + 14 * HOUR, productB));
    events.push(...generateSession(now - 2 * DAY + 14 * HOUR, productB));
    events.push(...generateSession(now - 1 * DAY + 14 * HOUR, productB.slice(0, 4)));
    
    // User Research
    const research = [
        { url: 'https://dovetailapp.com/projects/research-q1', title: 'Dovetail - Q1 Research', focusMs: 720000 },
        { url: 'https://calendly.com/user-interviews', title: 'User Interview Schedule', focusMs: 300000 },
        { url: 'https://zoom.us/j/interviews', title: 'Zoom - Interviews', focusMs: 600000 },
        { url: 'https://typeform.com/results', title: 'Survey Results', focusMs: 480000 },
        { url: 'https://hotjar.com/recordings', title: 'Hotjar Recordings', focusMs: 540000 },
    ];
    events.push(...generateSession(now - 4 * DAY + 16 * HOUR, research));
    events.push(...generateSession(now - 2 * DAY + 16 * HOUR, research));
    
    // Competitive Analysis
    const competitive = [
        { url: 'https://competitor-a.com', title: 'Competitor A', focusMs: 420000 },
        { url: 'https://competitor-b.com', title: 'Competitor B', focusMs: 360000 },
        { url: 'https://g2.com/categories/product-analytics', title: 'G2 - Product Analytics', focusMs: 300000 },
        { url: 'https://capterra.com/reviews', title: 'Capterra Reviews', focusMs: 240000 },
        { url: 'https://notion.com/competitive-analysis', title: 'Competitive Analysis Doc', focusMs: 540000 },
    ];
    events.push(...generateSession(now - 6 * DAY + 16 * HOUR, competitive));
    events.push(...generateSession(now - 3 * DAY + 16 * HOUR, competitive));
    
    // Stakeholder Communication
    const stakeholder = [
        { url: 'https://docs.google.com/presentation/weekly-update', title: 'Weekly Update Deck', focusMs: 600000 },
        { url: 'https://docs.google.com/spreadsheets/metrics', title: 'Metrics Dashboard', focusMs: 420000 },
        { url: 'https://loom.com/my-videos', title: 'Loom - Updates', focusMs: 360000 },
        { url: 'https://slack.com/leadership-channel', title: 'Leadership Slack', focusMs: 300000 },
    ];
    events.push(...generateSession(now - 5 * DAY + 18 * HOUR, stakeholder));
    events.push(...generateSession(now - 3 * DAY + 18 * HOUR, stakeholder));
    events.push(...generateSession(now - 1 * DAY + 18 * HOUR, stakeholder));
    
    addBackgroundNoise(events, now, 6);
    
    return {
        name: 'Product Manager',
        description: '2 products, user research, competitive analysis, and stakeholder communication',
        simulates: 'Multi-product PM work with shared tools (Linear, Notion, Amplitude)',
        timespan: '6 days',
        events,
    };
}

// ══════════════════════════════════════════════════════════════
// SCENARIO 8: Agency Team Lead (~250 tabs)
// ══════════════════════════════════════════════════════════════

function agencyTeamLead() {
    resetIds();
    const now = Date.now();
    const events = [];
    
    // Client 1: Tech Startup (Full Rebrand)
    const client1 = [
        { url: 'https://figma.com/techstart-brand', title: 'TechStart Brand - Figma', focusMs: 900000 },
        { url: 'https://figma.com/techstart-website', title: 'TechStart Website', focusMs: 840000 },
        { url: 'https://figma.com/techstart-app', title: 'TechStart App', focusMs: 720000 },
        { url: 'https://figma.com/techstart-marketing', title: 'TechStart Marketing', focusMs: 600000 },
        { url: 'https://notion.com/techstart-project', title: 'TechStart Project', focusMs: 480000 },
        { url: 'https://slack.com/techstart', title: 'TechStart Slack', focusMs: 360000 },
        { url: 'https://asana.com/techstart', title: 'TechStart Tasks', focusMs: 420000 },
        { url: 'https://drive.google.com/drive/techstart', title: 'TechStart Drive', focusMs: 300000 },
    ];
    events.push(...generateSession(now - 6 * DAY + 9 * HOUR, client1));
    events.push(...generateSession(now - 5 * DAY + 9 * HOUR, client1));
    events.push(...generateSession(now - 4 * DAY + 9 * HOUR, client1));
    events.push(...generateSession(now - 2 * DAY + 9 * HOUR, client1.slice(0, 6)));
    events.push(...generateSession(now - 1 * DAY + 9 * HOUR, client1.slice(0, 5)));
    
    // Client 2: Restaurant Chain
    const client2 = [
        { url: 'https://figma.com/foodco-rebrand', title: 'FoodCo Rebrand - Figma', focusMs: 780000 },
        { url: 'https://figma.com/foodco-menu', title: 'FoodCo Menu Design', focusMs: 600000 },
        { url: 'https://figma.com/foodco-packaging', title: 'FoodCo Packaging', focusMs: 540000 },
        { url: 'https://canva.com/foodco-social', title: 'FoodCo Social - Canva', focusMs: 480000 },
        { url: 'https://notion.com/foodco-project', title: 'FoodCo Project', focusMs: 360000 },
        { url: 'https://slack.com/foodco', title: 'FoodCo Slack', focusMs: 300000 },
    ];
    events.push(...generateSession(now - 5 * DAY + 14 * HOUR, client2));
    events.push(...generateSession(now - 4 * DAY + 14 * HOUR, client2));
    events.push(...generateSession(now - 3 * DAY + 14 * HOUR, client2));
    events.push(...generateSession(now - 1 * DAY + 14 * HOUR, client2.slice(0, 4)));
    
    // Client 3: E-commerce Fashion
    const client3 = [
        { url: 'https://figma.com/fashionista-ecom', title: 'Fashionista E-com - Figma', focusMs: 840000 },
        { url: 'https://figma.com/fashionista-mobile', title: 'Fashionista Mobile', focusMs: 720000 },
        { url: 'https://figma.com/fashionista-email', title: 'Fashionista Emails', focusMs: 480000 },
        { url: 'https://notion.com/fashionista-project', title: 'Fashionista Project', focusMs: 420000 },
        { url: 'https://slack.com/fashionista', title: 'Fashionista Slack', focusMs: 300000 },
        { url: 'https://shopify.com/fashionista', title: 'Fashionista Shopify', focusMs: 360000 },
    ];
    events.push(...generateSession(now - 4 * DAY + 16 * HOUR, client3));
    events.push(...generateSession(now - 3 * DAY + 16 * HOUR, client3));
    events.push(...generateSession(now - 2 * DAY + 16 * HOUR, client3));
    events.push(...generateSession(now - 1 * DAY + 16 * HOUR, client3.slice(0, 4)));
    
    // Client 4: Healthcare App
    const client4 = [
        { url: 'https://figma.com/healthapp-ui', title: 'HealthApp UI - Figma', focusMs: 720000 },
        { url: 'https://figma.com/healthapp-dashboard', title: 'HealthApp Dashboard', focusMs: 600000 },
        { url: 'https://notion.com/healthapp-project', title: 'HealthApp Project', focusMs: 360000 },
        { url: 'https://slack.com/healthapp', title: 'HealthApp Slack', focusMs: 240000 },
    ];
    events.push(...generateSession(now - 3 * DAY + 18 * HOUR, client4));
    events.push(...generateSession(now - 2 * DAY + 18 * HOUR, client4));
    events.push(...generateSession(now - 1 * DAY + 18 * HOUR, client4.slice(0, 3)));
    
    // Team Management
    const teamMgmt = [
        { url: 'https://notion.com/team-wiki', title: 'Team Wiki', focusMs: 300000 },
        { url: 'https://notion.com/team-processes', title: 'Team Processes', focusMs: 360000 },
        { url: 'https://float.com/schedule', title: 'Float - Team Schedule', focusMs: 420000 },
        { url: 'https://harvest.com/timesheets', title: 'Harvest Timesheets', focusMs: 240000 },
        { url: 'https://slack.com/agency-team', title: 'Agency Team Slack', focusMs: 480000 },
    ];
    events.push(...generateSession(now - 6 * DAY + 18 * HOUR, teamMgmt));
    events.push(...generateSession(now - 4 * DAY + 18 * HOUR, teamMgmt));
    events.push(...generateSession(now - 2 * DAY + 20 * HOUR, teamMgmt));
    
    // New Business / Pitches
    const newBusiness = [
        { url: 'https://docs.google.com/presentation/pitch-client5', title: 'Client 5 Pitch', focusMs: 600000 },
        { url: 'https://figma.com/pitch-mockups', title: 'Pitch Mockups', focusMs: 540000 },
        { url: 'https://notion.com/proposals', title: 'Proposals', focusMs: 360000 },
        { url: 'https://linkedin.com/sales', title: 'LinkedIn Sales', focusMs: 300000 },
    ];
    events.push(...generateSession(now - 5 * DAY + 20 * HOUR, newBusiness));
    events.push(...generateSession(now - 3 * DAY + 20 * HOUR, newBusiness));
    
    addBackgroundNoise(events, now, 6, true);
    
    return {
        name: 'Agency Team Lead',
        description: '4 client projects, team management, and new business development',
        simulates: 'Multi-client agency work with shared tools (Figma, Notion, Slack)',
        timespan: '6 days',
        events,
    };
}

// ── Exports ──────────────────────────────────────────────────

export const ALL_SCENARIOS = [
    { id: 'student', emoji: '👨‍🎓', label: 'Engineering Student (~50 tabs)', generate: engineeringStudent },
    { id: 'founder', emoji: '🚀', label: 'Startup Founder (~80 tabs)', generate: startupFounder },
    { id: 'creator', emoji: '🎬', label: 'Content Creator (~100 tabs)', generate: contentCreator },
    { id: 'datascience', emoji: '🔬', label: 'Data Scientist (~120 tabs)', generate: dataScientist },
    { id: 'designer', emoji: '🎨', label: 'Freelance Designer (~150 tabs)', generate: freelanceDesigner },
    { id: 'developer', emoji: '💻', label: 'Full-Stack Developer (~180 tabs)', generate: fullStackDeveloper },
    { id: 'pm', emoji: '📊', label: 'Product Manager (~200 tabs)', generate: productManager },
    { id: 'agency', emoji: '🏢', label: 'Agency Team Lead (~250 tabs)', generate: agencyTeamLead },
];
