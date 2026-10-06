import { heartbeatJob } from './heartbeat';
import type { JobDefinition } from './types';

/** Every job the worker processes. Later phases register their jobs here. */
export const jobs: JobDefinition[] = [heartbeatJob];
