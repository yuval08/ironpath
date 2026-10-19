import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// Verify the pair AND the previously distributed phone build before packaging.
// Private signing material is never read or copied by this script.
const signer = process.env.APKSIGNER;
const baseline = process.argv[2];
const phase = process.argv[3] ?? 'watch-phase1';
if (!/^watch-phase[1-5]$/.test(phase)) throw new Error('Expected an artifact folder such as watch-phase2');
if (!signer || !baseline) {
  throw new Error('Usage: APKSIGNER=/path/to/apksigner node scripts/package-watch-apks.mjs previous-phone.apk');
}
const files = {
  'ironpath-phone.apk': resolve('android/app/build/outputs/apk/debug/app-debug.apk'),
  'ironpath-watch.apk': resolve('android/wear/build/outputs/apk/debug/wear-debug.apk'),
};
function certificate(file) {
  const output = execFileSync(signer, ['verify', '--print-certs', file], { encoding: 'utf8' });
  const matches = [...output.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-f0-9]+)$/gm)];
  if (matches.length !== 1) throw new Error(`Expected one signer: ${file}`);
  return matches[0][1];
}
const expected = certificate(resolve(baseline));
for (const file of Object.values(files)) {
  if (certificate(file) !== expected) throw new Error(`Signing certificate mismatch: ${file}`);
}
const directory = resolve('artifacts', phase);
mkdirSync(directory, { recursive: true });
const hashes = [];
for (const [name, source] of Object.entries(files)) {
  copyFileSync(source, resolve(directory, name));
  hashes.push(`${createHash('sha256').update(readFileSync(source)).digest('hex')}  ${name}`);
}
writeFileSync(resolve(directory, 'SHA256SUMS'), hashes.join('\n') + '\n');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
writeFileSync(resolve(directory, 'build.json'), JSON.stringify({
  revision, dirty, builtAt: new Date().toISOString(), variant: 'debug', protocolVersion: 1,
  purpose: phase === 'watch-phase1' ? 'Phase 1 connection diagnostics; no workout controls'
    : phase === 'watch-phase2' ? 'Workout snapshot preview and sync foundation; no set controls'
    : phase === 'watch-phase4' ? 'Phone/watch control transfer, finish checkpoint, and rejected-action recovery'
    : 'Watch set controls, durable actions, and local rest timers',
  signingCertificateSha256: expected,
}, null, 2) + '\n');
console.log(`Verified and packaged APK pair in ${directory}`);
