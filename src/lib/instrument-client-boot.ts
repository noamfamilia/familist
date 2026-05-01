/**
 * Side-effect import: run as early as possible in the client bundle (import first in StartupPerfCapture).
 */
import { markClientBootStart, perfLog } from '@/lib/startupPerfLog'

markClientBootStart()
perfLog('client JS start')
