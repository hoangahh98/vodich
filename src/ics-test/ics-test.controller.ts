/**
 * MODULE THỬ NGHIỆM — XOÁ ĐƯỢC.
 *
 * Trả lời một câu hỏi duy nhất: file METHOD:CANCEL tải từ Safari có xoá được sự kiện
 * đã nạp bằng METHOD:PUBLISH trên iPhone không? Nếu có thì lịch thuốc thật mới bỏ được
 * kiểu nhét STATUS:CANCELLED vào file PUBLISH (phi chuẩn) đang dùng.
 *
 * Toàn bộ nằm trong src/ics-test + một dòng ở app.module.ts. Xoá thư mục và gỡ dòng đó
 * là hết sạch. Dữ liệu thì xoá người thân "THU LICH ICS" là cascade sạch theo.
 *
 * Mọi thao tác ghi/xoá ở đây đều chặn cứng vào ĐÚNG người thân test của chính người
 * đang đăng nhập (khớp cả tên lẫn chủ sở hữu) — không có đường nào chạm vào hồ sơ thật.
 */
import { Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { FeatureAccess } from '../common/feature.decorator';
import { FeatureGuard } from '../common/feature.guard';
import { PrismaService } from '../prisma.service';
import { CurrentUser } from '../types';
import { buildSchedule } from '../medical/medication-schedule';
import { buildTestCancelIcs, buildTestCleanupIcs, buildTestPublishIcs } from './test-ics';

/** Kiểu file cần dựng. cleanup = bản sao của tính năng dọn dẹp đang chạy thật. */
type IcsKind = 'publish' | 'cancel' | 'cleanup';

/** Tên cắm cứng: vừa để tìm lại, vừa để nhìn trong danh sách là biết ngay hồ sơ rác. */
const TEST_PATIENT_NAME = 'THU LICH ICS (xoa duoc)';

@Controller()
@UseGuards(FeatureGuard)
@FeatureAccess('MEDICAL')
export class IcsTestController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('/ics-test')
  async page(@Req() req: Request, @Res() res: Response, @Query('email') email?: string) {
    const patient = await this.findTestPatient(req);
    const address = String(email || '').trim();
    // Hiện luôn tiền tố UID: mọi sự kiện trong Lịch iPhone đều mang nó, nên nhìn là biết
    // file sắp tải có trỏ đúng vào những sự kiện đã nạp hay không.
    const rxId = patient?.prescriptions[0]?.id.toString() || '';
    return res.send(renderPage(patient ? patient.id.toString() : '', rxId, address));
  }

  /** Dựng người thân rác + một đơn đã chốt lịch, để UID sinh ra giống hệt lịch thật. */
  @Post('/ics-test/seed')
  async seed(@Req() req: Request, @Res() res: Response) {
    // Đã có rồi thì GIỮ NGUYÊN, tuyệt đối không tạo lại.
    //
    // UID gắn với id đơn thuốc, mà tạo lại là sinh id mới -> toàn bộ UID đổi theo. Khi
    // đó những sự kiện đã nạp vào Lịch iPhone bằng UID cũ vĩnh viễn không huỷ được nữa
    // (không file nào còn trỏ tới chúng), và phép thử ra kết quả âm tính giả: tưởng lệnh
    // huỷ hỏng, thật ra chỉ là huỷ nhầm địa chỉ. Muốn làm lại thì xoá rồi seed.
    const existing = await this.findTestPatient(req);
    if (existing?.prescriptions.length) return res.redirect('/ics-test');
    // Còn sót hồ sơ cụt (có người thân nhưng chưa có đơn) thì dọn, không thì thành hai
    // hồ sơ trùng tên và findFirst nhặt bừa một cái.
    await this.removeTestPatient(req);

    const patient = await this.prisma.medPatient.create({
      data: { name: TEST_PATIENT_NAME, ownerAdminId: ownerId(req), notes: 'Hồ sơ thử METHOD:CANCEL. Xoá thoải mái.' },
    });
    await this.prisma.medPrescription.create({
      data: {
        patientId: patient.id,
        diagnosis: 'Thử lịch .ics',
        // Bắt đầu từ NGÀY MAI: mọi cữ đều nằm ở tương lai nên nhìn trong Lịch là thấy
        // ngay, và huỷ xong biến mất cũng rõ ràng. Bắt đầu hôm nay thì vài cữ đã trôi
        // qua, không phân biệt được "bị huỷ" với "đã qua".
        scheduleStart: new Date(`${tomorrowInVietnam()}T00:00:00Z`),
        scheduleSlot: 'SANG',
        items: {
          create: [
            { drugName: 'THU Thuoc A', timesPerDay: 2, days: 2, dosage: '1 vien', route: 'UONG', timing: 'SAU_AN' },
            { drugName: 'THU Thuoc B', timesPerDay: 1, days: 2, dosage: '5 ml', route: 'UONG', timing: 'SAU_AN' },
          ],
        },
      },
    });
    return res.redirect('/ics-test');
  }

  @Post('/ics-test/remove')
  async remove(@Req() req: Request, @Res() res: Response) {
    await this.removeTestPatient(req);
    return res.redirect('/ics-test');
  }

  @Get('/ics-test/publish.ics')
  async publish(@Req() req: Request, @Res() res: Response, @Query('email') email?: string) {
    return this.sendIcs(req, res, email, 'publish');
  }

  @Get('/ics-test/cancel.ics')
  async cancel(@Req() req: Request, @Res() res: Response, @Query('email') email?: string) {
    return this.sendIcs(req, res, email, 'cancel');
  }

  /** Phép thử C: đúng cơ chế mà bản dọn dẹp thật đang dùng. */
  @Get('/ics-test/cleanup.ics')
  async cleanup(@Req() req: Request, @Res() res: Response, @Query('email') email?: string) {
    return this.sendIcs(req, res, email, 'cleanup');
  }

  private async sendIcs(req: Request, res: Response, email: string | undefined, kind: IcsKind) {
    const patient = await this.findTestPatient(req);
    const prescription = patient?.prescriptions[0];
    if (!patient || !prescription?.scheduleStart) {
      return res.status(404).send('Chưa có người thân test. Vào /ics-test bấm "Tạo dữ liệu test" trước.');
    }

    const startDate = prescription.scheduleStart.toISOString().slice(0, 10);
    const { groups } = buildSchedule(
      prescription.items.map((item) => ({
        id: item.id.toString(),
        drugName: item.drugName,
        dosage: item.dosage,
        route: item.route,
        timing: item.timing,
        timesPerDay: item.timesPerDay,
        days: item.days,
        note: item.note,
        isAntibiotic: item.isAntibiotic,
      })),
      startDate,
      'SANG',
      { morning: patient.doseTimeMorning, noon: patient.doseTimeNoon, evening: patient.doseTimeEvening, bedtime: patient.doseTimeBedtime },
    );
    if (!groups.length) return res.status(404).send('Đơn test không sinh ra cữ nào — báo lại để sửa dữ liệu seed.');

    const options = {
      // UID gắn với id đơn, y hệt lịch thật. publish và cancel dùng chung nên đối chiếu được.
      uidPrefix: `rx${prescription.id}`,
      calendarName: 'THU huy lich',
      patientName: TEST_PATIENT_NAME,
      attendeeEmail: email,
      // Đếm theo GIÂY từ 2020 chứ không phải phút: bấm publish rồi bấm huỷ ngay sau
      // vài giây vẫn phải ra số lớn hơn, không thì app Lịch coi file huỷ là bản cũ và
      // bỏ qua — sẽ bị hiểu nhầm thành "lệnh huỷ không chạy".
      sequence: Math.floor((Date.now() - Date.UTC(2020, 0, 1)) / 1000) + (kind === 'publish' ? 0 : 1),
    };

    const builders = { publish: buildTestPublishIcs, cancel: buildTestCancelIcs, cleanup: buildTestCleanupIcs };
    const ics = builders[kind](groups, options);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    // inline: Safari trên iOS mở thẳng màn hình xử lý của Lịch, giống hệt lịch thuốc thật.
    res.setHeader('Content-Disposition', `inline; filename="thu-${kind}.ics"`);
    return res.send(ics);
  }

  private async findTestPatient(req: Request) {
    return this.prisma.medPatient.findFirst({
      // Khớp CẢ tên lẫn chủ sở hữu: không bao giờ chạm vào hồ sơ thật hay hồ sơ người khác.
      where: { name: TEST_PATIENT_NAME, ownerAdminId: ownerId(req) },
      include: { prescriptions: { include: { items: true }, orderBy: { id: 'desc' } } },
    });
  }

  private async removeTestPatient(req: Request) {
    // deleteMany chứ không delete: không có gì để xoá thì im lặng bỏ qua, không ném lỗi.
    // Điều kiện tên + chủ sở hữu là hàng rào duy nhất, không được nới.
    await this.prisma.medPatient.deleteMany({
      where: { name: TEST_PATIENT_NAME, ownerAdminId: ownerId(req) },
    });
  }
}

/** Session giữ id dạng chuỗi, cột ownerAdminId là BigInt — không đổi kiểu là Prisma từ chối. */
function ownerId(req: Request): bigint {
  return BigInt((req.session.user as CurrentUser).id);
}

/** Server chạy UTC trên Render nhưng "ngày mai" phải theo giờ Việt Nam (UTC+7). */
function tomorrowInVietnam(): string {
  return new Date(Date.now() + (7 + 24) * 3600 * 1000).toISOString().slice(0, 10);
}

function renderPage(patientId: string, rxId: string, email: string): string {
  const emailValue = escapeHtml(email);
  const query = email ? `?email=${encodeURIComponent(email)}` : '';
  const status = patientId
    ? `<p class="ok">Đã có dữ liệu test (người thân #${escapeHtml(patientId)}).</p>
<p class="note">UID đang dùng: <code>rx${escapeHtml(rxId)}-d1..d4@vodich</code>. Mọi sự kiện
[THU] trong Lịch iPhone phải mang đúng tiền tố này thì lệnh huỷ mới trỏ tới được.</p>`
    : '<p class="warn">Chưa có dữ liệu test — bấm nút bên dưới trước.</p>';

  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Thử METHOD:CANCEL</title>
<style>
 body{font:16px/1.6 -apple-system,system-ui,sans-serif;margin:0;padding:20px;max-width:640px}
 h1{font-size:20px} h2{font-size:17px;margin-top:28px}
 a.btn,button{display:block;width:100%;box-sizing:border-box;padding:14px;margin:8px 0;
  font-size:16px;border:1px solid #999;border-radius:10px;background:#f4f4f4;text-align:center;
  text-decoration:none;color:#111}
 input{width:100%;box-sizing:border-box;padding:12px;font-size:16px;border:1px solid #999;border-radius:10px}
 .ok{color:#0a7} .warn{color:#c60} .note{color:#666;font-size:14px}
 hr{border:0;border-top:1px solid #ddd;margin:24px 0}
</style></head><body>
<h1>Thử METHOD:CANCEL</h1>
${status}
<form method="post" action="/ics-test/seed"><button>Tạo dữ liệu test</button></form>
<p class="note">Đã có dữ liệu rồi thì nút này không làm gì — cố ý. Tạo lại sẽ đổi hết UID,
khiến sự kiện đã nạp vào Lịch không huỷ được nữa và phép thử ra kết quả sai.</p>

<hr>
<h2>Bước 1 — nạp lịch</h2>
<p class="note">Luôn bấm nút này TRƯỚC mỗi phép thử. Xong kiểm tra Lịch <b>ngày mai và
ngày kia</b> phải có 4 sự kiện <b>[THU]</b> lúc 07:00 và 19:00.</p>
<a class="btn" href="/ics-test/publish.ics">1. Nạp lịch (PUBLISH)</a>

<hr>
<h2>Phép thử C — đúng thứ đang chạy thật</h2>
<p class="note">PUBLISH + STATUS:CANCELLED, bản sao của tính năng dọn dẹp trong
<code>ics.ts</code>. Kèm một sự kiện <b>CHUNG NHAN</b> lúc 12:00 để biết iPhone có thật
sự đọc file hay không.</p>
<p class="note"><b>Đọc kết quả:</b> thấy CHUNG NHAN mà 4 cữ [THU] vẫn còn → lệnh huỷ bị
bỏ qua, tính năng dọn dẹp thật <b>vô dụng</b>. Cả CHUNG NHAN lẫn 4 cữ đều biến mất →
tính năng chạy đúng. Không thấy CHUNG NHAN → iPhone từ chối cả file, báo lại mình.</p>
<a class="btn" href="/ics-test/cleanup.ics">3. Dọn lịch (PUBLISH + STATUS:CANCELLED)</a>

<hr>
<h2>Phép thử A — METHOD:CANCEL</h2>
<p class="note">Đã thử 19/07/2026: iPhone hiện màn hình "Thêm tất cả" rồi không làm gì —
METHOD bị bỏ qua hoàn toàn. Giữ nút lại để thử lại nếu cần.</p>
<a class="btn" href="/ics-test/cancel.ics">2. Huỷ lịch (CANCEL)</a>

<hr>
<h2>Phép thử B — có ORGANIZER/ATTENDEE</h2>
<p class="note">Chỉ chạy khi A thất bại, để biết cơ chế huỷ có hoạt động trên iOS hay không.
Email phải là <b>đúng tài khoản Lịch trên iPhone</b>, sai địa chỉ là B trượt vì lệch danh
tính chứ không phải vì CANCEL hỏng.</p>
<form method="get" action="/ics-test">
 <input name="email" type="email" placeholder="email tài khoản Lịch" value="${emailValue}">
 <button>Đặt email</button>
</form>
${email ? `<a class="btn" href="/ics-test/publish.ics${query}">4. Nạp lịch (PUBLISH + organizer)</a>
<a class="btn" href="/ics-test/cancel.ics${query}">5. Huỷ lịch (CANCEL + organizer)</a>`
        : '<p class="warn">Điền email ở trên để hiện nút 4 và 5.</p>'}

<hr>
<form method="post" action="/ics-test/remove"><button>Xoá sạch dữ liệu test</button></form>
<p class="note">Xoá người thân test là cascade sạch đơn thuốc theo. Sự kiện đã nằm trong
Lịch iPhone thì không xoá theo được — phải tự xoá tay trên máy.</p>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
