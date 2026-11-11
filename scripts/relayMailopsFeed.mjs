import { lstat, readFile, readdir, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseFeed, LIMITS } from "../services/mailopsTracking/protocol.js";

const args=process.argv.slice(2);
const allowed=/^--(?:input-dir|endpoint)=.+$|^--(?:watch|preview)$/;
if(args.some(a=>!allowed.test(a)))throw new Error("Unsupported relay option");
const value=name=>{
  const values=args.filter(a=>a.startsWith("--"+name+"="));
  if(values.length!==1)throw new Error("Supply --"+name+" exactly once");
  return values[0].slice(name.length+3);
};
const directory=resolve(value("input-dir"));
const endpoint=new URL(value("endpoint"));
if(endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname!=="/api/mailops-feed" ||
   (endpoint.protocol!=="https:" && !(endpoint.protocol==="http:" && ["localhost","127.0.0.1"].includes(endpoint.hostname)))) {
  throw new Error("Use the VoterSpheres HTTPS /api/mailops-feed endpoint");
}
const preview=args.includes("--preview");
const token=process.env.MAILOPS_FEED_TOKEN;
if(!preview && !/^miv_[A-Za-z0-9_-]{43}$/.test(token||""))throw new Error("Set MAILOPS_FEED_TOKEN for this campaign");
async function run(){
  let accepted=0, failed=0;
  const files=(await readdir(directory)).filter(n=>n.endsWith(".ready.csv")).sort().slice(0,5);
  for(const name of files){
    try {
      const path=join(directory,name);
      const stat=await lstat(path);
      if(!stat.isFile() || stat.isSymbolicLink() || stat.size>LIMITS.bytes)throw new Error("Invalid file");
      const csv=await readFile(path,"utf8");
      const parsed=parseFeed(csv);
      if(preview){console.log(JSON.stringify({mode:"preview",rows:parsed.rows.length}));continue;}
      const response=await fetch(endpoint,{
        method:"POST", redirect:"error", signal:AbortSignal.timeout(25000),
        headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},
        body:JSON.stringify({csv}),
      });
      if(!response.ok)throw new Error("Feed rejected");
      const result=await response.json();
      if(result.ok!==true)throw new Error("Invalid receipt");
      await rename(path,path.replace(/\.ready\.csv$/,".accepted.csv"));
      accepted++;
      console.log(JSON.stringify({accepted:true,duplicate:result.duplicate,inserted:result.inserted_rows,unmatched:result.unmatched_rows}));
    } catch { failed++; console.error(JSON.stringify({ok:false,code:"FILE_NOT_ACKNOWLEDGED",policy:"File remains available for retry; check server limits, CSV format and token."})); }
  }
  return failed;
}
do {
  try { const failed=await run();if(!args.includes("--watch")){process.exitCode=failed?1:0;break;} }
  catch {console.error(JSON.stringify({ok:false,code:"RELAY_DIRECTORY_UNAVAILABLE"}));if(!args.includes("--watch")){process.exitCode=1;break;}}
  await new Promise(r=>setTimeout(r,60000));
}while(args.includes("--watch"));
