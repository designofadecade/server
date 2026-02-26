
export default class Slack {

    static async sendNotification(webhookUrl: string, message: string, options: Record<string, any> = {}): Promise<{ success: boolean; status: number }> {

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
        } catch (error: any) {
            throw new Error(`Failed to send Slack notification: ${error.message}`, { cause: error });
        }
    }

    static async sendMessage({ webhookUrl, text, channel, username, icon_emoji, blocks, attachments }: {
        webhookUrl: string;
        text?: string;
        channel?: string;
        username?: string;
        icon_emoji?: string;
        blocks?: any[];
        attachments?: any[];
    }): Promise<{ success: boolean; status: number }> {

        const payload: Record<string, any> = {
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
        } catch (error: any) {
            throw new Error(`Failed to send Slack message: ${error.message}`, { cause: error });
        }
    }

}
