const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withBackgroundActionsHealth(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const application = manifest.manifest.application[0];

    if (!application.service) {
      application.service = [];
    }

    const serviceName = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';
    const existing = application.service.find(
      (s) => s.$['android:name'] === serviceName
    );

    if (existing) {
      // 이미 있으면 타입만 추가
      existing.$['android:foregroundServiceType'] = 'health';
    } else {
      // 없으면 서비스 엔트리 직접 추가
      application.service.push({
        $: {
          'android:name': serviceName,
          'android:exported': 'false',
          'android:foregroundServiceType': 'health',
        },
      });
    }

    // FOREGROUND_SERVICE_HEALTH 권한 추가
    if (!manifest.manifest['uses-permission']) {
      manifest.manifest['uses-permission'] = [];
    }
    const hasPermission = manifest.manifest['uses-permission'].some(
      (p) => p.$['android:name'] === 'android.permission.FOREGROUND_SERVICE_HEALTH'
    );
    if (!hasPermission) {
      manifest.manifest['uses-permission'].push({
        $: { 'android:name': 'android.permission.FOREGROUND_SERVICE_HEALTH' },
      });
    }

    return config;
  });
};
