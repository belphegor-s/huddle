/**
 * Node adapter: libSQL, filesystem or S3 compatible blobs, and an in process
 * WebSocket hub. This is the self hosted half of the ports and adapters
 * design and is built next, alongside the Docker Compose target.
 *
 * Nothing imports it yet. It exists as a package so the workspace boundary is
 * established before the code lands.
 */
export const ADAPTER_NODE_READY = false;
