const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoDir = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const desktop = path.join(os.homedir(), 'Desktop');
const requestedOutputDir = process.env.AEGIS_DEBUG_OUTPUT_DIR || (process.env.CI ? repoDir : '');
const outputDir = requestedOutputDir || (fs.existsSync(desktop) ? desktop : repoDir);
fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `aegis-debug-${timestamp}.txt`);

function command(commandName, args) {
  const result = spawnSync(commandName, args, { cwd: repoDir, encoding: 'utf8', windowsHide: true });
  return {
    command: `${commandName} ${args.join(' ')}`,
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim()
  };
}

function tail(filePath, maxLines = 500) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  try {
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).slice(-maxLines).join('\n');
  } catch (error) {
    return `Could not read ${filePath}: ${error.message}`;
  }
}

function findAegisLogs() {
  const roots = [process.env.APPDATA, process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = [];
  for (const root of roots) {
    for (const relative of [
      'Aegis/logs/aegis.log',
      'Aegis/aegis.log',
      'aegis-chatgpt-client/logs/aegis.log',
      'aegis-chatgpt-client/aegis.log',
      'aegis-autopilot/logs/aegis.log',
      'aegis-autopilot/aegis.log'
    ]) {
      const candidate = path.join(root, ...relative.split('/'));
      if (fs.existsSync(candidate)) candidates.push(candidate);
    }
  }
  return [...new Set(candidates)];
}

const checks = [
  command('git', ['rev-parse', 'HEAD']),
  command('git', ['branch', '--show-current']),
  command('git', ['status', '--short']),
  command('git', ['diff', '--stat']),
  command(process.execPath, ['--version']),
  command(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'])
];

const logs = findAegisLogs();
const sections = [
  '# Aegis debug bundle',
  `capturedAt: ${new Date().toISOString()}`,
  `packageVersion: ${packageJson.version}`,
  `buildSha: ${process.env.AEGIS_BUILD_SHA || ''}`,
  `platform: ${process.platform} ${process.arch}`,
  `os: ${os.type()} ${os.release()} ${os.version?.() || ''}`,
  `node: ${process.versions.node}`,
  `electronDependency: ${packageJson.devDependencies?.electron || ''}`,
  '',
  '# Repository checks',
  ...checks.flatMap((entry) => [
    `## ${entry.command}`,
    `status: ${entry.status}`,
    entry.stdout || '(no stdout)',
    entry.stderr ? `stderr:\n${entry.stderr}` : '',
    ''
  ]),
  '# Aegis logs',
  logs.length ? logs.map((filePath) => `## ${filePath}\n${tail(filePath)}`).join('\n\n') : 'No known Aegis log file was found automatically.',
  '',
  '# Next step',
  'Inside Aegis: open one ChatGPT conversation, clear the composer, press “Тест отправки”, then paste the copied SEND TEST report below this bundle.'
];

fs.writeFileSync(outputPath, sections.filter((line) => line !== '').join('\n'), 'utf8');
console.log(`[Aegis] Debug bundle created: ${outputPath}`);
