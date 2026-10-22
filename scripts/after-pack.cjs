// electron-builder afterPack：对 .app 做 ad-hoc 签名（本地安装包，未做公证）
const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const entitlements = path.join(__dirname, '..', 'build', 'entitlements.mac.plist');
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--entitlements', entitlements, appPath], {
      stdio: 'inherit',
    });
    console.log('[after-pack] ad-hoc signed:', appPath);
  } catch (e) {
    console.warn('[after-pack] codesign failed (will still package):', e.message);
  }
};
