// plugins/withHealthKitBackground.js
// Config Plugin: HealthKit Background Delivery (CashWalk-like)
// - Entitlements: com.apple.developer.healthkit + background-delivery
// - Info.plist: UIBackgroundModes (fetch), BGTaskSchedulerPermittedIdentifiers
// - AppDelegate.mm: HKObserverQuery + enableBackgroundDelivery → triggers JS background fetch

const {
  withAppDelegate,
  withInfoPlist,
  withEntitlementsPlist,
} = require('@expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

// ─── 1. HealthKit entitlements ───────────────────────────────────────────────
function withHealthKitEntitlements(config) {
  return withEntitlementsPlist(config, (cfg) => {
    cfg.modResults['com.apple.developer.healthkit'] = true;
    cfg.modResults['com.apple.developer.healthkit.background-delivery'] = true;
    if (!Array.isArray(cfg.modResults['com.apple.developer.healthkit.access'])) {
      cfg.modResults['com.apple.developer.healthkit.access'] = [];
    }
    return cfg;
  });
}

// ─── 2. Info.plist: UIBackgroundModes + BGTaskSchedulerPermittedIdentifiers ──
function withBackgroundPlist(config) {
  return withInfoPlist(config, (cfg) => {
    // UIBackgroundModes: fetch lets expo-background-fetch run JS task
    const modes = cfg.modResults.UIBackgroundModes || [];
    if (!modes.includes('fetch')) modes.push('fetch');
    cfg.modResults.UIBackgroundModes = modes;

    // BGTaskSchedulerPermittedIdentifiers (iOS 13+)
    const ids = cfg.modResults.BGTaskSchedulerPermittedIdentifiers || [];
    const taskId = 'com.seoma.pedmeter.bg-sync';
    if (!ids.includes(taskId)) ids.push(taskId);
    cfg.modResults.BGTaskSchedulerPermittedIdentifiers = ids;

    return cfg;
  });
}

// ─── 3. AppDelegate.mm: HKObserverQuery setup ────────────────────────────────
const HK_IMPORT = `#import <HealthKit/HealthKit.h>`;

const HK_METHOD = `
// withHealthKitBackground: HealthKit observer for background step sync
- (void)setupHealthKitBackgroundDelivery {
  if (![HKHealthStore isHealthDataAvailable]) return;

  HKHealthStore *healthStore = [[HKHealthStore alloc] init];
  HKQuantityType *stepType = [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierStepCount];

  [healthStore enableBackgroundDeliveryForType:stepType
                                     frequency:HKUpdateFrequencyImmediate
                                withCompletion:^(BOOL success, NSError *error) {
    if (!success) return;

    HKObserverQuery *query = [[HKObserverQuery alloc]
      initWithSampleType:stepType
               predicate:nil
           updateHandler:^(HKObserverQuery *q,
                           HKObserverQueryCompletionHandler completionHandler,
                           NSError *err) {
      if (!err) {
        // Ask iOS to wake JS as soon as possible via background fetch
        dispatch_async(dispatch_get_main_queue(), ^{
          [[UIApplication sharedApplication]
            setMinimumBackgroundFetchInterval:UIApplicationBackgroundFetchIntervalMinimum];
        });
      }
      completionHandler();
    }];

    [healthStore executeQuery:query];
  }];
}
`;

function withHealthKitAppDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    // Only modify Objective-C / Objective-C++ files
    if (!['objc', 'objcpp'].includes(cfg.modResults.language)) {
      console.warn('[withHealthKitBackground] AppDelegate language not ObjC — skipping AppDelegate patch');
      return cfg;
    }

    let src = cfg.modResults.contents;

    // ── a) Add HealthKit import (once) ──────────────────────────────────────
    if (!src.includes(HK_IMPORT)) {
      const importResult = mergeContents({
        src,
        newSrc: HK_IMPORT,
        anchor: /#import <React\/RCTBundleURLProvider\.h>/,
        offset: 1,
        tag: 'withHealthKitBackground-import',
        comment: '//',
      });
      if (importResult.didMerge) src = importResult.contents;
    }

    // ── b) Call setupHealthKitBackgroundDelivery in didFinishLaunching ──────
    if (!src.includes('setupHealthKitBackgroundDelivery')) {
      const callResult = mergeContents({
        src,
        newSrc: '  [self setupHealthKitBackgroundDelivery];',
        anchor: /return \[super application:application didFinishLaunchingWithOptions:launchOptions\]/,
        offset: 0,
        tag: 'withHealthKitBackground-setup-call',
        comment: '//',
      });
      if (callResult.didMerge) src = callResult.contents;
    }

    // ── c) Add the method body before @end ───────────────────────────────────
    if (!src.includes('setupHealthKitBackgroundDelivery {')) {
      const methodResult = mergeContents({
        src,
        newSrc: HK_METHOD,
        anchor: /@end/,
        offset: 0,
        tag: 'withHealthKitBackground-method',
        comment: '//',
      });
      if (methodResult.didMerge) src = methodResult.contents;
    }

    cfg.modResults.contents = src;
    return cfg;
  });
}

// ─── Compose ─────────────────────────────────────────────────────────────────
module.exports = function withHealthKitBackground(config) {
  config = withHealthKitEntitlements(config);
  config = withBackgroundPlist(config);
  config = withHealthKitAppDelegate(config);
  return config;
};
