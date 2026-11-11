import { error } from "./protocol.js";
import { canManage, trackingMode } from "./policy.js";
export function createCampaignHandlers(store, getConfig) {
  const modeFor = (user,firm) => trackingMode(getConfig(),user,firm);
const safeCode = code => typeof code==="string" && /^(?:INVALID_|MANIFEST_|CSV_|EMPTY_CSV|DUPLICATE_|MALFORMED_|UNSUPPORTED_|CAMPAIGN_|PIECE_|EVENT_|FEED_|PILOT_)/.test(code);
function respondError(res,err) {
  const code=safeCode(err?.code)?err.code:"TRACKING_UNAVAILABLE";
  return res.status(code===err?.code ? err.status||400 : 503).json({ok:false,error:code,message:code==="TRACKING_UNAVAILABLE"?"Campaign tracking is unavailable.":"This operation could not be completed ("+code+")."});
}
const route=(fn,owner=false)=>async(req,res)=>{
  res.set("Cache-Control","no-store");
  try {
    const firm=req.user?.firm_id;
    if(!firm || !req.user?.id) throw error("FEED_UNAUTHORIZED",403);
    const mode=modeFor(req.user.id,firm);
    if(!mode) throw error("PILOT_NOT_ENABLED",503);
    if(owner && !canManage(req.user)) throw error("FEED_ADMIN_REQUIRED",403);
    return res.json({ok:true,...await fn(req,firm,mode)});
  }catch(err){return respondError(res,err);}
};
return {
  status(req,res) {
    res.set("Cache-Control","no-store");
    return res.json({enabled:Boolean(req.user?.firm_id && modeFor(req.user?.id,req.user.firm_id)),can_manage:canManage(req.user)});
  },
  list:route(async(_req,firm)=>({campaigns:await store.list(firm)})),
  create:route(async(req,firm,mode)=>({campaign:await store.create(firm,req.user.id,req.body,mode)}),true),
  manifest:route(async(req,firm)=>{
    if(!["preview","apply"].includes(req.body?.action))throw error("INVALID_MANIFEST_ACTION");
    return store.manifest(firm,req.params.id,req.body.csv,req.body.action==="apply",req.body.plan);
  },true),
  token:route(async(req,firm)=>{
    if(!["rotate","revoke"].includes(req.body?.action))throw error("INVALID_FEED_TOKEN_ACTION");
    return store.token(firm,req.params.id,req.body.action==="revoke");
  },true),
  summary:route(async(req,firm)=>store.summary(firm,req.params.id)),
  events:route(async(req,firm)=>({events:await store.events(firm,req.params.id,req.body?.imb)})),
};

}
