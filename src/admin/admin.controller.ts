import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { requireUser } from '../common/controller-utils';
import { render } from '../common/view';
import { AdminService } from './admin.service';

@Controller()
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly auth: AuthService,
  ) {}

  @Get('/permissions')
  async permissions(@Req() req: Request, @Res() res: Response) {
    const user = requireUser(req, res);
    if (!user) return;
    if (!this.auth.isRoot(user)) return res.status(403).render('error', { message: 'Không có quyền' });
    const admins = await this.adminService.listDelegatedAdmins();
    return render(res, 'permissions', { admins, features: this.adminService.features });
  }

  @Post('/permissions')
  async savePermissions(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string | string[] | undefined>) {
    const user = requireUser(req, res);
    if (!user || !this.auth.isRoot(user)) return res.status(403).render('error', { message: 'Không có quyền' });
    await this.adminService.savePermissions(body);
    return res.redirect('/permissions');
  }

  @Post('/admins')
  async createAdmin(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const user = requireUser(req, res);
    if (!user || !this.auth.isRoot(user)) return res.status(403).render('error', { message: 'Không có quyền' });
    await this.adminService.createDelegatedAdmin(body);
    return res.redirect('/permissions');
  }

  @Get('/logs')
  async logs(@Req() req: Request, @Res() res: Response) {
    const user = requireUser(req, res);
    if (!user || !this.auth.isRoot(user)) return res.status(403).render('error', { message: 'Chỉ admin gốc được xem log' });
    const level = String(req.query.level || 'ERROR');
    const category = String(req.query.category || 'ALL');
    const logs = await this.adminService.listLogs(level, category);
    return render(res, 'logs/index', { logs, level, levels: ['ERROR', 'WARN', 'INFO', 'ALL'], category, categories: ['ALL', 'HTTP', 'REDIS'] });
  }
}
