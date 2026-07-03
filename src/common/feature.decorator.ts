import { SetMetadata } from '@nestjs/common';
import { AppFeature } from '../types';

export const FEATURE_ACCESS_KEY = 'featureAccess';
export const ADMIN_ONLY_KEY = 'adminOnly';
export const ROOT_ADMIN_ONLY_KEY = 'rootAdminOnly';

export const FeatureAccess = (feature: AppFeature) => SetMetadata(FEATURE_ACCESS_KEY, feature);
export const AdminOnly = () => SetMetadata(ADMIN_ONLY_KEY, true);
export const RootAdminOnly = () => SetMetadata(ROOT_ADMIN_ONLY_KEY, true);
