#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

process.chdir(__dirname);

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
        console.log(`Usage: node index.js

Install dependencies, generate Prisma, deploy database migrations,
register Discord commands, and run the bot and web server.
Requires Node.js 24+, npm, a configured config.json, and an existing MySQL database.
Ctrl+C stops all services. Any preparation failure prevents service startup.`);
        return;
    }
    if (args.length) throw new Error(`Unknown argument: ${args[0]}. Use --help for usage.`);
    if (Number(process.versions.node.split('.')[0]) < 24) {
        throw new Error('Node.js 24+ is required.');
    }
    if (!fs.existsSync('config.json')) {
        fs.copyFileSync('configTemplate.json', 'config.json');
        throw new Error('Created config.json. Fill in its credentials and settings, then rerun node index.js.');
    }

    let config;
    try { config = JSON.parse(fs.readFileSync('config.json', 'utf8')); }
    catch { throw new Error('config.json must contain valid JSON.'); }
    const missing = ['TOKEN', 'CLIENT_ID', 'GUILD_ID'].filter(key => !config?.DISCORD?.BOT?.[key]);
    if (missing.length) throw new Error(`Fill in config.json DISCORD.BOT: ${missing.join(', ')}`);

    function npm(args, message, env = {}) {
        console.log(message);
        const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
            stdio: 'inherit',
            env: { ...process.env, ...env },
            shell: process.platform === 'win32',
        });
        if (result.error) throw new Error(`Could not run npm: ${result.error.message}`);
        if (result.status !== 0) {
            process.exitCode = result.status || 1;
            throw new Error(`${message} failed${result.signal ? ` (${result.signal})` : ''}. Services were not started.`);
        }
    }

    const installEnv = { NODE_OPTIONS: '--max-old-space-size=128' };
    const ready = path.join('node_modules', '.hosting-install-ready');
    if (!fs.existsSync(ready)) {
        if (fs.existsSync('node_modules')) fs.renameSync('node_modules', 'node_modules.incomplete-' + Date.now());
        npm(['ci', '--include=dev', '--no-audit', '--no-fund', '--maxsockets=1'], 'Installing locked application dependencies...', installEnv);
        fs.writeFileSync(ready, 'Installed from package-lock.json');
    }
    process.env.NODE_ENV = 'production';
    fs.mkdirSync(path.join('src', 'cache'), { recursive: true });
    npm(['run', 'prisma:generate'], 'Generating Prisma client...');
    npm(['run', 'prisma:migrate'], 'Applying database migrations...');
    process.env.PORTAL_ENABLED = 'false';
    console.log('Portal frontend disabled; starting bot and API only.');
    npm(['run', 'deploy'], 'Deploying Discord commands...');

    console.log('Starting bot and server. Press Ctrl+C to stop both.');
    // Load after installation so this script also works on a fresh checkout.
    const concurrently = require('concurrently');
    const { result } = concurrently([
        { name: 'bot', command: 'node src/bot/index.js' },
        { name: 'server', command: 'node src/server/index.js' },
    ], { killOthers: ['success', 'failure'] });
    try { await result; }
    catch { process.exitCode = 1; }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = process.exitCode || 1;
});
