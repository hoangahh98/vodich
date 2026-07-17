import { Injectable, OnModuleInit } from '@nestjs/common';
import { parseVpbankEmail, ParsedVpbankTxn } from './household-parser';
import { HouseholdService } from './household.service';

export interface ScanResult {
  ok: boolean;
  scanned: number;
  added: number;
  message: string;
}

/**
 * Đọc hòm Gmail chung (2 vợ chồng auto-forward email VPBank vào đây) qua IMAP, parse
 * từng thư và lưu giao dịch. Dùng app password của Gmail (bật 2FA rồi tạo), KHÔNG dùng
 * OAuth. Thư viện `imapflow` + `mailparser` được nạp động để build không phụ thuộc chúng.
 */
@Injectable()
export class HouseholdEmailService implements OnModuleInit {
  private scanning = false;

  constructor(private readonly household: HouseholdService) {}

  onModuleInit() {
    if (process.env.SKIP_PRISMA_CONNECT === 'true') return;
    const minutes = Number.parseInt(process.env.HOUSEHOLD_POLL_MINUTES || '', 10);
    if (this.isConfigured() && Number.isFinite(minutes) && minutes > 0) {
      // Poll định kỳ khi tiến trình còn sống; mỗi lần bọc try/catch để không sập app.
      setInterval(() => {
        this.scan().catch((error) => console.error('[household] poll lỗi:', error));
      }, minutes * 60_000).unref?.();
    }
  }

  isConfigured(): boolean {
    return Boolean(process.env.HOUSEHOLD_GMAIL_USER && process.env.HOUSEHOLD_GMAIL_APP_PASSWORD);
  }

  mailbox(): string {
    return process.env.HOUSEHOLD_GMAIL_USER || '';
  }

  /** Quét hòm thư: lấy thư trong N ngày gần nhất, parse và lưu (dedupe theo mã giao dịch). */
  async scan(days = Number.parseInt(process.env.HOUSEHOLD_SCAN_DAYS || '90', 10)): Promise<ScanResult> {
    if (!this.isConfigured()) {
      return { ok: false, scanned: 0, added: 0, message: 'Chưa cấu hình HOUSEHOLD_GMAIL_USER / HOUSEHOLD_GMAIL_APP_PASSWORD trên server' };
    }
    if (this.scanning) {
      return { ok: false, scanned: 0, added: 0, message: 'Đang quét, thử lại sau giây lát' };
    }
    this.scanning = true;
    try {
      const { ImapFlow, simpleParser } = loadImapLibs();
      const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);
      const client = new ImapFlow({
        host: process.env.HOUSEHOLD_GMAIL_HOST || 'imap.gmail.com',
        port: Number.parseInt(process.env.HOUSEHOLD_GMAIL_PORT || '993', 10),
        secure: true,
        auth: { user: process.env.HOUSEHOLD_GMAIL_USER, pass: process.env.HOUSEHOLD_GMAIL_APP_PASSWORD },
        logger: false,
      });

      await client.connect();
      let scanned = 0;
      const parsedTxns: ParsedVpbankTxn[] = [];
      const lock = await client.getMailboxLock(process.env.HOUSEHOLD_IMAP_FOLDER || 'INBOX');
      try {
        for await (const msg of client.fetch({ since }, { source: true })) {
          scanned += 1;
          const mail = await simpleParser(msg.source);
          const body = String(mail.html || '') || String(mail.text || '');
          const txn = parseVpbankEmail(body);
          if (txn) parsedTxns.push(txn);
        }
      } finally {
        lock.release();
      }
      await client.logout();

      const added = await this.household.saveParsedTxns(parsedTxns);
      console.log(`[household] scan: scanned=${scanned} parsed=${parsedTxns.length} added=${added}`);
      return { ok: true, scanned, added, message: `Đã quét ${scanned} email, thêm ${added} giao dịch mới` };
    } catch (error) {
      console.error('[household] scan lỗi:', error);
      const message = error instanceof Error ? error.message : 'Quét email thất bại';
      return { ok: false, scanned: 0, added: 0, message };
    } finally {
      this.scanning = false;
    }
  }
}

/** Nạp động imapflow + mailparser; báo lỗi rõ ràng nếu server chưa cài dependency. */
function loadImapLibs(): { ImapFlow: any; simpleParser: any } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ImapFlow } = require('imapflow');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { simpleParser } = require('mailparser');
    return { ImapFlow, simpleParser };
  } catch {
    throw new Error('Server chưa cài imapflow + mailparser (npm i imapflow mailparser)');
  }
}
