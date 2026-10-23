
const SUPABASE_URL = 'https://nnfngkwprbfixvjentqc.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_FkK0D5R9szF728oUWyd_iw_LVToZUq3';

// The CDN exposes `window.supabase`, so use a different name for the client.
const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}
);

const themes = ["system", "light", "dark"];
function applyTheme(theme) {
  const selected = themes.includes(theme) ? theme : "system";
  document.documentElement.dataset.theme = selected;
  const button = document.querySelector("#theme-toggle");
  if (button) {
    const labels = {system:"Sistema", light:"Chiaro", dark:"Scuro"};
    const icons = {system:"◐", light:"☀️", dark:"🌙"};
    button.innerHTML = `${icons[selected]} <span>${labels[selected]}</span>`;
    button.setAttribute("aria-label", `Stile: ${labels[selected]}. Clicca per cambiare`);
    button.title = `Stile: ${labels[selected]}`;
  }
}
function cycleTheme() {
  const current = document.documentElement.dataset.theme || "system";
  applyTheme(themes[(themes.indexOf(current) + 1) % themes.length]);
}
applyTheme("system");
document.querySelector("#theme-toggle").addEventListener("click", cycleTheme);

const db={threshold:70,animators:[],meetings:[],attendance:{}};
let selectedMeetingId=null;
let currentUser=null;
let animatorSearch="";
let animatorSort="az";
function getUserDisplayName(user){
  const metadata=user?.user_metadata||{};
  return metadata.display_name||metadata.full_name||metadata.name||user?.email||"Educatore";
}
function updateAuthStatus(){
  const status=document.querySelector("#auth-status");
  if(!status)return;
  if(!currentUser){
    status.innerHTML="";
    return;
  }
  status.innerHTML=`<button class="auth-status-button" type="button" onclick="signOut()">👤 ${esc(getUserDisplayName(currentUser))} · Esci</button>`;
}
async function signOut(){
  const {error}=await supabaseClient.auth.signOut();
  if(error){showError(error);return}
  currentUser=null;
  updateAuthStatus();
  location.hash="#/";
}
function showError(error){
  console.error("Errore:",error);
  const detail=[error.code,error.details].filter(Boolean).join(" · ");
  document.querySelector("#app").innerHTML=`<section class="card"><h1>Si è verificato un errore</h1><p class="muted">${esc(error.message||"Operazione non riuscita.")}</p>${detail?`<p class="muted">${esc(detail)}</p>`:""}<a class="back" href="#/">← Torna al tracker</a></section>`;
}
async function loadFromSupabase(){
  const [animatorsResult, meetingsResult, attendanceResult]=await Promise.all([
    supabaseClient.from("animatori").select("id,nickname,attivo").eq("attivo",true).order("id"),
    supabaseClient.from("incontri").select("id,data,titolo,tipo,gruppo_presenza").order("data").order("id"),
    supabaseClient.from("presenze").select("animatore_id,incontro_id,presente")
  ]);
  const firstError=animatorsResult.error||meetingsResult.error||attendanceResult.error;
  if(firstError) throw firstError;
  db.animators=animatorsResult.data.map(a=>({id:a.id,nickname:a.nickname}));
  db.meetings=meetingsResult.data.map(m=>({id:m.id,date:m.data,title:m.titolo,type:m.tipo,group:m.gruppo_presenza}));
  db.attendance={};
  attendanceResult.data.forEach(row=>{
    db.attendance[`${row.animatore_id}-${row.incontro_id}`]=row.presente===true;
  });
}
async function saveMeetingAttendance(meetingId){
  try{
    const results=await Promise.all(db.animators.map(a=>supabaseClient.from("presenze").upsert(
      {animatore_id:a.id,incontro_id:meetingId,presente:db.attendance[`${a.id}-${meetingId}`]===true},
      {onConflict:"animatore_id,incontro_id"}
    )));
    const error=results.find(result=>result.error)?.error;
    if(error) throw error;
    alert("Presenze salvate su Supabase.");
  }catch(error){
    showError(error);
  }
}
async function createRemoteMeeting(meeting){
  const {data,error}=await supabaseClient.from("incontri").insert({
    data:meeting.date,titolo:meeting.title,tipo:meeting.type,gruppo_presenza:meeting.group||null
  }).select("id,data,titolo,tipo,gruppo_presenza").single();
  if(error) throw error;
  return {id:data.id,date:data.data,title:data.titolo,type:data.tipo,group:data.gruppo_presenza};
}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function fmtDate(d){return new Date(d+"T12:00:00").toLocaleDateString("it-IT",{day:"2-digit",month:"2-digit",year:"numeric"})}
function isFuture(m){return new Date(m.date+"T23:59:59")>new Date()}
function meetingGroup(m){return m.group||`meeting:${m.id}`}
function requiredGroups(){
 const groups=new Map();
 db.meetings.filter(m=>m.type==="obbligatorio").forEach(m=>{
   const key=meetingGroup(m);
   if(!groups.has(key))groups.set(key,[]);
   groups.get(key).push(m);
 });
 return [...groups.values()];
}
function stats(a){
 const req=requiredGroups();
 const done=req.filter(group=>group.some(m=>!isFuture(m)&&db.attendance[`${a.id}-${m.id}`]===true)).length;
 const past=req.filter(group=>group.some(m=>!isFuture(m))).length;
 const total=req.length;
 const pct=total?Math.round(done/total*100):0;
 return {done,total,pct,past:past.length};
}
function status(s){return s.pct>=db.threshold?["🟢 IDONEO","good"]:["🔴 NON IDONEO","badtext"]}
function app(){let hash=location.hash||"#/"; if(hash==="#/")home(); else if(hash.startsWith("#/animatore/"))detail(Number(hash.split("/")[2])); else if(hash==="#/admin/login")login(); else if(hash==="#/admin")requireAuth(dashboard); else if(hash==="#/admin/presenze")requireAuth(attendancePage); else home()}
window.addEventListener("hashchange",app);
function home(){
 const req=requiredGroups(), opt=db.meetings.filter(m=>m.type==="facoltativo");
 const visibleAnimators=db.animators
   .filter(a=>a.nickname.toLocaleLowerCase("it-IT").includes(animatorSearch.toLocaleLowerCase("it-IT")))
   .sort((a,b)=>animatorSort==="za"
     ? b.nickname.localeCompare(a.nickname,"it",{sensitivity:"base"})
     : a.nickname.localeCompare(b.nickname,"it",{sensitivity:"base"}));
 document.querySelector("#app").innerHTML=`
 <section class="hero"><div class="eyebrow">🌟 Animatori 2026/27</div><h1>Tracker Presenze</h1><p>Controlla le presenze del gruppo e verifica il raggiungimento dell'obiettivo del <b>${db.threshold}%</b> sugli incontri obbligatori.</p></section>
 <div class="stats"><div class="stat"><b>${req.length}</b><small>obblighi obbligatori programmati</small></div><div class="stat"><b>${opt.length}</b><small>incontri facoltativi</small></div></div>
 <div class="section-title"><h2>👥 Animatori</h2><span class="muted">Clicca su un nome per il dettaglio</span></div>
 <div class="animator-filters"><label class="search-field"><span class="sr-only">Cerca animatore</span><input id="animator-search" type="search" placeholder="Cerca animatore..." value="${esc(animatorSearch)}"></label><label class="sort-field"><span class="sr-only">Ordina animatori</span><select id="animator-sort"><option value="az" ${animatorSort==="az"?"selected":""}>A → Z</option><option value="za" ${animatorSort==="za"?"selected":""}>Z → A</option></select></label></div>
 <div class="cards">${visibleAnimators.length?visibleAnimators.map(a=>{const s=stats(a),st=status(s);return `<article class="card anim-card" onclick="location.hash='#/animatore/${a.id}'"><div class="row"><div class="nickname">${esc(a.nickname)}</div><div class="pct">${s.pct}%</div></div><div class="progress"><div class="bar ${s.pct<db.threshold?'bad':''}" style="width:${Math.min(s.pct,100)}%"></div></div><div class="row"><span class="status ${st[1]}">${st[0]}</span><span class="muted">${s.done}/${s.total} obbligatori</span></div></article>`}).join(""):`<div class="empty">Nessun animatore trovato.</div>`}</div>`;
 document.querySelector("#animator-search").addEventListener("input",event=>{
   animatorSearch=event.target.value;
   home();
   const search=document.querySelector("#animator-search");
   search.focus();
   search.setSelectionRange(search.value.length,search.value.length);
 });
 document.querySelector("#animator-sort").addEventListener("change",event=>{
   animatorSort=event.target.value;
   home();
 });
}
function detail(id){
 const a=db.animators.find(x=>x.id===id); if(!a)return home(); const s=stats(a),st=status(s);
 const sorted=[...db.meetings].sort((x,y)=>x.date.localeCompare(y.date));
 document.querySelector("#app").innerHTML=`<section class="detail"><a class="back" href="#/">← Torna al tracker</a><div class="card detail-head"><div class="avatar">🌟</div><div class="eyebrow">Animatore</div><h1>${esc(a.nickname)}</h1><div class="bigpct">${s.pct}%</div><div class="progress"><div class="bar ${s.pct<db.threshold?'bad':''}" style="width:${Math.min(s.pct,100)}%"></div></div><div class="status ${st[1]}">${st[0]}</div><p class="muted">${s.done} presenze su ${s.total} incontri obbligatori programmati</p></div><div class="card attendance-list"><h2>📅 Dettaglio incontri</h2>${sorted.map(m=>{const future=isFuture(m),v=db.attendance[`${id}-${m.id}`],req=m.type==="obbligatorio";return `<div class="attendance ${future?'future':''}"><div><div class="date-title">${fmtDate(m.date)} · ${esc(m.title)}</div><div class="date-sub"><span class="pill ${req?'req':''}">${req?'OBBLIGATORIO':'FACOLTATIVO'}</span> ${future?' · In programma':''}</div></div><div class="check">${future?'🕐':v?'✅':'❌'}</div></div>`}).join("")}</div></section>`;
}
function login(){
 document.querySelector("#app").innerHTML=`<section class="login"><div class="card"><div class="eyebrow">Area riservata</div><h1>🔐 Area Educatori</h1><p class="muted">Accedi con l'account Educatore configurato in Supabase.</p><form id="login-form"><div class="field"><label>Email</label><input id="email" type="email" autocomplete="username" required></div><div class="field"><label>Password</label><input id="pw" type="password" autocomplete="current-password" required></div><button class="btn full">ACCEDI</button></form><p><a class="back" href="#/">← Torna al tracker</a></p></div></section>`;
 document.querySelector("#login-form").addEventListener("submit",signIn);
}
async function signIn(event){
 event.preventDefault();
 const {data,error}=await supabaseClient.auth.signInWithPassword({email:document.querySelector("#email").value.trim(),password:document.querySelector("#pw").value});
 if(error){alert(`Accesso non riuscito: ${error.message}`);return}
 currentUser=data.user;
 updateAuthStatus();
 location.hash="#/admin";
}
async function requireAuth(page){
 if(!currentUser){
   const {data}=await supabaseClient.auth.getUser();
   if(!data.user){location.hash="#/admin/login";return}
   currentUser=data.user;
 }
 page();
}
function dashboard(){
 const eligible=db.animators.filter(a=>stats(a).pct>=db.threshold).length;
 document.querySelector("#app").innerHTML=`<section><div class="section-title"><div><div class="eyebrow">Area educatori</div><h1>Dashboard</h1></div><a href="#/" class="muted">Vista pubblica →</a></div>
 <div class="dashboard-grid"><div class="stat"><b>${db.animators.length}</b><small>Animatori</small></div><div class="stat"><b>${requiredGroups().length}</b><small>Obblighi obbligatori</small></div><div class="stat"><b>${db.meetings.filter(m=>m.type==='facoltativo').length}</b><small>Facoltativi</small></div><div class="stat"><b>${eligible}</b><small>Idonei al ${db.threshold}%</small></div></div>
 <div class="admin-actions"><h2>Azioni rapide</h2><div class="actions"><a class="btn success" href="#/admin/presenze">✅ Inserisci presenze</a><button class="btn secondary" onclick="addMeeting()">📅 Nuovo incontro</button></div></div>
 <div class="notice">Dati sincronizzati con <b>Supabase</b>. Le modifiche alle presenze vengono salvate online quando premi il relativo pulsante.</div>
 <div class="card"><h2>Ultimi incontri</h2>${[...db.meetings].sort((a,b)=>b.date.localeCompare(a.date)).map(m=>{const done=db.animators.filter(a=>db.attendance[`${a.id}-${m.id}`]===true).length;return `<div class="attendance"><div><b>${fmtDate(m.date)} · ${esc(m.title)}</b><div class="date-sub"><span class="pill ${m.type==='obbligatorio'?'req':''}">${m.type.toUpperCase()}</span></div></div><b>${done}/${db.animators.length}</b></div>`}).join("")}</div></section>`;
}
function attendancePage(){
 const meetings=[...db.meetings].sort((a,b)=>a.date.localeCompare(b.date)); const selected=selectedMeetingId||meetings.find(m=>!isFuture(m))?.id||meetings[0]?.id;
 const m=db.meetings.find(x=>x.id===selected)||meetings[0];
 if(!m){document.querySelector("#app").innerHTML='<div class="empty">Nessun incontro. Crea prima un incontro.</div>';return}
 const rows=db.animators.map(a=>`<tr><td><b>${esc(a.nickname)}</b></td><td><button class="check-btn" onclick="togglePresence(${a.id},${m.id})">${db.attendance[`${a.id}-${m.id}`]===true?'✅':'❌'}</button></td></tr>`).join("");
 document.querySelector("#app").innerHTML=`<section><a class="back" href="#/admin">← Dashboard</a><div class="section-title"><div><div class="eyebrow">Area educatori</div><h1>Inserisci presenze</h1></div></div>
 <div class="card"><div class="field"><label>Incontro</label><select onchange="selectMeeting(this.value)">${meetings.map(x=>`<option value="${x.id}" ${x.id===m.id?'selected':''}>${fmtDate(x.date)} · ${esc(x.title)} · ${x.type}${x.group?' · gruppo '+esc(x.group):''}</option>`).join("")}</select></div><div class="actions"><button class="btn secondary" onclick="allPresent(${m.id})">✅ Tutti presenti</button><button class="btn success" onclick="saveMeetingAttendance(${m.id})">💾 Salva su Supabase</button></div></div>
 <div class="table-wrap" style="margin-top:16px"><table class="table"><thead><tr><th>Animatore</th><th>Presenza</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}
function selectMeeting(id){selectedMeetingId=Number(id);location.hash="#/admin/presenze"}
function togglePresence(a,m){
 const presente=!db.attendance[`${a}-${m}`];
 db.attendance[`${a}-${m}`]=presente;
 attendancePage();
}
function allPresent(m){
 db.animators.forEach(a=>db.attendance[`${a.id}-${m}`]=true);
 attendancePage();
}
async function addMeeting(){
 const date=prompt("Data (AAAA-MM-GG):","2027-03-09"); if(!date)return;
 const title=prompt("Titolo incontro:","Incontro mensile"); if(!title)return;
 const type=confirm("Premi OK per OBBLIGATORIO, Annulla per FACOLTATIVO.")?"obbligatorio":"facoltativo";
 const group=type==="obbligatorio"
   ?prompt("Gruppo alternativo (es. 2026-10). Lascia vuoto se è un obbligo singolo:","")
   :"";
 try{
  const meeting=await createRemoteMeeting({date,title,type,group});
   db.meetings.push(meeting);
   db.animators.forEach(a=>db.attendance[`${a.id}-${meeting.id}`]=false);
   dashboard();
 }catch(error){showError(error)}
}
async function startApp(){
  try{
    const {data:{session}}=await supabaseClient.auth.getSession();
    currentUser=session?.user||null;
    updateAuthStatus();
    supabaseClient.auth.onAuthStateChange((_event,nextSession)=>{
      currentUser=nextSession?.user||null;
      updateAuthStatus();
    });
    await loadFromSupabase();
    app();
  }catch(error){
    showError(error);
  }
}
startApp();