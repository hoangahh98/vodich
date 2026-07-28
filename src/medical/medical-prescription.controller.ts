import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { notFound } from '../common/controller-utils';
import { FeatureAccess } from '../common/feature.decorator';
import { RateLimitService } from '../common/rate-limit.service';
import { render } from '../common/view';
import { CurrentUser } from '../types';
import { drugNamesCollide, matchKey, parseCountable } from './cabinet';
import { CabinetService } from './cabinet.service';
import {
  carryOverFor,
  currentUser,
  doseProgress,
  doseTimesOf,
  leftoversFor,
  parseDecisions,
  parseImage,
  todayInVietnam,
} from './medical-controller-utils';
import { MedicalAiService } from './medical-ai.service';
import { MedicalScopeService } from './medical-scope.service';
import { MedicalService } from './medical.service';

/**
 * Vòng đời một đơn thuốc: chụp ảnh → AI đọc → soát từng thuốc → gộp với đơn cũ.
 * Bước lên lịch nằm ở MedicalScheduleController.
 */
@Controller()
@FeatureAccess('MEDICAL')
export class MedicalPrescriptionController {
  constructor(
    private readonly medical: MedicalService,
    private readonly ai: MedicalAiService,
    private readonly cabinet: CabinetService,
    private readonly rateLimit: RateLimitService,
    private readonly scope: MedicalScopeService,
  ) {}

  @Post('/medical/patients/:id/prescriptions')
  async addPrescription(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const patient = await this.scope.patient(req, res, id);
    if (!patient) return;
    const patientId = patient.id;
    const back = `/medical/patients/${patientId}`;
    if (!this.ai.isConfigured()) return res.redirect(`${back}?err=${encodeURIComponent('Chưa cấu hình AI trên server (GROQ_API_KEY)')}`);
    const limit = this.rateLimit.consume(`ai:medical:${req.ip || 'unknown'}`, { max: 15, windowMs: 60_000 });
    if (!limit.allowed) return res.redirect(`${back}?err=${encodeURIComponent(`Thao tác quá nhanh, thử lại sau ${limit.retryAfterSeconds}s`)}`);
    const image = parseImage(body.imageData, body.imageMime);
    if (!image) return res.redirect(`${back}?err=${encodeURIComponent('Cần chọn ảnh đơn thuốc')}`);
    try {
      const extracted = await this.ai.extractFromImage(image.data, image.mime);
      if (!extracted.items.length) return res.redirect(`${back}?err=${encodeURIComponent('AI không đọc được thuốc trong ảnh, thử ảnh rõ hơn')}`);
      const prescription = await this.medical.createPrescription(patientId, extracted, image);
      await this.runAnalysis(patientId, prescription.id, currentUser(req));
      // Đơn cũ chưa uống xong thì hỏi ngay thuốc nào còn dùng tiếp, trước khi lên lịch.
      const others = await this.medical.otherScheduled(patientId, prescription.id);
      if (others.length) return res.redirect(`/medical/prescriptions/${prescription.id}/chuyen-don`);
    } catch (error) {
      return res.redirect(`${back}?err=${encodeURIComponent(error instanceof Error ? error.message : 'Xử lý đơn thất bại')}`);
    }
    return res.redirect(back);
  }

  @Post('/medical/prescriptions/:id/reanalyze')
  async reanalyze(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const prescription = await this.scope.prescription(req, res, id);
    if (!prescription) return;
    const back = `/medical/patients/${prescription.patientId}`;
    const limit = this.rateLimit.consume(`ai:medical:${req.ip || 'unknown'}`, { max: 15, windowMs: 60_000 });
    if (!limit.allowed) return res.redirect(`${back}?err=${encodeURIComponent(`Thao tác quá nhanh, thử lại sau ${limit.retryAfterSeconds}s`)}`);
    try {
      await this.runAnalysis(prescription.patientId, prescription.id, currentUser(req));
    } catch (error) {
      return res.redirect(`${back}?err=${encodeURIComponent(error instanceof Error ? error.message : 'Phân tích thất bại')}`);
    }
    return res.redirect(back);
  }

  @Post('/medical/prescriptions/:id/delete')
  async deletePrescription(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const prescription = await this.scope.prescription(req, res, id);
    if (!prescription) return;
    await this.medical.deletePrescription(prescription.id);
    return res.redirect(`/medical/patients/${prescription.patientId}`);
  }

  /** Bước xác nhận: giữ/bỏ từng thuốc và sửa số lần/ngày trước khi lên lịch. */
  @Post('/medical/prescriptions/:id/items')
  async saveItems(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const prescription = await this.scope.prescription(req, res, id);
    if (!prescription) return;
    await this.medical.saveItemDecisions(prescription.id, parseDecisions(body, prescription.items));
    // Quyết định mua: chỉnh tủ thuốc cho khớp thực tế. Làm SAU saveItemDecisions và chỉ
    // cho những dòng người dùng thật sự điền — bỏ trống nghĩa là chưa quyết, không phải
    // mua 0 (mua 0 là một quyết định khác hẳn: dùng hết hàng nhà, có thể thiếu).
    for (const item of prescription.items) {
      const raw = body[`buy_${item.id}`];
      if (raw === undefined || String(raw).trim() === '') continue;
      const bought = Math.round(Number(raw));
      if (!Number.isFinite(bought) || bought < 0) continue;
      if (bought === item.purchasedCount) continue;
      const needed = item.quantityCount || 0;
      if (!needed) continue;
      const parsed = parseCountable(item.quantity);
      if (!parsed) continue;
      const { baseline } = await this.cabinet.recordPurchase(currentUser(req), {
        drugName: item.drugName,
        unit: parsed.unit,
        bought,
        needed,
        // Mốc tồn kho chỉ chụp LẦN ĐẦU rồi giữ nguyên: sửa lại số mua sau đó thì tủ đã bị
        // trừ phần đơn dùng, đọc lại sẽ ra số khác và tính ra kết quả sai.
        baseline: item.stockAtPurchase,
      });
      await this.medical.savePurchasedCount(item.id, bought, baseline);
    }
    // Lưu xong ở lại chính đơn vừa sửa: trước đây nhảy về trang người thân nên không
    // thấy được kết quả (tồn kho mới, cảnh báo thiếu) của thứ vừa bấm.
    return res.redirect(`/medical/prescriptions/${prescription.id}`);
  }

  /**
   * Có đơn mới trong khi đơn cũ chưa uống xong: hỏi thuốc nào còn dùng tiếp.
   * Bỏ tick hết thì lịch đơn cũ bị dừng và file .ics đơn mới sẽ kèm lệnh huỷ cữ cũ.
   */
  @Get('/medical/prescriptions/:id/chuyen-don')
  async transition(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const prescription = await this.scope.prescription(req, res, id);
    if (!prescription) return;
    // Chỉ đơn CHƯA DỪNG mới được làm đích, và chỉ nhận thuốc từ đơn CŨ HƠN. Xem
    // transitionSources() để biết vì sao — làm sai ở đây là giết lịch thuốc đang chạy.
    const others = await this.medical.transitionSources(prescription);
    // Không còn gì để gộp (đã gộp xong, hoặc mở tay khi không có đơn cũ) thì đưa về trang
    // SOÁT THUỐC, không nhảy thẳng tới lịch. Nhảy tới lịch khiến người dùng bấm quay lại
    // là thấy mình bị "ném" tới bước cuối, bỏ qua bước soát — đúng lỗi đã báo.
    if (!others.length) return res.redirect(`/medical/prescriptions/${prescription.id}`);
    // Hiện sẵn "đã uống mấy liều" để người dùng sửa nếu có hôm bỏ cữ — nếu không, app
    // mặc định coi mọi cữ đã lên lịch đều đã uống và sẽ cắt ngắn liệu trình.
    const doseTimes = doseTimesOf(prescription.patient);
    const today = todayInVietnam();
    const progress: Record<string, { total: number; taken: number }> = {};
    for (const other of others) {
      for (const item of other.items) {
        progress[item.id.toString()] = doseProgress(other, item, doseTimes, today);
      }
    }
    // Trang này CHỈ để chọn thuốc đơn cũ nào uống tiếp — không cảnh báo trùng ở đây. Cảnh
    // báo trùng được đưa sang từng dòng thuốc của ĐƠN MỚI ở trang soát thuốc (xem
    // prescription()), vì đó mới là chỗ soát thuốc mới và đủ ngữ cảnh.
    return render(res, 'medical/transition', {
      patient: prescription.patient,
      prescription,
      others,
      progress,
      menuPatientId: prescription.patientId.toString(),
      menuPrescriptionId: prescription.id.toString(),
    });
  }

  @Post('/medical/prescriptions/:id/chuyen-don')
  async saveTransition(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const prescription = await this.scope.prescription(req, res, id);
    if (!prescription) return;
    // Cùng bộ luật với màn hình GET. Chặn ở đây mới là chặn thật: gửi POST tay vẫn chạy
    // dù giao diện không hiện nút nào.
    const others = await this.medical.transitionSources(prescription);
    if (!others.length) return res.redirect(`/medical/prescriptions/${prescription.id}`);
    // Checkbox không tick thì trình duyệt không gửi field -> vắng mặt nghĩa là ngừng thuốc đó.
    const keep = others.flatMap((other) =>
      other.items.map((item) => item.id.toString()).filter((itemId) => body[`keep_${itemId}`] !== undefined),
    );
    const doseTimes = doseTimesOf(prescription.patient);
    const today = todayInVietnam();
    // Người dùng khai lại số liều đã uống (bỏ cữ nào thì sửa xuống); vắng thì dùng số
    // app tự tính.
    const takenOverride: Record<string, number> = {};
    for (const other of others) {
      for (const item of other.items) {
        const raw = body[`taken_${item.id}`];
        const parsed = Math.round(Number(raw));
        if (raw !== undefined && Number.isFinite(parsed)) takenOverride[item.id.toString()] = parsed;
      }
    }
    for (const other of others) {
      const stopped = other.items.filter((item) => !keep.includes(item.id.toString()));
      const kept = other.items.filter((item) => keep.includes(item.id.toString()));
      // Ghi thuốc thừa vào tủ TRƯỚC khi tắt, vì sau khi tắt thì không dựng lại được
      // số liều đã uống nữa. Cùng lý do với việc tính số ngày còn lại ngay tại đây.
      // Mốc trừ là ngày ĐƠN MỚI bắt đầu, không phải hôm nay: thuốc cũ được uống tới lúc
      // đơn mới thay chỗ. Chốt lịch thường làm SAU bước này nên đa số lần sẽ rơi về hôm
      // nay — vẫn đúng, vì hai mốc trùng nhau. Chỉ lệch khi người dùng hẹn đơn mới bắt
      // đầu từ ngày khác, và khi đó lấy mốc này mới ra đúng số thuốc còn thừa.
      const stopDate = prescription.scheduleStart ? prescription.scheduleStart.toISOString().slice(0, 10) : today;
      const leftovers = leftoversFor(other, stopped, doseTimes, stopDate, takenOverride);
      if (leftovers.length) await this.cabinet.addLeftovers(currentUser(req), leftovers, other.prescribedDate);
      const carryOver = carryOverFor(other, kept, doseTimes, today, takenOverride);
      await this.medical.applyTransition(other.id, prescription.id, carryOver);
    }
    // Gộp xong đưa về trang SOÁT THUỐC (bước 3), không nhảy thẳng tới lịch (bước 4): sau khi
    // thuốc cũ nhập chung vào đơn mới, đây đúng là lúc cần soát lại cả thuốc mới lẫn thuốc
    // chuyển sang (trùng liều, số ngày còn lại) trước khi lên lịch. Từ trang đó có sẵn nút
    // sang lịch.
    return res.redirect(`/medical/prescriptions/${prescription.id}`);
  }

  /**
   * Chi tiết MỘT đơn thuốc.
   *
   * Tách khỏi trang người thân vì nhà đã có nhiều đơn: đổ hết mọi đơn kèm form sửa từng
   * thuốc ra một trang thì phải cuộn cả chục màn hình mới tới đơn cần xem, và dễ sửa nhầm
   * sang đơn khác. Trang người thân giờ chỉ liệt kê, bấm vào đơn nào mới mở đơn đó.
   */
  @Get('/medical/prescriptions/:id')
  async prescription(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const prescription = await this.scope.prescription(req, res, id);
    if (!prescription) return;
    const carriedIds = prescription.items.map((item) => item.carriedFromId).filter((v): v is bigint => Boolean(v));
    // Còn đơn khác đang chạy thì phải mở được màn hình "thuốc nào uống tiếp". Trước đây
    // màn hình đó chỉ tới được bằng cú chuyển hướng ngay sau khi upload ảnh đơn: lỡ bỏ
    // qua một lần là không có đường quay lại, mà đó đúng là lúc dễ bỏ qua nhất.
    const otherRunning = await this.medical.transitionSources(prescription);
    const stockByItem = await this.stockByItem(req, prescription.items);
    const clusterOf = clusterDuplicates(prescription.items);
    // Ghi chú trùng cho từng thuốc: (a) cùng nhóm trong đơn này, hoặc (b) đã có ở một đơn
    // gần đây khác — KỂ CẢ đơn đã dừng và dòng đã bỏ tick, vì người dùng vẫn cần biết "đã
    // kê thuốc này rồi". (Đây là lý do dùng historyForPatient chứ không chỉ đơn đang chạy:
    // ca thật "Zensomid" bị sót vì bản cũ "Zensonid" nằm ở đơn đã dừng.)
    const recentOthers = await this.medical.historyForPatient(prescription.patientId, prescription.id);
    const dupNote = buildDuplicateNotes(prescription.items, clusterOf, recentOthers);
    // Xếp lại thứ tự HIỂN THỊ: các dòng trùng cùng nhóm đứng liền nhau và lên đầu cho dễ bỏ,
    // phần còn lại giữ nguyên thứ tự id. Form gửi theo id nên đổi thứ tự hiển thị vô hại.
    const orderedItems = [
      ...prescription.items
        .filter((i) => clusterOf[i.id.toString()])
        .sort((a, b) => clusterOf[a.id.toString()] - clusterOf[b.id.toString()] || Number(a.id - b.id)),
      ...prescription.items.filter((i) => !clusterOf[i.id.toString()]),
    ];
    return render(res, 'medical/prescription', {
      prescription,
      otherRunningCount: otherRunning.length,
      dupNote,
      clusterOf,
      orderedItems,
      patient: prescription.patient,
      menuPatientId: prescription.patientId.toString(),
      menuPrescriptionId: prescription.id.toString(),
      // Ngày kê của đơn gốc, để đánh dấu thuốc nào là hàng chuyển sang từ đợt trước.
      carrySources: await this.medical.carrySourceDates(carriedIds),
      stockByItem,
      aiConfigured: this.ai.isConfigured(),
    });
  }

  @Get('/medical/prescriptions/:id/image')
  async image(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    // Ảnh đơn thuốc là dữ liệu nhạy cảm nhất ở đây (tên, tuổi, chẩn đoán của bé)
    // nên phải qua đúng bộ lọc quyền như mọi route khác.
    const prescription = await this.scope.prescription(req, res, id);
    if (!prescription) return;
    if (!prescription.imageData) return notFound(res, 'Không có ảnh');
    const buffer = Buffer.from(prescription.imageData, 'base64');
    res.setHeader('Content-Type', prescription.imageMime || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(buffer);
  }

  /**
   * Tồn kho gắn vào TỪNG DÒNG THUỐC, không phải một băng-rôn đầu trang: lúc soát đơn
   * người ta đọc từng thuốc một, số tồn nằm tách ở đầu trang thì phải nhớ rồi cuộn
   * xuống đối chiếu. Đây cũng là chỗ duy nhất đủ ngữ cảnh để gợi ý mua thêm bao nhiêu.
   */
  private async stockByItem(req: Request, items: Array<{ id: bigint; drugName: string }>) {
    const matches = await this.cabinet.matchFor(
      currentUser(req),
      items.map((item) => item.drugName),
    );
    const stockByItem = new Map<string, { quantity: number; unit: string; expired: boolean; inUse: boolean }>();
    for (const [list, inUse] of [[matches.available, false], [matches.inUse, true]] as const) {
      for (const stock of list) {
        for (const item of items) {
          if (matchKey(item.drugName) !== stock.matchKey) continue;
          stockByItem.set(item.id.toString(), { quantity: stock.quantity, unit: stock.unit, expired: stock.expired, inUse });
        }
      }
    }
    return stockByItem;
  }

  /**
   * Chạy phân tích an toàn cho một đơn và ghi kết quả xuống DB.
   *
   * Ba nguồn đối chiếu, cố ý gửi hết trong MỘT lượt hỏi thay vì hỏi ba lần: đơn mới, các
   * đợt thuốc trước (đợt gần nhất đứng đầu), và tủ thuốc còn tồn ở nhà. Trùng hoạt chất
   * chỉ nhìn ra được khi ba thứ này nằm cạnh nhau — hỏi riêng từng cái thì mỗi lượt đều
   * thấy "không có gì".
   *
   * Kết quả ra hai chỗ: tóm tắt cả đơn, và cảnh báo gắn vào từng dòng thuốc.
   */
  private async runAnalysis(patientId: bigint, prescriptionId: bigint, user: CurrentUser) {
    const [prescription, patient, history, cabinet] = await Promise.all([
      this.medical.getPrescription(prescriptionId, user),
      this.medical.getPatient(patientId, user),
      this.medical.historyForPatient(patientId, prescriptionId),
      this.cabinet.list(user),
    ]);
    if (!prescription || !patient) return;
    const today = todayInVietnam();
    const analysis = await this.ai.analyze(
      { name: patient.name, birthYear: patient.birthYear, gender: patient.gender, allergies: patient.allergies, conditions: patient.conditions },
      prescription.items.map((item) => ({
        drugName: item.drugName,
        isAntibiotic: item.isAntibiotic,
        dosage: item.dosage,
        frequency: item.frequency,
        duration: item.duration,
        note: item.note,
      })),
      history.map((entry) => ({
        date: entry.prescribedDate ? entry.prescribedDate.toISOString().slice(0, 10) : '',
        // Đơn đã chốt lịch mà chưa dừng = thuốc VẪN ĐANG uống. Nặng ký hơn hẳn đơn đã xong
        // từ lâu: uống chồng lên nhau ngay hôm nay chứ không phải chuyện của tháng trước.
        running: Boolean(entry.scheduleStart && !entry.scheduleStopped),
        items: entry.items.map((item) => ({ drugName: item.drugName, isAntibiotic: item.isAntibiotic, duration: item.duration })),
      })),
      cabinet.map((item) => ({
        drugName: item.drugName,
        quantity: item.quantity,
        unit: item.unit,
        expiryDate: item.expiryDate ? item.expiryDate.toISOString().slice(0, 10) : '',
        expired: Boolean(item.expiryDate && item.expiryDate.toISOString().slice(0, 10) < today),
      })),
    );
    await this.medical.saveAnalysis(prescriptionId, analysis.risk, analysis.summary);
    // AI trỏ theo số thứ tự trong mảng vừa gửi lên, nên map ngược về id thật ở đây — đúng
    // thứ tự đó, không sắp xếp lại gì giữa chừng.
    const byItemId = new Map<string, { level: string; note: string }>();
    for (const warning of analysis.warnings) {
      const item = prescription.items[warning.index];
      if (!item) continue;
      byItemId.set(item.id.toString(), { level: warning.level, note: warning.reason });
    }
    await this.medical.saveItemWarnings(prescriptionId, byItemId);
  }
}

/**
 * GOM NHÓM thuốc trùng NGAY trong đơn này (hay gặp: một thuốc vừa được bác sĩ kê mới,
 * vừa được chuyển từ đơn cũ sang -> hai dòng cùng thuốc, uống gấp đôi). Các dòng cùng
 * nhóm sẽ được xếp cạnh nhau ở giao diện cho dễ soát & bỏ bớt. So bằng drugNamesCollide.
 */
function clusterDuplicates(items: Array<{ id: bigint; enabled: boolean; drugName: string }>): Record<string, number> {
  const enabledItems = items.filter((item) => item.enabled);
  const clusterOf: Record<string, number> = {};
  let groupNo = 0;
  for (const item of enabledItems) {
    const key = item.id.toString();
    if (clusterOf[key]) continue;
    const mates = enabledItems.filter(
      (o) => o.id !== item.id && !clusterOf[o.id.toString()] && drugNamesCollide(o.drugName, item.drugName),
    );
    if (!mates.length) continue;
    clusterOf[key] = ++groupNo;
    for (const mate of mates) clusterOf[mate.id.toString()] = groupNo;
  }
  return clusterOf;
}

function buildDuplicateNotes(
  items: Array<{ id: bigint; enabled: boolean; drugName: string }>,
  clusterOf: Record<string, number>,
  recentOthers: Array<{ prescribedDate: Date | null; scheduleStart: Date | null; scheduleStopped: boolean; items: Array<{ drugName: string }> }>,
): Record<string, string> {
  const dupNote: Record<string, string> = {};
  for (const item of items.filter((i) => i.enabled)) {
    if (clusterOf[item.id.toString()]) {
      dupNote[item.id.toString()] =
        'Trùng với thuốc khác trong đơn này (đã gom cùng nhóm) — chỉ giữ MỘT dòng, bỏ tick (các) dòng còn lại rồi lưu.';
      continue;
    }
    for (const other of recentOthers) {
      const hit = other.items.find((o) => drugNamesCollide(o.drugName, item.drugName));
      if (!hit) continue;
      const day = other.prescribedDate
        ? other.prescribedDate.toISOString().slice(0, 10).split('-').reverse().slice(0, 2).join('/')
        : 'trước';
      const running = Boolean(other.scheduleStart && !other.scheduleStopped);
      dupNote[item.id.toString()] = running
        ? `Trùng với "${hit.drugName}" ở đơn ${day} đang uống dở — dễ uống gấp đôi. Dùng "Chọn thuốc uống tiếp" để gộp về một lịch.`
        : `Bệnh nhân đã được kê "${hit.drugName}" ở đơn ${day}. Nếu đúng là cùng thuốc thì cân nhắc khỏi kê/mua lại.`;
      break;
    }
  }
  return dupNote;
}
