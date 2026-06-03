import { Page, expect } from "@playwright/test";
import { execSync } from "child_process";
import * as path from "path";
import * as os from "os";

export async function login(page: Page) {
  // Add browser logs and error listeners to trace issues
  page.on("console", msg => console.log(`[BROWSER LOG] [${msg.type()}]`, msg.text()));
  page.on("pageerror", err => console.error("[BROWSER ERROR]", err.message));

  const token = `TEST_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const dbPath = path.join(os.homedir(), ".t3/dev/state.sqlite");
  
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 3600000).toISOString();
  
  // Insert the pairing token directly into the SQLite database with exact ISO-compliant timestamps
  const query = `INSERT INTO auth_pairing_links (id, credential, method, role, subject, created_at, expires_at) VALUES ('id_${Date.now()}', '${token}', 'one-time-token', 'owner', 'owner-bootstrap', '${now}', '${expires}');`;
  execSync(`sqlite3 ${dbPath} "${query}"`);
  console.log(`[E2E Auth] Inserted token: ${token}`);
  
  // Navigate to the pair page with the token in the hash
  await page.goto(`/pair#token=${token}`);
  
  // Wait for the sidebar element to render, confirming successful pairing and loading
  await expect(page.locator('[data-testid="command-palette-trigger"]')).toBeVisible({ timeout: 15000 });
}
