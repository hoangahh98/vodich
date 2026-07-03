import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { RootAdminOnly } from '../common/feature.decorator';
import { FeatureGuard } from '../common/feature.guard';
import { render } from '../common/view';
import { AdminService } from './admin.service';

@Controller()
@UseGuards(FeatureGuard)
@RootAdminOnly()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('/permissions')
  async permissions(@Res() res: Response) {
    const admins = await this.adminService.listDelegatedAdmins();
    return render(res, 'permissions', { admins, features: this.adminService.features });
  }

  @Post('/permissions')
  async savePermissions(@Res() res: Response, @Body() body: Record<string, string | string[] | undefined>) {
    await this.adminService.savePermissions(body);
    return res.redirect('/permissions');
  }

  @Post('/admins')
  async createAdmin(@Res() res: Response, @Body() body: Record<string, string>) {
    await this.adminService.createDelegatedAdmin(body);
    return res.redirect('/permissions');
  }

  @Get('/logs')
  async logs(@Req() req: Request, @Res() res: Response) {
    const level = String(req.query.level || 'ERROR');
    const category = String(req.query.category || 'ALL');
    const logs = await this.adminService.listLogs(level, category);
    return render(res, 'logs/index', { logs, level, levels: ['ERROR', 'WARN', 'INFO', 'ALL'], category, categories: ['ALL', 'HTTP', 'REDIS'] });
  }
}
