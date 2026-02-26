interface ParsedMessage {
    id?: string;
    type: string;
    payload: any;
}
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
    static parse(rawMessage: string): ParsedMessage | null;
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
    static format(type: string, payload: any): string;
}
export {};
//# sourceMappingURL=WebSocketMessageFormatter.d.ts.map