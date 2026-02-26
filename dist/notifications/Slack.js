export default class Slack {
    static async sendNotification(webhookUrl, message, options = {}) {
        const payload = {
            text: message,
            ...options
        };
        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                throw new Error(`Slack API returned ${response.status}: ${response.statusText}`);
            }
            return { success: true, status: response.status };
        }
        catch (error) {
            throw new Error(`Failed to send Slack notification: ${error.message}`, { cause: error });
        }
    }
    static async sendMessage({ webhookUrl, text, channel, username, icon_emoji, blocks, attachments }) {
        const payload = {
            ...(text && { text }),
            ...(channel && { channel }),
            ...(username && { username }),
            ...(icon_emoji && { icon_emoji }),
            ...(blocks && { blocks }),
            ...(attachments && { attachments })
        };
        if (!text && !blocks && !attachments) {
            throw new Error('Slack message must include text, blocks, or attachments');
        }
        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Slack API returned ${response.status}: ${errorText}`);
            }
            return { success: true, status: response.status };
        }
        catch (error) {
            throw new Error(`Failed to send Slack message: ${error.message}`, { cause: error });
        }
    }
}
//# sourceMappingURL=Slack.js.map