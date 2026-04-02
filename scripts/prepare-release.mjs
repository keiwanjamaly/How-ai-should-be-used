import fs from 'fs';
import path from 'path';

const version = process.argv[2];
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

if (!version || !semverPattern.test(version)) {
  console.error('Usage: npm run release:prepare -- <x.y.z[-label]>');
  process.exit(1);
}

const root = process.cwd();
const packageJsonPath = path.join(root, 'package.json');
const manifestPath = path.join(root, 'manifest.json');
const versionsPath = path.join(root, 'versions.json');
const packageLockPath = path.join(root, 'package-lock.json');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
const packageLock = fs.existsSync(packageLockPath)
  ? JSON.parse(fs.readFileSync(packageLockPath, 'utf8'))
  : null;

packageJson.version = version;
manifest.version = version;
versions[version] = manifest.minAppVersion;

if (packageLock) {
  packageLock.version = version;
  if (packageLock.packages && packageLock.packages['']) {
    packageLock.packages[''].version = version;
  }
}

fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(versionsPath, `${JSON.stringify(versions, null, 2)}\n`);
if (packageLock) {
  fs.writeFileSync(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`);
}

console.log(`Prepared release ${version}`);
