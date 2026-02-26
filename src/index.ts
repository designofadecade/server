// Server Core
export { default as Server } from './server/Server.js';
export { default as Router } from './router/Router.js';
export { default as Routes } from './router/Routes.js';
export { default as StaticFileHandler } from './router/StaticFileHandler.js';

// WebSocket
export { default as WebSocketServer } from './websocket/WebSocketServer.js';
export { default as WebSocketMessageFormatter } from './websocket/WebSocketMessageFormatter.js';

// Middleware
export * from './middleware/RequestLogger.js';

// State & Events
export { default as AppState } from './state/AppState.js';
export { default as Events } from './events/Events.js';
export { default as EventsManager } from './events/EventsManager.js';

// Utilities (individual exports)
export { default as HtmlSanitizer } from './sanitizer/HtmlSanitizer.js';
export { default as HtmlRenderer } from './utils/HtmlRenderer.js';
export { default as Local } from './local/Local.js';
export { logger } from './logger/Logger.js';
export { default as ApiClient } from './client/ApiClient.js';

// Utilities (grouped namespace - classes only)
import HtmlSanitizer from './sanitizer/HtmlSanitizer.js';
import HtmlRenderer from './utils/HtmlRenderer.js';
import Local from './local/Local.js';
import ApiClient from './client/ApiClient.js';

export const Utils = {
    HtmlSanitizer,
    HtmlRenderer,
    Local,
    ApiClient
};

// Integrations
export { default as Slack } from './notifications/Slack.js';
