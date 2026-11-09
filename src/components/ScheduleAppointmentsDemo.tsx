import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Focus, List, Plus, RotateCcw, Search, MoreHorizontal, Clock, ArrowLeftRight, Check, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { DEMO_DATE, demoTrainers, demoTime, demoVisit, demoBook, demoMove, demoSwap, demoComplete, demoCancel, demoOpenings, initialDemoState, type DemoAppointment, type DemoTrainer } from '@/lib/schedule-demo';

type Mode = 'day' | 'zoom' | 'trainer' | 'openings';
type Editor = {kind:'book'|'move'|'swap'|'cancel'; appointment?: DemoAppointment; trainer:DemoTrainer; start:number};
function Choice({label,value,onChange,options}:{label:string;value:string;onChange:(value:string)=>void;options:{value:string;label:string}[]}) {
  return <div className="min-w-0 space-y-1"><Label>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label} className="min-h-11 w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent>{options.map(o=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></div>;
}
const money = (value:number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value);
export function ScheduleAppointmentsDemo() {
  const [state,setState]=useState(initialDemoState);
  const [date,setDate]=useState(DEMO_DATE);
  const [mode,setMode]=useState<Mode>('day');
  const [trainer,setTrainer]=useState<DemoTrainer>('Avery');
  const [selected,setSelected]=useState<DemoTrainer[]>([...demoTrainers]);
  const [duration,setDuration]=useState('30');
  const [search,setSearch]=useState('');
  const [editor,setEditor]=useState<Editor|null>(null);
  const [clientId,setClientId]=useState('demo-2');
  const [editDate,setEditDate]=useState(DEMO_DATE);
  const [editTrainer,setEditTrainer]=useState<DemoTrainer>('Avery');
  const [editTime,setEditTime]=useState('11:00');
  const [packageMode,setPackageMode]=useState('existing');
  const [price,setPrice]=useState('375');
  const [customVisits,setCustomVisits]=useState('6');
  const [swapId,setSwapId]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [resetOpen,setResetOpen]=useState(false);
  const client=state.clients.find(c=>c.id===clientId);
  const trainerOptions=demoTrainers.map(t=>({value:t,label:t}));
  const active=state.appointments.filter(a=>a.date===date && a.status!=='cancelled').sort((a,b)=>a.start-b.start);
  const visible=active.filter(a=>state.clients.find(c=>c.id===a.clientId)?.name.toLowerCase().includes(search.trim().toLowerCase()));
  const openings=demoOpenings(state,date,selected,Number(duration));
  const shift=(days:number)=>{const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);setDate(d.toISOString().slice(0,10));};
  const open=(kind:Editor['kind'],a?:DemoAppointment,slot?:{trainer:DemoTrainer;start:number})=>{
    setEditor({kind,appointment:a,trainer:a?.trainer??slot?.trainer??trainer,start:a?.start??slot?.start??660});
    setClientId(a?.clientId??'demo-2');setEditDate(a?.date??date);setEditTrainer(a?.trainer??slot?.trainer??trainer);
    const start=a?.start??slot?.start??660;setEditTime(`${String(Math.floor(start/60)).padStart(2,'0')}:${String(start%60).padStart(2,'0')}`);
    setPackageMode('existing');setSwapId('');setError('');
  };
  const apply=()=>{
    if(!editor) return;
    try {
      const [h,m]=editTime.split(':').map(Number); const start=(h??NaN)*60+(m??NaN);
      if(!editDate || !Number.isFinite(start)) throw new Error('Choose a date and time.');
      let next=state;
      if(editor.kind==='book') next=demoBook(state,{id:`demo-book-${crypto.randomUUID()}`,clientId,trainer:editTrainer,date:editDate,start,duration:Number(duration),status:'booked'},packageMode==='existing'?undefined:{total:packageMode==='custom'?Number(customVisits):Number(packageMode),price:Number(price)});
      else if(editor.kind==='move' && editor.appointment) next=demoMove(state,editor.appointment.id,{trainer:editTrainer,date:editDate,start,duration:editor.appointment.duration});
      else if(editor.kind==='swap' && editor.appointment) next=demoSwap(state,editor.appointment.id,swapId);
      else if(editor.kind==='cancel' && editor.appointment) next=demoCancel(state,editor.appointment.id);
      setState(next);setNotice(`Demo appointment ${editor.kind==='book'?'booked':editor.kind==='move'?'updated':editor.kind==='swap'?'swapped':'cancelled'}. No live records changed.`);setEditor(null);
    } catch(e) {setError(e instanceof Error?e.message:'Demo action failed.');}
  };
  const complete=(a:DemoAppointment)=>{try{setState(demoComplete(state,a.id));setNotice('Demo visit completed. No payment recorded or live visit changed.');}catch(e){setNotice(e instanceof Error?e.message:'Unable to complete demo visit.');}};
  const tile=(a:DemoAppointment,large=false)=>{
    const c=state.clients.find(c=>c.id===a.clientId); if(!c)return null;
    const due=Math.max(0,c.price-c.paid);
    return <article key={a.id} aria-label={`${c.name}, ${demoTime(a.start)}, ${a.trainer}`} className={`relative shrink-0 snap-start rounded-md border-l-4 border-l-chart-2 bg-card p-3 ${large?'flex h-[300px] flex-col border':'min-h-28 border-b'}`}>
      <div className="flex items-start justify-between gap-2"><span className="text-sm font-semibold tabular-nums">{demoTime(a.start)}<span className="ml-2 text-xs font-normal text-muted-foreground">{a.duration} min</span></span><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label={`Actions for ${c.name}`} title="Appointment actions"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={a.status!=='booked'} onSelect={()=>open('move',a)}>Reschedule / change trainer</DropdownMenuItem><DropdownMenuItem disabled={a.status!=='booked'} onSelect={()=>open('swap',a)}>Swap appointments</DropdownMenuItem><DropdownMenuItem disabled={a.status!=='booked'} onSelect={()=>open('cancel',a)}>Cancel appointment</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
      <h3 className={`font-semibold ${large?'mt-5 text-2xl':'text-base'}`}>{c.name}</h3>
      <div className={`flex flex-wrap gap-x-3 gap-y-1 ${large?'mt-4 text-base':'mt-1 text-xs'}`}><span>Visit {demoVisit(state,a)} of {c.total}</span><span className={due?'font-semibold text-destructive':'font-semibold text-chart-2'}>{due?`${money(due)} due`:`${money(c.price)} paid`}</span></div>
      {large&&<><p className="mt-2 text-sm text-muted-foreground">Demo package · {money(c.price)}<br />{money(c.paid)} recognized · {c.used} completed</p><div className="mt-auto flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{a.status==='completed'?'Completed':'Booked · projected visit'}</span><Button variant="outline" size="sm" disabled={a.status==='completed'} onClick={()=>complete(a)}><Check />{a.status==='completed'?'Completed':'Complete demo visit'}</Button></div></>}
      {!large&&a.status==='completed'&&<span className="text-xs text-muted-foreground">Completed</span>}
    </article>;
  };
  return <div className="min-w-0 space-y-5">
    <section className="flex gap-3 border-y border-chart-4 bg-chart-4/10 py-3" aria-label="Demo safety notice"><FlaskConical className="mt-0.5 size-5 shrink-0 text-foreground"/><div><strong className="text-sm">ISOLATED DEMO · Fake clients only</strong><p className="text-xs text-muted-foreground">Simulated appointments, packages and payment labels. Resets when you leave or refresh. No Square, SMS, charges or live record changes.</p></div></section>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Appointments demo</h1><p className="text-sm text-muted-foreground">{active.length} appointments · America/Chicago</p></div><div className="flex gap-2"><Button variant="outline" size="icon" aria-label="Reset demo" title="Reset demo" onClick={()=>setResetOpen(true)}><RotateCcw /></Button><Button onClick={()=>open('book')}><Plus />Book demo</Button></div></div>
    <div className="flex min-w-0 flex-wrap items-end gap-2"><Button variant="outline" size="icon" aria-label="Previous day" title="Previous day" onClick={()=>shift(-1)}><ChevronLeft /></Button><div className="min-w-0 flex-1 sm:max-w-52"><Label htmlFor="demo-day">Demo day</Label><Input id="demo-day" type="date" value={date} className="min-h-11 w-full min-w-0" onChange={e=>{if(e.target.value)setDate(e.target.value);}} /></div><Button variant="outline" size="icon" aria-label="Next day" title="Next day" onClick={()=>shift(1)}><ChevronRight /></Button><Button variant="ghost" onClick={()=>setDate(DEMO_DATE)}>Nov 9</Button></div>
    <nav aria-label="Demo appointment views" className="grid grid-cols-4 gap-1 border-b pb-2">{([{id:'day',label:'Day',icon:CalendarDays},{id:'zoom',label:'Zoom',icon:Focus},{id:'trainer',label:'Trainer',icon:List},{id:'openings',label:'Openings',icon:Clock}] as const).map(v=><Button key={v.id} variant={mode===v.id?'default':'ghost'} aria-pressed={mode===v.id} className="h-auto min-h-12 min-w-0 flex-col gap-1 px-1 text-xs sm:flex-row sm:text-sm" onClick={()=>setMode(v.id)}><v.icon className="size-4"/>{v.label}</Button>)}</nav>
    <p role="status" className={notice?'text-sm font-medium':'sr-only'}>{notice}</p>
    {mode!=='openings'&&<div className="relative max-w-sm"><Search className="absolute left-3 top-3 size-4 text-muted-foreground"/><Input aria-label="Search demo clients" placeholder="Search fake clients" value={search} onChange={e=>setSearch(e.target.value)} className="min-h-11 pl-9"/></div>}
    {(mode==='day'||mode==='zoom')&&<div className="max-w-full overflow-x-auto overscroll-x-contain pb-3" tabIndex={0} aria-label="Trainer columns"><div className="flex min-w-max gap-3">{demoTrainers.map(t=><section key={t} className={`shrink-0 ${mode==='zoom'?'w-[280px] sm:w-[310px]':'w-[220px] sm:w-[260px]'}`}><header className="mb-2 flex items-center justify-between border-b py-2"><Button variant="link" className="h-auto px-0 text-base font-semibold" onClick={()=>{setTrainer(t);setMode('trainer');}}>{t}</Button><span className="text-xs text-muted-foreground">{visible.filter(a=>a.trainer===t).length} visits</span></header><div className={`overflow-y-auto overscroll-y-contain ${mode==='zoom'?'h-[300px] snap-y snap-mandatory space-y-3':'h-[480px] space-y-2'}`} tabIndex={0} aria-label={`${t} ${mode==='zoom'?'current appointment':'day overview'}`}>{visible.filter(a=>a.trainer===t).map(a=>tile(a,mode==='zoom'))}{!visible.some(a=>a.trainer===t)&&<p className="py-6 text-sm text-muted-foreground">No matching appointments.</p>}</div><Button variant="outline" className="mt-3 w-full" onClick={()=>open('book',undefined,{trainer:t,start:660})}><Plus />Book with {t}</Button></section>)}</div></div>}
    {mode==='trainer'&&<section className="space-y-3"><div className="max-w-xs"><Choice label="Trainer" value={trainer} onChange={v=>setTrainer(v as DemoTrainer)} options={trainerOptions}/></div><div className="max-w-2xl divide-y">{visible.filter(a=>a.trainer===trainer).map(a=>tile(a))}{!visible.some(a=>a.trainer===trainer)&&<p className="py-6 text-sm text-muted-foreground">No matching appointments.</p>}</div><Button variant="outline" onClick={()=>open('book')}><Plus />Book with {trainer}</Button></section>}
    {mode==='openings'&&<section className="space-y-4"><div className="flex flex-wrap gap-2"><Button variant={selected.length===3?'default':'outline'} aria-pressed={selected.length===3} onClick={()=>setSelected([...demoTrainers])}>Any trainer</Button>{demoTrainers.map(t=><Button key={t} variant={selected.includes(t)?'secondary':'outline'} aria-pressed={selected.includes(t)} onClick={()=>setSelected(prev=>prev.includes(t)?prev.filter(x=>x!==t):[...prev,t])}>{selected.includes(t)&&<Check />}{t}</Button>)}</div><div className="max-w-xs"><Choice label="Appointment length" value={duration} onChange={setDuration} options={[{value:'30',label:'30 minutes'},{value:'60',label:'60 minutes'}]}/></div><h2 className="font-semibold">{openings.length} available demo slots</h2><div className="max-h-[520px] overflow-y-auto divide-y">{openings.map(s=><div key={`${s.trainer}-${s.start}`} className="flex items-center justify-between gap-3 py-3"><div className="text-sm"><strong>{demoTime(s.start)}</strong><span className="ml-3">{s.trainer}</span><span className="block text-xs text-muted-foreground">{s.duration} minutes</span></div><Button variant="outline" size="icon" aria-label={`Book ${s.trainer} at ${demoTime(s.start)}`} title="Book demo slot" onClick={()=>open('book',undefined,s)}><Plus /></Button></div>)}{!openings.length&&<p className="py-5 text-sm text-muted-foreground">No openings for the selected trainers.</p>}</div></section>}
    <Dialog open={editor!==null} onOpenChange={o=>{if(!o)setEditor(null);}}><DialogContent className="p-4 sm:p-6"><DialogHeader><DialogTitle>{editor?.kind==='book'?'Book demo appointment':editor?.kind==='move'?'Reschedule / change trainer':editor?.kind==='swap'?'Swap demo appointments':'Cancel demo appointment'}</DialogTitle><DialogDescription>Fake clients only. No live schedule or payment changes.</DialogDescription></DialogHeader>
      {editor&&(editor.kind==='book'||editor.kind==='move')&&<form className="min-w-0 space-y-4" onSubmit={e=>{e.preventDefault();apply();}}>
        {editor.kind==='book'?<Choice label="Demo client" value={clientId} onChange={v=>{setClientId(v);setPackageMode('existing');}} options={state.clients.map(c=>({value:c.id,label:c.name}))}/>:<p className="font-medium">{client?.name}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="min-w-0"><Label htmlFor="demo-edit-date">Appointment date</Label><Input id="demo-edit-date" type="date" value={editDate} onChange={e=>setEditDate(e.target.value)} required className="min-w-0 min-h-11"/></div><div className="min-w-0"><Label htmlFor="demo-edit-time">Start time</Label><Input id="demo-edit-time" type="time" value={editTime} onChange={e=>setEditTime(e.target.value)} required className="min-w-0 min-h-11"/></div></div>
        <Choice label="Appointment trainer" value={editTrainer} onChange={v=>setEditTrainer(v as DemoTrainer)} options={trainerOptions}/>
        {editor.kind==='book'&&<><Choice label="Appointment length" value={duration} onChange={setDuration} options={[{value:'30',label:'30 minutes'},{value:'60',label:'60 minutes'}]}/><Choice label="Demo package" value={packageMode} onChange={v=>{setPackageMode(v);setPrice(v==='8'?'375':v==='4'?'200':v==='2'?'100':v==='1'?'50':'175');}} options={[{value:'existing',label:'Use existing client package'},{value:'8',label:'8 visits'},{value:'4',label:'4 visits'},{value:'2',label:'2 visits'},{value:'1',label:'Single visit'},{value:'custom',label:'Custom package'}]}/>{packageMode==='existing'?<p className="text-sm text-muted-foreground">{client?.total} visits · {client?.used} completed · {state.appointments.filter(a=>a.clientId===clientId&&a.status==='booked').length} reserved<br />Package {money(client?.price??0)} · recognized {money(client?.paid??0)}</p>:<><p className="text-xs text-muted-foreground">Illustrative demo prices, not live rates. New packages require a client with no completed or reserved visits.</p>{packageMode==='custom'&&<div><Label htmlFor="demo-visits">Custom visits</Label><Input id="demo-visits" type="number" min="1" max="100" step="1" required value={customVisits} onChange={e=>setCustomVisits(e.target.value)}/></div>}<div><Label htmlFor="demo-price">Demo package price ($)</Label><Input id="demo-price" type="number" min="0" step="0.01" required value={price} onChange={e=>setPrice(e.target.value)}/></div></>}</>}
        {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<Button type="submit" className="w-full">{editor.kind==='book'?'Book demo appointment':'Save demo changes'}</Button>
      </form>}
      {editor?.kind==='swap'&&<><p className="text-sm">Swap {client?.name}’s time and trainer with:</p><Choice label="Swap with" value={swapId} onChange={setSwapId} options={state.appointments.filter(a=>a.id!==editor.appointment?.id&&a.status==='booked').map(a=>({value:a.id,label:`${state.clients.find(c=>c.id===a.clientId)?.name} · ${a.date} ${demoTime(a.start)} · ${a.trainer}`}))}/>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<Button disabled={!swapId} onClick={apply}><ArrowLeftRight />Swap demo appointments</Button></>}
      {editor?.kind==='cancel'&&<><p className="text-sm">Cancel {client?.name}’s demo appointment? This releases the reserved demo visit; it does not refund or change recognized payment.</p><Button variant="destructive" onClick={apply}>Confirm demo cancellation</Button></>}
    </DialogContent></Dialog>
    <Dialog open={resetOpen} onOpenChange={setResetOpen}><DialogContent><DialogHeader><DialogTitle>Reset isolated demo?</DialogTitle><DialogDescription>Discard simulated changes and return to November 9. Live clients are never affected.</DialogDescription></DialogHeader><Button onClick={()=>{setState(initialDemoState());setDate(DEMO_DATE);setNotice('Demo reset.');setResetOpen(false);}}>Reset fake appointments</Button></DialogContent></Dialog>
  </div>;
}