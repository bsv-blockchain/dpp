import { GS1_ARTEFACTS_DIR_ENV } from '../src/gs1-artefacts.js';
import { gs1TestArtefactsDir } from './gs1-global-setup.js';

// Each test worker reads the folder the global set-up provisioned, the same way a deployment names its own.
process.env[GS1_ARTEFACTS_DIR_ENV] = gs1TestArtefactsDir();
