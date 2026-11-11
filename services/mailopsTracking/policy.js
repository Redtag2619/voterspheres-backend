const role = user => String(user?.role||"").toLowerCase();
export const canManage = user => ["admin","firm_admin","owner","platform_admin","super_admin"].includes(role(user));
export function trackingMode(config,userId,firmId) {
  const positive = value => /^[1-9][0-9]*$/.test(String(value||""));
  if(config.enabled!=="true" || !positive(userId) || !positive(firmId))return null;
  if(config.mode==="production")return "production";
  if(config.mode==="cat" && positive(config.userId) && positive(config.firmId) &&
      String(userId)===String(config.userId) && String(firmId)===String(config.firmId))return "cat";
  return null;
}
