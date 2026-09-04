import { initCinematicOrchestrator } from './cinematic-orchestrator.js';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCinematicOrchestrator);
} else {
  initCinematicOrchestrator();
}
