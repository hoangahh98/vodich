import { Controller, Get, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { requireUser } from './common/controller-utils';
import { render } from './common/view';

@Controller()
export class HomeController {
  @Get('/')
  home(@Req() req: Request, @Res() res: Response) {
    const user = requireUser(req, res);
    if (!user) return;
    return render(res, 'home');
  }

  @Get(['/score-reader', '/doc-diem-giao-luu'])
  scoreReader(@Req() req: Request, @Res() res: Response) {
    const user = requireUser(req, res);
    if (!user) return;
    return render(res, 'score-reader');
  }

  /**
   * Vòng quay tên đứng riêng — công cụ vui đặt cạnh "Đọc điểm", không thuộc module nào.
   * Không có `@FeatureAccess`: chỉ cần đăng nhập là vào được, y như trang đọc điểm.
   */
  @Get(['/vong-quay', '/wheel'])
  wheel(@Req() req: Request, @Res() res: Response) {
    const user = requireUser(req, res);
    if (!user) return;
    return render(res, 'wheel');
  }
}
