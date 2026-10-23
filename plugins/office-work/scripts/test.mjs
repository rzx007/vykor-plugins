import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// The runner is tracked plugin source; unit tests never prepare or download OfficeCLI.
const native = process.argv.includes('--native');
if (native && (process.platform !== 'win32' || process.arch !== 'x64')) throw Error('Native integration tests currently require Windows x64.');
const args = ['--test', '--test-concurrency=2'];
if (!native) args.push('--test-skip-pattern=^real OfficeCLI:');
args.push('test/*.test.mjs', '__test__/*.test.mjs');
const result = spawnSync(process.execPath, args, { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
