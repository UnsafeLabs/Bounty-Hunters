import { readFileSync } from "node:fs";

const oauth2 = readFileSync("fastapi/fastapi/security/oauth2.py", "utf8");
const securityInit = readFileSync("fastapi/fastapi/security/__init__.py", "utf8");
const rootInit = readFileSync("fastapi/fastapi/__init__.py", "utf8");
const tests = readFileSync("fastapi/tests/test_security_oauth2_refresh.py", "utf8");
const provenance = readFileSync("fastapi/fastapi/security/.provenance.json", "utf8");

const checks = [
  ["OAuth2PasswordBearerWithRefresh class", /class OAuth2PasswordBearerWithRefresh\(OAuth2PasswordBearer\)/.test(oauth2)],
  ["refresh_url parameter", /refresh_url: Annotated\[\s*str,/.test(oauth2)],
  ["refreshUrl forwarded to OpenAPI flow", /refreshUrl=refresh_url/.test(oauth2)],
  ["OAuth2RefreshRequestForm class", /class OAuth2RefreshRequestForm:/.test(oauth2)],
  ["refresh grant pattern", /Form\(pattern="\^refresh_token\$"\)/.test(oauth2)],
  ["refresh token form field", /self\.refresh_token = refresh_token/.test(oauth2)],
  ["security exports", securityInit.includes("OAuth2PasswordBearerWithRefresh") && securityInit.includes("OAuth2RefreshRequestForm")],
  ["root exports", rootInit.includes("OAuth2PasswordBearerWithRefresh") && rootInit.includes("OAuth2RefreshRequestForm")],
  ["OpenAPI test covers refreshUrl", tests.includes('"refreshUrl": "token/refresh"')],
  ["standard bearer behavior test", tests.includes("OAuth2PasswordBearer(") && tests.includes("legacytoken")],
  ["safe provenance metadata", provenance.includes("Codex GPT-5") && provenance.includes("safe public metadata")],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(failed.map(([name]) => `FAILED: ${name}`).join("\n"));
  process.exit(1);
}

console.log(`oauth2 refresh checks passed (${checks.length})`);
