import { MailService as SendGridClient } from '@sendgrid/mail';
import type { AppConfig } from '../../config/app-config.service';
import { validateEnv } from '../../config/env';
import { MailService } from './mail.service';

const sendGridSend = jest.fn();
const setApiKey = jest.fn();
jest.mock('@sendgrid/mail', () => ({
  MailService: jest.fn().mockImplementation(() => ({ setApiKey, setTimeout: jest.fn(), send: sendGridSend })),
}));

const message = { to: 'asha@example.test', subject: 'Reset your password', text: 'Link: https://app/reset?token=abc', html: '<p>Link</p>' };

function configOf(values: Record<string, unknown>): AppConfig {
  const env = { NODE_ENV: 'development', SENDGRID_FROM_EMAIL: 'no-reply@hrms.test', SENDGRID_FROM_NAME: 'HRMS', SENDGRID_SANDBOX_MODE: false, ...values };
  return { get: (key: string) => env[key as keyof typeof env], isTest: env.NODE_ENV === 'test' } as unknown as AppConfig;
}

const BASE_ENV = {
  DB_NAME: 'hrms_dev',
  DB_USER: 'hrms',
  DB_PASSWORD: 'secret',
  JWT_ACCESS_SECRET: 'x'.repeat(40),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('MailService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends through SendGrid with tracking disabled', async () => {
    sendGridSend.mockResolvedValue([{ statusCode: 202 }, {}]);
    const mail = new MailService(configOf({ SENDGRID_API_KEY: 'SG.test-key' }));
    await mail.send(message);

    expect(SendGridClient).toHaveBeenCalledTimes(1);
    expect(setApiKey).toHaveBeenCalledWith('SG.test-key');
    expect(sendGridSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { email: 'no-reply@hrms.test', name: 'HRMS' },
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        trackingSettings: { clickTracking: { enable: false, enableText: false }, openTracking: { enable: false } },
        mailSettings: { sandboxMode: { enable: false } },
      }),
    );
  });

  it('reports SendGrid API errors without exposing the API key', async () => {
    sendGridSend.mockRejectedValue({ code: 403, message: 'Forbidden', response: { body: { errors: [{ message: 'The from address does not match a verified Sender Identity' }] } } });
    const mail = new MailService(configOf({ SENDGRID_API_KEY: 'SG.secret-key' }));
    const error = await mail.send(message).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Email delivery failed: 403 The from address does not match a verified Sender Identity');
    expect((error as Error).message).not.toContain('SG.secret-key');
  });

  it('captures messages in tests and never calls a provider', async () => {
    const mail = new MailService(configOf({ NODE_ENV: 'test', SENDGRID_API_KEY: 'SG.test-key' }));
    await mail.send(message);
    expect(mail.outbox).toEqual([message]);
    expect(sendGridSend).not.toHaveBeenCalled();
  });

  it('only logs in development when no API key is configured', async () => {
    const mail = new MailService(configOf({}));
    await expect(mail.send(message)).resolves.toBeUndefined();
    expect(SendGridClient).not.toHaveBeenCalled();
  });
});

describe('mail configuration', () => {
  it('accepts only SendGrid-formatted API keys and allows none in development', () => {
    expect(() => validateEnv({ ...BASE_ENV, SENDGRID_API_KEY: 'not-a-key' })).toThrow(/SENDGRID_API_KEY/);
    expect(validateEnv({ ...BASE_ENV, SENDGRID_API_KEY: 'SG.abc' }).SENDGRID_API_KEY).toBe('SG.abc');
    expect(validateEnv({ ...BASE_ENV }).SENDGRID_API_KEY).toBeUndefined();
    expect(() => validateEnv({ ...BASE_ENV, SENDGRID_FROM_EMAIL: 'not-an-email' })).toThrow(/SENDGRID_FROM_EMAIL/);
  });

  it('requires a real SendGrid configuration in production', () => {
    const prod = { ...BASE_ENV, NODE_ENV: 'production', COOKIE_SECURE: 'true' };
    expect(() => validateEnv(prod)).toThrow(/SENDGRID_API_KEY is required/);
    expect(() => validateEnv({ ...prod, SENDGRID_API_KEY: 'SG.abc', SENDGRID_SANDBOX_MODE: 'true' })).toThrow(/SANDBOX/);
    expect(validateEnv({ ...prod, SENDGRID_API_KEY: 'SG.abc' }).NODE_ENV).toBe('production');
  });
});
