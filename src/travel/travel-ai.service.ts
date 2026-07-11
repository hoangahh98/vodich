import { Injectable } from '@nestjs/common';
import { GeminiService } from '../common/gemini.service';
import { PrismaService } from '../prisma.service';

export interface TravelPlanResult {
  summary: string;
  places: Array<{ category: string; name: string; area: string; note: string }>;
  itinerary: Array<{ day: string; slots: Array<{ time: string; activity: string; note: string }> }>;
}

@Injectable()
export class TravelAiService {
  constructor(
    private readonly gemini: GeminiService,
    private readonly prisma: PrismaService,
  ) {}

  isConfigured() {
    return this.gemini.isConfigured();
  }

  /** Sinh gợi ý địa điểm + lịch trình cho một chuyến đi và lưu vào chuyến đó. */
  async generateForTrip(tripId: bigint, options: { days?: number; people?: number; notes?: string } = {}) {
    const trip = await this.prisma.travelTrip.findUniqueOrThrow({ where: { id: tripId }, include: { destination: true } });
    const destination = trip.destination?.name || trip.name;
    const days = Math.min(Math.max(Number(options.days) || 2, 1), 10);
    const people = Math.max(Number(options.people) || 1, 1);

    const prompt = [
      `Bạn là chuyên gia lên kế hoạch du lịch trong nước Việt Nam.`,
      `Hãy gợi ý cho chuyến đi tới "${destination}" trong ${days} ngày, nhóm ${people} người${options.notes ? `, lưu ý: ${options.notes}` : ''}.`,
      `Trả về JSON đúng schema:`,
      `{`,
      `  "summary": "1-2 câu tổng quan chuyến đi",`,
      `  "places": [ { "category": "một trong: Quán ăn ngon, Cà phê ngon, Cà phê chụp ảnh đẹp, Khu vui chơi trẻ em, Điểm khám phá, Khách sạn, Ăn vặt/đặc sản", "name": "tên địa điểm", "area": "khu vực/địa chỉ tương đối", "note": "vì sao nên tới, món/điểm nổi bật" } ],`,
      `  "itinerary": [ { "day": "Ngày 1", "slots": [ { "time": "Sáng|Trưa|Chiều|Tối", "activity": "làm gì", "note": "gợi ý ngắn" } ] } ]`,
      `}`,
      `Yêu cầu: mỗi loại địa điểm cho 2-4 gợi ý (ưu tiên chỗ nổi tiếng/đại diện), tổng ~12-20 địa điểm; lịch trình đủ ${days} ngày, mỗi ngày 3-4 khung giờ. Ưu tiên nơi phù hợp có trẻ em nếu nhóm có trẻ. Viết tiếng Việt, ngắn gọn, thực tế. Chỉ trả JSON.`,
    ].join('\n');

    const result = await this.gemini.generateJson<TravelPlanResult>(prompt, { temperature: 0.8 });
    const normalized: TravelPlanResult = {
      summary: String(result.summary || ''),
      places: Array.isArray(result.places) ? result.places.slice(0, 30) : [],
      itinerary: Array.isArray(result.itinerary) ? result.itinerary.slice(0, 10) : [],
    };
    await this.prisma.travelTrip.update({
      where: { id: tripId },
      data: { aiPlan: JSON.stringify(normalized), aiPlanAt: new Date() },
    });
    return normalized;
  }

  parseStored(aiPlan?: string | null): TravelPlanResult | null {
    if (!aiPlan) return null;
    try {
      return JSON.parse(aiPlan) as TravelPlanResult;
    } catch {
      return null;
    }
  }
}
