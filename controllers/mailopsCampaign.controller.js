import { pool } from "../db/pool.js";
import { resolveFirmEntitlements, hasEntitlement } from "../services/subscriptionEntitlements.service.js";
import { createTrackingStore } from "../services/mailopsTracking/store.js";
import { error } from "../services/mailopsTracking/protocol.js";
import { ivMode } from "../services/uspsIvLookup.js";
import { trackingMode } from "../services/mailopsTracking/policy.js";

import { createCampaignHandlers } from "../services/mailopsTracking/handlers.js";
const store=createTrackingStore(pool);
const config=()=>({
  enabled:process.env.MAILOPS_CAMPAIGN_ENABLED, mode:process.env.USPS_IV_MODE,
  userId:process.env.USPS_IV_PILOT_USER_ID, firmId:process.env.USPS_IV_PILOT_FIRM_ID,
});
export const mailopsCampaign=createCampaignHandlers(store,config);
const safeCode=code=>typeof code==="string" && /^(?:INVALID_|MANIFEST_|CSV_|EMPTY_CSV|DUPLICATE_|MALFORMED_|UNSUPPORTED_|CAMPAIGN_|PIECE_|EVENT_|FEED_|PILOT_)/.test(code);
function respondError(res,err) {
  const code=safeCode(err?.code)?err.code:"TRACKING_UNAVAILABLE";
  return res.status(code===err?.code ? err.status||400 : 503).json({ok:false,error:code});
}
const modeFor=(user,firm)=>trackingMode({
  enabled:process.env.MAILOPS_CAMPAIGN_ENABLED, mode:process.env.USPS_IV_MODE,
  userId:process.env.USPS_IV_PILOT_USER_ID, firmId:process.env.USPS_IV_PILOT_FIRM_ID,
},user,firm);

export async function receiveMailopsFeed(req,res) {
  res.set("Cache-Control","no-store");
  const input=req.body;
  req.body=undefined;
  const auth=String(req.headers.authorization||"");
  const token=auth.startsWith("Bearer ")?auth.slice(7):"";
  try {
    if(process.env.MAILOPS_CAMPAIGN_ENABLED!=="true" || !ivMode(process.env.USPS_IV_MODE))throw error("PILOT_NOT_ENABLED",503);
    const result=await store.ingest(token,input?.csv, authorizeFeed);
    return res.json({ok:true,...result});
  }catch(err){return respondError(res,err);}

  async function authorizeFeed(c, db) {
    if (c.source_mode !== modeFor(c.created_by_user,c.firm_id)) return false;
    const firm = (await db.query("SELECT id,plan_tier,status,subscription_status FROM firms WHERE id=$1 FOR SHARE",[c.firm_id])).rows[0];
    if (!firm || firm.status !== "active" ||
        (firm.subscription_status && !["active","trialing"].includes(firm.subscription_status))) return false;
    const access = await resolveFirmEntitlements({firmId:firm.id,planTier:firm.plan_tier,user:{}});
    return hasEntitlement(access,"mailops_iv");
  }
}
