import { applyOverrides, type PackageOverride } from "./package-override";
import type { SimplePackage } from "./simple-dues";
export type OpeningClient = {id:string;first_name:string;last_name:string;status:string|null;deleted_at:string|null;package_total_visits:number;package_price:number;package_start_date:string|null};
export type OpeningOverride = PackageOverride & {id:string;client_id:string;cleared_at:string|null};
export type OpeningRow = {client_id:string;visits:number;price:number;started_on:string};
export function planOpeningPackages(clients:OpeningClient[],overrides:OpeningOverride[],existing:Pick<SimplePackage,"client_id"|"source">[],cutoverDate:string) {
  const rows:OpeningRow[]=[];const noPackageInfo:{id:string;name:string}[]=[];const notBeforeCutover:{id:string;name:string}[]=[];let alreadyCreated=0;
  for(const c of clients) {
    if(c.deleted_at || c.status!=="active")continue;
    if(existing.some(p=>p.client_id===c.id && p.source==="opening")){alreadyCreated++;continue;}
    const current=overrides.filter(o=>o.client_id===c.id && o.slot==="current" && !o.cleared_at).sort((a,b)=>(b.created_at??"").localeCompare(a.created_at??"") || b.id.localeCompare(a.id))[0];
    const effective=applyOverrides(c,current?[current]:[]);
    const name=`${c.first_name} ${c.last_name}`.trim();
    if(effective.package_total_visits<=0 || !effective.package_start_date){noPackageInfo.push({id:c.id,name});continue;}
    if(effective.package_start_date>=cutoverDate){notBeforeCutover.push({id:c.id,name});continue;}
    rows.push({client_id:c.id,visits:effective.package_total_visits,price:Number(effective.package_price),started_on:effective.package_start_date});
  }
  return {rows:rows.sort((a,b)=>a.client_id.localeCompare(b.client_id)),noPackageInfo,notBeforeCutover,alreadyCreated};
}