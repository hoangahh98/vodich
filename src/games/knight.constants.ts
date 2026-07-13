// Nội dung game "Hiệp Sĩ Toán Học": danh sách ải + quái vật. Server là nguồn sự
// thật duy nhất cho cấu hình này (client chỉ nhận qua API) để không thể gian lận.

export type MonsterType = 'normal' | 'elite' | 'boss';

export interface Monster {
  name: string;
  emoji: string;
  type: MonsterType;
  hp: number; // số câu trả lời đúng cần có để hạ gục
}

export interface Stage {
  stage: number;
  title: string;
  scene: string; // mô tả bối cảnh ngắn cho trẻ
  monster: Monster;
}

// 10 ải: quái thường (1 HP) → tinh anh (2-3 HP) → boss (10 HP). Ải 10 cứu công chúa/hoàng tử.
export const STAGES: Stage[] = [
  { stage: 1, title: 'Rừng Khởi Đầu', scene: 'Bìa rừng xanh mát', monster: { name: 'Sâu Bột', emoji: '🐛', type: 'normal', hp: 1 } },
  { stage: 2, title: 'Hang Dơi', scene: 'Hang động tối lấp lánh', monster: { name: 'Dơi Đêm', emoji: '🦇', type: 'normal', hp: 1 } },
  { stage: 3, title: 'Đầm Lầy', scene: 'Đầm lầy sương mù', monster: { name: 'Rắn Lục', emoji: '🐍', type: 'elite', hp: 2 } },
  { stage: 4, title: 'Sa Mạc Cát Vàng', scene: 'Sa mạc nắng cháy', monster: { name: 'Bọ Cạp', emoji: '🦂', type: 'elite', hp: 3 } },
  { stage: 5, title: 'Núi Lửa', scene: 'Miệng núi lửa rực đỏ', monster: { name: 'Quỷ Lửa', emoji: '👹', type: 'boss', hp: 10 } },
  { stage: 6, title: 'Khu Rừng Nhện', scene: 'Rừng giăng đầy tơ nhện', monster: { name: 'Nhện Độc', emoji: '🕷️', type: 'normal', hp: 1 } },
  { stage: 7, title: 'Đồng Tuyết', scene: 'Cánh đồng tuyết trắng', monster: { name: 'Sói Xám', emoji: '🐺', type: 'elite', hp: 2 } },
  { stage: 8, title: 'Thung Lũng Cổ', scene: 'Thung lũng khủng long', monster: { name: 'Khủng Long', emoji: '🦖', type: 'elite', hp: 3 } },
  { stage: 9, title: 'Nghĩa Địa', scene: 'Nghĩa địa u ám', monster: { name: 'Xác Sống', emoji: '🧟', type: 'elite', hp: 3 } },
  { stage: 10, title: 'Lâu Đài Rồng', scene: 'Đỉnh tháp lâu đài', monster: { name: 'Rồng Chúa', emoji: '🐉', type: 'boss', hp: 10 } },
];

export const MAX_STAGE = STAGES.length;
export const MAX_HP = 10;

export function getStage(stageNumber: number): Stage | undefined {
  // Tra cứu bằng so khớp chính xác số ải (không lọc theo khoảng).
  return STAGES.find((s) => s.stage === stageNumber);
}
