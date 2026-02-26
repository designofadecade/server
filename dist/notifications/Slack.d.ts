export default class Slack {
    static sendNotification(webhookUrl: string, message: string, options?: Record<string, any>): Promise<{
        success: boolean;
        status: number;
    }>;
    static sendMessage({ webhookUrl, text, channel, username, icon_emoji, blocks, attachments }: {
        webhookUrl: string;
        text?: string;
        channel?: string;
        username?: string;
        icon_emoji?: string;
        blocks?: any[];
        attachments?: any[];
    }): Promise<{
        success: boolean;
        status: number;
    }>;
}
//# sourceMappingURL=Slack.d.ts.map