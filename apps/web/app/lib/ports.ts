import type { Ports } from '@huddle/domain';
import { createContext } from 'react-router';

/**
 * How a loader or action reaches the outside world. The Worker fills this in
 * per request, which is what keeps the route modules free of any Cloudflare
 * import and lets the Node build hand over its own adapter unchanged.
 */
export const portsContext = createContext<Ports>();
