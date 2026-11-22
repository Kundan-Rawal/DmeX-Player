// Compatibility entry point for the recording-adaptive status contract.
if(process.env.ANDROID_STATUS_TEST!=='approved')throw new Error('Obtain approval to install/open the update before device verification.');
process.env.ANDROID_ENHANCED_TEST='approved';
await import('./android-enhanced-status.mjs');
