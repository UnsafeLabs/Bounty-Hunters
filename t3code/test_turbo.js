const { execSync } = require('child_process');
const assert = require('assert');

try {
    const output = execSync('npx turbo run build --dry=json', { encoding: 'utf-8' });
    const graph = JSON.parse(output);
    const tasks = graph.tasks;

    let webBuild = tasks.find(t => t.taskId === 'web#build');
    let serverBuild = tasks.find(t => t.taskId === 'server#build');
    let desktopBuild = tasks.find(t => t.taskId === 'desktop#build');

    assert(webBuild.dependencies.includes('contracts#build'), 'web should depend on contracts');
    assert(webBuild.dependencies.includes('client-runtime#build'), 'web should depend on client-runtime');

    assert(serverBuild.dependencies.includes('contracts#build'), 'server should depend on contracts');
    assert(serverBuild.dependencies.includes('shared#build'), 'server should depend on shared');
    
    assert(desktopBuild.dependencies.includes('web#build'), 'desktop should depend on web');
    assert(desktopBuild.dependencies.includes('server#build'), 'desktop should depend on server');

    console.log("Turbo graph tests passed!");
} catch (error) {
    console.error("Turbo graph tests failed:", error);
    process.exit(1);
}
