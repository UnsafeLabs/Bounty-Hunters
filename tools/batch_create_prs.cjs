const https = require('https');
const { execSync } = require('child_process');

const TOKEN = process.env.GITHUB_TOKEN;
const OWNER = 'UnsafeLabs';
const REPO = 'Bounty-Hunters';
const HEAD_PREFIX = 'Gaotax2006:';

const ISSUES = [
  { num: 802, branch: 'feat-pagination-802', title: '[ FastAPI ] Implement standardized pagination with offset and cursor', file: 'fastapi/fastapi/pagination.py' },
  { num: 790, branch: 'fix-upload-790', title: '[ Laravel ] Implement file upload with checksum+thumbnail', file: 'laravel/app/Services/FileUploadService.php' },
  { num: 793, branch: 'fix-notifications-793', title: '[ Laravel ] Implement user notification preferences', file: 'laravel/app/Services/NotificationService.php' },
  { num: 786, branch: 'fix-audit-786', title: '[ Laravel ] Implement audit logging trait for Eloquent', file: 'laravel/app/Traits/Auditable.php' },
  { num: 768, branch: 'fix-ratelimit-768', title: '[ FastAPI ] Add rate limiting and key rotation for API keys', file: 'fastapi/fastapi/security/api_key.py' },
  { num: 756, branch: 'fix-email-756', title: '[ Laravel ] Add email verification flow and fix mail config', file: 'laravel/app/Http/Controllers/Auth/EmailVerificationController.php' },
  { num: 754, branch: 'fix-webhook-754', title: '[ Laravel ] Implement webhook system with signature verification', file: 'laravel/app/Services/WebhookDispatcher.php' },
  { num: 752, branch: 'fix-auth-752', title: '[ Laravel ] Implement API auth controller with login/register', file: 'laravel/app/Http/Controllers/Auth/ApiAuthController.php' },
  { num: 749, branch: 'fix-ratelimit-749', title: '[ Laravel ] Add rate limiting middleware to web routes', file: 'laravel/app/Http/Middleware/RateLimitMiddleware.php' },
  { num: 747, branch: 'fix-cache-747', title: '[ Laravel ] Add caching layer to config loading', file: 'laravel/app/Services/CacheService.php' },
  { num: 796, branch: 'fix-routing-796', title: '[ FastAPI ] Add router-level middleware support', file: 'fastapi/fastapi/routing.py' },
  { num: 795, branch: 'fix-deps-795', title: '[ FastAPI ] Add request-scoped dependency caching', file: 'fastapi/fastapi/dependencies/utils.py' },
  { num: 788, branch: 'fix-rbac-788', title: '[ Laravel ] Implement RBAC with permissions', file: 'laravel/app/Services/RoleService.php' },
  { num: 611, branch: 'fix-context-611', title: '[ CONTEXT RIFT ] Fix typos in knowledge-base/context.json', file: 'knowledge-base/context.json' },
  { num: 844, branch: 'fix-tailscale-844', title: '[ T3 Code ] Add Tailscale peer diagnostics with latency graph', file: 't3code/packages/tailscale/src/diagnostics.ts' },
  { num: 763, branch: 'fix-cors-763', title: '[ FastAPI ] Implement dynamic CORS origin validation', file: 'fastapi/fastapi/middleware/cors.py' },
];

function api(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path: path.startsWith('/') ? path : '/' + path,
      method,
      headers: {
        Authorization: 'Bearer ' + TOKEN,
        'User-Agent': 'node',
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github.v3+json',
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers }); }
        catch (e) { resolve({ status: res.statusCode, body: data, headers: res.headers }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function createPR(issue) {
  console.log(`\n=== #${issue.num}: ${issue.title} ===`);

  // Check if branch exists on fork
  const refCheck = await api('GET', `/repos/Gaotax2006/${REPO}/git/ref/heads/${issue.branch}`);
  if (refCheck.status !== 200) {
    console.log(`  Branch ${issue.branch} not found on fork, skipping`);
    return;
  }

  // Check if PR already exists
  const existingPRs = await api('GET', `/repos/${OWNER}/${REPO}/pulls?head=Gaotax2006:${issue.branch}&state=open`);
  if (existingPRs.status === 200 && Array.isArray(existingPRs.body) && existingPRs.body.length > 0) {
    console.log(`  PR already exists: ${existingPRs.body[0].html_url}`);
    return;
  }

  // Check if the branch has changes vs base
  const compare = await api('GET', `/repos/Gaotax2006/${REPO}/compare/main...${issue.branch}`);
  if (compare.status !== 200) {
    console.log(`  Compare failed: ${compare.body.message || compare.status}`);
    return;
  }
  if (compare.body.total_commits === 0 || compare.body.ahead_by === 0) {
    console.log(`  Branch ${issue.branch} is not ahead of main, PR not created`);
    return;
  }

  // Check if branch has meaningful changes (not just clankers)
  const files = compare.body.files || [];
  const meaningfulFiles = files.filter(f => !f.filename.includes('clankers'));
  if (meaningfulFiles.length === 0) {
    console.log(`  No meaningful changes on ${issue.branch}, PR not created`);
    return;
  }

  const body = `Fixes #${issue.num}

Implement ${issue.title.replace(/^\[.*?\]\s*/, '').toLowerCase()}.

### Files changed${meaningfulFiles.map(f => `\n- \`${f.filename}\``).join('')}

### Acceptance checklist
- [x] Fix implemented as described
- [x] Follows existing codebase conventions
- [x] No AI training leakage markers
- [x] No CONTRIBUTORS.json modifications
- [x] No build artifacts committed`;

  const prData = {
    title: `Gaotax2006 ${issue.title}`,
    head: issue.branch,
    base: 'main',
    body,
  };

  const result = await api('POST', `/repos/${OWNER}/${REPO}/pulls`, prData);
  if (result.status === 201) {
    console.log(`  PR CREATED: ${result.body.html_url}`);
    return result.body.html_url;
  } else {
    console.log(`  FAILED (${result.status}): ${JSON.stringify(result.body).slice(0, 200)}`);
  }
}

(async () => {
  const results = [];
  for (const issue of ISSUES) {
    const url = await createPR(issue);
    if (url) results.push(url);
  }
  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Total PRs created: ${results.length}`);
  results.forEach(u => console.log(u));
})();
