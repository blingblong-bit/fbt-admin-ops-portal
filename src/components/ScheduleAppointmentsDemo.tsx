import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getScheduleCheck } from '@/lib/schedule.functions';
import { projectLiveAppointment } from '@/lib/schedule-demo-live';
import { chicagoYmd } from '@/lib/work-week';
import { Focus, List, Plus, RotateCcw, Search, MoreHorizontal, Clock, ArrowLeftRight, Check, FlaskConical, CalendarDays, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { DemoWeekStrip } from '@/components/DemoWeekStrip';
import { useRole } from '@/hooks/useRole';
import { DEMO_DATE, DEMO_CAPACITY, demoTrainers, demoTime, demoVisit, demoBook, demoMove, demoSwap, demoComplete, demoCancel, demoSlotFree, demoSlotLoad, demoUnreserved, demoPackageFor, demoAddTrainer, initialDemoState, type DemoAppointment, type DemoState } from '@/lib/schedule-demo';

type Mode = 'day'|'zoom'|'trainer'|'openings';
type Editor = {kind:'book'|'move'|'cancel';appointment?:DemoAppointment};
function Choice({label,value,onChange,options}:{label:string;value:string;onChange:(v:string)=>void;options:{value:string;label:string}[]}) {
  return <div className="min-w-0 space-y-1"><Label>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label} className="min-h-11 w-full min-w-0"><SelectValue placeholder="Select client"/></SelectTrigger><SelectContent>{options.map(o=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></div>;
}
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
const times=Array.from({length:26},(_,i)=>360+i*30);
export function ScheduleAppointmentsDemo() {
  const {isAdmin,isLoading}=useRole();
  const [simulation,setState]=useState<DemoState>(() => ({...initialDemoState(),appointments:[]}));
  const [date,setDate]=useState(chicagoYmd);
  const fetchSchedule=useServerFn(getScheduleCheck);
  const query=useQuery({queryKey:['schedule-check',date],queryFn:()=>fetchSchedule({data:{date}}),refetchInterval:()=>typeof document!=='undefined'&&document.visibilityState==='visible'?60_000:false,refetchIntervalInBackground:false,refetchOnWindowFocus:true});
  const live=(query.data?.selected_day??[]).map(projectLiveAppointment);
  const liveTrainers=[...new Set(live.map(a=>a.trainer))];
  const allTrainers=[...new Set([...liveTrainers,...simulation.trainers.filter(t=>!demoTrainers.some(d=>d===t))])];
  const trainers=allTrainers.length?allTrainers:[...simulation.trainers];
  const state={...simulation,trainers,simulationOnlyTrainers:simulation.trainers,readOnlySlots:live.map(a=>a.blocker),availabilityUnknown:query.isPending||query.isError||Boolean(query.data?.error)||live.some(a=>a.trainerUnknown)};
  const saveSimulation=(next:DemoState)=>setState({...next,trainers:simulation.trainers,readOnlySlots:undefined,availabilityUnknown:undefined,simulationOnlyTrainers:undefined});
  const [mode,setMode]=useState<Mode>('day');
  const [lastOverview,setLastOverview]=useState<'day'|'zoom'>('day');
  const [trainer,setTrainer]=useState('Avery');
  const [selected,setSelected]=useState<string[]|null>(null);
  const [duration,setDuration]=useState('30');
  const [search,setSearch]=useState('');
  const [editor,setEditor]=useState<Editor|null>(null);
  const [clientId,setClientId]=useState('');
  const [editDate,setEditDate]=useState(DEMO_DATE);
  const [editTrainer,setEditTrainer]=useState('Avery');
  const [editTime,setEditTime]=useState('11:00');
  const [visits,setVisits]=useState('8');
  const [price,setPrice]=useState('375');
  const [swapFrom,setSwapFrom]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [resetOpen,setResetOpen]=useState(false);
  const [addOpen,setAddOpen]=useState(false);
  const [trainerName,setTrainerName]=useState('');
  const client=state.clients.find(c=>c.id===clientId);
  const needsPackage=client?demoUnreserved(state,client)<=0:false;
  const active=state.appointments.filter(a=>a.date===date&&a.status!=='cancelled').sort((a,b)=>a.start-b.start);
  const visible=active.filter(a=>state.clients.find(c=>c.id===a.clientId)?.name.toLowerCase().includes(search.trim().toLowerCase()));
  const trainerOptions=state.trainers.map(t=>({value:t,label:t}));
  const liveVisible=live.filter(a=>a.name.toLowerCase().includes(search.trim().toLowerCase()));
  const liveTile=(a:ReturnType<typeof projectLiveAppointment>,large=false)=><article key={`live-${a.id}`} aria-label={`Square appointment: ${a.name}`} className={`shrink-0 snap-start rounded-md border bg-card p-2 ${large?'flex h-[320px] flex-col':'min-h-14'}`}><div className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground"><span>{demoTime(a.start)}{a.duration?` · ${a.duration}m`:''}</span><span>Square · read-only</span></div><h3 className={`break-words font-semibold ${large?'mt-5 text-2xl':'text-sm'}`}>{a.name}</h3>{large&&<><p className="mt-3 text-sm">{a.service??'Service unavailable'} · {a.status}</p><p className="mt-3 text-xs text-muted-foreground">Visit number unavailable in this schedule read. Appointment checkout due/paid unavailable.</p></>}</article>;
  const open=(kind:Editor['kind'],a?:DemoAppointment,slot?:{trainer:string;start:number})=>{
    setSwapFrom(null);setEditor({kind,appointment:a});setClientId(a?.clientId??'');setEditDate(a?.date??date);setEditTrainer(a?.trainer??slot?.trainer??trainer);
    const start=a?.start??slot?.start??660;setEditTime(`${String(Math.floor(start/60)).padStart(2,'0')}:${String(start%60).padStart(2,'0')}`);setError('');setVisits('8');setPrice('375');
  };
  const apply=(count=false)=>{
    if(!editor)return;
    if(query.isFetching){setError('Wait for the Square refresh before changing the simulation.');return;}
    try {
      const [h,m]=editTime.split(':').map(Number);const start=(h??NaN)*60+(m??NaN);
      if(editor.kind==='move'&&editDate!==date)throw new Error('Cross-day rescheduling is not available in this read-only preview. Select a slot on the displayed day.');
      if(!editDate||!Number.isFinite(start))throw new Error('Choose a date and time.');
      let next=state;
      if(editor.kind==='book')next=demoBook(state,{id:`demo-book-${crypto.randomUUID()}`,clientId,trainer:editTrainer,date:editDate,start,duration:Number(duration),status:'booked'},needsPackage?{total:Number(visits),price:Number(price)}:undefined);
      else if(editor.kind==='move'&&editor.appointment)next=demoMove(state,editor.appointment.id,{trainer:editTrainer,date:editDate,start,duration:editor.appointment.duration});
      else if(editor.kind==='cancel'&&editor.appointment)next=demoCancel(state,editor.appointment.id,count);
      saveSimulation(next);setNotice(editor.kind==='cancel'?(count?'Cancelled; one demo visit counted.':'Cancelled; no visit counted.'):'Demo appointment saved.');setEditor(null);
    }catch(e){setError(e instanceof Error?e.message:'Demo action failed.');}
  };
  const swapConflict=(a:DemoAppointment)=>{if(query.isFetching)return 'Square refresh in progress.';if(!swapFrom)return '';try{demoSwap(state,swapFrom,a.id);return '';}catch(e){return e instanceof Error?e.message:'Swap conflict.';}};
  const swap=(a:DemoAppointment)=>{if(!swapFrom||query.isFetching)return;try{saveSimulation(demoSwap(state,swapFrom,a.id));setSwapFrom(null);setNotice('Demo clients swapped.');}catch(e){setNotice(e instanceof Error?e.message:'Swap conflict.');}};
  const complete=(a:DemoAppointment)=>{try{saveSimulation(demoComplete(state,a.id));setNotice('One demo visit completed.');}catch(e){setNotice(e instanceof Error?e.message:'Unable to complete.');}};
  const tile=(a:DemoAppointment,large=false)=>{
    const c=state.clients.find(c=>c.id===a.clientId);if(!c)return null;
    const pkg=demoPackageFor(c,a.packageId),due=Math.max(0,pkg.price-pkg.paid);
    const conflict=swapFrom&&swapFrom!==a.id?swapConflict(a):'';
    return <article key={a.id} aria-label={`${c.name}, ${demoTime(a.start)}, ${a.trainer}`} className={`shrink-0 snap-start rounded-md border border-l-4 border-l-chart-2 bg-card p-2 ${large?'flex h-[320px] flex-col':'min-h-14'}`}>
      <div className="flex items-start justify-between gap-1"><span className="text-xs font-semibold">{demoTime(a.start)} · {a.duration}m</span>{swapFrom?<>{a.id===swapFrom?<span className="text-xs font-semibold text-chart-2">Swap selected</span>:a.status==='booked'&&<Button size="icon" variant="outline" disabled={Boolean(conflict)} title={conflict||`Swap with ${c.name}`} aria-label={`Swap with ${c.name}`} onClick={()=>swap(a)}><ArrowLeftRight className="size-4"/></Button>}</>:<DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="size-8" aria-label={`Actions for ${c.name}`}><MoreHorizontal/></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={a.status!=='booked'} onSelect={()=>open('move',a)}>Reschedule / change trainer</DropdownMenuItem><DropdownMenuItem disabled={a.status!=='booked'} onSelect={()=>{setSwapFrom(a.id);setNotice('');}}>Swap client</DropdownMenuItem><DropdownMenuItem disabled={a.status!=='booked'} onSelect={()=>open('cancel',a)}>Cancel appointment</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</div>
      <span className="text-[10px] font-semibold text-chart-4">SIMULATED</span><h3 className={`font-semibold ${large?'mt-5 text-2xl':'text-sm'}`}>{c.name}</h3><div className={`mt-1 flex flex-wrap gap-x-2 gap-y-1 ${large?'text-base':'text-xs'}`}><span>Visit {demoVisit(state,a)} of {pkg.total}</span><span className={due?'font-semibold text-destructive':'font-semibold text-chart-2'}>{due?`${money(due)} demo due`:`${money(pkg.price)} demo paid`}</span></div>
      {conflict&&<p className="mt-1 text-xs text-destructive">{conflict}</p>}
      {large&&<><p className="mt-3 text-sm text-muted-foreground">Package {money(pkg.price)} · {pkg.used} completed<br/>{money(pkg.paid)} recognized</p><div className="mt-auto"><Button variant="outline" size="sm" disabled={a.status!=='booked'||Boolean(swapFrom)} onClick={()=>complete(a)}><Check/>{a.status==='completed'?'Completed':'Complete demo visit'}</Button></div></>}
      {!large&&a.status==='completed'&&<span className="text-xs text-muted-foreground">Completed</span>}
    </article>;
  };
  const grid=(trainers:string[],onlyOpen=false)=>{
    const starts=onlyOpen?times:[...new Set([...times,...liveVisible.map(a=>a.start),...visible.map(a=>a.start)])].sort((a,b)=>a-b);
    return <div className="max-h-[600px] max-w-full overflow-auto overscroll-contain" tabIndex={0} aria-label={onlyOpen?'Demo openings grid':'Demo schedule grid'}><table className="w-full border-collapse text-sm"><thead className="sticky top-0 z-10 bg-background"><tr><th className="w-16 min-w-16 border-b p-2 text-left">Time</th>{trainers.map(t=><th key={t} className="min-w-[180px] border-b p-2 text-left"><Button variant="link" className="max-w-[180px] whitespace-normal px-0 font-semibold" onClick={()=>{setTrainer(t);setMode('trainer');}}>{t}{simulation.trainers.includes(t)&&<span className="ml-1 text-[10px] text-chart-4">Demo</span>}</Button></th>)}</tr></thead><tbody>{starts.map(start=><tr key={start}><th className="border-b p-2 text-left align-top text-xs font-medium">{demoTime(start)}</th>{trainers.map(t=>{const slot={date,trainer:t,start,duration:onlyOpen?Number(duration):30};const load=demoSlotLoad(state,slot),free=demoSlotFree(state,slot)&&!query.isFetching;const cards=visible.filter(a=>a.trainer===t&&a.start===start);const squareCards=liveVisible.filter(a=>a.trainer===t&&a.start===start);const occupied=live.some(a=>a.trainer===t&&start<a.blocker.start+a.blocker.duration&&a.blocker.start<start+slot.duration);return <td key={t} className="min-w-[180px] border-b border-l p-1.5 align-top"><div className="space-y-1">{!onlyOpen&&<>{squareCards.map(a=>liveTile(a))}{cards.map(a=>tile(a))}</>}{free?<div className="flex items-center justify-end gap-2">{onlyOpen&&<span className="text-xs text-muted-foreground">{DEMO_CAPACITY-load} demo spaces</span>}<Button variant="ghost" size="icon" className="size-7" aria-label={`Book ${t} at ${demoTime(start)}`} title="Book simulated slot" onClick={()=>open('book',undefined,slot)}><Plus className="size-4"/></Button></div>:onlyOpen?<p className="text-xs text-muted-foreground">{state.availabilityUnknown||query.isFetching?'Availability unverified':occupied?'Square occupied':'Fully booked in simulation'}</p>:occupied&&!squareCards.length?<span className="text-[10px] text-muted-foreground">Square occupied</span>:null}</div></td>;})}</tr>)}</tbody></table>{!trainers.length&&<p className="py-4 text-sm">No trainers selected.</p>}</div>;
  };
  return <div className="min-w-0 space-y-4">
    <section className="flex gap-3 border-y border-chart-4 bg-chart-4/10 py-3" aria-label="Demo safety notice"><FlaskConical className="size-5 shrink-0"/><div><strong className="text-sm">SQUARE READ-ONLY · SIMULATED ACTIONS</strong><p className="text-xs text-muted-foreground">Live appointments cannot be edited here. Fake-client actions reset on reload; no live bookings, messages or payments. Openings are preview-only, not verified trainer availability.</p></div></section>
    <div className="flex items-center justify-between gap-2"><div><h1 className="text-2xl font-semibold">Appointments preview</h1><p className="text-xs text-muted-foreground">{live.length} Square · {active.length} simulated · America/Chicago</p></div><Button size="icon" variant="outline" aria-label="Reset demo" title="Reset demo" onClick={()=>setResetOpen(true)}><RotateCcw/></Button></div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2"><p className="text-xs text-muted-foreground">{query.isFetching?'Reading Square…':query.data&&!query.data.error&&!query.isError?`Last successful Square read ${new Date(query.dataUpdatedAt).toLocaleTimeString('en-US',{timeZone:'America/Chicago'})} Chicago`:query.data?'Square read incomplete':'Square not loaded'} · Checks every 60 seconds while visible; refreshes on focus and Hub sync notices. Not instant.</p><Button variant="outline" size="sm" disabled={query.isFetching} onClick={()=>void query.refetch()}><RotateCcw className="size-4"/>Refresh Square</Button></div>
    {(query.isError||query.data?.error)&&<p role="alert" className="text-sm text-destructive">Square could not be fully read. Openings disabled. {query.data?.error??(query.error instanceof Error?query.error.message:'Try Refresh Square.')}</p>}
    {live.some(a=>a.trainerUnknown)&&<p className="text-xs text-muted-foreground">Square trainer names are unavailable; separate trainer IDs are shown when supplied. Live openings remain unverified.</p>}
    <DemoWeekStrip date={date} onChange={d=>{setDate(d);setSwapFrom(null);}}/>
    <nav aria-label="Demo appointment views" className="grid grid-cols-3 gap-1 border-b pb-2"><Button variant={mode==='day'||mode==='zoom'?'default':'ghost'} onClick={()=>{const next=(mode==='day'||(mode!=='zoom'&&lastOverview==='day'))?'zoom':'day';setMode(next);setLastOverview(next);}}>{(mode==='day'||(mode!=='zoom'&&lastOverview==='day'))?<Focus className="size-4"/>:<CalendarDays className="size-4"/>}{(mode==='day'||(mode!=='zoom'&&lastOverview==='day'))?'Zoom':'Day'}</Button><Button variant={mode==='trainer'?'default':'ghost'} onClick={()=>setMode('trainer')}><List className="size-4"/>Trainer</Button><Button variant={mode==='openings'?'default':'ghost'} onClick={()=>setMode('openings')}><Clock className="size-4"/>Openings</Button></nav>
    {swapFrom&&<div className="flex flex-wrap items-center justify-between gap-2 border-y py-2"><span className="text-sm font-medium">Swap {state.clients.find(c=>c.id===state.appointments.find(a=>a.id===swapFrom)?.clientId)?.name} with another client</span><Button variant="outline" onClick={()=>setSwapFrom(null)}><X/>Cancel swap</Button></div>}
    <p role="status" className={notice?'text-sm font-medium':'sr-only'}>{notice}</p>
    {mode!=='openings'&&<div className="relative max-w-sm"><Search className="absolute left-3 top-3 size-4 text-muted-foreground"/><Input aria-label="Search demo clients" placeholder="Search appointments" value={search} onChange={e=>setSearch(e.target.value)} className="min-h-11 pl-9"/></div>}
    {mode==='day'&&grid(state.trainers)}
    {mode==='zoom'&&<div className="max-w-full overflow-x-auto pb-2"><div className="flex min-w-max gap-3">{state.trainers.map(t=><section key={t} className="w-[270px] shrink-0 sm:w-[310px]"><Button variant="link" className="px-0 text-base font-semibold" onClick={()=>{setTrainer(t);setMode('trainer');}}>{t}</Button><div className="h-[320px] snap-y snap-mandatory space-y-3 overflow-y-auto overscroll-y-contain" tabIndex={0} aria-label={`${t} current appointment`}>{[...liveVisible.filter(a=>a.trainer===t).map(a=>({start:a.start,id:`live-${a.id}`,node:liveTile(a,true)})),...visible.filter(a=>a.trainer===t).map(a=>({start:a.start,id:a.id,node:tile(a,true)}))].sort((a,b)=>a.start-b.start).map(a=>a.node)}{!visible.some(a=>a.trainer===t)&&!liveVisible.some(a=>a.trainer===t)&&<p className="py-6 text-sm text-muted-foreground">No appointments.</p>}</div></section>)}</div></div>}
    {mode==='trainer'&&<section className="space-y-3"><div className="flex flex-wrap items-end gap-2"><div className="min-w-40 max-w-xs flex-1"><Choice label="Trainer" value={trainer} onChange={setTrainer} options={trainerOptions}/></div>{isAdmin&&!isLoading&&<Button variant="outline" onClick={()=>{setAddOpen(true);setTrainerName('');setError('');}}><Plus/>Add demo trainer</Button>}</div>{grid([state.trainers.includes(trainer)?trainer:state.trainers[0]??trainer])}</section>}
    {mode==='openings'&&<section className="space-y-3"><div className="flex flex-wrap gap-2"><Button variant={selected===null?'default':'outline'} onClick={()=>setSelected(null)}>Any trainer</Button>{state.trainers.map(t=><Button key={t} variant={(selected??state.trainers).includes(t)?'secondary':'outline'} aria-pressed={(selected??state.trainers).includes(t)} onClick={()=>setSelected(prev=>(prev??state.trainers).includes(t)?(prev??state.trainers).filter(x=>x!==t):[...(prev??state.trainers),t])}>{(selected??state.trainers).includes(t)&&<Check className="size-4"/>}{t}</Button>)}</div><div className="max-w-xs"><Choice label="Appointment length" value={duration} onChange={setDuration} options={[{value:'30',label:'30 minutes'},{value:'60',label:'60 minutes'}]}/></div>{grid(selected??state.trainers,true)}</section>}
    <Dialog open={editor!==null} onOpenChange={o=>{if(!o)setEditor(null);}}><DialogContent className="max-h-[90dvh] overflow-y-auto p-4 sm:p-6"><DialogHeader><DialogTitle>{editor?.kind==='book'?'Book demo appointment':editor?.kind==='move'?'Reschedule / change trainer':'Cancel demo appointment'}</DialogTitle><DialogDescription>{editTrainer} · {editDate} · {editTime} · Fake clients only</DialogDescription></DialogHeader>
      {editor&&(editor.kind==='book'||editor.kind==='move')&&<form className="min-w-0 space-y-4" onSubmit={e=>{e.preventDefault();apply();}}>
        {editor.kind==='book'?<Choice label="Demo client" value={clientId} onChange={v=>{setClientId(v);setError('');}} options={state.clients.map(c=>({value:c.id,label:c.name}))}/>:<p className="font-medium">{client?.name}</p>}
        {editor.kind==='move'&&<><DemoWeekStrip date={editDate} onChange={setEditDate}/><Label htmlFor="demo-edit-time">Start time</Label><Input id="demo-edit-time" type="time" value={editTime} onChange={e=>setEditTime(e.target.value)} required/><Choice label="Appointment trainer" value={editTrainer} onChange={setEditTrainer} options={trainerOptions}/></>}
        {client&&editor.kind==='book'&&<>{needsPackage?<><p className="text-sm font-medium">No unreserved visits remain. Start a fresh demo package.</p><div className="flex flex-wrap gap-1">{[8,4,2,1].map(n=><Button type="button" key={n} variant={visits===String(n)?'secondary':'outline'} onClick={()=>{setVisits(String(n));setPrice(n===8?'375':n===4?'200':n===2?'100':'50');}}>{n===1?'Single':`${n} visits`}</Button>)}</div><div className="grid grid-cols-2 gap-3"><div><Label htmlFor="demo-visits">Visits</Label><Input id="demo-visits" type="number" min="1" max="100" step="1" value={visits} onChange={e=>setVisits(e.target.value)} required/></div><div><Label htmlFor="demo-price">Demo price ($)</Label><Input id="demo-price" type="number" min="0" step="0.01" value={price} onChange={e=>setPrice(e.target.value)} required/></div></div><p className="text-xs text-muted-foreground">Prior package retained: {client.used}/{client.total} completed · {money(client.price)} · {money(client.paid)} recognized. Demo prices only.</p></>:<p className="text-sm text-muted-foreground">Active package · {client.total} visits · {demoUnreserved(state,client)} unreserved<br/>{money(client.price)} package · {money(client.paid)} recognized</p>}{Boolean(client.history?.length)&&<details><summary className="cursor-pointer text-sm">Prior demo packages ({client.history?.length})</summary>{client.history?.map(p=><p key={p.id} className="text-xs text-muted-foreground">{p.used}/{p.total} completed · {money(p.price)} · {money(p.paid)} recognized</p>)}</details>}</>}
        {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<Button type="submit" disabled={!clientId} className="w-full">{editor.kind==='book'?'Book demo appointment':'Save demo changes'}</Button>
      </form>}
      {editor?.kind==='cancel'&&<><p className="text-sm">{client?.name}: count this cancelled appointment as one visit, or cancel without changing visit counts? Neither option changes payment.</p>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<Button variant="outline" onClick={()=>apply(true)}>Count as a visit</Button><Button variant="destructive" onClick={()=>apply(false)}>Cancel (no visit change)</Button></>}
    </DialogContent></Dialog>
    <Dialog open={addOpen&&isAdmin&&!isLoading} onOpenChange={setAddOpen}><DialogContent><DialogHeader><DialogTitle>Add demo trainer</DialogTitle><DialogDescription>Temporary fake trainer only. No account or permissions are created.</DialogDescription></DialogHeader><form className="space-y-3" onSubmit={e=>{e.preventDefault();try{const next=demoAddTrainer(simulation,trainerName,isAdmin&&!isLoading);setState(next);setTrainer(trainerName.trim());setSelected(null);setAddOpen(false);setNotice('Demo trainer added.');}catch(err){setError(err instanceof Error?err.message:'Unable to add.');}}}><Label htmlFor="demo-trainer-name">Trainer name</Label><Input id="demo-trainer-name" maxLength={40} value={trainerName} onChange={e=>setTrainerName(e.target.value)} required/>{error&&<p role="alert">{error}</p>}<Button type="submit" disabled={!isAdmin||isLoading}>Add demo trainer</Button></form></DialogContent></Dialog>
    <Dialog open={resetOpen} onOpenChange={setResetOpen}><DialogContent><DialogHeader><DialogTitle>Reset isolated demo?</DialogTitle><DialogDescription>Discard simulated changes. Live clients are never affected.</DialogDescription></DialogHeader><Button onClick={()=>{setState({...initialDemoState(),appointments:[]});setTrainer(state.trainers[0]??'Avery');setSelected(null);setSwapFrom(null);setNotice('Demo reset.');setResetOpen(false);}}>Reset simulation</Button></DialogContent></Dialog>
  </div>;
}
