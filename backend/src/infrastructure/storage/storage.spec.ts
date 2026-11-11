import { once } from 'node:events';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { Readable } from 'node:stream';
import { AppError } from '../../common/errors/app-error';
import { ClamAvScanner, TestSignatureScanner, type MalwareScanner } from './malware-scanner';
import { LocalStorageDriver, RetentionLockedError, S3StorageDriver, StorageService, type StorageDriver } from './storage.service';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

class MemoryDriver implements StorageDriver {
  readonly objects = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.objects.set(key, data);
  }
  async get(key: string) {
    return Readable.from(this.objects.get(key)!);
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

describe('StorageService upload scanning', () => {
  const key = 'organizations/org-1/employees/emp-1/file.pdf';

  it('stores clean files and rejects infected ones without storing them', async () => {
    const driver = new MemoryDriver();
    const audit = { record: jest.fn() };
    const storage = new StorageService(driver, new TestSignatureScanner(), audit as never);
    await storage.put(key, Buffer.from('%PDF-1.4 fine'), 'application/pdf');
    expect(driver.objects.has(key)).toBe(true);

    const bad = 'organizations/org-1/employees/emp-1/bad.pdf';
    await expect(storage.put(bad, Buffer.from(`prefix ${EICAR} suffix`), 'application/pdf')).rejects.toMatchObject({ code: 'FILE_REJECTED' });
    expect(driver.objects.has(bad)).toBe(false);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'security.upload_blocked', metadata: expect.objectContaining({ area: 'employees' }) }));
  });

  it('fails closed when the scanner is unavailable, and skips the scan for generated content', async () => {
    const driver = new MemoryDriver();
    const down: MalwareScanner = { name: 'down', scan: () => Promise.reject(new Error('connection refused')) };
    const storage = new StorageService(driver, down);
    const err = await storage.put(key, Buffer.from('x'), 'application/pdf').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('SCAN_UNAVAILABLE');
    expect(driver.objects.size).toBe(0);
    await storage.put('organizations/org-1/audit/archive.csv', Buffer.from('a,b'), 'text/csv', { generated: true });
    expect(driver.objects.size).toBe(1);
  });
});

describe('Write-once retention', () => {
  it('local driver refuses to delete a locked object until its retention ends', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hrms-lock-'));
    try {
      const driver = new LocalStorageDriver(dir);
      await driver.put('a/locked.csv', Buffer.from('x'), 'text/csv', { until: new Date(Date.now() + 60_000), mode: 'COMPLIANCE' });
      await expect(driver.delete('a/locked.csv')).rejects.toBeInstanceOf(RetentionLockedError);
      await expect(driver.put('a/locked.csv', Buffer.from('y'), 'text/csv')).rejects.toThrow(/EEXIST/);
      await driver.put('a/expired.csv', Buffer.from('x'), 'text/csv', { until: new Date(Date.now() - 1000), mode: 'COMPLIANCE' });
      await driver.delete('a/expired.csv');
      await expect(driver.get('a/expired.csv')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('S3 driver writes Object Lock retention with a checksum', async () => {
    const driver = new S3StorageDriver('bucket', { region: 'ap-south-1' });
    const sent: { input: Record<string, unknown> }[] = [];
    (driver as unknown as { client: { send: (c: { input: Record<string, unknown> }) => Promise<void> } }).client = { send: async (c) => void sent.push(c) };
    const until = new Date('2033-11-11T00:00:00Z');
    await driver.put('org/archive.csv', Buffer.from('x'), 'text/csv', { until, mode: 'COMPLIANCE' });
    await driver.put('org/doc.pdf', Buffer.from('x'), 'application/pdf');
    expect(sent[0]!.input).toMatchObject({ ObjectLockMode: 'COMPLIANCE', ObjectLockRetainUntilDate: until, ChecksumAlgorithm: 'SHA256', ServerSideEncryption: 'AES256' });
    expect(sent[1]!.input.ObjectLockMode).toBeUndefined();
  });
});

describe('ClamAvScanner', () => {
  let server: Server;
  let received: Buffer;

  /** A minimal clamd: reads the INSTREAM chunks and answers like ClamAV. */
  beforeAll(async () => {
    server = createServer((socket) => {
      const chunks: Buffer[] = [];
      socket.on('data', (c) => chunks.push(c));
      socket.on('end', () => {
        const all = Buffer.concat(chunks);
        const command = 'zINSTREAM\0';
        expect(all.subarray(0, command.length).toString()).toBe(command);
        const parts: Buffer[] = [];
        for (let i = command.length; ; ) {
          const size = all.readUInt32BE(i);
          i += 4;
          if (size === 0) break;
          parts.push(all.subarray(i, i + size));
          i += size;
        }
        received = Buffer.concat(parts);
        socket.end(received.includes(EICAR) ? 'stream: Win.Test.EICAR_HDB-1 FOUND\0' : 'stream: OK\0');
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
  });
  afterAll(() => server.close());

  const scanner = () => new ClamAvScanner('127.0.0.1', (server.address() as AddressInfo).port, 5000);

  it('streams the file in chunks and reads the verdict', async () => {
    const big = Buffer.alloc(200 * 1024, 7);
    await expect(scanner().scan(big)).resolves.toEqual({ clean: true });
    expect(received.equals(big)).toBe(true);
    await expect(scanner().scan(Buffer.from(EICAR))).resolves.toEqual({ clean: false, signature: 'Win.Test.EICAR_HDB-1' });
  });

  it('reports an unreachable daemon as unavailable', async () => {
    await expect(new ClamAvScanner('127.0.0.1', 1, 2000).scan(Buffer.from('x'))).rejects.toThrow(/unreachable/);
  });
});
