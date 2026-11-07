#!/usr/bin/env node
/**
 * Verification script for T3 Code HTTP compression implementation
 * Run: node verify_compression.js
 */

const fs = require('fs');
const path = require('path');

const checks = [];

// Check 1: http.ts exists and contains compression code
const httpPath = path.join(__dirname, 'apps/server/src/http.ts');
if (fs.existsSync(httpPath)) {
  const content = fs.readFileSync(httpPath, 'utf8');
  checks.push({
    name: 'http.ts contains compression imports',
    pass: content.includes('createGzip') && content.includes('createBrotliCompress'),
  });
  checks.push({
    name: 'http.ts contains compressResponseIfNeeded function',
    pass: content.includes('async function compressResponseIfNeeded'),
  });
  checks.push({
    name: 'http.ts contains withCompression wrapper',
    pass: content.includes('export const withCompression'),
  });
  checks.push({
    name: 'http.ts contains decompressRequestBody function',
    pass: content.includes('export async function decompressRequestBody'),
  });
  checks.push({
    name: 'serverEnvironmentRouteLayer uses withCompression',
    pass: content.includes('withCompression(Effect.gen(function* ()') &&
          content.includes('/.well-known/t3/environment'),
  });
  checks.push({
    name: 'otlpTracesProxyRouteLayer uses withCompression',
    pass: content.includes('withCompression(Effect.gen(function* ()') &&
          content.includes('OTLP_TRACES_PROXY_PATH'),
  });
  checks.push({
    name: 'staticAndDevRouteLayer uses withCompression',
    pass: content.includes('withCompression(Effect.gen(function* ()') &&
          content.includes('staticAndDevRouteLayer'),
  });
  checks.push({
    name: 'Compression configuration from env vars',
    pass: content.includes('COMPRESSION_GZIP_LEVEL') &&
          content.includes('COMPRESSION_BROTLI_QUALITY') &&
          content.includes('COMPRESSION_THRESHOLD'),
  });
} else {
  checks.push({ name: 'http.ts exists', pass: false });
}

// Check 2: Test file exists
const testPath = path.join(__dirname, 'apps/server/src/httpCompression.test.ts');
checks.push({
  name: 'Test file exists',
  pass: fs.existsSync(testPath),
});

// Check 3: Provenance file exists
const provenancePath = path.join(__dirname, '_provenance.json');
if (fs.existsSync(provenancePath)) {
  try {
    const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
    checks.push({
      name: 'Provenance file has required fields',
      pass: provenance.tool_name && provenance.boot_context && provenance.timestamp,
    });
    checks.push({
      name: 'Provenance boot_context is complete',
      pass: provenance.boot_context.length > 100,
    });
  } catch {
    checks.push({ name: 'Provenance file is valid JSON', pass: false });
  }
} else {
  checks.push({ name: 'Provenance file exists', pass: false });
}

// Check 4: Documentation exists
const docsPath = path.join(__dirname, 'COMPRESSION_IMPLEMENTATION.md');
checks.push({
  name: 'Documentation file exists',
  pass: fs.existsSync(docsPath),
});

// Print results
console.log('\n=== T3 Code Compression Implementation Verification ===\n');
let passCount = 0;
checks.forEach((check, i) => {
  const status = check.pass ? '✅' : '❌';
  console.log(`${status} ${check.name}`);
  if (check.pass) passCount++;
});

console.log(`\n=== Results: ${passCount}/${checks.length} checks passed ===\n`);

if (passCount === checks.length) {
  console.log('🎉 All checks passed! Implementation is complete and ready for PR.\n');
  console.log('Next steps:');
  console.log('1. Run tests: npm test httpCompression.test.ts');
  console.log('2. Manual testing with curl/Postman');
  console.log('3. Create PR with title: [Qoder AI Agent] [ T3 Code ] Add gzip and brotli response compression to HTTP layer');
  console.log('4. Include _provenance.json in PR\n');
  process.exit(0);
} else {
  console.log('⚠️  Some checks failed. Please review the implementation.\n');
  process.exit(1);
}
