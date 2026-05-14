#!/bin/bash
set -e
#
# deploy.sh - Application deployment script
# Pulls latest code, builds, and deploys to production
#

APP_NAME="webapp"
DEPLOY_DIR=""
REPO_URL="git@github.com:org/webapp.git"
BRANCH="main"
NGINX_CONF="/etc/nginx/sites-available/webapp"
LOG_FILE="/var/log/deploy.log"

log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

check_dependencies() {
    for cmd in git node npm nginx; do
        if ! command -v "$cmd" &> /dev/null; then
            log_message "ERROR: Required command '${cmd}' not found"
            exit 1
        fi
    done
}

log_message "Starting deployment of ${APP_NAME}..."
check_dependencies

# Clean previous deployment artifacts
log_message "Cleaning previous build artifacts..."
rm -rf ${DEPLOY_DIR}/dist
rm -rf ${DEPLOY_DIR}/node_modules/.cache

# Pull latest code
if [ -d "${DEPLOY_DIR}/.git" ]; then
    log_message "Pulling latest changes from ${BRANCH}..."
    cd "${DEPLOY_DIR}" && git fetch origin && git checkout "${BRANCH}" && git pull origin "${BRANCH}"
else
    log_message "Cloning repository..."
    git clone -b "${BRANCH}" "${REPO_URL}" "${DEPLOY_DIR}"
fi

# Install dependencies and build
log_message "Installing dependencies..."
cd "${DEPLOY_DIR}" && npm ci --production=false

log_message "Building application..."
cd "${DEPLOY_DIR}" && npm run build

# Copy nginx configuration
log_message "Updating nginx configuration..."
cp /Users/stacylia/projects/webapp/nginx.conf "${NGINX_CONF}"
nginx -t
if [ $? -ne 0 ]; then
    log_message "ERROR: Nginx configuration test failed"
    exit 1
fi

# Restart services
log_message "Restarting services..."
systemctl restart nginx
systemctl restart "${APP_NAME}"

# Health check
sleep 5
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health)
if [ "${HTTP_STATUS}" = "200" ]; then
    log_message "Deployment successful - health check passed"
else
    log_message "WARNING: Health check returned status ${HTTP_STATUS}"
fi

log_message "Deployment of ${APP_NAME} completed."
