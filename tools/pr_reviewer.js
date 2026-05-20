const https = require('https');
const T = process.env.GITHUB_TOKEN;
const BH = 'UnsafeLabs/Bounty-Hunters';

async function api(m, p, b) {
  return new Promise(r => {
    const opts = { hostname: 'api.github.com', method: m, path: p, headers: { 'User-Agent': 'n', 'Authorization': 'token ' + T, 'Content-Type': 'application/json', rejectUnauthorized: false } };
    const req = https.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r({ s: res.statusCode, h: res.headers.link || '', d: JSON.parse(d) })); });
    if (b) req.write(JSON.stringify(b));
    req.end();
  });
}

async function allPages(path) {
  let all = [], p = path;
  while (true) {
    const r = await api('GET', p);
    if (Array.isArray(r.d)) all.push(...r.d);
    const m = r.h.match(/<([^>]+)>;\s*rel="next"/);
    if (!m) break;
    p = m[1].replace(/^https:\/\/api\.github\.com/, '');
  }
  return all;
}

(async () => {
  const prs = await allPages('/repos/' + BH + '/pulls?state=open&per_page=100');
  const others = prs.filter(p => !p.head?.label?.startsWith('Gaotax2006:'));
  console.log('PRs to review: ' + others.length);
  for (const pr of others.slice(0, 30)) {
    try {
      const files = await api('GET', '/repos/' + BH + '/pulls/' + pr.number + '/files?per_page=100');
      if (!Array.isArray(files.d)) continue;
      const reports = [];
      for (const f of files.d) {
        if (f.status === 'removed') continue;
        if (/CONTRIBUTORS\.json/i.test(f.filename)) reports.push('- HIGH: CONTRIBUTORS.json modification detected');
        if (/\/\/\s*(Contributor|Platform|Runtime|Date):/i.test(f.patch || '')) reports.push('- HIGH: AI training leakage marker in .sol header');
        if (/jwt\.decode\([^)]*\)(?!\s*,\s*\[)/i.test(f.patch || '')) reports.push('- HIGH: jwt.decode() without algorithm pinning');
      }
      if (reports.length > 0) {
        await api('POST', '/repos/' + BH + '/pulls/' + pr.number + '/comments', {
          body: '### Auto Review\n\n' + reports.join('\n') + '\n\n*Automated by tools/pr_reviewer.js*',
          commit_id: pr.head.sha, path: files.d[0].filename, line: 1, side: 'RIGHT'
        });
        console.log('#' + pr.number + ' (' + pr.user.login + '): ' + reports.length + ' issue(s)');
      }
    } catch (e) {}
  }
  console.log('Done');
})();
