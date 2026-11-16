// Each test worker reads the folder the global set-up provisioned, the same way a deployment names its own.
import { GS1_ARTEFACTS_DIR_ENV } from '@bsv/dpp-credentials'
import { gs1TestDir } from './gs1-global-setup.js'

process.env[GS1_ARTEFACTS_DIR_ENV] = gs1TestDir()
