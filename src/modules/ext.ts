import { getUserSetting } from '../host';
import { EXTENSION_NAME } from '../constants';

export function getExtensionSetting() {
  console.info(`getExtensionSetting function of ext.ts`);
  console.debug('User setting: ', getUserSetting(EXTENSION_NAME));
  return getUserSetting(EXTENSION_NAME);
}
