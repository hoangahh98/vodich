import { SetMetadata } from '@nestjs/common';
import { AppFeature } from '../types';

export const FEATURE_ACCESS_KEY = 'featureAccess';
export const ADMIN_ONLY_KEY = 'adminOnly';
export const ROOT_ADMIN_ONLY_KEY = 'rootAdminOnly';
export const PUBLIC_KEY = 'publicRoute';

export const FeatureAccess = (feature: AppFeature) => SetMetadata(FEATURE_ACCESS_KEY, feature);
export const AdminOnly = () => SetMetadata(ADMIN_ONLY_KEY, true);
export const RootAdminOnly = () => SetMetadata(ROOT_ADMIN_ONLY_KEY, true);

/**
 * Mở một route cho người chưa đăng nhập. FeatureGuard chạy TOÀN CỤC theo kiểu
 * mặc-định-chặn, nên đây là cách DUY NHẤT để một endpoint thành public — quên
 * đánh dấu thì route bị khoá (fail closed), chứ không hở ra (fail open).
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
