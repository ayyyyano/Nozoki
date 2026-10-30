import { authEndpoint, boundedJson, environment } from '../../utils/auth-http.ts'
import { requireAdminMutation } from '../../utils/require-admin.ts'
import { getDatabase } from '../../utils/database.ts'
import { saveAdminConfig } from '../../services/admin-config.ts'
import { CONFIG_BODY_LIMIT } from '../../../shared/contracts/admin.ts'
export default authEndpoint(async (event) => {
  const session = await requireAdminMutation(event)
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const value = await boundedJson(event, CONFIG_BODY_LIMIT)
  const result = await saveAdminConfig(
    getDatabase(event),
    value,
    getHeader(event, 'idempotency-key') ?? '',
    session,
    environment(event),
  )
  if (!result.success) {
    setResponseStatus(
      event,
      result.code === 'CONFIG_CONFLICT' || result.code === 'IDEMPOTENCY_CONFLICT'
        ? 409
        : result.code === 'VALIDATION_ERROR'
          ? 400
          : 503,
    )
    return {
      ...result,
      message:
        result.code === 'CONFIG_CONFLICT'
          ? '配置已被其他编辑窗口更新；请保留草稿并读取最新版本'
          : result.code === 'IDEMPOTENCY_CONFLICT'
            ? '此请求标识已用于不同内容，请重新提交'
            : '未能保存，请检查标记字段及凭据操作后重试',
    }
  }
  return result
})
