'use strict';
// Separate unmodified Audiveris aggregate: its own AGPL/GPL and third-party notices apply.
const fs=require('node:fs'),path=require('node:path');
const {verifyBundleFiles,inspectBundleManifest}=require('./offline-audio.cjs');
const PINNED_OMR_MANIFEST_SHA256='7606a485f0a68d7f1fbf798ad5f35d9f97a5ccdda95556b6a5e5b614679bf315';
const BUNDLE_NAME='score-offline-v1';
const REQUIRED_FILES=['Audiveris/Audiveris.exe','Audiveris/app/Audiveris.cfg','Audiveris/app/audiveris.jar','Audiveris/runtime/bin/java.dll','Audiveris/runtime/bin/server/jvm.dll','tessdata/eng.traineddata','tessdata/chi_sim.traineddata'];
class OfflineOmrBundle{
 constructor(runtime){this.directory=path.join(runtime,BUNDLE_NAME);}
 get present(){try{fs.lstatSync(this.directory);return true;}catch(e){return e.code!=='ENOENT';}}
 get engine(){return path.join(this.directory,'Audiveris','Audiveris.exe');}
 get tessdata(){return path.join(this.directory,'tessdata');}
 inspect(){return inspectBundleManifest(this.directory,PINNED_OMR_MANIFEST_SHA256,BUNDLE_NAME,REQUIRED_FILES);}
 async verify(checkCancel=()=>{}){return verifyBundleFiles(this.directory,PINNED_OMR_MANIFEST_SHA256,BUNDLE_NAME,{requiredFiles:REQUIRED_FILES,checkCancel});}
}
module.exports={OfflineOmrBundle,PINNED_OMR_MANIFEST_SHA256,BUNDLE_NAME,REQUIRED_FILES};
