export default class WebSocketMessageFormatter {
    /**
     * Parses a raw WebSocket message string into a structured object.
     *
     * @param {string} rawMessage - The raw message string to parse, expected to be valid JSON.
     * @returns {Object|null} Returns a parsed object with 'id' (if present), 'type' and 'payload' properties if successful,
     *                        or null if the message is invalid, cannot be parsed, or lacks required fields.
     *
     * @example
     * const message = '{"id": "123-abc", "type": "update", "payload": {"id": 123}}';
     * const parsed = WebSocketMessageFormatter.parse(message);
     * // Returns: { id: "123-abc", type: "update", payload: { id: 123 } }
     *
     * @example
     * const invalidMessage = 'not json';
     * const parsed = WebSocketMessageFormatter.parse(invalidMessage);
     * // Returns: null
     */
    static parse(rawMessage) {
        if (!rawMessage || typeof rawMessage !== 'string') {
            console.warn("Received invalid message data:", rawMessage);
            return null;
        }
        try {
            const parsedObject = JSON.parse(rawMessage);
            if (typeof parsedObject.type !== 'string' || typeof parsedObject.payload === 'undefined') {
                console.error("Parsed message lacks required 'type' or 'payload' fields.");
                return null;
            }
            // Preserve id if present, otherwise return just type and payload
            return {
                ...(parsedObject.id && { id: parsedObject.id }),
                type: parsedObject.type,
                payload: parsedObject.payload
            };
        }
        catch (error) {
            console.error("Failed to parse incoming WebSocket message as JSON:", error);
            return null;
        }
    }
    /**
     * Formats a WebSocket message into a JSON string.
     *
     * Creates a message object with a unique ID, type, and payload, then serializes it to JSON.
     * If serialization fails, returns an error message object instead.
     *
     * @static
     * @param {string} type - The type/category of the WebSocket message
     * @param {*} payload - The data payload to be sent with the message
     * @returns {string} A JSON string representing the formatted message, or an error message if serialization fails
     * @throws {Error} Throws if type parameter is not a string
     */
    static format(type, payload) {
        // Validate type parameter
        if (typeof type !== 'string') {
            throw new Error('Message type must be a string');
        }
        const messageObject = {
            id: crypto.randomUUID(),
            type,
            payload
        };
        try {
            return JSON.stringify(messageObject);
        }
        catch (error) {
            console.error("Failed to serialize WebSocket message:", error);
            // Provide more specific error message for circular references
            const errorMsg = error.message.includes('circular')
                ? 'Circular reference in payload'
                : 'Serialization failed';
            return JSON.stringify({
                id: crypto.randomUUID(),
                type: 'error',
                payload: { message: errorMsg }
            });
        }
    }
}
//# sourceMappingURL=WebSocketMessageFormatter.js.map