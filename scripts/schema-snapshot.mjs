import { readFile, writeFile } from 'node:fs/promises';
import { runCli, version } from '../dist/cli.js';

const args = process.argv.slice(2);
if (args.length !== 1 || !['--write', '--check'].includes(args[0])) throw Error('Usage: node scripts/schema-snapshot.mjs --write|--check');
const target = new URL('../docs/schema.json', import.meta.url);
let stdout = '';
const forbidden = () => { throw Error('Schema snapshot must be offline and credential-free'); };
globalThis.fetch = forbidden;
const exitCode = await runCli(['schema', '--json'], {
  env: { CINA_CONFIG_DIR: 'deliberately-invalid' },
  io: { out: value => { stdout += value; }, err: forbidden, isTTY: false },
  store: { get: forbidden, set: forbidden, remove: forbidden }, openBrowser: forbidden,
});
if (exitCode !== 0) throw Error('Schema generation failed');
const envelope = JSON.parse(stdout);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const snapshot = JSON.stringify(canonical({ cliVersion: version, contractVersion: envelope.contractVersion, ...envelope.data,
  commands: envelope.data.commands.toSorted((a, b) => a.command.localeCompare(b.command, 'en')),
}), null, 2) + '\n';
if (args[0] === '--write') await writeFile(target, snapshot);
else {
  const recorded = (await readFile(target, 'utf8')).replaceAll('\r\n', '\n');
  if (recorded !== snapshot) throw Error('Schema snapshot changed. Review the contract diff and run pnpm schema:update.');
}
console.log(JSON.stringify({ ok: true, mode: args[0].slice(2), version, commands: envelope.data.commands.length }));
