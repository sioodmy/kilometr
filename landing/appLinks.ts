import androidLinks from './public/.well-known/assetlinks.json';

export function appLinkFiles(fingerprints: string, teamId: string) {
  const files: { fileName: string; source: string }[] = [];
  if (fingerprints.trim()) {
    const certificates = fingerprints.split(',').map((value) => value.trim().toUpperCase());
    if (certificates.some((value) => !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value)))
      throw new Error('Invalid Android App Links certificate fingerprint');
    files.push({
      fileName: '.well-known/assetlinks.json',
      source: JSON.stringify([
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: {
            namespace: 'android_app',
            package_name: 'app.kilometr',
            sha256_cert_fingerprints: [
              ...androidLinks[0].target.sha256_cert_fingerprints,
              ...certificates,
            ],
          },
        },
      ]),
    });
  }
  if (teamId.trim()) {
    if (!/^[A-Z0-9]{10}$/.test(teamId)) throw new Error('Invalid Apple Team ID');
    files.push({
      fileName: '.well-known/apple-app-site-association',
      source: JSON.stringify({
        applinks: {
          details: [{ appIDs: [`${teamId}.app.kilometr`], components: [{ '/': '/trip/*' }] }],
        },
      }),
    });
  }
  return files;
}
