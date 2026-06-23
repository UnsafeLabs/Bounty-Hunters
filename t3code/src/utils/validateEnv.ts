// Environment variable validation utility
export function validateEnvVars(): void {
    const required = [
        "NODE_ENV",
        "DATABASE_URL",
        "SESSION_SECRET",
        "PORT"
    ];
    const missing: string[] = [];
    for (const key of required) {
        if (!process.env[key]) {
            missing.push(key);
        }
    }
    if (missing.length > 0) {
        console.error(`Missing required environment variables: ${missing.join(", ")}`);
        process.exit(1);
    }
    console.log("All required environment variables are set");
}
