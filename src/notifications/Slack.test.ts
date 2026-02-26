import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Slack from './Slack.ts';

describe('Slack', () => {
    let originalFetch;

    beforeEach(() => {
        originalFetch = global.fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    describe('sendNotification()', () => {
        const webhookUrl = 'https://hooks.slack.com/services/TEST/WEBHOOK/URL';

        it('should send a simple notification', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200
            });

            const result = await Slack.sendNotification(webhookUrl, 'Test message');

            expect(global.fetch).toHaveBeenCalledWith(
                webhookUrl,
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                })
            );
            expect(result).toEqual({ success: true, status: 200 });
        });

        it('should include message in payload', async () => {
            const fetchSpy = vi.fn().mockResolvedValue({
                ok: true,
                status: 200
            });
            global.fetch = fetchSpy;

            await Slack.sendNotification(webhookUrl, 'Test message');

            const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
            expect(payload.text).toBe('Test message');
        });

        it('should merge options into payload', async () => {
            const fetchSpy = vi.fn().mockResolvedValue({
                ok: true,
                status: 200
            });
            global.fetch = fetchSpy;

            const options = {
                channel: '#general',
                username: 'Bot',
                icon_emoji: ':robot:'
            };

            await Slack.sendNotification(webhookUrl, 'Test message', options);

            const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
            expect(payload.text).toBe('Test message');
            expect(payload.channel).toBe('#general');
            expect(payload.username).toBe('Bot');
            expect(payload.icon_emoji).toBe(':robot:');
        });

        it('should throw error when Slack API returns non-ok response', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 400,
                statusText: 'Bad Request'
            });

            await expect(
                Slack.sendNotification(webhookUrl, 'Test message')
            ).rejects.toThrow('Slack API returned 400: Bad Request');
        });

        it('should throw error when fetch fails', async () => {
            global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

            await expect(
                Slack.sendNotification(webhookUrl, 'Test message')
            ).rejects.toThrow('Failed to send Slack notification: Network error');
        });

        it('should handle 500 server errors', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error'
            });

            await expect(
                Slack.sendNotification(webhookUrl, 'Test message')
            ).rejects.toThrow('Slack API returned 500: Internal Server Error');
        });
    });

    describe('sendMessage()', () => {
        const webhookUrl = 'https://hooks.slack.com/services/TEST/WEBHOOK/URL';

        it('should send message with text', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200
            });

            const result = await Slack.sendMessage({
                webhookUrl,
                text: 'Hello, World!'
            });

            expect(result).toEqual({ success: true, status: 200 });
        });

        it('should include text in payload', async () => {
            const fetchSpy = vi.fn().mockResolvedValue({
                ok: true,
                status: 200
            });
            global.fetch = fetchSpy;

            await Slack.sendMessage({
                webhookUrl,
                text: 'Test message'
            });

            const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
            expect(payload.text).toBe('Test message');
        });

        it('should include channel when provided', async () => {
            const fetchSpy = vi.fn().mockResolvedValue({
                ok: true,
                status: 200
            });
            global.fetch = fetchSpy;

            await Slack.sendMessage({
                webhookUrl,
                text: 'Test',
                channel: '#general'
            });

            const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
            expect(payload.channel).toBe('#general');
        });

        it('should include username when provided', async () => {
            const fetchSpy = vi.fn().mockResolvedValue({
                ok: true,
                status: 200
            });
            global.fetch = fetchSpy;

            await Slack.sendMessage({
                webhookUrl,
                text: 'Test',
                username: 'CustomBot'
            });

            const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
            expect(payload.username).toBe('CustomBot');
        });

        it('should include icon_emoji when provided', async () => {
            const fetchSpy = vi.fn().mockResolvedValue({
                ok: true,
                status: 200
            });
            global.fetch = fetchSpy;

            await Slack.sendMessage({
                webhookUrl,
                text: 'Test',
                icon_emoji: ':rocket:'
            });

            const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
            expect(payload.icon_emoji).toBe(':rocket:');
        });

        it('should send message with blocks', async () => {
            const fetchSpy = vi.fn().mockResolvedValue({
                ok: true,
                status: 200
            });
            global.fetch = fetchSpy;

            const blocks = [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '*Bold text*'
                    }
                }
            ];

            await Slack.sendMessage({
                webhookUrl,
                blocks
            });

            const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
            expect(payload.blocks).toEqual(blocks);
        });

        it('should send message with attachments', async () => {
            const fetchSpy = vi.fn().mockResolvedValue({
                ok: true,
                status: 200
            });
            global.fetch = fetchSpy;

            const attachments = [
                {
                    color: 'good',
                    text: 'Attachment text'
                }
            ];

            await Slack.sendMessage({
                webhookUrl,
                attachments
            });

            const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
            expect(payload.attachments).toEqual(attachments);
        });

        it('should throw error when no text, blocks, or attachments provided', async () => {
            await expect(
                Slack.sendMessage({ webhookUrl })
            ).rejects.toThrow('Slack message must include text, blocks, or attachments');
        });

        it('should not include undefined fields in payload', async () => {
            const fetchSpy = vi.fn().mockResolvedValue({
                ok: true,
                status: 200
            });
            global.fetch = fetchSpy;

            await Slack.sendMessage({
                webhookUrl,
                text: 'Test'
            });

            const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
            expect(payload).toEqual({ text: 'Test' });
            expect(payload).not.toHaveProperty('channel');
            expect(payload).not.toHaveProperty('username');
            expect(payload).not.toHaveProperty('icon_emoji');
        });

        it('should handle API errors with response text', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 400,
                text: async () => 'Invalid payload'
            });

            await expect(
                Slack.sendMessage({ webhookUrl, text: 'Test' })
            ).rejects.toThrow('Slack API returned 400: Invalid payload');
        });

        it('should throw error when fetch fails', async () => {
            global.fetch = vi.fn().mockRejectedValue(new Error('Network timeout'));

            await expect(
                Slack.sendMessage({ webhookUrl, text: 'Test' })
            ).rejects.toThrow('Failed to send Slack message: Network timeout');
        });

        it('should send complex message with all options', async () => {
            const fetchSpy = vi.fn().mockResolvedValue({
                ok: true,
                status: 200
            });
            global.fetch = fetchSpy;

            const message = {
                webhookUrl,
                text: 'Main text',
                channel: '#alerts',
                username: 'AlertBot',
                icon_emoji: ':warning:',
                blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*Alert*' } }],
                attachments: [{ color: 'danger', text: 'Critical issue' }]
            };

            await Slack.sendMessage(message);

            const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
            expect(payload.text).toBe('Main text');
            expect(payload.channel).toBe('#alerts');
            expect(payload.username).toBe('AlertBot');
            expect(payload.icon_emoji).toBe(':warning:');
            expect(payload.blocks).toBeDefined();
            expect(payload.attachments).toBeDefined();
        });
    });

    describe('Edge Cases', () => {
        const webhookUrl = 'https://hooks.slack.com/services/TEST/WEBHOOK/URL';

        it('should handle empty string message', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200
            });

            const result = await Slack.sendNotification(webhookUrl, '');

            expect(result.success).toBe(true);
        });

        it('should handle long messages', async () => {
            const fetchSpy = vi.fn().mockResolvedValue({
                ok: true,
                status: 200
            });
            global.fetch = fetchSpy;

            const longMessage = 'A'.repeat(4000);
            await Slack.sendNotification(webhookUrl, longMessage);

            const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
            expect(payload.text).toBe(longMessage);
        });

        it('should handle special characters in message', async () => {
            const fetchSpy = vi.fn().mockResolvedValue({
                ok: true,
                status: 200
            });
            global.fetch = fetchSpy;

            const specialMessage = 'Test & <test> "quotes" \'apostrophe\'';
            await Slack.sendNotification(webhookUrl, specialMessage);

            const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
            expect(payload.text).toBe(specialMessage);
        });

        it('should handle Unicode characters', async () => {
            const fetchSpy = vi.fn().mockResolvedValue({
                ok: true,
                status: 200
            });
            global.fetch = fetchSpy;

            const unicodeMessage = 'Hello 世界 🌍 مرحبا';
            await Slack.sendNotification(webhookUrl, unicodeMessage);

            const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
            expect(payload.text).toBe(unicodeMessage);
        });
    });
});
