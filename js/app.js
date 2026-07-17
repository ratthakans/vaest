/* ═══ helpers ═══ */
  const $=id=>document.getElementById(id);
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function toast(m){$('toastMsg').textContent=m;$('toast').classList.add('show');clearTimeout(window._tt);window._tt=setTimeout(()=>$('toast').classList.remove('show'),2400)}
  // .stop() kills any queued frame — call it before painting a final result, or the pending
  // frame fires after your write and resurrects the streaming text + cursor on top of it.
  function raf(fn){let p=false,last,dead=false;const g=v=>{last=v;if(p||dead)return;p=true;requestAnimationFrame(()=>{p=false;if(!dead)fn(last)})};g.stop=()=>{dead=true};return g}
  function nearBottom(el){return el.scrollHeight-el.scrollTop-el.clientHeight<90}
  function softScroll(el){if(nearBottom(el))el.scrollTop=el.scrollHeight}
  // rAF smooth scroll — reliable across browsers (no scroll-behavior)
  function smoothTo(el,to,dur){to=Math.max(0,Math.min(to,el.scrollHeight-el.clientHeight));const from=el.scrollTop,d=to-from;if(Math.abs(d)<2){el.scrollTop=to;return}
    dur=dur||Math.min(700,220+Math.abs(d)*.35);let t0=null;
    const step=ts=>{if(t0===null)t0=ts;const p=Math.min(1,(ts-t0)/dur);el.scrollTop=from+d*(1-Math.pow(1-p,3));if(p<1)requestAnimationFrame(step)};
    requestAnimationFrame(step)}
  function uid(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,6)}

  /* ═══ markdown ═══ */
  function safeHref(u){u=(u||'').trim();return /^(https?:\/\/|mailto:)/i.test(u)?u:''}
  function safeImg(u){u=(u||'').trim();return /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(u)||/^https:\/\/[^\s"'<>]+$/i.test(u)?u:''}
  function mdInline(s){return esc(s)
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,'$1<em>$2</em>')
    .replace(/`([^`]+?)`/g,'<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g,(m,a,u)=>{const h=safeImg(u);return h?'<img src="'+esc(h)+'" alt="'+a+'">':''})
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,(m,t,u)=>{const h=safeHref(u);return h?'<a href="'+esc(h)+'" target="_blank" rel="noopener noreferrer">'+t+'</a>':t})
    .replace(/\*\*/g,'')}
  function splitRow(s){return s.replace(/^\s*\|/,'').replace(/\|\s*$/,'').split('|').map(c=>c.trim())}
  function renderMd(text){
    const lines=String(text).split('\n');let html='',ul=false,ol=false;
    const flush=()=>{if(ul){html+='</ul>';ul=false}if(ol){html+='</ol>';ol=false}};
    for(let i=0;i<lines.length;i++){const line=lines[i].trim();
      if(!line){flush();continue}
      if(/^(-{3,}|\*{3,}|_{3,})$/.test(line)){flush();html+='<hr>';continue}
      if(line.startsWith('```')){flush();const code=[];i++;
        while(i<lines.length&&!lines[i].trim().startsWith('```')){code.push(lines[i]);i++}
        html+='<pre><code>'+esc(code.join('\n'))+'</code></pre>';continue}
      if(/^>\s?/.test(line)){flush();const q=[line.replace(/^>\s?/,'')];
        while(i+1<lines.length&&/^>\s?/.test(lines[i+1].trim())){i++;q.push(lines[i].trim().replace(/^>\s?/,''))}
        html+='<blockquote>'+mdInline(q.join(' '))+'</blockquote>';continue}
      if(line.includes('|')&&i+1<lines.length&&/^\s*\|?[\s:|-]*-[\s:|-]*\|[\s:|-]*$/.test(lines[i+1])){
        flush();const head=splitRow(line);
        let t='<table><thead><tr>'+head.map(c=>'<th>'+mdInline(c)+'</th>').join('')+'</tr></thead><tbody>';i++;
        while(i+1<lines.length&&lines[i+1].includes('|')&&lines[i+1].trim()){i++;const cells=splitRow(lines[i].trim());t+='<tr>'+cells.map(c=>'<td>'+mdInline(c)+'</td>').join('')+'</tr>'}
        html+=t+'</tbody></table>';continue}
      if(/^#{2,6}\s/.test(line)){flush();html+='<div class="ph">'+mdInline(line.replace(/^#{2,6}\s+/,''))+'</div>';continue}
      if(/^#\s/.test(line)){flush();html+='<p class="ph" style="font-size:17px">'+mdInline(line.replace(/^#\s+/,''))+'</p>';continue}
      if(/^\d+[.)]\s/.test(line)){if(!ol){flush();html+='<ol>';ol=true}html+='<li>'+mdInline(line.replace(/^\d+[.)]\s/,''))+'</li>';continue}
      if(/^[-*•]\s/.test(line)){if(!ul){flush();html+='<ul>';ul=true}html+='<li>'+mdInline(line.replace(/^[-*•]\s/,''))+'</li>';continue}
      flush();html+='<p>'+mdInline(line)+'</p>'}
    flush();return html}

  /* ═══ state — sessions/projects · localStorage + Supabase ═══ */
  const STORE='vaest_v2',DB_V=5,TOKEN_CAP=5e6,LEGACY_WHO='orions-workspace';
  // VÆST 3.0 — every item carries a mode: 'idea' (chat) · 'brief' (interview→doc) · 'crystallize' (canvas)
  const MODES=['idea','brief','crystallize'];
  function inferMode(s){
    if(MODES.includes(s&&s.mode))return s.mode;
    if(s&&s.canvas&&s.canvas.trim())return 'crystallize';
    return 'idea';
  }
  // a clean plain-text title from markdown — strips headings, **bold**, `code`, links, etc.
  function mdTitle(t){return String(t||'')
    .replace(/^#+\s*/,'').replace(/\[([^\]]*)\]\([^)]*\)/g,'$1')
    .replace(/[*_`>#~]/g,'').replace(/\s+/g,' ').trim().slice(0,52)||'Note'}
  const SB={url:'https://yyhqcqlylnoukmovrpwo.supabase.co',key:'sb_publishable_baZ9N1npPznt4zjsOJ69_w_kGEHq7aM',who:LEGACY_WHO};
  let projects=[],sessions=[],currentSid=null,usage=0,profile={},_busy=false,_renaming=false;
  let library=[]; // MD library — saved chat answers, kept as .md
  function setBusy(b){_busy=b;const bar=$('genBar');if(bar)bar.classList.toggle('on',!!b);const sb=$('stopBtn');if(sb)sb.classList.toggle('show',!!b);document.querySelector('.main')?.classList.toggle('genning',!!b)}
  /* ═══ CI dialog — promise-based confirm/prompt ═══ */
  let _dlgResolve=null;
  function uiDialog(opts){
    return new Promise(res=>{
      _dlgResolve=res;
      $('dlgMsg').textContent=opts.msg;
      const inp=$('dlgIn'),isPrompt='value' in opts;
      inp.style.display=isPrompt?'':'none';
      if(isPrompt){inp.value=opts.value||'';inp.placeholder=opts.placeholder||''}
      const ok=$('dlgOk');ok.textContent=opts.ok||'Confirm';ok.classList.toggle('danger',!!opts.danger);
      $('dlgCancel').textContent=opts.cancel||'Cancel';
      $('dlgView').classList.add('show');
      setTimeout(()=>{(isPrompt?inp:ok).focus();if(isPrompt)inp.select()},60);
    })}
  function dlgClose(val){$('dlgView').classList.remove('show');const r=_dlgResolve;_dlgResolve=null;if(r)r(val)}
  function uiSheet(html){const s=$('mdSheet');if(!s)return;s.innerHTML=html;$('mdView').classList.add('show')}
  function uiSheetClose(){const v=$('mdView');if(v)v.classList.remove('show')}
  const uiConfirm=(msg,opts)=>uiDialog({msg,...(opts||{})}).then(v=>v!==null&&v!==false);
  const uiPrompt=(msg,value,opts)=>uiDialog({msg,value:value||'',...(opts||{})});
  const cur=()=>sessions.find(s=>s.id===currentSid)||null;

  /* ═══ auth — Supabase email+password ═══ */
  const AUTH_STORE='vaest_auth';
  let AUTH=null; // {access_token,refresh_token,expires_at,email}
  // ── Anonymous trial ── use Galdr free without an account; a few messages, then a signup wall.
  let ANON=false;
  const ANON_MAX=5, ANON_N_KEY='vaest_anon_n';
  function anonCount(){try{return +localStorage.getItem(ANON_N_KEY)||0}catch(e){return 0}}
  function anonBump(){try{localStorage.setItem(ANON_N_KEY,anonCount()+1)}catch(e){}}
  function anonLeft(){return Math.max(0,ANON_MAX-anonCount())}
  function loadAuth(){try{AUTH=JSON.parse(localStorage.getItem(AUTH_STORE))||null}catch(e){AUTH=null}return AUTH}
  function saveAuth(a){AUTH=a;try{a?localStorage.setItem(AUTH_STORE,JSON.stringify(a)):localStorage.removeItem(AUTH_STORE)}catch(e){}}
  function authHeaders(){return {apikey:SB.key,'Content-Type':'application/json'}}
  function applySession(d){saveAuth({access_token:d.access_token,refresh_token:d.refresh_token,
    expires_at:Date.now()+((d.expires_in||3600)-90)*1000,email:(d.user&&d.user.email||'').toLowerCase()})}
  async function authLogin(email,pass){
    const r=await fetch(SB.url+'/auth/v1/token?grant_type=password',{method:'POST',headers:authHeaders(),body:JSON.stringify({email,password:pass})});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error_description||d.msg||d.error||'Wrong email or password');
    applySession(d)}
  async function authSignup(email,pass){
    // server-side signup: auto-confirmed, returns a session immediately (no email round-trip)
    const r=await fetch('/api/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pass})});
    const d=await r.json().catch(()=>({}));
    if(r.status===409)throw new Error(d.error||'Account exists — sign in instead');
    if(!r.ok)throw new Error(d.error||'Sign-up failed');
    if(d.access_token){applySession(d);return 'ok'}
    return 'confirm' // fallback — created but no session; ask them to sign in
  }
  async function authRefresh(){
    if(!AUTH||!AUTH.refresh_token)return false;
    try{const r=await fetch(SB.url+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:authHeaders(),body:JSON.stringify({refresh_token:AUTH.refresh_token})});
      if(!r.ok)return false;const d=await r.json();if(!d.access_token)return false;applySession(d);return true}
    catch(e){return 'net'}} // network hiccup ≠ invalid session
  async function ensureAuth(){
    if(!AUTH)return false;
    if(Date.now()<(AUTH.expires_at||0))return true;
    const ok=await authRefresh();
    return ok==='net'?true:ok} // offline → keep the session; the API still gates for real
  // keep long-lived tabs signed in — refresh quietly before expiry
  setInterval(()=>{if(AUTH&&Date.now()>(AUTH.expires_at||0)-5*60*1000)authRefresh()},4*60*1000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&AUTH&&Date.now()>(AUTH.expires_at||0)-5*60*1000)authRefresh()});
  // refresh plan/quota when the tab regains focus so an upgrade or reset shows up
  // without a reload (debounced to at most once a minute).
  let _lastQuota=0;
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&AUTH&&Date.now()-_lastQuota>60000){_lastQuota=Date.now();checkAccess()}});
  function confirmLogout(){if(!AUTH)return;if(confirm('Sign out ('+AUTH.email+') ?'))logout()}
  function logout(){const k=STORE+':'+((AUTH&&AUTH.email)||'anon');saveAuth(null);try{localStorage.removeItem(k);localStorage.removeItem(STORE)}catch(e){}location.reload()}

  /* auth UI */
  let _authMode='login';
  function toggleAuthMode(){_authMode=_authMode==='login'?'signup':'login';
    $('authTitle').textContent=_authMode==='login'?'Sign in':'Sign up';
    $('authGo').textContent=_authMode==='login'?'Sign in':'Sign up';
    $('authSw').innerHTML=_authMode==='login'
      ?'No account yet<button type="button" onclick="toggleAuthMode()">Sign up</button>'
      :'Already have an account<button type="button" onclick="toggleAuthMode()">Sign in</button>';
    $('authErr').textContent=''}
  function showAuth(msg){$('authView').classList.add('show');if(msg)$('authErr').textContent=msg;setTimeout(()=>$('authEmail').focus(),50)}
  function hideAuth(){$('authView').classList.remove('show')}
  // enter the free trial — home + Galdr only, log in / sign up top-right (ChatGPT-style)
  function startAnon(){
    ANON=true;SB.who='anon';
    const bar=$('anonBar');if(bar)bar.style.display='';
    $('app').classList.add('anon');
    if(!loadLocal()){projects=[];sessions=[];usage=0;library=[]}
    if(!sessions.length)sessions=[{id:uid('s'),title:'New',projectId:null,brief:'',files:[],canvas:'',updatedAt:Date.now(),mode:'idea'}];
    if(!currentSid||!cur())currentSid=sessions[0].id;
    renderRail();showHome();renderAnonLimit()}
  function anonLogin(){if(_authMode!=='login')toggleAuthMode();showAuth()}
  function anonSignup(){if(_authMode!=='signup')toggleAuthMode();showAuth('Free account — keep your chat and unlock Crystallize')}
  // the wall: a few free messages, then sign up. Reason is shown as the auth headline.
  function anonWall(reason){
    if(_authMode!=='signup')toggleAuthMode();
    showAuth(reason||'That’s the free trial — sign up (free) to keep going and save this chat')}
  // small tier hint under the Idea input — anonymous trial or free (no-plan) account
  function renderAnonLimit(){
    const el=$('anonLimit');if(!el)return;
    if(ANON){
      const left=anonLeft();el.style.display='';
      el.innerHTML=left>0
        ?'<span class="al-n">'+left+'</span> free message'+(left>1?'s':'')+' left · <button onclick="anonSignup()">Sign up free</button> to keep chatting with Galdr — plans unlock the whole studio'
        :'You’ve used your free messages — <button onclick="anonSignup()">Sign up free</button> to keep going';
      return}
    // signed-in, no plan → free tier: Galdr with a monthly allowance
    if(AUTH&&window.QUOTA&&window.QUOTA.allowed===false){
      el.style.display='';
      el.innerHTML='Free account — Galdr chat + <b>one Crystallize on the house</b> · <button onclick="showNotInvited()">Pick a plan</button> for the whole studio';
      return}
    el.style.display='none'}
  function renderTierNote(){renderAnonLimit()}
  // capture the trial chat so it survives the jump into a real account
  function snapshotAnonChats(){
    try{return sessions.filter(s=>chatsOf(s).some(c=>c.ideas.length))
      .map(s=>{const c=JSON.parse(JSON.stringify(s));c.id=uid('s');c.shareId=null;
        if(c.chats)c.chats.forEach(x=>x.id=uid('ch'));if(c.chats&&c.chats[0])c.chatId=c.chats[0].id;
        c.title=s.title&&s.title!=='New'?s.title:(c.chats&&c.chats[0]&&c.chats[0].title)||'From your trial';
        return c})}catch(e){return []}}
  // called from the auth-success path when we were anonymous — hand the chat to the account
  function endAnon(){
    if(!ANON)return;
    window._anonCarry=snapshotAnonChats();
    ANON=false;const bar=$('anonBar');if(bar)bar.style.display='none';$('app').classList.remove('anon');
    try{localStorage.removeItem(ANON_N_KEY);localStorage.removeItem(STORE+':anon')}catch(e){}}
  async function submitAuth(){
    const email=$('authEmail').value.trim().toLowerCase(),pass=$('authPass').value;
    if(!email||pass.length<6){$('authErr').textContent='Enter an email and a password of at least 6 characters';return}
    const go=$('authGo');go.disabled=true;go.textContent='One sec…';$('authErr').textContent='';
    try{
      if(_authMode==='login'){await authLogin(email,pass)}
      else{const res=await authSignup(email,pass);
        if(res==='confirm'){$('authErr').textContent='Signed up — check your email to confirm, then sign in';
          _authMode='signup';toggleAuthMode();go.disabled=false;return}}
      endAnon(); // if we were on the free trial, carry the chat into the account
      if(await checkAccess()){hideAuth();await boot()}
      else if(window._wantPlan){const p=window._wantPlan;window._wantPlan=null;hideAuth();startCheckout(p)}
      else{hideAuth();await boot();renderTierNote()} // free account — Galdr stays usable; engines wall on use
    }catch(e){$('authErr').textContent=e.message}
    finally{go.disabled=false;go.textContent=_authMode==='login'?'Sign in':'Sign up'}}

  /* reset password */
  async function forgotPassword(){
    const email=($('authEmail').value||'').trim().toLowerCase();
    if(!email){$('authErr').textContent='Enter your email first, then tap “Forgot password”';$('authEmail').focus();return}
    try{await fetch(SB.url+'/auth/v1/recover',{method:'POST',headers:authHeaders(),
      body:JSON.stringify({email,options:{redirect_to:location.origin+'/app'}})});
      $('authErr').textContent='Reset link sent to '+email+' — check your email'}
    catch(e){$('authErr').textContent='Couldn’t send, try again'}}
  // set password (email link) — robust across Supabase flows:
  //   implicit  #access_token=…&type=recovery
  //   verify    ?token_hash=…&type=recovery   (recommended email-template form)
  //   pkce      ?code=…
  async function detectRecovery(){
    try{
      const hp=new URLSearchParams((location.hash||'').replace(/^#/,''));
      const qp=new URLSearchParams(location.search||'');
      if(/recovery|invite|signup/.test(hp.get('type')||'')&&hp.get('access_token'))return hp.get('access_token');
      const th=qp.get('token_hash'),ty=qp.get('type')||'recovery';
      if(th){const r=await fetch(SB.url+'/auth/v1/verify',{method:'POST',headers:authHeaders(),body:JSON.stringify({type:ty,token_hash:th})});
        const d=await r.json().catch(()=>({}));if(r.ok&&d.access_token)return d.access_token}
      const code=qp.get('code');
      if(code){const r=await fetch(SB.url+'/auth/v1/token?grant_type=pkce',{method:'POST',headers:authHeaders(),body:JSON.stringify({auth_code:code})});
        const d=await r.json().catch(()=>({}));if(r.ok&&d.access_token)return d.access_token}
    }catch(e){}
    return null}
  async function submitNewPass(){
    const t=window._recToken,p1=$('npPass').value;
    if(p1.length<6){$('npErr').textContent='Password must be at least 6 characters';return}
    const b=$('npGo');b.disabled=true;b.textContent='One sec…';$('npErr').textContent='';
    try{const r=await fetch(SB.url+'/auth/v1/user',{method:'PUT',
      headers:{apikey:SB.key,Authorization:'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify({password:p1})});
      const d=await r.json();if(!r.ok)throw new Error(d.msg||d.error_description||'Couldn’t set the new password');
      history.replaceState(null,'',location.pathname);
      $('npView').classList.remove('show');toast('Password updated — you can sign in now');showAuth('Password set — sign in with your new password')}
    catch(e){$('npErr').textContent=e.message;b.disabled=false;b.textContent='Save new password'}}

  /* ═══ credit meter ═══ */
  /* ═══ invite-only — access check (server enforces · client only shows the right screen) ═══ */
  async function checkAccess(){
    if(!AUTH)return false;if(!await ensureAuth())return false;
    // only an explicit allowed:false gates · error/offline → let through (server /api/chat still enforces)
    try{const r=await fetch('/api/access',{headers:{Authorization:'Bearer '+AUTH.access_token}});
      if(r.status===200){const d=await r.json();window.QUOTA=d;applyPlanUI();return d.allowed!==false}
      return true}catch(e){return true}}
  // fail-open: no plan info (offline / error / older server) → allow everything
  function canRefine(){const q=window.QUOTA;return !q||!q.plan||q.plan.refine!==false}
  // reflect the plan in the UI — lock Refine (Norrsken) on Basic; server still enforces regardless
  function applyPlanUI(){
    const locked=!canRefine();
    const mb=$('mastBtn');
    if(mb){mb.classList.toggle('locked',locked);
      mb.title=locked?'Refine is on Pro and above — upgrade to unlock the apex audit'
        :'Refine — make it cleaner: catch contradictions, repetition and broken logic';}
    const cb=$('chainBtn');if(cb)cb.style.display=locked?'none':'';
    const q=window.QUOTA;
    // token breakdown + real-cost tool are internal (ORIONS team) only — they reveal margin/provider
    const iu=$('internalUsage');if(iu)iu.style.display=(q&&q.internal)?'':'none';
    const bl=$('billingLink');if(bl)bl.style.display=(q&&q.canManage)?'':'none';
    // credit top-up = for paying customers only (comp/invite accounts upgrade instead)
    const bo=$('creditRow');
    if(bo){const on=(q&&q.source==='stripe');bo.style.display=on?'':'none';
      const opts=$('creditOpts');
      if(on&&opts){const left=(q.usage&&q.usage.packsLeft!=null)?q.usage.packsLeft:3;
        if(left<=0){opts.innerHTML='<div class="set-note" style="color:var(--cin-d)">Monthly credit limit reached — <a onclick="closeSettings();openPortal()" style="color:var(--ink);cursor:pointer;text-decoration:underline">upgrade your plan</a> for more.</div>';}
        else{let h='';for(let n=1;n<=left;n++){h+='<button class="plan-opt" style="justify-content:center" onclick="closeSettings();startCheckout(\'boost\',\'individual\','+n+')">'+n+' pack'+(n>1?'s':'')+' · ฿'+(490*n).toLocaleString()+'</button>';}opts.innerHTML=h;}
      }
    }
    renderRailUsage()}
  // usage meter — abstract by design: a percentage + reset date, never raw counts.
  const fmtReset=iso=>{try{const d=new Date(iso+'T00:00:00Z');
    return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'})}catch(e){return ''}};
  function quotaBarHTML(q){
    if(!q||q.internal)return '';
    const u=q.usage;if(!u||u.pct==null)return '';
    const pct=Math.min(100,u.pct);
    const onCredit=u.boosted&&pct>=100; // plan used up but purchased credit still covering
    const label=onCredit?'Usage · running on credit':('Usage this month'+(u.boosted?' · +credit':''));
    const val=onCredit?'credit active':(pct+'%'+(u.resetsOn?' · resets '+fmtReset(u.resetsOn):''));
    return '<span class="qn">'+label+'</span>'
      +'<span class="qbar"><i style="width:'+pct+'%"'+(pct>85&&!onCredit?' class="hot"':'')+'></i></span>'
      +'<span class="qv">'+val+'</span>';}
  // rail bottom-left usage meter — paid plans show the abstract % (max of docs/spend, same as
  // Settings); free accounts show their Galdr allowance. Internal + anon: hidden.
  function renderRailUsage(){
    const el=$('railUsage');if(!el)return;
    const q=window.QUOTA;
    if(ANON||!q||q.internal){el.style.display='none';return}
    const u=q.usage;
    if(q.allowed&&u&&u.pct!=null){el.style.display='';el.innerHTML=quotaBarHTML(q);return}
    if(q.allowed===false){ // free tier — Galdr meter (server sends pct vs the free allowance)
      el.style.display='';
      const pct=u&&u.pct!=null?Math.min(100,u.pct):0;
      el.innerHTML='<span class="qn">Free · Galdr</span>'
        +'<span class="qbar"><i style="width:'+pct+'%"'+(pct>85?' class="hot"':'')+'></i></span>'
        +'<span class="qv">'+pct+'%'+(u&&u.resetsOn?' · resets '+fmtReset(u.resetsOn):'')
        +(u&&u.freeCrystallize?' · 1 Crystallize free':'')+'</span>';
      return}
    el.style.display='none'}
  function showNotInvited(msg){
    hideAuth();$('giEmail').textContent=AUTH?AUTH.email:'';
    // if they had a subscription that lapsed, say so
    const q=window.QUOTA;const lp=$('giLapsed');if(lp)lp.style.display=(q&&q.source==='lapsed')?'':'none';
    // contextual paywall — the sheet says WHY it opened ("Brief needs a plan…"), not just "pick one"
    const cx=$('planCtx');if(cx){const t=typeof msg==='string'?msg.trim():'';cx.textContent=t;cx.style.display=t?'':'none'}
    $('gateView').classList.add('show')}
  function hideGate(){$('gateView').classList.remove('show')} // free tier keeps Galdr — the gate is a picker, not a trap
  // ── billing: start Stripe Checkout / open the customer portal ──
  async function startCheckout(plan,kind,qty){
    if(!AUTH){showAuth('Sign in to continue to checkout');return}
    if(!await ensureAuth()){showAuth('Session expired — sign in again');return}
    toast('Opening secure checkout…');
    try{const r=await fetch('/api/checkout',{method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+AUTH.access_token},
      body:JSON.stringify({plan,kind:kind||'individual',seats:qty,packs:qty})});
      const d=await r.json().catch(()=>({}));
      if(r.ok&&d.url){location.href=d.url;return}
      toast(d.error||'Couldn’t start checkout')}
    catch(e){toast('Couldn’t start checkout, try again')}}
  async function openPortal(){
    if(!AUTH)return;if(!await ensureAuth())return;
    toast('Opening billing…');
    try{const r=await fetch('/api/portal',{method:'POST',headers:{Authorization:'Bearer '+AUTH.access_token}});
      const d=await r.json().catch(()=>({}));
      if(r.ok&&d.url){location.href=d.url;return}
      toast(d.error||'No billing to manage yet')}
    catch(e){toast('Couldn’t open billing, try again')}}
  // (invite-request path retired — the gate is a plan picker now, self-serve only)

  /* ═══ usage analytics — cost per document ═══ */
  const RATE_DEF={opus:2600,fable:600,idea:150,mimir:3100,skadi:400}; // THB per 1M (in+out combined) — estimate, editable
  function getRates(){try{const r=JSON.parse(localStorage.getItem('vaest_rates'));if(r&&r.opus>=0&&r.fable>=0)return {...RATE_DEF,...r}}catch(e){}return {...RATE_DEF}}
  function saveRates(){const r={opus:+$('rateOpus').value||0,fable:+$('rateFable').value||0,idea:+$('rateIdea').value||0,mimir:+$('rateMimir').value||0};try{localStorage.setItem('vaest_rates',JSON.stringify(r))}catch(e){}}
  function docCost(s,rt){const t=s.tok||{};return (t.opus||0)/1e6*rt.opus+(t.fable||0)/1e6*rt.fable+(t.idea||0)/1e6*(rt.idea||0)+(t.mimir||0)/1e6*(rt.mimir||0)+(t.skadi||0)/1e6*(rt.skadi||0)}
  const baht=n=>'฿'+(n>=1000?Math.round(n).toLocaleString():n.toFixed(n<10?2:1));
  function openStats(){if(!(window.QUOTA&&window.QUOTA.internal))return;const rt=getRates();$('rateOpus').value=rt.opus;$('rateFable').value=rt.fable;$('rateIdea').value=rt.idea||0;$('rateMimir').value=rt.mimir||0;$('statsView').classList.add('show');renderStats()}
  function closeStats(){$('statsView').classList.remove('show')}
  function renderStats(){
    const rt=getRates();
    const docs=sessions.filter(s=>(s.ops||0)>0);
    let tOpus=0,tFable=0,tIdea=0,tMimir=0,cost=0;docs.forEach(s=>{const t=s.tok||{};tOpus+=t.opus||0;tFable+=t.fable||0;tIdea+=t.idea||0;tMimir+=t.mimir||0;cost+=docCost(s,rt)});
    const tAll=tOpus+tFable+tIdea+tMimir;
    const nDoc=docs.length,avg=nDoc?cost/nDoc:0,avgTok=nDoc?tAll/nDoc:0;
    $('statsKpis').innerHTML=[
      ['Documents measured',nDoc],
      ['Total tokens',fmtTok(tAll)],
      ['Total cost',baht(cost)],
      ['Avg / document',baht(avg)+' <small>· '+fmtTok(avgTok)+'</small>'],
    ].map(k=>'<div class="kpi"><div class="kn">'+k[0]+'</div><div class="kv">'+k[1]+'</div></div>').join('');
    // fair-use quota (invitees) — visible before the wall, not after
    const q=window.QUOTA;const qEl=$('quotaRow');
    if(qEl){const h=quotaBarHTML(q);if(h){qEl.style.display='';qEl.innerHTML=h}else qEl.style.display='none'}
    // per-doc
    const top=[...docs].sort((a,b)=>docCost(b,rt)-docCost(a,rt)).slice(0,12);
    $('statsDocs').innerHTML= nDoc
      ?('<thead><tr><th>Document</th><th class="num">Runs</th><th class="num">Tokens</th><th class="num">Cost</th></tr></thead><tbody>'
        +top.map(s=>{const t=s.tok||{};return '<tr><td>'+esc((s.title||'—').slice(0,40))+'</td><td class="num">'+(s.ops||0)+'</td><td class="num">'+fmtTok((t.opus||0)+(t.fable||0)+(t.idea||0)+(t.mimir||0))+'</td><td class="num">'+baht(docCost(s,rt))+'</td></tr>'}).join('')+'</tbody>')
      :'<tbody><tr><td style="color:var(--mute);padding:16px 0">No data yet — start using Crystallize / Think / Refine and cost shows up here</td></tr></tbody>'}

  function stateBlob(){return {v:DB_V,projects,sessions,currentSid,usage,trash,profile,library}}
  // v4→v5 (idempotent): give every item a mode, split multi-chat idea sessions into separate
  // Idea items so 1 chat = 1 Recent, and lift saved sparks into the MD library. Safe to re-run:
  // once items carry a mode and no chats/sparks remain, it's a no-op.
  function migrateToModes(){
    const out=[], lifted=[];
    (sessions||[]).forEach(s=>{
      (s.sparks||[]).forEach(sp=>{const t=(sp.text||'').trim();if(!t)return;
        lifted.push({id:uid('md'),title:(sp.topic&&sp.topic!=='…'?sp.topic+' — ':'')+mdTitle(t),
          md:t,createdAt:sp.ts||s.updatedAt||Date.now(),fromTitle:s.title||'',projectId:s.projectId||null})});
      delete s.sparks;
      const mode=inferMode(s);
      const liveChats=(s.chats||[]).filter(c=>c&&Array.isArray(c.ideas)&&c.ideas.length);
      if(mode==='crystallize'){
        s.mode='crystallize';
        // research chats that fed this canvas become their own Idea items (nothing lost)
        liveChats.forEach(c=>out.push({id:uid('s'),mode:'idea',title:c.title||('Chat — '+(s.title||'')),
          projectId:s.projectId||null,ideas:c.ideas,updatedAt:s.updatedAt||Date.now()}));
        delete s.chats;delete s.ideas;
        out.push(s);
      }else{ // idea
        if(!liveChats.length){s.mode='idea';s.ideas=s.ideas||[];delete s.chats;out.push(s)}
        else liveChats.forEach((c,i)=>{
          if(i===0){s.mode='idea';s.ideas=c.ideas;if(c.title)s.title=c.title;delete s.chats;out.push(s)}
          else out.push({id:uid('s'),mode:'idea',title:c.title||s.title||'Idea',projectId:s.projectId||null,ideas:c.ideas,updatedAt:s.updatedAt||Date.now()})});
      }
    });
    sessions=out;
    if(lifted.length)library=(library||[]).concat(lifted);
  }
  function applyBlob(b){
    if(!b)return false;
    if(b.v>=4&&Array.isArray(b.sessions)){projects=b.projects||[];sessions=b.sessions;currentSid=b.currentSid;usage=b.usage||0;
      trash=Array.isArray(b.trash)?b.trash:[];profile=(b.profile&&typeof b.profile==='object')?b.profile:{};
      library=Array.isArray(b.library)?b.library:[];
      // one-time cleanup: titles saved before mdTitle() still carry raw markdown (**, ##) — re-derive them
      library.forEach(m=>{if(m&&m.title&&/(\*\*|^#|`)/.test(m.title))m.title=mdTitle(m.md||m.title)});
      // normalize to the modes schema (idempotent) — old blobs (v4) and any item missing a mode
      if(b.v<5||sessions.some(s=>!MODES.includes(s.mode))||sessions.some(s=>s.sparks||s.chats))migrateToModes();
      return true}
    if(Array.isArray(b.projects)&&(b.LIB||b.CANVAS)){ // migrate v1
      projects=[];sessions=[];
      b.projects.forEach(p=>{
        const files=((b.LIB||{})[p.id]||[]).map(m=>({n:m.t||'file',c:m.content||''}));
        const canvas=((b.CANVAS||{})[p.id])||'';
        if(files.length||canvas.trim())sessions.push({id:uid('s'),title:p.name||'Prior work',projectId:null,brief:'',files,canvas,updatedAt:Date.now()});
      });
      usage=b.usage||0;currentSid=(sessions[0]||{}).id||null;return true}
    return false}
  const storeKey=()=>STORE+':'+((AUTH&&AUTH.email)||'anon');
  let _sizeWarned=false;
  function save(){try{localStorage.setItem(storeKey(),JSON.stringify(stateBlob()))}catch(e){}
    if(!_sizeWarned&&stateBytes()>4.2e6){_sizeWarned=true;toast('Your workspace is getting large — trim old sessions or empty the trash in Settings › Privacy to keep syncing fast')}
    cloudSave()}
  function loadLocal(){
    try{if(applyBlob(JSON.parse(localStorage.getItem(storeKey()))))return true}catch(e){}
    try{if(applyBlob(JSON.parse(localStorage.getItem(STORE)))){save();return true}}catch(e){} // pre-login
    try{if(applyBlob(JSON.parse(localStorage.getItem('vaest_v1')))){save();return true}}catch(e){}
    return false}
  // dual-path sync: user JWT first (RLS-ready) → anon fallback (pre-migration) — correct in both worlds
  async function cloudLoad(){
    try{await ensureAuth();
      const get=async b=>{const r=await fetch(SB.url+'/rest/v1/vaest_state?email=eq.'+SB.who+'&select=data',{headers:{apikey:SB.key,Authorization:'Bearer '+b}});
        if(!r.ok)return null;const rows=await r.json();return (rows[0]&&rows[0].data)||null};
      const viaJwt=AUTH&&AUTH.access_token?await get(AUTH.access_token):null;
      return viaJwt||await get(SB.key)}catch(e){return null}}
  let _ct;function cloudSave(){const cs=cur();if(cs&&cs.private){setSync('ok');return}clearTimeout(_ct);_ct=setTimeout(async()=>{try{
    await ensureAuth();
    const post=b=>fetch(SB.url+'/rest/v1/vaest_state',{method:'POST',headers:{apikey:SB.key,Authorization:'Bearer '+b,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},
      body:JSON.stringify({email:SB.who,data:stateBlob(),updated_at:new Date().toISOString()})});
    let r=await post((AUTH&&AUTH.access_token)||SB.key);
    if(!r.ok)r=await post(SB.key); // pre-migration fallback
    setSync(r.ok?'ok':'off')}catch(e){setSync('off')}},700)}
  function setSync(s){const el=$('syncDot');if(el)el.className='sync '+s}
  function fmtTok(n){return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?Math.round(n/1e3)+'K':n}

  /* ═══ API ═══ */
  let _lastErr=0;
  function logErr(msg,where){
    const now=Date.now();if(now-_lastErr<4000)return;_lastErr=now; // throttle
    try{fetch('/api/log',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json',Authorization:'Bearer '+((typeof AUTH!=='undefined'&&AUTH&&AUTH.access_token)||'')},
      body:JSON.stringify({msg:String(msg).slice(0,400),where:where||''})})}catch(e){}}
  addEventListener('error',e=>logErr(e.message||'error',(e.filename||'')+':'+(e.lineno||'')));
  addEventListener('unhandledrejection',e=>logErr((e.reason&&(e.reason.message||e.reason))||'rejection','promise'));
  let _abort=null,_origTitle=null;
  function stopGen(){if(_abort){_abort.abort();_abort=null}}
  function notifyDone(what){if(_origTitle===null)_origTitle=document.title;document.title='✓ '+what+' done — VÆST'}
  addEventListener('visibilitychange',()=>{if(!document.hidden&&_origTitle!==null){document.title=_origTitle;_origTitle=null}});
  async function streamAPI(mode,messages,system,onText){
    const headers={'Content-Type':'application/json'};
    if(ANON){
      // free trial covers Galdr (idea) only — anything else is the signup wall
      if(mode!=='idea'){anonWall();throw new Error('Sign up to use this')}
    }else{
      if(!await ensureAuth()){showAuth('Session expired — sign in again');throw new Error('Not signed in')}
      headers.Authorization='Bearer '+AUTH.access_token;
    }
    _abort=new AbortController();
    const r=await fetch('/api/chat',{method:'POST',signal:_abort.signal,headers,
      body:JSON.stringify({mode,messages,system:system||''})});
    if(r.status===401){
      if(ANON){anonWall();throw new Error('Sign up to continue')}
      showAuth('Session expired — sign in again');throw new Error('Session expired')}
    if(r.status===402||r.status===403){let d={};try{d=await r.json()}catch(e){}checkAccess();showNotInvited(d.error||'');throw new Error(d.error||'Choose a plan to continue')}
    if(r.status===429){let d={};try{d=await r.json()}catch(e){}const msg=d.error||'Usage limit reached';
      if(ANON&&d.signup){anonWall(msg)}else toast(msg);throw new Error(msg)}
    if(!r.ok||!r.body){let msg='HTTP '+r.status;try{msg=(await r.json()).error||msg}catch(e){}throw new Error(msg)}
    const reader=r.body.getReader(),dec=new TextDecoder();let full='',stopped=false;
    try{for(;;){const {done,value}=await reader.read();if(done)break;full+=dec.decode(value,{stream:true});if(onText)onText(full.split('[[USAGE]]')[0])}}
    catch(e){if(e.name==='AbortError'){stopped=true;toast('Stopped — kept what streamed so far')}else throw e}
    finally{_abort=null}
    if(stopped){const u=full.indexOf('[[USAGE]]');return (u>=0?full.slice(0,u):full).trim()}
    const i=full.indexOf('[[ERROR]]');if(i>=0)throw new Error(full.slice(i+9).trim()||'server error');
    // split tokens per call → record per-document cost (session)
    const um=full.match(/\[\[USAGE\]\](\d+),(\d+),([^\s]+)/);
    if(um){full=full.slice(0,um.index);const tks=(+um[1])+(+um[2]);
      const s=cur();if(s&&tks){s.tok=s.tok||{opus:0,fable:0};const b=um[3]==='norrsken'?'fable':um[3]==='galdr'?'idea':um[3]==='mimir'?'mimir':'opus';s.tok[b]=(s.tok[b]||0)+tks;s.ops=(s.ops||0)+1;schedulePersistLight()}}
    return full.trim()}
  let _tt2;function schedulePersistLight(){clearTimeout(_tt2);_tt2=setTimeout(()=>save(),900)}

  /* ═══ files — multi-format ═══ */
  function loadScript(src){return new Promise((res,rej)=>{if(document.querySelector('script[data-l="'+src+'"]'))return res();
    const s=document.createElement('script');s.src=src;s.dataset.l=src;s.onload=res;s.onerror=()=>rej(new Error('Couldn’t load the file reader'));document.head.appendChild(s)})}
  const readText=f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result||''));r.onerror=rej;r.readAsText(f)});
  const readBuf=f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsArrayBuffer(f)});
  async function extractFile(f){
    const ext=(f.name.split('.').pop()||'').toLowerCase();
    if(['md','markdown','txt','csv','tsv','json'].includes(ext))return (await readText(f)).trim();
    if(['html','htm'].includes(ext)){const t=document.createElement('div');t.innerHTML=await readText(f);return (t.textContent||'').replace(/\n{3,}/g,'\n\n').trim()}
    if(ext==='docx'){await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
      const r=await window.mammoth.extractRawText({arrayBuffer:await readBuf(f)});return (r.value||'').trim()}
    if(['xlsx','xls'].includes(ext)){await loadScript('https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js');
      const wb=window.XLSX.read(await readBuf(f),{type:'array'});return wb.SheetNames.map(n=>'## '+n+'\n'+window.XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n\n').trim()}
    if(ext==='pdf'){await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      const pj=window.pdfjsLib;pj.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const doc=await pj.getDocument({data:await readBuf(f)}).promise;let out='';
      for(let p=1;p<=doc.numPages;p++){const pg=await doc.getPage(p);const tc=await pg.getTextContent();out+=tc.items.map(x=>x.str).join(' ')+'\n\n'}
      return out.trim()}
    if(['jpg','jpeg','png','webp','gif','heic'].includes(ext))return '[image ref: '+f.name+']';
    return (await readText(f)).trim()}
  async function addFiles(files){
    const s=cur();if(!s)return;
    toast('Reading '+files.length+' files…');let ok=0,fail=0,cut=0;
    for(const f of files){try{
      if(isImg(f)){ // images → downscaled base64 so the model actually SEES them
        if(stateBytes()>3.2e6){s.files.push({n:f.name,c:'[image: '+f.name+' — too large to attach]'});ok++;continue}
        const url=await imgToDataURL(f,1200,.78);
        s.files.push({n:f.name,c:'[image: '+f.name+']',img:url});ok++;continue}
      const c=await extractFile(f);
      if(c&&c.trim()){if(c.length>20000)cut++;s.files.push({n:f.name,c:c.trim()});ok++}else fail++}catch(e){fail++}}
    s.updatedAt=Date.now();save();renderChips();
    toast(ok?('Attached '+ok+' files'+(fail?' · '+fail+' unreadable':'')+(cut?' · '+cut+' long file'+(cut>1?'s':'')+' will be read partially (~20K chars)':'')):'Couldn’t read the files')}
  function handleUpload(e){const fs=[...(e.target.files||[])];e.target.value='';if(fs.length)addFiles(fs)}
  function removeFile(i){const s=cur();if(!s)return;s.files.splice(i,1);s.updatedAt=Date.now();save();renderChips()}
  function renderChips(){const s=cur();
    $('chips').innerHTML=(s&&s.files.length)?s.files.map((f,i)=>
      '<span class="chip'+(f.paste?' paste':'')+'" onclick="openPaste('+i+')" title="Click to view"><b>'+(f.paste?'IDEA':esc((f.n.split('.').pop()||'').toUpperCase().slice(0,4)))+'</b><span>'+esc(f.n)+'</span><button onclick="event.stopPropagation();removeFile('+i+')" title="Remove">✕</button></span>').join(''):''}
  // paste viewer — click a chip to read what's inside
  function openPaste(i){const s=cur();const f=s&&s.files[i];if(!f)return;
    $('pasteTitle').textContent=f.n;
    $('pasteBody').innerHTML=f.img?('<img src="'+f.img+'" style="max-width:100%;border-radius:8px">'):('<pre>'+esc(capTxt(f.c,12000))+'</pre>');
    $('pasteView').classList.add('show')}
  function closePaste(){$('pasteView').classList.remove('show')}
  // long paste into the brief → a tile, not a wall of text
  function briefPaste(e){
    const t=(e.clipboardData||{}).getData?e.clipboardData.getData('text'):'';
    if(!t||t.length<=800)return;
    e.preventDefault();
    const s=cur();if(!s)return;
    s.files.push({n:pasteTileName(t),c:t.trim(),paste:true});
    s.updatedAt=Date.now();save();renderChips();
    toast('Long paste saved as a tile — click it to read, ✕ to remove')}
  // add files while on canvas → merge into the document (Odin)
  async function handleAddFiles(e){const fs=[...(e.target.files||[])];e.target.value='';if(fs.length)await addAndMerge(fs)}
  // shared merge core — feed new source material into the current document (files & pastes)
  async function mergeIntoDoc(s,{srcBlock,imgs=[],busyLine,okToast,onFail}){
    pushUndo();setBusy(true);
    const prompt='Original document:\n\n'+genMd()+'\n\nNewly added data:\n'+srcBlock
      +(imgs.length?('\n\nNewly attached images (shown below): '+imgs.map(f=>f.n).join(', ')+' — read them as real visual references'):'')
      +'\n\nMerge the new data into the existing document smoothly and consistently. Return the full markdown (keep the "# title" and "## " structure; add/adjust only what’s relevant).';
    $('doc').innerHTML='<div class="gen"><div class="gen-eye"><span class="pulse"></span> '+busyLine+'</div><div class="gen-body" id="genBody"></div></div>';
    let failed=false;
    try{const md=await streamAPI('summing',[{role:'user',content:msgContent(prompt,imgs)}],toneSys(),raf(full=>{const g=$('genBody');if(g){g.innerHTML=renderMd(full)+'<span class="cursor"></span>';softScroll($('cvView'))}}));
      setCanvasMd(s,md);s.updatedAt=Date.now();save();renderRail();showCanvas();toast(okToast)}
    catch(e){failed=true;undoStack.pop();updateUndo();renderDoc(s.canvas);toast('Failed: '+e.message)}
    finally{setBusy(false);if(failed&&onFail)onFail()}}
  async function addAndMerge(fs){
    if(_busy){toast('Working…');return}
    const s=cur();if(!s)return;
    toast('Reading '+fs.length+' files…');const names=[];
    for(const f of fs){try{
      if(isImg(f)){const url=await imgToDataURL(f,1200,.78);s.files.push({n:f.name,c:'[image: '+f.name+']',img:url});names.push(f.name);continue}
      const c=await extractFile(f);if(c.trim()){s.files.push({n:f.name,c:c.trim()});names.push(f.name)}}catch(e){}}
    s.updatedAt=Date.now();save();
    if(!names.length){toast('Couldn’t read the files');return}
    const fresh=s.files.filter(f=>names.includes(f.n));
    const imgs=fresh.filter(f=>f.img);
    await mergeIntoDoc(s,{
      srcBlock:fresh.filter(f=>!f.img).map(f=>'### '+f.n+'\n'+capTxt(f.c,20000)).join('\n\n'),
      imgs,busyLine:'Merging new files into the document…',
      okToast:'Merged '+names.length+' files into the document'})}
  // paste text (no file) → merge into the document
  const pasteTileName=t=>'Pasted · '+t.replace(/[#*>`\n]/g,' ').trim().split(/\s+/).slice(0,4).join(' ').slice(0,26)+'…';
  function openAddPaste(prefill){if(_busy){toast('Working…');return}const ta=$('addPasteTa');if(ta)ta.value=typeof prefill==='string'?prefill:'';$('addPasteView').classList.add('show');setTimeout(()=>{if(ta)ta.focus()},60)}
  function closeAddPaste(){$('addPasteView').classList.remove('show')}
  async function mergePaste(){
    if(_busy){toast('Working…');return}
    const s=cur();if(!s)return;
    const t=($('addPasteTa').value||'').trim();if(!t){toast('Paste some text first');return}
    closeAddPaste();
    const tile={n:pasteTileName(t),c:capTxt(t,100000),paste:true}; // cap stored copy — the doc carries the merged result
    s.files.push(tile);save();
    await mergeIntoDoc(s,{
      srcBlock:'### '+tile.n+'\n'+capTxt(t,20000),
      busyLine:'Merging the pasted text into the document…',
      okToast:'Merged the pasted text into the document',
      onFail:()=>{s.files=s.files.filter(f=>f!==tile);save();renderChips();openAddPaste(t)}})} // tile removed, text restored — nothing lost
  // drop files onto a section → edit just that section
  // ── image blocks — embed real images (downscaled to avoid bloat) ──
  const IMG_EXT=['jpg','jpeg','png','webp','gif','heic'];
  const isImg=f=>IMG_EXT.includes((f.name.split('.').pop()||'').toLowerCase())||/^image\//.test(f.type||'');
  function imgToDataURL(file,maxDim,q){return new Promise((res,rej)=>{
    const fr=new FileReader();fr.onerror=rej;
    fr.onload=()=>{const im=new Image();im.onerror=rej;
      im.onload=()=>{let{width:w,height:hh}=im;const sc=Math.min(1,maxDim/Math.max(w,hh));
        w=Math.round(w*sc);hh=Math.round(hh*sc);
        const cv=document.createElement('canvas');cv.width=w;cv.height=hh;
        cv.getContext('2d').drawImage(im,0,0,w,hh);
        try{res(cv.toDataURL('image/jpeg',q||.72))}catch(e){rej(e)}};
      im.src=fr.result};
    fr.readAsDataURL(file)})}
  function stateBytes(){try{return JSON.stringify(stateBlob()).length}catch(e){return 0}}
  async function embedImages(secEl,imgs){
    const s=cur();if(!s)return;const c=secEl.querySelector('.sec-c');
    pushUndo();let added=0;
    for(const f of imgs){
      if(stateBytes()>4.2e6){toast('Document is very large — skipping remaining images to stay safe');break}
      try{const url=await imgToDataURL(f,1200,.72);
        const p=document.createElement('p');p.innerHTML='<img src="'+url+'" alt="'+esc(f.name.replace(/\.[^.]+$/,''))+'">';
        c.appendChild(p);added++}catch(e){}
    }
    if(added){s.canvas=genMd();s.updatedAt=Date.now();save();toast('Embedded '+added+' images')}
  }
  async function dropOnSection(secEl,files){
    if(_busy){toast('Working…');return}
    const s=cur();if(!s)return;
    const imgs=files.filter(isImg),docs=files.filter(f=>!isImg(f));
    if(imgs.length)await embedImages(secEl,imgs);
    if(!docs.length)return; // images only — embedded already, no AI call needed
    files=docs;
    const hEl=secEl.querySelector('.sec-h'),c=secEl.querySelector('.sec-c');const h=hEl?hEl.innerText.trim():'';
    const beforeTxt=c.innerText.trim();
    pushUndo();setBusy(true);s.secFiles=s.secFiles||{};s.secFiles[h]=s.secFiles[h]||[];
    toast('Reading files into “'+h+'”…');let merged='';
    for(const f of files){try{const cc=await extractFile(f);s.secFiles[h].push(f.name);merged+='### '+f.name+'\n'+capTxt(cc,15000)+'\n\n'}catch(e){}}
    secEl.classList.add('improving');c.innerHTML='<span class="cursor"></span>';
    const prompt='Document context: "'+($('mhTitle').innerText.trim())+'"\n\nSection: "'+h+'"\nCurrent text:\n'+beforeTxt+'\n\nData from the files attached to this section:\n'+merged+'\n\nMerge the file data into this section smoothly. Return only the refined section body (markdown, no ## heading).';
    try{const text=await streamAPI('improve',[{role:'user',content:prompt}],toneSys(),raf(full=>{c.innerHTML=renderMd(full)+'<span class="cursor"></span>'}));
      c.innerHTML=renderMd(text);s.canvas=genMd();s.updatedAt=Date.now();save();renderDoc(s.canvas);
      const nEl=[...document.querySelectorAll('#doc .sec')].find(x=>x.getAttribute('data-h')===h);if(nEl){nEl.classList.add('flash');setTimeout(()=>nEl.classList.remove('flash'),1300)}
      toast('Merged files into this section — hit Refine to check whole-document coherence')}
    catch(e){c.innerHTML=renderMd(beforeTxt);toast('Failed: '+e.message)}
    finally{setBusy(false)}}
  function removeSecFile(h,k){const s=cur();if(!s||!s.secFiles||!s.secFiles[h])return;s.secFiles[h].splice(k,1);if(!s.secFiles[h].length)delete s.secFiles[h];save();renderDoc(s.canvas)}
  // section tools
  function pinSection(btn){const sec=btn.closest('.sec');const h=sec.getAttribute('data-h');const s=cur();if(!s)return;
    s.pins=s.pins||{};if(s.pins[h])delete s.pins[h];else s.pins[h]=1;save();renderDoc(s.canvas);toast(s.pins[h]?'Pinned as chapter':'Unpinned')}
  function copyToClip(t){if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).catch(()=>fbCopy(t));else fbCopy(t)}
  function fbCopy(t){const ta=document.createElement('textarea');ta.value=t;ta.style.position='fixed';ta.style.opacity=0;document.body.appendChild(ta);ta.select();try{document.execCommand('copy')}catch(e){}ta.remove()}
  function copySection(btn){const sec=btn.closest('.sec');const hEl=sec.querySelector('.sec-h'),c=sec.querySelector('.sec-c');
    copyToClip((hEl?hEl.innerText.trim()+'\n\n':'')+c.innerText.trim());const b=btn;const o=b.innerHTML;b.classList.add('on');setTimeout(()=>{b.classList.remove('on');b.innerHTML=o},1000);toast('Section copied')}
  function copyFullPage(){$('expMenu').classList.remove('show');copyToClip(genMd());toast('Full page copied')}
  // rich-text copy — pastes with real formatting into Docs / Slack / Email
  async function copyRich(){
    $('expMenu').classList.remove('show');
    const title=$('mhTitle')?$('mhTitle').innerText.trim():'Document';
    let html='<h1>'+esc(title)+'</h1>';
    document.querySelectorAll('#doc .sec').forEach(sec=>{
      const hh=sec.querySelector('.sec-h');if(hh)html+='<h2>'+esc(hh.innerText.trim())+'</h2>';
      const c=sec.querySelector('.sec-c');if(c)html+=c.innerHTML});
    const md=genMd();
    try{
      await navigator.clipboard.write([new ClipboardItem({
        'text/html':new Blob([html],{type:'text/html'}),
        'text/plain':new Blob([md],{type:'text/plain'})})]);
      toast('Copied as rich text — paste into Docs / Slack / Email')}
    catch(e){copyToClip(md);toast('Rich copy unsupported here — copied markdown instead')}}
  // page-level drag & drop (whole project/session)
  let _dg=0;
  addEventListener('dragenter',e=>{e.preventDefault();_dg++;$('dropzone').classList.add('on')});
  addEventListener('dragleave',e=>{e.preventDefault();_dg--;if(_dg<=0){_dg=0;$('dropzone').classList.remove('on')}});
  addEventListener('dragover',e=>e.preventDefault());
  addEventListener('drop',e=>{e.preventDefault();_dg=0;$('dropzone').classList.remove('on');
    const fs=[...(e.dataTransfer?.files||[])];if(!fs.length)return;
    if($('cvView').style.display!=='none')addAndMerge(fs);else addFiles(fs)});

  /* ═══ sessions / projects ═══ */
  function newSession(mode){
    const m=MODES.includes(mode)?mode:'idea';
    const s={id:uid('s'),title:'New',projectId:null,brief:'',files:[],canvas:'',updatedAt:Date.now(),mode:m};
    sessions.unshift(s);currentSid=s.id;save();renderRail();openSession(s.id);closeRailMobile()}
  function openSession(id){
    if(_renaming)return;
    const s=sessions.find(x=>x.id===id);if(!s)return;currentSid=id;save();renderRail();
    if(s.canvas&&s.canvas.trim())showCanvas();else showHome();closeRailMobile()}
  let trash=[];
  async function deleteSession(id){
    const s=sessions.find(x=>x.id===id);if(!s)return;
    if(!await uiConfirm('Delete “'+s.title+'”? It goes to the trash for 30 days.',{ok:'Delete',danger:true}))return;
    trash=(trash||[]).filter(t=>Date.now()-t.at<30*864e5);
    trash.unshift({at:Date.now(),s:JSON.parse(JSON.stringify(s))});if(trash.length>50)trash.length=50;
    sessions=sessions.filter(x=>x.id!==id);
    if(currentSid===id){currentSid=(sessions[0]||{}).id||null;if(!currentSid){newSession();return}openSession(currentSid)}
    save();renderRail();toast('Moved to trash — restore in Settings › Privacy')}
  function restoreTrash(at){const t=(trash||[]).find(x=>x.at===at);if(!t)return;
    t.s.id=uid('s');t.s.updatedAt=Date.now();sessions.unshift(t.s);trash=trash.filter(x=>x.at!==at);
    currentSid=t.s.id;save();renderRail();openSession(t.s.id);renderTrash();toast('Restored')}
  async function emptyTrash(){if(!(trash&&trash.length))return;
    if(!await uiConfirm('Empty the trash? '+trash.length+' item'+(trash.length>1?'s':'')+' will be permanently removed.',{ok:'Empty',danger:true}))return;
    trash=[];save();renderTrash();toast('Trash emptied')}
  function renderTrash(){const el=$('trashList');if(!el)return;
    trash=(trash||[]).filter(t=>Date.now()-t.at<30*864e5);
    el.innerHTML=trash.length?trash.map(t=>'<div class="ub-row"><span>'+esc((t.s.title||'Untitled').slice(0,32))+'</span><button class="set-link" style="font-size:12px" onclick="restoreTrash('+t.at+')">Restore</button></div>').join(''):'<div class="set-note" style="margin-top:8px">Trash is empty</div>'}
  function duplicateSession(id){
    const s=sessions.find(x=>x.id===id);if(!s)return;
    const c=JSON.parse(JSON.stringify(s));c.id=uid('s');c.title=(s.title||'Untitled')+' copy';c.updatedAt=Date.now();
    c.shareId=null;c.snaps=[];c.ideas=s.ideas?JSON.parse(JSON.stringify(s.ideas)):[];
    if(s.chats){c.chats=JSON.parse(JSON.stringify(s.chats));c.chats.forEach(x=>x.id=uid('ch'));c.chatId=c.chats[0]&&c.chats[0].id}
    if(c.canvases)c.canvases.forEach(cv=>cv.id=uid('cv'));
    const i=sessions.indexOf(s);sessions.splice(i+1,0,c);currentSid=c.id;save();renderRail();openSession(c.id);toast('Duplicated')}
  function moveSession(id,pid){const s=sessions.find(x=>x.id===id);if(!s)return;s.projectId=pid;s.updatedAt=Date.now();save();renderRail();
    toast(pid?'Moved into the project — the next Crystallize will see this project’s context':'Removed from the project')}
  async function newProject(){const n=((await uiPrompt('Name the project','',{ok:'Create',placeholder:'Project name'}))||'').trim();if(!n)return;
    projects.push({id:uid('p'),name:n});save();renderRail()}
  async function renameProject(id){const p=projects.find(x=>x.id===id);if(!p)return;
    const n=((await uiPrompt('Rename project',p.name,{ok:'Rename'}))||'').trim();if(!n)return;p.name=n;save();renderRail()}
  async function deleteProject(id){const p=projects.find(x=>x.id===id);if(!p)return;
    if(!await uiConfirm('Delete project “'+p.name+'”? Its sessions become standalone.',{ok:'Delete',danger:true}))return;
    sessions.forEach(s=>{if(s.projectId===id)s.projectId=null});
    projects=projects.filter(x=>x.id!==id);save();renderRail()}

  function fmtAgo(ts){if(!ts)return '';const d=Date.now()-ts;const m=Math.floor(d/6e4),h=Math.floor(d/36e5),day=Math.floor(d/864e5);
    if(m<1)return 'just now';if(m<60)return m+' min ago';if(h<24)return h+' hr ago';if(day<7)return day+' days ago';
    return Math.floor(day/7)+' weeks ago'}
  let _cmtCounts={};
  function sItem(s){const n=_cmtCounts[s.id]||0;const m=inferMode(s);
    return '<div class="s-item mode-'+m+(s.id===currentSid?' on':'')+'" data-sid="'+s.id+'" onclick="openSession(\''+s.id+'\')" ondblclick="renameSession(\''+s.id+'\')">'
    +'<span class="s-ic" title="'+m+'">'+modeIcon(m)+'</span><span class="sb"><span class="tt">'+esc(s.title)+'</span><span class="ago">'+fmtAgo(s.updatedAt)+'</span></span>'
    +(s.private?'<span class="lock" title="Private — on this device only">🔒</span>':'')+(n?'<span class="cbadge" title="'+n+' client comment'+(n>1?'s':'')+'">'+n+'</span>':'')
    +'<button class="more" aria-label="Session options" onclick="event.stopPropagation();openCtx(event,\''+s.id+'\')">⋯</button></div>'}
  // sweep shared sessions for fresh client comments (badge in the rail)
  async function sweepCommentCounts(){
    const shared=sessions.filter(x=>x.shareId).slice(0,12);
    if(!shared.length)return;
    await Promise.all(shared.map(async x=>{
      const d=await loadShare(x.shareId);
      _cmtCounts[x.id]=((d&&d.comments)||[]).length}));
    renderRail()}
  // mode glyph for a Recents item — line icons matching the app's toolbar style
  function modeIcon(m){
    if(m==='crystallize')return '<svg class="mi-ic" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 3l3.5 5.2L12 21 8.5 8.2z"/><path d="M4.5 8.2h15" stroke-opacity=".5"/></svg>';
    if(m==='brief')return '<svg class="mi-ic" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 3h6v3H9z"/><path d="M9 11h6M9 15h4" stroke-opacity=".6"/></svg>';
    return '<svg class="mi-ic" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 20l1.8-5.1A7.5 7.5 0 1 1 20 11.5z"/></svg>';
  }
  function renderRail(){
    { const cm=cur()?inferMode(cur()):null; document.querySelectorAll('#modeSeg button').forEach(b=>b.classList.toggle('on',b.dataset.m===cm)); updateSegThumb(); }
    if(!window._railSettled){window._railSettled=true;setTimeout(()=>{const r=document.querySelector('.rail');if(r)r.classList.add('settled')},750)}
    if(typeof paintAvatar==='function'){paintAvatar();const w=$('whoLbl');if(w&&AUTH)w.textContent=(profile&&profile.name)||AUTH.email}
    // Projects — folders holding their items
    const pl=$('projList');
    if(pl)pl.innerHTML=projects.length?projects.map(p=>{
      const kids=sessions.filter(s=>s.projectId===p.id).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
      return '<div class="p-row"><span class="pi">/</span>'+esc(p.name)
        +'<button class="more" aria-label="Project options" onclick="event.stopPropagation();openPCtx(event,\''+p.id+'\')">⋯</button></div>'
        +'<div class="p-kids">'+(kids.length?kids.map(sItem).join(''):'<div class="r-empty sm"><span>Empty — move items in</span></div>')+'</div>';
    }).join(''):'<div class="r-empty"><span>No projects yet</span></div>';
    // Recents — every item, newest first (Claude-style quick access), capped
    const rl=$('recentList');
    if(rl){const recents=[...sessions].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,20);
      rl.innerHTML=recents.length?recents.map(sItem).join(''):'<div class="r-empty"><span>Nothing yet</span></div>'}
    // MD library
    renderMDList()}
  // MD is scoped to the project you're in — each project keeps its own library; items
  // saved outside any project live in the General pool. The section label names the scope.
  function mdScopeId(){const s=cur();return (s&&s.projectId)||null}
  function renderMDList(){
    const ml=$('mdList');if(!ml)return;
    const pid=mdScopeId();
    const lib=(library||[]).filter(m=>(m.projectId||null)===pid).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    const cn=$('mdCount');if(cn)cn.textContent=lib.length?lib.length:'';
    const sc=$('mdScope');if(sc){const p=pid&&projects.find(x=>x.id===pid);sc.textContent=p?('/ '+p.name):''}
    ml.innerHTML=lib.length?lib.map(m=>
      '<div class="md-item" data-mid="'+m.id+'" onclick="openMD(\''+m.id+'\')" title="'+esc(m.title)+'">'
      +'<svg class="mi-ic" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M14 3v5h5M8 3h6l5 5v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/></svg>'
      +'<span class="md-t">'+esc(m.title)+'</span>'
      +'<button class="more" aria-label="MD options" onclick="event.stopPropagation();openMDCtx(event,\''+m.id+'\')">⋯</button></div>'
    ).join(''):'<div class="r-empty"><span>'+(pid?'Nothing here yet':'Empty')+'</span></div>'}
  function moveMD(id,pid){const md=(library||[]).find(x=>x.id===id);if(!md)return;
    md.projectId=pid||null;save();renderMDList();
    const p=pid&&projects.find(x=>x.id===pid);toast(p?('Moved to /'+p.name):'Moved to General')}

  /* ctx menus */
  function openCtx(e,sid){
    const s=sessions.find(x=>x.id===sid);if(!s)return;
    let h='<button onclick="renameSession(\''+sid+'\');hideCtx()">Rename</button>';
    if(projects.length||s.projectId)h+='<div class="sep"></div>';
    if(projects.length){h+='<div class="cap">Move to project</div>';
      projects.forEach(p=>{if(p.id!==s.projectId)h+='<button onclick="moveSession(\''+sid+'\',\''+p.id+'\');hideCtx()">'+esc(p.name)+'</button>'})}
    if(s.projectId)h+='<button onclick="moveSession(\''+sid+'\',null);hideCtx()">Remove from project</button>';
    h+='<button onclick="duplicateSession(\''+sid+'\');hideCtx()">Duplicate</button>';
    h+='<div class="sep"></div><button class="danger" onclick="deleteSession(\''+sid+'\');hideCtx()">Delete session</button>';
    showCtx(e,h)}
  function renameSession(id){
    const s=sessions.find(x=>x.id===id);if(!s)return;
    const el=document.querySelector('.s-item[data-sid="'+id+'"] .tt');if(!el)return;
    if(el.getAttribute('contenteditable')==='true')return;
    const orig=s.title;_renaming=true;
    el.setAttribute('contenteditable','true');el.spellcheck=false;el.classList.add('editing');
    el.focus();
    const rg=document.createRange();rg.selectNodeContents(el);const sel=getSelection();sel.removeAllRanges();sel.addRange(rg);
    let done=false;
    const finish=commit=>{if(done)return;done=true;
      el.removeEventListener('keydown',onKey);el.removeEventListener('blur',onBlur);
      el.removeAttribute('contenteditable');el.classList.remove('editing');
      const val=el.textContent.replace(/\s+/g,' ').trim();
      if(commit&&val&&val!==orig){s.title=val;s.updatedAt=Date.now();save();
        if(id===currentSid){$('topTitle').textContent=val;const mh=$('mhTitle');if(mh)mh.textContent=val}}
      setTimeout(()=>{_renaming=false;renderRail()},0)};
    const onKey=ev=>{ev.stopPropagation();
      if(ev.key==='Enter'){ev.preventDefault();finish(true)}
      else if(ev.key==='Escape'){ev.preventDefault();el.textContent=orig;finish(false)}};
    const onBlur=()=>finish(true);
    el.addEventListener('keydown',onKey);el.addEventListener('blur',onBlur)}
  function openPCtx(e,pid){
    const p=projects.find(x=>x.id===pid);const nRef=(p&&p.refs&&p.refs.length)||0;
    let h='<button onclick="renameProject(\''+pid+'\');hideCtx()">Rename</button>'
      +'<div class="sep"></div><div class="cap">Reference'+(nRef?' · '+nRef+' files':'')+'</div>'
      +'<button onclick="addProjectRef(\''+pid+'\');hideCtx()">Add reference (file)</button>'
      +'<button onclick="openVoice(\''+pid+'\');hideCtx()">Voice & guidelines'+(p&&p.voice?' ·&nbsp;set':'')+'</button>';
    if(nRef)p.refs.forEach((r,k)=>h+='<button class="danger" onclick="removeProjectRef(\''+pid+'\','+k+');hideCtx()">✕ '+esc(r.n.slice(0,26))+'</button>');
    h+='<div class="sep"></div><button class="danger" onclick="deleteProject(\''+pid+'\');hideCtx()">Delete project</button>';
    showCtx(e,h)}
  let _refPid=null;
  function addProjectRef(pid){_refPid=pid;$('refInput').click()}
  async function handleRefFiles(e){const fs=[...(e.target.files||[])];e.target.value='';const p=projects.find(x=>x.id===_refPid);if(!p||!fs.length)return;
    p.refs=p.refs||[];toast('Reading '+fs.length+' files…');let ok=0;
    for(const f of fs){try{const c=await extractFile(f);if(c&&c.trim()){p.refs.push({n:f.name,c:c.trim()});ok++}}catch(e){}}
    save();renderRail();toast(ok?('Added '+ok+' references to the project — every session’s Crystallize will see them'):'Couldn’t read the files')}
  function removeProjectRef(pid,k){const p=projects.find(x=>x.id===pid);if(!p||!p.refs)return;p.refs.splice(k,1);save();toast('Reference removed')}
  function showCtx(e,html){const c=$('ctx');c.innerHTML=html;c.classList.add('show');
    const r=c.getBoundingClientRect();
    let x=e.clientX-r.width+10,y=e.clientY+8;
    if(x<8)x=8;if(y+r.height>innerHeight-8)y=e.clientY-r.height-8;
    c.style.left=x+'px';c.style.top=y+'px'}
  function hideCtx(){$('ctx').classList.remove('show')}
  addEventListener('click',e=>{if(!e.target.closest('.ctx')&&!e.target.closest('.more'))hideCtx();
    if(!e.target.closest('.exp-wrap'))$('expMenu').classList.remove('show')});
  // ⌘A inside an editable box selects that box only — not the whole page (Safari especially)
  addEventListener('keydown',e=>{
    if((e.metaKey||e.ctrlKey)&&(e.key==='a'||e.key==='A')){
      const el=document.activeElement;
      if(el&&(el.tagName==='TEXTAREA'||el.tagName==='INPUT'))return; // native fields scope themselves
      const sel=getSelection();const n=sel&&sel.anchorNode;
      let host=n&&(n.nodeType===1?n:n.parentElement);
      while(host&&!host.isContentEditable)host=host.parentElement;
      if(!host)return; // not editing → normal page select-all
      let box=host;while(box.parentElement&&box.parentElement.isContentEditable)box=box.parentElement;
      e.preventDefault();
      const r=document.createRange();r.selectNodeContents(box);
      sel.removeAllRanges();sel.addRange(r);
      if(typeof updateSelBar==='function')updateSelBar(); // and offer the toolbar right away
    }});
  addEventListener('keydown',e=>{if(e.key==='Escape'){hideCtx();$('expMenu').classList.remove('show');closeSnap();closeStats();closeVoice();closeDiff();closeSettings();closePaste();closeSummingPicker();closeAddPaste();if($('dlgView').classList.contains('show'))dlgClose(null);closePresent()}
    if(e.key==='Enter'&&$('dlgView').classList.contains('show')&&document.activeElement!==$('dlgCancel')){e.preventDefault();dlgClose($('dlgIn').style.display!=='none'?$('dlgIn').value:true)}});
  $('dlgOk').onclick=()=>dlgClose($('dlgIn').style.display!=='none'?$('dlgIn').value:true);
  $('dlgCancel').onclick=()=>dlgClose(null);
  $('dlgView').onclick=e=>{if(e.target===$('dlgView'))dlgClose(null)};
  // ⌥↑ / ⌥↓ — switch sessions in the order shown in the rail
  addEventListener('keydown',e=>{
    if(!e.altKey||(e.key!=='ArrowUp'&&e.key!=='ArrowDown'))return;
    if(_renaming||_busy)return;
    const t=e.target;if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable))return;
    const ids=[...document.querySelectorAll('.s-item[data-sid]')].map(x=>x.getAttribute('data-sid'));
    if(!ids.length)return;
    let i=ids.indexOf(currentSid);
    i=e.key==='ArrowDown'?(i<0?0:Math.min(ids.length-1,i+1)):(i<0?0:Math.max(0,i-1));
    if(ids[i]!==currentSid){e.preventDefault();openSession(ids[i])}});

  /* ═══ selection toolbar — refine highlighted text (ODIN) ═══ */
  let _selRange=null;
  const SELBTNS='<button onmousedown="event.preventDefault()" onclick="runSelEdit(\'make it more concise while keeping the meaning\')">Shorten</button>'
    +'<button onmousedown="event.preventDefault()" onclick="runSelEdit(\'make the tone more formal and polished\')">Formal</button>'
    +'<button onmousedown="event.preventDefault()" onclick="runSelEdit(\'expand with a little more detail, keep the tone\')">Expand</button>'
    +'<button onmousedown="event.preventDefault()" onclick="runSelEdit(\'rewrite it sharper and smoother, keep the meaning\')">Rewrite</button>'
    +'<span class="sb-div"></span>'
    +'<input class="sb-ask" placeholder="Ask VÆST…" spellcheck="false" '
    +'onkeydown="if(event.key===\'Enter\'){event.preventDefault();const v=this.value.trim();if(v)runSelEdit(v)}else if(event.key!==\'Escape\')event.stopPropagation()">';
  function secCOf(node){const el=node&&(node.nodeType===1?node:node.parentElement);return el&&el.closest?el.closest('.sec-c'):null}
  function updateSelBar(){
    const bar=$('selBar');
    if(bar.classList.contains('busy'))return;
    // typing in the Ask field — don't re-render/hide under the user's fingers
    if(document.activeElement&&document.activeElement.closest&&document.activeElement.closest('.sel-bar'))return;
    if($('cvView').style.display==='none'){hideSelBar();return}
    const sel=getSelection();
    if(!sel||sel.isCollapsed||!sel.rangeCount){hideSelBar();return}
    const range=sel.getRangeAt(0);
    const txt=(sel.toString()||range.toString()).replace(/\s+/g,' ').trim();
    if(txt.length<2||!secCOf(range.commonAncestorContainer)){hideSelBar();return}
    _selRange=range.cloneRange();
    const r=range.getBoundingClientRect();
    let left=Math.min(Math.max(r.left+r.width/2,96),innerWidth-96);
    bar.innerHTML=SELBTNS;bar.classList.add('show');
    const flip=r.top<64;bar.classList.toggle('below',flip);
    bar.style.left=left+'px';bar.style.top=(flip?r.bottom+8:r.top-8)+'px'}
  function hideSelBar(){const b=$('selBar');b.classList.remove('show','busy','below')}
  function runSelEdit(instruction){
    if(_busy){toast('Working…');return}
    if(!_selRange)return;
    const secc=secCOf(_selRange.commonAncestorContainer);if(!secc)return;
    const original=_selRange.toString();if(original.replace(/\s+/g,' ').trim().length<2)return;
    const context=secc.innerText.trim().slice(0,1200);
    const bar=$('selBar');bar.classList.add('busy');bar.innerHTML='<span class="sb-run"><span class="pulse"></span> Refining…</span>';
    setBusy(true);pushUndo();
    const prompt='Paragraph context:\n"'+context+'"\n\nInstruction: '+instruction+'\n\nSelected text (return only this text, refined):\n"'+original+'"';
    streamAPI('edit',[{role:'user',content:prompt}],toneSys())
      .then(text=>{
        text=text.trim().replace(/^[\s"'“”]+|[\s"'“”]+$/g,'');
        if(!text){toast('No result');return}
        try{const sel=getSelection();sel.removeAllRanges();sel.addRange(_selRange);
          _selRange.deleteContents();
          const frag=_selRange.createContextualFragment(mdInline(text));
          _selRange.insertNode(frag);sel.removeAllRanges()}catch(e){}
        const s=cur();if(s){s.canvas=genMd();s.updatedAt=Date.now();save();savedTick();renderDoc(s.canvas)}
        toast('Text refined')})
      .catch(e=>toast('Failed: '+e.message))
      .finally(()=>{setBusy(false);_selRange=null;hideSelBar()})}
  document.addEventListener('mouseup',e=>{if(!e.target.closest('.sel-bar'))setTimeout(updateSelBar,10)});
  document.addEventListener('keyup',e=>{if(e.shiftKey||e.key==='Shift')setTimeout(updateSelBar,10)});
  document.addEventListener('scroll',()=>{if(!$('selBar').classList.contains('busy'))hideSelBar()},true);
  addEventListener('keydown',e=>{if(e.key==='Escape')hideSelBar()});

  /* ═══ tone preset — session-level persona (ODIN for all writing) ═══ */
  /* ═══ Dynamic Persona Engine — injected on top of EVERY call ═══ */
  const PERSONA={
    standard:'PERSONA — STANDARD: clear, direct, professionally sharp. Say things plainly; cut filler; every sentence earns its place. Confident without decoration.',
    formal:'PERSONA — EDITORIAL: the measured voice of a world-class design magazine (think Monocle, Vogue). Composed, precise, quietly confident; rich vocabulary worn lightly; long thoughts allowed when they are earned. Never stiff, never bureaucratic — cultivated.',
    playful:'PERSONA — PLAYFUL: a creative director who enjoys breaking frames. Industry slang welcome, vivid metaphors, a little mischief; provoke sideways thinking and challenge the obvious take. Never corny, never random for its own sake — the mischief must serve the idea.',
  };
  const personaKey=()=>{const s=cur();return PERSONA[(s&&s.tone)||'standard']?((s&&s.tone)||'standard'):'standard'};
  // persona-flavored waiting lines (micro-copy while heavy calls run)
  const PERSONA_WAIT={
    standard:['Reading the whole board…','Weighing what’s missing…','Sharpening the angles…'],
    formal:['Reading between the lines…','Considering the composition…','Letting the ideas settle…'],
    playful:['Ripping it apart (kindly)…','Hunting for the cultural hook…','Bending the frame a little…'],
  };
  // shorter, lighter lines for the Galdr chat — shown only until the first token lands
  const IDEA_WAIT={
    standard:['Thinking…','Crafting an angle…','Pulling the thread…','Shaping a reply…'],
    formal:['Considering…','Composing a reply…','Weighing the words…','Finding the line…'],
    playful:['Cooking…','Chasing the spark…','Bending it a little…','Almost got it…'],
  };
  // rotate a status line inside `el` until stop() is called; returns the stopper
  function waitLines(el,pool){
    const lines=pool||IDEA_WAIT.standard;let i=0;
    const paint=()=>{if(el)el.innerHTML='<span class="id-wait">'+lines[i%lines.length]+'</span><span class="cursor"></span>'};
    paint();const iv=setInterval(()=>{i++;paint()},2200);
    return ()=>clearInterval(iv);
  }
  const LANGS={th:'Reply in Thai (ภาษาไทย) regardless of the input language.',en:'Reply in English regardless of the input language.'};
  function getLang(){try{return localStorage.getItem('vaest_lang')||''}catch(e){return ''}}
  function setLang(l){try{localStorage.setItem('vaest_lang',l)}catch(e){}
    document.querySelectorAll('#langBar button').forEach(b=>b.classList.toggle('on',(b.getAttribute('data-lang')||'')===l));
    toast(l==='th'?'ทุกคำตอบเป็นภาษาไทย':l==='en'?'Replies locked to English':'Auto — mirrors your language')}
  function toneSys(){
    const s=cur(),parts=[];
    parts.push(PERSONA[personaKey()]+' This persona governs word choice, tone and mood of everything you write here.');
    if(LANGS[getLang()])parts.push(LANGS[getLang()]);
    const p=s&&s.projectId&&projects.find(x=>x.id===s.projectId);
    if(p&&p.voice&&p.voice.trim())parts.push('Project voice & guidelines (follow strictly):\n'+p.voice.trim());
    const taste=[...((p&&p.taste)||[]),...((s&&s.taste)||[])].slice(-14);
    if(taste.length){
      const ap=taste.filter(x=>x.v==='approved').map(x=>x.t),rj=taste.filter(x=>x.v==='skipped').map(x=>x.t);
      parts.push(capTxt('Taste memory — how this team judged earlier suggestions (let it quietly bias your choices):'
        +(ap.length?'\nAPPROVED: '+ap.join(' · '):'')+(rj.length?'\nPASSED ON: '+rj.join(' · '):''),1200))}
    return parts.join('\n\n')}

  /* project voice modal */
  let _voicePid=null;
  function openVoice(pid){const p=projects.find(x=>x.id===pid);if(!p)return;_voicePid=pid;
    $('voiceTitle').textContent='Voice — '+p.name;$('voiceText').value=p.voice||'';
    const tEl=$('vcTaste');const n=(p.taste||[]).length;
    if(tEl){if(n){tEl.style.display='';tEl.innerHTML='<span>Taste memory: learned from <b>'+n+'</b> decision'+(n>1?'s':'')+' — quietly biases every suggestion</span><button onclick="clearTaste()">Forget</button>'}
      else{tEl.style.display='none'}}
    $('voiceView').classList.add('show');setTimeout(()=>$('voiceText').focus(),60)}
  async function clearTaste(){const p=projects.find(x=>x.id===_voicePid);if(!p)return;
    if(!await uiConfirm('Forget the '+(p.taste||[]).length+' learned taste decisions for this project?',{ok:'Forget',danger:true}))return;
    p.taste=[];save();$('vcTaste').style.display='none';toast('Taste memory cleared')}
  function setSetTab(t){
    document.querySelectorAll('.set-tab').forEach(b=>b.classList.toggle('on',b.getAttribute('data-st')===t));
    document.querySelectorAll('.set-pane').forEach(p=>p.classList.toggle('on',p.getAttribute('data-sp')===t));
    if(t==='usage')renderUsageBreak();
    if(t==='api')renderApiKeys()}
  /* ═══ API keys — build VÆST into your own tools ═══ */
  async function renderApiKeys(){
    const list=$('apiKeyList');if(!list)return;
    // show the same monthly usage meter as the app — API calls count here too (sync)
    const uq=$('apiUsage');if(uq){const h=quotaBarHTML(window.QUOTA);uq.innerHTML=h||'';uq.style.display=h?'':'none'}
    list.innerHTML='<div class="set-note">Loading…</div>';
    try{if(!await ensureAuth()){list.innerHTML='<div class="set-note">Sign in again.</div>';return}
      const r=await fetch('/api/keys',{headers:{Authorization:'Bearer '+AUTH.access_token}});
      if(r.status===402){list.innerHTML='<div class="set-note">API access needs an active plan.</div>';return}
      const d=await r.json().catch(()=>({keys:[]}));
      const keys=(d.keys||[]).filter(k=>!k.revokedAt);
      list.innerHTML=keys.length?keys.map(k=>'<div class="api-key"><div class="api-kmeta"><b>'+esc(k.name||'API key')+'</b><span class="api-kp">'+esc(k.prefix||'vsk_live_')+'…</span></div><button class="set-link" style="color:var(--cin-d)" onclick="revokeApiKeyUI(\''+k.id+'\')">Revoke</button></div>').join('')
        :'<div class="set-note">No keys yet — create one to start.</div>';
    }catch(e){list.innerHTML='<div class="set-note">Couldn’t load keys.</div>'}}
  async function createNewApiKey(){
    const name=await uiPrompt('Name this key','',{ok:'Create',placeholder:'e.g. Production, Zapier'});
    if(name===null)return;
    try{if(!await ensureAuth())return;
      const r=await fetch('/api/keys',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+AUTH.access_token},body:JSON.stringify({name:name||'API key'})});
      if(r.status===429){toast('Max 5 keys — revoke one first');return}
      if(r.status===402){toast('API access needs an active plan');return}
      const d=await r.json().catch(()=>({}));
      if(!d.key)throw new Error('failed');
      const box=$('apiKeyNew');box.style.display='';
      box.innerHTML='<div class="api-new"><div class="api-new-lbl">Copy your key now — it won’t be shown again</div>'
        +'<div class="api-newkey" id="apiNewKey">'+esc(d.key)+'</div>'
        +'<button class="api-copy" onclick="copyToClip($(\'apiNewKey\').textContent);toast(\'Key copied\')">Copy key</button></div>';
      renderApiKeys();}
    catch(e){toast('Couldn’t create key, try again')}}
  async function revokeApiKeyUI(id){
    if(!await uiConfirm('Revoke this key? Anything using it stops working immediately.',{ok:'Revoke',danger:true}))return;
    try{if(!await ensureAuth())return;
      await fetch('/api/keys?id='+encodeURIComponent(id),{method:'DELETE',headers:{Authorization:'Bearer '+AUTH.access_token}});
      const b=$('apiKeyNew');if(b){b.style.display='none';b.innerHTML=''}
      renderApiKeys();toast('Key revoked')}
    catch(e){toast('Couldn’t revoke, try again')}}
  function openSettings(){renderTone();
    document.querySelectorAll('#langBar button').forEach(b=>b.classList.toggle('on',(b.getAttribute('data-lang')||'')===getLang()));
    const pr=getProfile();$('pfName').value=pr.name||'';$('pfEmail').textContent='Signed in as '+(AUTH?AUTH.email:'');paintAvatar();
    $('pvPrivate').checked=!!(cur()&&cur().private);renderTrash();
    const kb=Math.round(stateBytes()/1024);$('storeLine').innerHTML='Workspace state: <b style="color:var(--ink)">'+(kb>1024?(kb/1024).toFixed(1)+' MB':kb+' KB')+'</b>'+(kb>4096?' — consider trimming':'');
    setSetTab('profile');$('setView').classList.add('show')}
  /* profile — name + avatar in the user's own state (stays with the account) */
  function getProfile(){return profile||{}}
  function saveProfileObj(p){profile=p||{};save()} // rides the cloud sync — follows the account across devices
  function paintAvatar(){const p=getProfile();const av=$('pfAv'),txt=$('pfAvTxt');const foot=$('railAv');
    const set=el=>{if(!el)return;if(p.pic){el.style.backgroundImage='url('+p.pic+')';el.classList.add('has');el.textContent=''}
      else{el.style.backgroundImage='';el.classList.remove('has');el.textContent=(p.name||(AUTH&&AUTH.email)||'?').trim()[0].toUpperCase()}};
    set(av);set(foot);if(txt&&!p.pic)txt.textContent=(p.name||(AUTH&&AUTH.email)||'?').trim()[0].toUpperCase();else if(txt)txt.textContent=''}
  function saveProfile(){const p=getProfile();p.name=$('pfName').value.trim().slice(0,40);saveProfileObj(p);paintAvatar();
    const w=$('whoLbl');if(w)w.textContent=p.name||AUTH.email;toast('Profile saved')}
  async function pfUpload(e){const f=(e.target.files||[])[0];e.target.value='';if(!f)return;
    try{const url=await imgToDataURL(f,128,.8);const p=getProfile();p.pic=url;saveProfileObj(p);paintAvatar();toast('Photo updated')}
    catch(err){toast('Couldn’t read that image')}}
  /* privacy */
  function togglePrivate(on){const s=cur();if(!s)return;s.private=on;save();
    renderRail();toast(on?'🔒 Private — this session stays on this device':'Sync re-enabled for this session')}
  function exportAllData(){
    const blob=new Blob([JSON.stringify(stateBlob(),null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='vaest-data-'+new Date().toISOString().slice(0,10)+'.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),2000);toast('Exported your data')}
  async function wipeCloud(){
    if(!await uiConfirm('Delete your cloud copy? What’s on this device stays; other devices will lose the sync.',{ok:'Delete cloud',danger:true}))return;
    try{await ensureAuth();
      // return=representation so we can confirm a row was actually deleted — under RLS a
      // blocked delete still returns 2xx with an empty body, which would otherwise look like success.
      const r=await fetch(SB.url+'/rest/v1/vaest_state?email=eq.'+encodeURIComponent(SB.who),{method:'DELETE',headers:{apikey:SB.key,Authorization:'Bearer '+((AUTH&&AUTH.access_token)||SB.key),Prefer:'return=representation'}});
      const rows=r.ok?await r.json().catch(()=>[]):null;
      if(r.ok&&Array.isArray(rows)&&rows.length){toast('Cloud copy deleted')}
      else{toast('Couldn’t delete — nothing was removed')}}
    catch(e){toast('Couldn’t delete, try again')}}
  function renderUsageBreak(){
    const rt=getRates();let o=0,f=0,idea=0,mi=0;sessions.forEach(x=>{const t=x.tok||{};o+=(t.opus||0)+(t.skadi||0);f+=t.fable||0;idea+=t.idea||0;mi+=t.mimir||0});
    const q=window.QUOTA;const qe=$('quotaRow2');
    if(qe){const h=quotaBarHTML(q);if(h){qe.style.display='';qe.innerHTML=h}else qe.style.display='none'}
    // Norrsken rides the same Anthropic key as Odin. `false` here means the key is absent, so that
    // engine has been silently falling back — the tokens above would be landing in another bucket.
    const en=(window.QUOTA&&window.QUOTA.engines)||null;
    const mfb=(en&&en.mimirFallback)||0; // Sol→Opus silent fallbacks this month
    let rows=[['ODIN · write',o,'odin'],['MIMIR · think',mi,'mimir'],['NORRSKEN · refine',f,'odin'],['Galdr · idea',idea,'galdr']]
      .map(r=>'<div class="ub-row"><span>'+r[0]+(en&&en[r[2]]===false?' <em class="ub-off">no key — falling back</em>':'')
        +(r[2]==='mimir'&&mfb>0?' <em class="ub-off">'+mfb+' fell back to Odin this month</em>':'')
        +'</span><b>'+fmtTok(r[1])+'</b></div>').join('');
    if(en&&typeof en.kv==='boolean') // rate limits: distributed (KV) vs per-instance
      rows+='<div class="ub-row"><span>Rate limit '+(en.kv?'':'<em class="ub-off">in-memory — connect KV</em>')+'</span><b>'+(en.kv?'distributed':'per-instance')+'</b></div>';
    $('usageBreak').innerHTML=rows}
  function closeSettings(){$('setView').classList.remove('show')}
  function closeVoice(){$('voiceView').classList.remove('show');_voicePid=null}
  function saveVoice(){const p=projects.find(x=>x.id===_voicePid);if(!p)return;
    p.voice=$('voiceText').value.trim();save();closeVoice();
    toast(p.voice?'Voice saved — every session in this project follows it':'Voice cleared')}
  function setTone(t){const s=cur();if(!s)return;s.tone=t;s.updatedAt=Date.now();save();renderTone();
    toast('Persona: '+({'':'Standard',formal:'Formal — editorial',playful:'Playful — a little mischief'}[t]||'Standard')+' · rides on top of every call from now on')}
  function renderTone(){const s=cur();let t=(s&&s.tone)||'';if(!PERSONA[t||'standard'])t='';
    document.querySelectorAll('#toneBar button').forEach(b=>b.classList.toggle('on',(b.getAttribute('data-tone')||'')===t))}

  /* ═══ command palette (⌘K) ═══ */
  let _palItems=[],_palIdx=0;
  function paletteCommands(){
    const onCanvas=$('cvView').style.display!=='none',c=[];
    const A=(t,run)=>c.push({t,run,k:'action'});
    A('New',()=>newSession());
    if(onCanvas){
      A('Back to home — chat & brief',()=>backToBrief());
      A('Add files to document',()=>$('addFileInput').click());
      A('Paste text into document',()=>openAddPaste());
      A('Refine — full recheck',()=>runMastering(''));
      A('Refine · tone only',()=>runMastering('tone'));
      A('Refine · coherence only',()=>runMastering('flow'));
      A('Refine · completeness only',()=>runMastering('complete'));
      A('Save this version',()=>saveSnapshot());
      A('Saved versions…',()=>openSnapshots());
      A('Undo last change',()=>undoCanvas());
      c.push({t:'Share link · read-only',run:()=>shareDoc(),k:'export'});
      c.push({t:'Settings · persona',run:()=>openSettings(),k:'app'});
      c.push({t:'Dialogue — copy as rich text',run:()=>copyRich(),k:'export'});
      c.push({t:'Presentation · deck',run:()=>openPresent(),k:'export'});
      c.push({t:'Find & replace in document',run:()=>findReplace(),k:'doc'});
      c.push({t:'Download Markdown (.md)',run:()=>downloadMD(),k:'export'});
      c.push({t:'Download Word (.doc)',run:()=>downloadDOC(),k:'export'});
      c.push({t:'Print / save PDF',run:()=>exportPDF(),k:'export'});
    }else{
      A('Crystallize — turn sources into a canvas',()=>runSumming());
      A('Attach files',()=>$('fileInput').click());
    }
    A('New project',()=>newProject());
    if(window.QUOTA&&window.QUOTA.internal)A('Usage & cost',()=>openStats());
    A('Sign out'+(AUTH?' ('+AUTH.email+')':''),()=>confirmLogout());
    sessions.forEach(s=>c.push({t:s.title||'Untitled',sub:fmtAgo(s.updatedAt),run:()=>openSession(s.id),k:'session'}));
    return c}
  function palIcon(k){return k==='session'?'/':k==='export'?'↓':'→'}
  function fuzzy(text,q){let i=-1;for(const ch of q){i=text.indexOf(ch,i+1);if(i<0)return false}return true}
  function openPalette(){$('pal').classList.add('show');const inp=$('palInput');inp.value='';renderPalette('');setTimeout(()=>inp.focus(),0)}
  function closePalette(){$('pal').classList.remove('show')}
  function renderPalette(q){q=(q||'').trim().toLowerCase();const all=paletteCommands();
    _palItems=q?all.filter(c=>fuzzy((c.t+' '+(c.sub||'')).toLowerCase(),q)):all;_palIdx=0;drawPalette()}
  function drawPalette(){const list=$('palList');
    if(!_palItems.length){list.innerHTML='<div class="pal-empty">No commands or sessions</div>';return}
    let html='',lastG=null;
    _palItems.forEach((c,i)=>{const g=c.k==='session'?'Sessions':'Commands';
      if(g!==lastG){html+='<div class="pal-cap">'+g+'</div>';lastG=g}
      html+='<div class="pal-item'+(i===_palIdx?' on':'')+'" onmousemove="palHover('+i+')" onmousedown="event.preventDefault()" onclick="palRun('+i+')">'
        +'<span class="pi-i">'+palIcon(c.k)+'</span><span class="pi-t">'+esc(c.t)+'</span>'+(c.sub?'<span class="pi-s">'+esc(c.sub)+'</span>':'')+'</div>'});
    list.innerHTML=html;const on=list.querySelector('.pal-item.on');if(on)on.scrollIntoView({block:'nearest'})}
  function palHover(i){if(i===_palIdx)return;_palIdx=i;drawPalette()}
  function palRun(i){const c=_palItems[i];if(!c)return;closePalette();setTimeout(c.run,10)}
  function palMove(d){if(!_palItems.length)return;_palIdx=(_palIdx+d+_palItems.length)%_palItems.length;drawPalette()}
  $('palInput').addEventListener('input',e=>renderPalette(e.target.value));
  $('palInput').addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'){e.preventDefault();palMove(1)}
    else if(e.key==='ArrowUp'){e.preventDefault();palMove(-1)}
    else if(e.key==='Enter'){e.preventDefault();palRun(_palIdx)}
    else if(e.key==='Escape'){e.preventDefault();closePalette()}});
  addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&(e.key==='k'||e.key==='K')){e.preventDefault();
    $('pal').classList.contains('show')?closePalette():openPalette()}});

  /* ═══ multi-canvas — one session, several documents ═══ */
  function ensureCanvases(s){
    if(!s.canvases||!s.canvases.length){s.canvases=[{id:uid('cv'),t:'Main',md:s.canvas||''}];s.cvId=s.canvases[0].id}
    if(!s.cvId||!s.canvases.find(c=>c.id===s.cvId))s.cvId=s.canvases[0].id;
    return s.canvases}
  function activeCv(s){ensureCanvases(s);return s.canvases.find(c=>c.id===s.cvId)}
  function setCanvasMd(s,md){s.canvas=md;const c=activeCv(s);if(c)c.md=md}
  function renderTabs(){
    const s=cur();const el=$('cvTabs');if(!el)return;
    const on=$('cvView').style.display!=='none';
    const cvs=(s&&s.canvases)||[];
    if(!on||cvs.length<2){el.classList.remove('has');el.innerHTML='';return}
    el.classList.add('has');
    el.innerHTML=cvs.map(c=>{const on=c.id===s.cvId;
      return '<button class="cv-tab'+(on?' on':'')+'" onclick="switchCanvas(\''+c.id+'\')" ondblclick="renameCanvas(\''+c.id+'\')" title="Double-click to rename">'+esc(c.t)
        +(on&&cvs.length>1?'<span class="tx" onclick="event.stopPropagation();deleteCanvas(\''+c.id+'\')" title="Delete this canvas">✕</span>':'')+'</button>'}).join('')
      +'<button class="cv-tab addt" onclick="addCanvas()" title="New canvas">+</button>'}
  function addCanvas(){
    const s=cur();if(!s)return;ensureCanvases(s);
    const c0=activeCv(s);if(c0&&$('cvView').style.display!=='none')c0.md=genMd();
    const c={id:uid('cv'),t:'Untitled',md:'# Untitled\n\n## Notes\n\n—'};
    s.canvases.push(c);s.cvId=c.id;s.canvas=c.md;
    renderDoc(s.canvas);save();renderTabs();toast('New canvas — double-click the tab to name it')}
  async function renameCanvas(id){
    const s=cur();if(!s)return;const c=(s.canvases||[]).find(x=>x.id===id);if(!c)return;
    const n=await uiPrompt('Canvas name',c.t,{ok:'Rename'});
    if(n===null||!String(n).trim())return;
    c.t=String(n).trim().slice(0,26);save();renderTabs()}
  async function deleteCanvas(id){
    const s=cur();if(!s)return;ensureCanvases(s);
    if(s.canvases.length<2)return;
    const c=s.canvases.find(x=>x.id===id);if(!c)return;
    if(!await uiConfirm('Delete canvas “'+c.t+'”? Its content goes with it.',{ok:'Delete',danger:true}))return;
    s.canvases=s.canvases.filter(x=>x.id!==id);
    if(s.cvId===id){s.cvId=s.canvases[0].id;s.canvas=s.canvases[0].md;renderDoc(s.canvas)}
    save();renderTabs()}
  function switchCanvas(id){
    const s=cur();if(!s)return;ensureCanvases(s);
    if(id===s.cvId)return;
    closeMast();
    const c0=activeCv(s);if(c0)c0.md=genMd();
    s.cvId=id;const c=activeCv(s);s.canvas=c.md;
    renderDoc(s.canvas);save();renderTabs();$('cvView').scrollTop=0}
  // Crystallize may split the work: ===CANVAS: Title=== before each part
  function splitCanvases(md){
    const seg=String(md).split(/^===\s*CANVAS:\s*(.+?)\s*===\s*$/m);
    if(seg.length<3)return null;
    const out=[];for(let i=1;i<seg.length;i+=2){const body=(seg[i+1]||'').trim();if(body)out.push({t:seg[i].trim().slice(0,26),md:body})}
    return out.length>1?out:null}

  /* ═══ views ═══ */
  /* ═══ BRIEF MODE — interview to a complete brief (Galdr asks · Odin compiles) ═══ */
  let _briefBusy=false;
  function briefMsgs(s){
    const qa=s.briefQA||[];
    const filesCtx=(s.files||[]).map((f,i)=>'### File '+(i+1)+': '+f.n+'\n'+capTxt(f.c,8000)).join('\n\n');
    return qa.map((m,i)=>{let c=m.c;
      if(i===0&&m.r==='user'&&filesCtx)c=m.c+'\n\n# Attached files (already provided)\n'+filesCtx;
      return {role:m.r==='user'?'user':'assistant',content:c}});
  }
  function renderBriefFiles(){
    const s=cur(),el=$('briefFiles');if(!el)return;
    el.innerHTML=(s&&s.files&&s.files.length)?s.files.map((f,i)=>
      '<span class="chip"><b>'+esc((f.n.split('.').pop()||'').toUpperCase().slice(0,4))+'</b><span>'+esc(f.n)+'</span><button onclick="removeFile('+i+');renderBriefFiles()" title="Remove">✕</button></span>').join(''):''}
  function briefFilePick(e){const fs=[...(e.target.files||[])];e.target.value='';if(fs.length)addFiles(fs).then(renderBriefFiles)}
  function renderBriefQA(){
    const s=cur(),th=$('briefThread');if(!th)return;
    const qa=(s&&s.briefQA)||[];const last=qa.length-1;
    th.innerHTML=qa.map((m,i)=>{const isAI=m.r!=='user';
      // the current question (last message, still an AI turn, brief not yet complete) pops as a focused card
      if(i===last&&isAI&&!(s&&s.briefComplete))
        return '<div class="q-card"><div class="q-eye"><span class="q-dot"></span> VÆST asks</div><div class="q-body">'+renderMd(m.c)+'</div></div>';
      return '<div class="id-m '+(isAI?'ai':'you')+'"><div class="who">'+(isAI?'VÆST':'YOU')+'</div><div class="tx">'+(isAI?renderMd(m.c):esc(m.c).replace(/\n/g,'<br>'))+'</div></div>'}).join('');
    // spotlight the question rather than pinning to the very bottom
    const card=th.querySelector('.q-card');
    if(card)card.scrollIntoView({block:'nearest'}); else th.scrollTop=th.scrollHeight}
  // Compile is offered two ways: once VÆST declares BRIEF_COMPLETE (primary), or as an
  // escape hatch after a few answers so a user in a hurry is never trapped in the interview.
  function updateBriefCompile(s){
    const bc=$('briefCompile');if(!bc)return;
    const complete=!!(s&&s.briefComplete);
    const answers=((s&&s.briefQA)||[]).filter(m=>m.r==='user').length; // includes the seed
    const early=!complete&&answers>=3;
    bc.style.display=(complete||early)?'':'none';
    bc.classList.toggle('early',early);
    const note=bc.querySelector('.bc-note');
    if(note)note.textContent=complete
      ? 'Looks complete — compile it into a brief, or keep answering below.'
      : 'Enough to start? Compile the brief now — you can reopen and add more anytime.'}
  async function startBrief(){
    if(_briefBusy)return;
    const s=cur();if(!s)return;
    const v=($('briefIn')&&$('briefIn').value.trim())||'';
    if(!v&&!(s.files&&s.files.length)){toast('Paste or type a rough brief, or attach a file');return}
    s.mode='brief';s.briefQA=[{r:'user',c:v||'(see attached files)',ts:Date.now()}];s.briefSeed=v;
    if((s.title==='New'||!s.title))s.title='Brief — '+(v.replace(/\s+/g,' ').slice(0,32)||'new');
    $('briefStart').style.display='none';$('briefInterview').style.display='';
    save();renderRail();renderBriefQA();
    await briefTurn(s)}
  async function sendBriefAnswer(){
    if(_briefBusy){toast('One moment…');return}
    const s=cur();if(!s)return;const inp=$('briefReply');const t=inp.value.trim();if(!t)return;
    inp.value='';inp.style.height='';$('briefCompile').style.display='none';
    s.briefQA=s.briefQA||[];s.briefQA.push({r:'user',c:t,ts:Date.now()});save();renderBriefQA();
    await briefTurn(s)}
  async function briefTurn(s){
    _briefBusy=true;
    const th=$('briefThread');
    const live=document.createElement('div');live.className='id-m ai';live.innerHTML='<div class="who">VÆST</div><div class="tx"></div>';
    th.appendChild(live);th.scrollTop=th.scrollHeight;
    const briefWait=['Reading your brief…','Finding the gaps…','Framing the next question…','Thinking…'];
    let stopBW=waitLines(live.querySelector('.tx'),briefWait),bwaited=true;
    try{
      const r=raf(full=>{if(full&&bwaited){bwaited=false;stopBW()}const tx=live.querySelector('.tx');if(tx){tx.innerHTML=renderMd(full.replace(/^BRIEF_COMPLETE\s*/i,''))+'<span class="cursor"></span>';th.scrollTop=th.scrollHeight}});
      const out=await streamAPI('briefchat',briefMsgs(s),toneSys(),r);r.stop();if(bwaited){bwaited=false;stopBW()}
      const complete=/^BRIEF_COMPLETE/i.test(out.trim());
      const clean=out.replace(/^BRIEF_COMPLETE\s*/i,'').trim();
      s.briefQA.push({r:'ai',c:clean||'Looks complete.',ts:Date.now()});s.briefComplete=complete;s.updatedAt=Date.now();save();renderBriefQA();
      updateBriefCompile(s);
    }catch(e){stopBW();live.remove();toast('Failed: '+e.message);const last=s.briefQA[s.briefQA.length-1];if(last&&last.r==='user'){s.briefQA.pop();const inp=$('briefReply');if(inp)inp.value=last.c;save();renderBriefQA()}}
    finally{_briefBusy=false}}
  async function compileBrief(){
    if(_briefBusy||_busy){toast('One moment…');return}
    const s=cur();if(!s)return;
    setBusy(true);
    const filesCtx=(s.files||[]).map((f,i)=>'### File '+(i+1)+': '+f.n+'\n'+capTxt(f.c,12000)).join('\n\n');
    const qaText=(s.briefQA||[]).map(m=>(m.r==='user'?'User: ':'VÆST: ')+m.c).join('\n\n');
    const prompt='# Initial input\n'+(s.briefSeed||'(see files)')+(filesCtx?('\n\n# Files\n'+filesCtx):'')+'\n\n# Interview (questions & answers)\n'+qaText;
    $('home').style.display='none';$('cvView').style.display='';$('topbar').style.display='flex';
    $('doc').innerHTML='<div class="gen"><div class="gen-eye"><span class="pulse"></span> Compiling the brief…</div><div class="gen-body" id="genBody"></div></div>';
    try{
      const r=raf(full=>{const g=$('genBody');if(g){g.innerHTML=renderMd(full)+'<span class="cursor"></span>';softScroll($('cvView'))}});
      const md=await streamAPI('briefdoc',[{role:'user',content:prompt}],toneSys(),r);r.stop();
      setCanvasMd(s,md);s.mode='brief';s.updatedAt=Date.now();save();renderRail();showCanvas();
      toast('Brief compiled — edit any section, then Export PDF');
    }catch(e){showHome();toast('Compile failed: '+e.message)}
    finally{setBusy(false)}}
  // segmented thumb — measure the active button, slide the pill under it
  function updateSegThumb(){ // measure synchronously — rAF stalls in hidden tabs
    const seg=$('modeSeg');if(!seg)return;
    const on=seg.querySelector('button.on'),th=$('segThumb');if(!on||!th)return;
    th.style.width=on.offsetWidth+'px';th.style.transform='translateX('+on.offsetLeft+'px)'}
  addEventListener('resize',()=>updateSegThumb());
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>updateSegThumb());
  const HOME_TITLE={idea:'What are we thinking?',brief:'Let’s get the brief right.',crystallize:'What are we making?'};
  function showHome(){const s=cur();
    $('home').style.display='';$('cvView').style.display='none';$('topbar').style.display='none';const _tt=$('toTop');if(_tt)_tt.classList.remove('show');
    const ab=$('anonBar');if(ab)ab.style.display=ANON?'':'none'; // restore the anon bar on the home
    document.querySelector('.main').classList.remove('has-top');
    $('brief').value=s?s.brief:'';
    const mode=inferMode(s);
    // switcher active state + the matching surface
    document.querySelectorAll('#modeSeg button').forEach(b=>b.classList.toggle('on',b.dataset.m===mode));updateSegThumb();
    document.querySelectorAll('.mode-pane').forEach(p=>{const on=p.dataset.pane===mode;
      if(on&&p.style.display==='none'){p.style.display='';p.classList.remove('pane-in');void p.offsetWidth;p.classList.add('pane-in')} // fade the pane in on a real switch
      else p.style.display=on?'':'none'});
    const ht=$('homeTitle');if(ht)ht.textContent=HOME_TITLE[mode]||HOME_TITLE.crystallize;
    if(mode==='brief'){const started=!!(s&&s.briefQA&&s.briefQA.length);
      $('briefStart').style.display=started?'none':'';$('briefInterview').style.display=started?'':'none';
      if(started){renderBriefFiles();renderBriefQA();updateBriefCompile(s)}
      else{const bi=$('briefIn');if(bi)bi.value='';renderBriefFiles()}}
    renderChips();renderTone();renderChain();renderIdeas();renderOutline();renderTabs();renderAnonLimit()}
  // switch the current (unstarted) item's mode — only allowed before it has real content
  function setMode(m){
    if(!MODES.includes(m))return;
    const s=cur();
    const started=s&&((s.canvas&&s.canvas.trim())||(s.ideas&&s.ideas.length)||(s.briefQA&&s.briefQA.length));
    // switching the mode on work that already has content opens a fresh item in that mode,
    // like picking a different Claude product — never overwrites what's there
    if(!s||(started&&inferMode(s)!==m)){newSession(m);return}
    s.mode=m;s.updatedAt=Date.now();save();renderRail();showHome();
    const inp=m==='idea'?$('ideaInput'):m==='brief'?$('briefIn'):$('brief');if(inp)setTimeout(()=>inp.focus(),40)}

  /* scroll-spy — the outline follows where you are; back-to-top past 600px */
  function initScrollSpy(){
    const cv=$('cvView');if(!cv||cv._spy)return;cv._spy=true;
    cv.addEventListener('scroll',raf(()=>{
      const tt=$('toTop');if(tt)tt.classList.toggle('show',cv.scrollTop>600&&cv.style.display!=='none');
      const cvTop=cv.getBoundingClientRect().top;let curH=null;
      document.querySelectorAll('#doc .sec').forEach(sec=>{
        if(sec.getAttribute('data-h')!=='_intro'&&sec.getBoundingClientRect().top-cvTop<=140)curH=sec.getAttribute('data-h')});
      document.querySelectorAll('.ol-item').forEach(it=>it.classList.toggle('cur',it.getAttribute('data-oh')===curH))}))}

  /* document outline in the rail — click to jump */
  function renderOutline(){
    const lbl=$('olLbl'),list=$('olList');if(!lbl||!list)return;
    const on=$('cvView').style.display!=='none';
    const secs=on?[...document.querySelectorAll('#doc .sec')].filter(x=>x.getAttribute('data-h')!=='_intro'):[];
    if(!secs.length){lbl.style.display='none';list.style.display='none';list.innerHTML='';return}
    const s=cur();const pins=(s&&s.pins)||{};
    lbl.style.display='';list.style.display='';
    list.innerHTML=secs.map((el,i)=>{const h=el.getAttribute('data-h');
      return '<div class="ol-item" data-oh="'+esc(h)+'"><span class="on2">'+String(i+1).padStart(2,'0')+'</span>'
        +'<span class="ot">'+(pins[h]?'<b class="op">◆</b> ':'')+esc(h)+'</span></div>'}).join('');
    list.querySelectorAll('.ol-item').forEach(it=>it.addEventListener('click',()=>{
      const h=it.getAttribute('data-oh');
      const sec=[...document.querySelectorAll('#doc .sec')].find(x=>x.getAttribute('data-h')===h);if(!sec)return;
      const cv=$('cvView');smoothTo(cv,cv.scrollTop+sec.getBoundingClientRect().top-cv.getBoundingClientRect().top-28);
      sec.classList.add('flash');setTimeout(()=>sec.classList.remove('flash'),1200);closeRailMobile()}))}
  function showCanvas(){const s=cur();if(!s)return;
    $('home').style.display='none';$('cvView').style.display='';$('topbar').style.display='flex';
    document.querySelector('.main').classList.add('has-top');
    // the anon Log-in/Sign-up bar belongs on the home only — the topbar owns the canvas view
    const ab=$('anonBar');if(ab)ab.style.display='none';
    // brief canvases have no Refine (that's a crystallize/Norrsken step) — hide the top-bar button
    const isBrief=inferMode(s)==='brief';const mb=$('mastBtn');if(mb)mb.style.display=isBrief?'none':'';
    ensureCanvases(s);renderDoc(s.canvas);$('topTitle').textContent=s.title;updateUndo();$('cvView').scrollTop=0;renderTabs();fetchComments(s)}
  // brief canvas → back to the interview to fill gaps
  function reopenBrief(){const s=cur();if(!s)return;s.briefComplete=false;showHome();
    const inp=$('briefReply');if(inp)setTimeout(()=>inp.focus(),60);toast('Answer more — then Compile brief again to update the document')}
  function backToBrief(){showHome();toast('Chat more or tweak the sources, then Crystallize again — your document stays')}
  // Brief ref: paste a reference brief, VÆST reshapes this brief to match its structure & tone (Odin rewrites, content kept)
  function toggleRefPanel(){
    const p=$('refPanel');if(!p)return;
    const open=p.style.display==='none';
    p.style.display=open?'':'none';
    if(open){const t=$('refIn');if(t)setTimeout(()=>t.focus(),40);p.scrollIntoView({behavior:'smooth',block:'nearest'})}}
  // attach a reference file → drop its text into the ref box (doesn't touch the project's own files)
  async function refFilePick(e){
    const f=(e.target.files||[])[0];e.target.value='';if(!f)return;
    const t=$('refIn');if(!t)return;
    toast('Reading '+f.name+'…');
    try{const c=await extractFile(f);
      if(c&&c.trim()){t.value=(t.value.trim()?t.value.trim()+'\n\n':'')+c.trim();toast('Reference loaded from '+f.name)}
      else toast('Couldn’t read '+f.name)}
    catch(err){toast('Couldn’t read '+f.name)}}
  async function alignBrief(){
    if(_busy){toast('Working…');return}
    const s=cur();if(!s)return;
    const ref=($('refIn')&&$('refIn').value.trim())||'';
    if(!ref){toast('Paste a reference brief first');return}
    const md=genMd(); // the live, possibly-edited brief
    if(!md.replace(/[#\s]/g,'')){toast('Nothing to align yet');return}
    pushUndo();toggleRefPanel();setBusy(true);
    $('doc').innerHTML='<div class="gen"><div class="gen-eye"><span class="pulse"></span> Aligning the brief to your reference…</div><div class="gen-body" id="genBody"></div></div>';
    const prompt='# REFERENCE BRIEF (match its shape, section set & order, tone, formatting, density)\n'+ref
      +'\n\n# CURRENT BRIEF (keep every fact, name, number — reshape only)\n'+md;
    const r=raf(full=>{const b=$('genBody');if(b)b.innerHTML=renderMd(full)+'<span class="cursor"></span>'});
    try{
      const out=await streamAPI('briefalign',[{role:'user',content:prompt}],toneSys(),r);r.stop();
      setCanvasMd(s,out);s.updatedAt=Date.now();save();renderDoc(out);
      toast('Brief reshaped to match your reference — Undo if it drifted');
    }catch(e){r.stop();renderDoc(s.canvas);/* streamAPI surfaced the wall/toast */}
    finally{setBusy(false)}}
  function toggleChain(){const s=cur();if(!s)return;
    if(!canRefine()){toast('Auto-Refine is on Pro and above');return}
    s.chain=!s.chain;save();renderChain();
    toast(s.chain?'Refine will run automatically after Crystallize':'Chain off — Refine stays manual')}
  function renderChain(){const s=cur();const b=$('chainBtn');if(b)b.classList.toggle('on',!!(s&&s.chain))}
  function briefChanged(){const s=cur();if(!s)return;s.brief=$('brief').value;clearTimeout(window._bt);window._bt=setTimeout(()=>{s.updatedAt=Date.now();save()},600)}

  /* brief templates — a scaffold that teaches a good brief */
  const TPL={
    rebrand:"Rebrand for [brand] — [what they do].\nAudience: [who exactly]\nWhy now: [what's broken about the current brand]\nFeeling we want: [3 adjectives]\nKeep / kill: [what must stay, what must go]\nDeliverables: [logo · identity · guidelines · …]",
    campaign:"Campaign for [product / launch].\nGoal: [awareness / conversion / launch]\nAudience: [who exactly]\nKey message: [one line]\nChannels: [social · OOH · video · …]\nBudget & timeline: [rough numbers]",
    website:"Website for [brand].\nJob of the site: [convert / present / sell]\nAudience: [who lands here, and why]\nMust-have sections: [pages]\nTone: [voice in 3 words]\nReferences we like: [links + why]",
    deck:"Deck for [pitch / report].\nWho's in the room: [audience]\nThe decision we want: [goal]\nStory in one line: [narrative]\nSlide count: [~N]\nData attached: [files]",
  };
  async function useTpl(k){
    const t=TPL[k];if(!t)return;
    const b=$('brief');
    if(b.value.trim()&&!await uiConfirm('Replace the current brief with the '+k+' template?',{ok:'Replace'}))return;
    b.value=t;briefChanged();b.focus();b.setSelectionRange(0,0);b.scrollTop=0}

  /* ═══ IDEA — Galdr chat ═══ */
  let _ideaBusy=false,_trimWarned=false;
  const IDEA_MAX=40;   // messages kept per session
  const IDEA_CTX=14;   // messages Galdr sees each reply (the memory horizon)
  const IDEA_SUGGEST=[
    'เริ่มระดมไอเดียแคมเปญกับฉันหน่อย',
    'ช่วยหา angle ที่คนอื่นยังไม่เคยเล่น',
    'ถกไอเดียนี้แบบ Creative Director',
  ];
  function startIdea(text){const inp=$('ideaInput');if(!inp)return;inp.value=text;sendIdea()}
  /* ═══ MULTI-CHAT — one session holds several topic chats (beans / location / trend / …) ═══
     Every chat is a Summing source. s.ideas stays as a mirror of the ACTIVE chat so an
     old client that hasn't reloaded yet still reads a sane thread from the cloud blob. */
  function chatsOf(s){
    if(!s.chats||!s.chats.length){
      const t=(s.ideas&&s.ideas.length&&s.ideas[0].c)?String(s.ideas[0].c).replace(/\s+/g,' ').slice(0,36):'';
      s.chats=[{id:uid('ch'),title:t,ideas:s.ideas||[]}];s.chatId=s.chats[0].id}
    if(!s.chatId||!s.chats.some(c=>c.id===s.chatId))s.chatId=s.chats[0].id;
    s.ideas=(s.chats.find(c=>c.id===s.chatId)||s.chats[0]).ideas; // legacy mirror
    return s.chats}
  function curChat(s){const cs=chatsOf(s);return cs.find(c=>c.id===s.chatId)||cs[0]}

  function renderIdeas(){
    const s=cur();const th=$('ideaThread');if(!th)return;
    const ideas=(s&&curChat(s).ideas)||[]; // one thread per item now — curChat mirrors s.ideas
    const box=$('ideaBox');if(box)box.classList.toggle('has-chat',ideas.length>0);
    if(!ideas.length){ th.innerHTML=''; return} // clean empty state — just the input, Claude-style
    const overHorizon=ideas.length>IDEA_CTX;
    th.innerHTML=(overHorizon?'<div class="id-horizon">Galdr replies from the last '+IDEA_CTX+' messages — ✚ Save anything earlier you want kept for Crystallize</div>':'')
      +ideas.map((m,i)=>{const isAI=m.r!=='user';const isLastAI=isAI&&i===ideas.length-1;
      return '<div class="id-m '+(isAI?'ai':'you')+'" data-i="'+i+'"><div class="who">'+(isAI?'VÆST':'YOU')
      +'<span class="id-acts">'
      +(isAI?'<button class="id-use ghost think" onclick="ideaThink('+i+')" title="Think — a sharper, braver push (Mimir)">Think</button>':'')
      +(isAI?'<button class="id-use ghost" onclick="copyIdea('+i+')" title="Copy this reply">⧉</button>':'')
      +(isLastAI?'<button class="id-use ghost" onclick="regenIdea()" title="Regenerate this reply">↻</button>':'')
      +'<button class="id-use" onclick="addSpark('+i+')" title="Save this — auto-filed by topic, feeds Crystallize">✚ Save</button>'
      +'</span></div><div class="tx">'+(isAI?renderMd(m.c):esc(m.c).replace(/\n/g,'<br>'))+'</div></div>'}).join('');
    th.scrollTop=th.scrollHeight;
    // one-time nudge: teach ✚ Save while the thread's building, before early replies drift past
    // the memory horizon. Fires once per user (localStorage), never nags.
    if(!ANON&&ideas.length>=6&&ideas.length<IDEA_CTX){
      try{if(!localStorage.getItem('vaest_save_hint')){localStorage.setItem('vaest_save_hint','1');
        toast('Tip — hit ✚ Save on a reply worth keeping. Saved answers feed Crystallize and never fall off the chat.')}}catch(e){}
    }
}
  function copyIdea(i){const s=cur();const m=s&&curChat(s).ideas[i];if(!m)return;copyToClip(m.c);toast('Copied')}
  // Think on an Idea reply — Mimir pushes it sharper; each push is a one-tap follow-up.
  // Ephemeral (lives in the DOM, cleared on the next render) — it provokes, it doesn't persist.
  async function ideaThink(i){
    if(_ideaBusy||_busy){toast('One moment…');return}
    const s=cur();if(!s)return;const m=curChat(s).ideas[i];if(!m||m.r==='user')return;
    const row=document.querySelector('#ideaThread .id-m[data-i="'+i+'"]');if(!row)return;
    const ex=row.nextElementSibling;if(ex&&ex.classList.contains('id-think')){ex.remove();return} // toggle off
    const btn=row.querySelector('.id-use.think');if(btn){btn.disabled=true;btn.classList.add('busy')}
    const box=document.createElement('div');box.className='id-think';
    box.innerHTML='<div class="it-hd">Think · Mimir</div><div class="it-stream"><span class="cursor"></span></div>';
    row.after(box);const th=$('ideaThread');th.scrollTop=th.scrollHeight;
    const prompt='Idea under discussion:\n'+m.c;
    const r=raf(full=>{const el=box.querySelector('.it-stream');if(el)el.innerHTML=renderMd(full)+'<span class="cursor"></span>'});
    try{
      const out=await streamAPI('sectionthink',[{role:'user',content:prompt}],toneSys(),r);r.stop();
      const pts=parsePoints(out);
      box.innerHTML='<div class="it-hd">Think · Mimir</div>'
        +pts.map(p=>'<div class="it-p"><div class="it-t">'+mdInline(p.t)+'</div>'
          +'<button class="it-go" onclick="exploreIdea(this)">Explore →</button></div>').join('')
        +'<button class="it-x" onclick="this.closest(\'.id-think\').remove()">Close</button>';
      // stash each push's plain text for Explore
      box.querySelectorAll('.it-p').forEach((el,k)=>el.dataset.push=(pts[k].t||'').replace(/\*\*/g,''));
      tasteLog('think',{t:m.c.slice(0,90)});
    }catch(e){box.remove();/* streamAPI already surfaces the wall/toast */}
    finally{if(btn){btn.disabled=false;btn.classList.remove('busy')}}}
  function exploreIdea(el){
    const push=el.closest('.it-p')&&el.closest('.it-p').dataset.push;if(!push)return;
    const box=el.closest('.id-think');if(box)box.remove();
    const inp=$('ideaInput');if(inp){inp.value=push;inp.style.height='';inp.style.height=Math.min(inp.scrollHeight,140)+'px'}
    sendIdea()} // Galdr mirrors the push's language and riffs on the angle
  function regenIdea(){
    if(_ideaBusy||_busy){toast('Working — one moment');return}
    const s=cur();if(!s)return;const ch=curChat(s);if(!ch.ideas.length)return;
    if(ch.ideas[ch.ideas.length-1].r!=='user')ch.ideas.pop(); // drop the reply, keep the question
    save();renderIdeas();streamIdeaReply(s,false)}
  async function sendIdea(){
    if(_ideaBusy){toast('Galdr is replying — one moment');return}
    if(_busy){toast('Working — one moment');return}
    const s=cur();if(!s)return;
    const inp=$('ideaInput');const text=inp.value.trim();if(!text)return;
    if(ANON&&anonLeft()<=0){anonWall();return} // free trial spent — wall before sending
    inp.value='';inp.style.height='';
    const ch=curChat(s);ch.ideas.push({r:'user',c:text,ts:Date.now()});
    if(ANON){anonBump();renderAnonLimit()}
    if(ch.ideas.length>IDEA_MAX){ch.ideas=ch.ideas.slice(-IDEA_MAX);if(!_trimWarned){_trimWarned=true;toast('Long chat — only the last '+IDEA_MAX+' messages are kept. Save key points with ✚')}}
    // auto-title the chat from its first message (and the session, off its first chat)
    if(!ch.title&&ch.ideas.length===1)ch.title=text.replace(/\s+/g,' ').slice(0,36);
    if((s.title==='New'||!s.title)){s.title=text.replace(/\s+/g,' ').slice(0,42);renderRail()}
    renderIdeas();save();
    await streamIdeaReply(s,true)}
  // Fluid streaming: buffer incoming text and reveal it at a smooth, steady pace so the
  // reply flows evenly regardless of network bursts. Reveals to word/newline boundaries so
  // partial markdown never flashes. render(text, streaming) is called each animation frame.
  function smoothStreamer(render){
    let target='',shown=0,raf=0,ended=false,doneCb=null;
    const tick=()=>{
      raf=0;
      if(shown<target.length){
        const gap=target.length-shown;
        let next=shown+Math.max(2,Math.ceil(gap*0.2)); // ease: faster when far behind
        if(next<target.length){const b=Math.max(target.lastIndexOf(' ',next),target.lastIndexOf('\n',next));if(b>shown)next=b+1}
        else next=target.length;
        shown=next;
        render(target.slice(0,shown),shown<target.length||!ended);
      }
      if(shown<target.length)schedule();
      else if(ended){render(target,false);if(doneCb){const c=doneCb;doneCb=null;c()}}
    };
    // rAF pauses in hidden tabs — fall back to a timer so a reply the user isn't watching
    // still lands and SAVES (otherwise closing the tab mid-reveal loses the reply)
    const schedule=()=>{if(raf)return;
      if(document.hidden){raf=setTimeout(()=>{raf=0;tick()},60);return}
      raf=requestAnimationFrame(tick)};
    return {push(t){target=t||'';schedule()},finish(cb){ended=true;doneCb=cb;schedule()}};
  }
  async function streamIdeaReply(s,restoreOnFail){
    _ideaBusy=true;setIdeaSendMode(true);
    const ch=curChat(s); // pin the chat — replies land here even if the user switches tabs mid-stream
    const th=$('ideaThread');
    const live=document.createElement('div');live.className='id-m ai';live.innerHTML='<div class="who">VÆST</div><div class="tx"></div>';
    th.appendChild(live);th.scrollTop=th.scrollHeight;
    // rotating status until the first token lands — masks the time-to-first-token
    let stopWait=waitLines(live.querySelector('.tx'),IDEA_WAIT[personaKey()]),waited=true;
    try{
      const msgs=ch.ideas.slice(-IDEA_CTX).map(m=>({role:m.r==='user'?'user':'assistant',content:m.c}));
      const sr=smoothStreamer((txt,streaming)=>{const tx=live.querySelector('.tx');if(tx){tx.innerHTML=renderMd(txt)+(streaming?'<span class="cursor"></span>':'');th.scrollTop=th.scrollHeight}});
      const out=await streamAPI('idea',msgs,toneSys(),full=>{if(full&&waited){waited=false;stopWait()}sr.push(full)});
      if(waited){waited=false;stopWait()} // empty/instant response — clear the status too
      if(out&&out.trim()){ch.ideas.push({r:'ai',c:out,ts:Date.now()});s.updatedAt=Date.now()}
      sr.push(out||'');
      await new Promise(r=>sr.finish(r)); // let the fluid reveal catch up before swapping in the final message
      save();renderIdeas()}
    catch(e){
      stopWait();live.remove();
      // a failed send must not poison the thread: pull the question back into the input
      const last=ch.ideas[ch.ideas.length-1];
      if(restoreOnFail&&last&&last.r==='user'){ch.ideas.pop();const inp=$('ideaInput');if(inp&&!inp.value)inp.value=last.c;
        save();renderIdeas();toast('Failed — your message is back in the box, try again')}
      else toast('Failed — try again in a moment')}
    finally{_ideaBusy=false;setIdeaSendMode(false);const inp=$('ideaInput');if(inp)inp.focus()}}
  // send button morphs into stop while Galdr streams
  function setIdeaSendMode(busy){const b=$('ideaSend');if(!b)return;
    b.textContent=busy?'■':'↑';b.title=busy?'Stop':'Send';
    b.onclick=busy?function(){stopGen()}:function(){sendIdea()}}
  /* ═══ SPARKS — saved idea replies, auto-filed by topic ═══ */
  // ✚ Save on a chat reply → the MD library (a saved .md you can reuse anywhere)
  function addSpark(i){
    const s=cur();if(!s)return;const m=curChat(s).ideas[i];if(!m)return;
    const text=(m.c||'').trim();if(!text)return;
    library=library||[];
    if(library.some(x=>x.md===text)){toast('Already in your MD library');return}
    const md={id:uid('md'),title:mdTitle(text),md:text,createdAt:Date.now(),fromTitle:s.title||'',projectId:s.projectId||null};
    library.unshift(md);s.updatedAt=Date.now();save();renderRail();
    const p=s.projectId&&projects.find(x=>x.id===s.projectId);
    toast(p?('Saved to MD · /'+p.name):'Saved to MD library');
    // a nicer title if the answer has no heading — infer a topic label
    if(!/^#/.test(text))inferTopic(text).then(top=>{if(top){md.title=top;save();renderMDList()}}).catch(()=>{})}
  /* ═══ MD library — open / download / delete ═══ */
  function openMD(id){
    const md=(library||[]).find(x=>x.id===id);if(!md)return;
    const body='<div class="md-view-hd"><div class="md-view-t" contenteditable="true" spellcheck="false" onblur="renameMD(\''+id+'\',this.innerText)">'+esc(md.title)+'</div>'
      +'<div class="md-view-act"><button onclick="downloadMD2(\''+id+'\')">⤓ .md</button><button onclick="insertMDToCanvas(\''+id+'\')">Use in Crystallize</button></div></div>'
      +'<div class="md-view-body">'+renderMd(md.md)+'</div>';
    uiSheet(body)}
  function renameMD(id,t){const md=(library||[]).find(x=>x.id===id);if(!md)return;const v=(t||'').replace(/\s+/g,' ').trim();if(v&&v!==md.title){md.title=v;save();renderMDList()}}
  function downloadMD2(id){const md=(library||[]).find(x=>x.id===id);if(!md)return;
    const name=md.title.replace(/[^\w฀-๿ -]/g,'').trim().replace(/\s+/g,'_').slice(0,48)||'note';
    dl(new Blob([md.md],{type:'text/markdown;charset=utf-8'}),name+'.md');toast('Downloaded .md')}
  async function deleteMD(id){const md=(library||[]).find(x=>x.id===id);if(!md)return;
    if(!await uiConfirm('Delete “'+esc(md.title)+'” from your MD library?',{ok:'Delete',danger:true}))return;
    library=library.filter(x=>x.id!==id);save();renderRail();toast('Deleted')}
  function openMDCtx(e,id){
    const md=(library||[]).find(x=>x.id===id);
    let h='<button onclick="openMD(\''+id+'\');hideCtx()">Open</button>'
      +'<button onclick="downloadMD2(\''+id+'\');hideCtx()">Download .md</button>';
    if(projects.length||((md&&md.projectId)||null)){h+='<div class="sep"></div><div class="cap">Move to</div>';
      projects.forEach(p=>{if(p.id!==((md&&md.projectId)||null))h+='<button onclick="moveMD(\''+id+'\',\''+p.id+'\');hideCtx()">/'+esc(p.name)+'</button>'});
      if(md&&md.projectId)h+='<button onclick="moveMD(\''+id+'\',null);hideCtx()">General</button>'}
    h+='<div class="sep"></div><button class="danger" onclick="deleteMD(\''+id+'\');hideCtx()">Delete</button>';
    showCtx(e,h)}
  function insertMDToCanvas(id){uiSheetClose();toast('In Crystallize, this MD is available as a source');/* wired fully in M3 */}
  async function inferTopic(text){
    try{const t=await streamAPI('tag',[{role:'user',content:text.slice(0,1200)}],'',null);
      return (t||'').replace(/["'.\n]/g,'').replace(/\s{2,}/g,' ').trim().split(/\s+/).slice(0,3).join(' ')||'General'}
    catch(e){return 'General'}}
  function sparkTopics(){
    const s=cur();const sp=(s&&s.sparks)||[];const map={};
    sp.forEach(x=>{const t=x.topic&&x.topic!=='…'?x.topic:'Filing…';(map[t]=map[t]||[]).push(x)});
    return map}
  function renderSparks(){
    const el=$('sparkTray');if(!el)return;
    const map=sparkTopics();const topics=Object.keys(map);
    if(!topics.length){el.classList.remove('has');el.innerHTML='';return}
    el.classList.add('has');
    el.innerHTML='<div class="sk-hd">Research · <b>'+topics.length+'</b> '+(topics.length===1?'thread':'threads')+'</div>'
      +topics.map(t=>'<div class="sk-grp"><div class="sk-t">'+esc(t)+' <span class="sk-n">'+map[t].length+'</span></div>'
        +map[t].map(sp=>'<div class="sk-chip" title="'+esc(sp.text.slice(0,240))+'"><span class="sk-x">'+esc(sp.text.replace(/[#*>`\n]/g,' ').replace(/\s{2,}/g,' ').trim().slice(0,64))+(sp.text.length>64?'…':'')+'</span><button onclick="removeSpark(\''+sp.id+'\')" title="Remove">✕</button></div>').join('')
        +'</div>').join('')}
  function removeSpark(id){
    const s=cur();if(!s||!s.sparks)return;
    s.sparks=s.sparks.filter(sp=>sp.id!==id);s.updatedAt=Date.now();save();renderSparks()}
  // keep the END of a long text — for conversations, the newest turns matter most
  const capTail=(t,n)=>{t=String(t||'');return t.length>n?'…[earlier messages trimmed]\n'+t.slice(-n):t};
  // the raw idea chat → Crystallize input (when the "Idea chat" source is picked).
  // Selected chats → Crystallize input, one block per chat so Odin sees the topic boundaries.
  // Messages already saved as sparks are skipped so nothing is fed twice.
  function chatsContext(chatIds,excludeTexts){
    const s=cur();if(!s||!chatIds||!chatIds.length)return '';
    const per=Math.max(2500,Math.floor(9000/chatIds.length)); // shared budget — every picked chat gets a voice
    const blocks=chatsOf(s).filter(c=>chatIds.includes(c.id)).map(c=>{
      let ideas=c.ideas;
      if(excludeTexts&&excludeTexts.size)ideas=ideas.filter(m=>!excludeTexts.has((m.c||'').trim()));
      if(!ideas.length)return '';
      return '## Chat: '+(c.title||'Untitled')+'\n'+capTail(ideas.map(m=>(m.r==='user'?'You: ':'VÆST: ')+m.c).join('\n'),per)
    }).filter(Boolean);
    if(!blocks.length)return '';
    return '\n\n# Idea chats (raw conversations — curate: keep what serves the work, drop the rest)\n'+blocks.join('\n\n')}
  // sparks for the chosen topics → Crystallize input
  function sparksContext(topics){
    const s=cur();const sp=(s&&s.sparks)||[];if(!sp.length||!topics||!topics.length)return '';
    const picked=sp.filter(x=>topics.includes(x.topic&&x.topic!=='…'?x.topic:'Filing…'));
    if(!picked.length)return '';
    const byTopic={};picked.forEach(x=>{const t=x.topic||'General';(byTopic[t]=byTopic[t]||[]).push(x.text)});
    return '\n\n# Saved sparks (chosen research to build from)\n'
      +capTxt(Object.keys(byTopic).map(t=>'## '+t+'\n'+byTopic[t].join('\n\n')).join('\n\n'),8000)}
  function toggleRail(){const a=$('app');innerWidth<=760?a.classList.toggle('rail-open'):a.classList.toggle('rail-off')}
  function closeRailMobile(){if(innerWidth<=760)$('app').classList.remove('rail-open')}
  function toggleExp(e){e.stopPropagation();$('expMenu').classList.toggle('show');
    const rv=$('expRevoke');if(rv){const s=cur();rv.style.display=(s&&s.shareId)?'':'none'}}
  async function revokeShare(){
    $('expMenu').classList.remove('show');
    const s=cur();if(!s||!s.shareId)return;
    if(!await uiConfirm('Revoke this share link? Anyone with the URL loses access.',{ok:'Revoke',danger:true}))return;
    try{await ensureAuth();
      const r=await fetch('/api/share?id='+encodeURIComponent(s.shareId),{method:'DELETE',headers:{Authorization:'Bearer '+((AUTH&&AUTH.access_token)||'')}});
      if(!r.ok&&r.status!==204)throw new Error('revoke failed');
      s.shareId=null;_cmtCounts[s.id]=0;_cmtCache[s.id]=[];save();renderRail();renderOwnerComments();toast('Link revoked')}
    catch(e){toast('Couldn’t revoke, try again')}}

  /* ═══ doc render / serialize ═══ */
  function renderDoc(md){
    const lines=String(md||'').split('\n');let title='',secs=[],c=null;
    for(const raw of lines){const line=raw.trim();
      if(/^#\s/.test(line)&&!title){title=line.replace(/^#\s/,'');continue}
      if(/^##\s/.test(line)){c={h:line.replace(/^##\s/,''),body:[]};secs.push(c);continue}
      if(c)c.body.push(raw);else if(line){if(!secs.length||secs[0].h!=='_intro'){secs.unshift({h:'_intro',body:[raw]})}else secs[0].body.push(raw)}}
    if(!secs.length)secs=[{h:'Document',body:lines}];
    const s=cur();const docTitle=title||(s?s.title:'Document');
    const isBrief=!_shareId&&inferMode(s)==='brief'; // brief canvas: edit sections + export, no Think/Refine
    const trail=isBrief
      ? '<div class="flow-trail"><span class="ft done"><span class="ck">✓</span> Brief compiled</span><span class="sep">→</span><span class="ft act next" onclick="reopenBrief()">Ask what’s missing</span><span class="sep">→</span><span class="ft act" onclick="toggleRefPanel()">Match a reference</span><span class="sep">→</span><span class="ft act" onclick="exportPDF()">Export PDF</span></div>'
      : '<div class="flow-trail"><span class="ft done"><span class="ck">✓</span> Crystallized</span><span class="sep">→</span><span class="ft act next" onclick="hintSectionThink()">Think <em>in each section</em></span><span class="sep">→</span><span class="ft act" onclick="runMastering()">Refine</span><span class="sep">→</span><span class="ft act" onclick="toggleExp(event)">Export</span></div>';
    let h='<div class="mast-head"><div class="mh-eye">ORIONS · VÆST'+(isBrief?' · BRIEF':'')+'</div>'
      +'<div class="mh-title" contenteditable="true" spellcheck="false" id="mhTitle">'+esc(docTitle)+'</div>'
      +'<div class="mh-meta"><span class="sl">/</span> '+secs.filter(x=>x.h!=='_intro').length+' sections · '+wordCount(md)+' words'+(_shareId?'':' · fully editable')+'</div>'
      +(_shareId?'':trail)
      +'</div>';
    if(!_shareId&&!isBrief)h+='<div class="doc-idea"><textarea id="docIdeaIn" rows="1" placeholder="Idea for the whole document — a direction or thread to weave in…" onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();canvasIdea()}"></textarea><button class="di-go" onclick="canvasIdea()">Add idea</button></div>';
    // Brief: paste a reference brief whose shape & tone you want, and VÆST reshapes this brief to match — content untouched
    if(!_shareId&&isBrief)h+='<div class="ref-panel" id="refPanel" style="display:none"><div class="rp-eye">Reference — paste a brief whose structure &amp; tone you want to match, or attach one. Your content stays; only the shape changes.</div><textarea id="refIn" rows="4" placeholder="Paste the reference brief here…"></textarea><input type="file" id="refFileInput" accept=".docx,.pdf,.md,.txt,.html" style="display:none" onchange="refFilePick(event)"><div class="rp-foot"><button class="rp-attach" onclick="$(\'refFileInput\').click()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> Attach a file</button><span style="flex:1"></span><button class="rp-x" onclick="toggleRefPanel()">Cancel</button><button class="rp-go" onclick="alignBrief()">Align brief to this <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button></div></div>';
    const secFiles=(s&&s.secFiles)||{},pins=(s&&s.pins)||{};
    let n=0;
    secs.forEach((sec,i)=>{
      const isIntro=sec.h==='_intro';if(!isIntro)n++;
      const pinned=!isIntro&&pins[sec.h];
      const files=(!isIntro&&secFiles[sec.h])||[];
      h+='<div class="sec'+(pinned?' pinned':'')+'" data-i="'+i+'" data-h="'+esc(sec.h)+'">'
        +(isIntro?'':'<div class="sec-top"><div class="sec-eye">'+(pinned?'<span class="pin-on">◆</span> ':'')+String(n).padStart(2,'0')+'</div>'
          +'<div class="sec-tools">'
          +'<button class="st'+(pinned?' on':'')+'" onclick="pinSection(this)" title="Pin as chapter"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M9 4h6l-1 7 3 3v2H7v-2l3-3z"/><path d="M12 16v4"/></svg></button>'
          +'<button class="st" onclick="copySection(this)" title="Copy section"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>'
          +(isBrief?'':'<button class="st" onclick="sectionIdea(this)" title="Add an idea to this section"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 3a6 6 0 0 0-3.8 10.6c.5.4.8 1 .8 1.7V16h6v-.7c0-.7.3-1.3.8-1.7A6 6 0 0 0 12 3z"/><path d="M9.5 20h5"/></svg> Idea</button>'
          +'<button class="st think" onclick="sectionThink(this)" title="Think — a bolder, braver take">Think</button>')
          +'</div></div>'
          +'<div class="sec-h" contenteditable="true" spellcheck="false">'+esc(sec.h)+'</div>')
        +'<div class="sec-c" contenteditable="true" spellcheck="false">'+renderMd(sec.body.join('\n'))+'</div>'
        +(files.length?'<div class="sec-files">'+files.map((f,k)=>'<span class="sec-file"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3v5h5M9 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/></svg>'+esc(f)+' <button onclick="removeSecFile(\''+esc(sec.h).replace(/'/g,"\\'")+'\','+k+')">✕</button></span>').join('')+'</div>':'')
        +'</div>'});
    $('doc').innerHTML=h;
    document.querySelectorAll('#doc .sec').forEach(secEl=>{
      secEl.addEventListener('dragover',e=>{e.preventDefault();e.stopPropagation();secEl.classList.add('drop-tgt')});
      secEl.addEventListener('dragleave',e=>{if(!secEl.contains(e.relatedTarget))secEl.classList.remove('drop-tgt')});
      secEl.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();secEl.classList.remove('drop-tgt');window._dg=0;$('dropzone').classList.remove('on');
        const fs=[...(e.dataTransfer?.files||[])];if(fs.length)dropOnSection(secEl,fs)});
    });
    $('mhTitle').addEventListener('input',()=>{const st=cur();if(st){st.title=$('mhTitle').innerText.trim()||'work';$('topTitle').textContent=st.title;schedulePersist();renderRail()}});
    renderOutline();if(!_shareId)renderOwnerComments()}
  // DOM → inline markdown — keep **bold** *italic* `code` [link](url) on serialize
  function inlineMd(node){let out='';node.childNodes.forEach(n=>{
    if(n.nodeType===3){out+=n.textContent;return}
    if(n.nodeType!==1)return;
    const t=n.tagName;
    if(t==='BR'){out+=' ';return}
    if(t==='STRONG'||t==='B'){const x=inlineMd(n).trim();out+=x?'**'+x+'**':'';return}
    if(t==='EM'||t==='I'){const x=inlineMd(n).trim();out+=x?'*'+x+'*':'';return}
    if(t==='CODE'){out+='`'+n.textContent+'`';return}
    if(t==='IMG'){const src=n.getAttribute('src')||'';out+=src?'!['+(n.getAttribute('alt')||'')+']('+src+')':'';return}
    if(t==='A'){const x=inlineMd(n).trim(),href=n.getAttribute('href')||'';out+=(href&&x)?'['+x+']('+href+')':x;return}
    out+=inlineMd(n)});
    return out}
  function wordCount(md){const t=String(md||'').replace(/[#>*`_\[\]()!-]/g,' ');const th=(t.match(/[\u0E00-\u0E7F]+/g)||[]).join('').length;const en=(t.match(/[A-Za-z0-9']+/g)||[]).length;return en+Math.round(th/4)}
  function genMd(){
    let md='# '+($('mhTitle')?$('mhTitle').innerText.trim():'Document')+'\n\n';
    document.querySelectorAll('#doc .sec').forEach(sec=>{
      const hEl=sec.querySelector('.sec-h');
      if(hEl)md+='## '+hEl.innerText.trim()+'\n\n';
      const c=sec.querySelector('.sec-c');
      c.querySelectorAll(':scope > *').forEach(el=>{
        if(el.tagName==='UL')el.querySelectorAll(':scope > li').forEach(li=>md+='- '+inlineMd(li).trim()+'\n');
        else if(el.tagName==='OL'){let k=1;el.querySelectorAll(':scope > li').forEach(li=>md+=(k++)+'. '+inlineMd(li).trim()+'\n')}
        else if(el.tagName==='TABLE'){
          const rows=[...el.querySelectorAll('tr')];
          rows.forEach((tr,ri)=>{const cells=[...tr.children].map(td=>inlineMd(td).trim());
            md+='| '+cells.join(' | ')+' |\n';
            if(ri===0)md+='|'+cells.map(()=>'---').join('|')+'|\n'})}
        else if(el.tagName==='PRE')md+='```\n'+el.innerText.replace(/\n$/,'')+'\n```\n';
        else if(el.tagName==='BLOCKQUOTE')md+='> '+inlineMd(el).trim()+'\n';
        else if(el.classList.contains('ph'))md+='### '+inlineMd(el).trim()+'\n';
        else if(el.tagName==='HR')md+='---\n';
        else md+=inlineMd(el).trim()+'\n';
        md+='\n'});
    });
    return md.replace(/\n{3,}/g,'\n\n').trim()+'\n'}
  let _pt;function schedulePersist(){clearTimeout(_pt);_pt=setTimeout(()=>{const s=cur();if(s&&$('cvView').style.display!=='none'){setCanvasMd(s,genMd());s.updatedAt=Date.now();save();savedTick()}},700)}
  let _si;function savedTick(){const el=$('saveInd');if(!el)return;el.textContent='Saved ✓';el.classList.add('show');clearTimeout(_si);_si=setTimeout(()=>el.classList.remove('show'),1600)}

  /* ═══ version snapshots ═══ */
  function openSnapshots(){const s=cur();if(!s){toast('No document yet');return}if($('cvView').style.display==='none'){toast('Open a document first');return}$('snapView').classList.add('show');renderSnaps()}
  function closeSnap(){$('snapView').classList.remove('show')}
  async function saveSnapshot(nameArg){const s=cur();if(!s)return;s.snaps=s.snaps||[];
    const dflt='Version '+(s.snaps.length+1);
    let name=nameArg;if(name===undefined){name=await uiPrompt('Name this version',dflt,{ok:'Save'});if(name===null)return}
    name=(name||'').trim()||dflt;
    ensureCanvases(s);s.snaps.unshift({id:uid('v'),name,md:genMd(),cv:s.cvId,ts:Date.now()});if(s.snaps.length>25)s.snaps.length=25;
    s.updatedAt=Date.now();save();renderSnaps();toast('Saved version “'+name+'”')}
  function renderSnaps(){const s=cur();const list=$('snapList');const snaps=(s&&s.snaps)||[];
    if(!snaps.length){list.innerHTML='<div class="snap-empty">No saved versions yet<br>Hit “Save now” to keep a point you like, to roll back to</div>';return}
    list.innerHTML=snaps.map(v=>'<div class="snap-it"><div class="si-b"><div class="si-n">'+esc(v.name)+'</div><div class="si-t">'+fmtAgo(v.ts)+'</div></div>'
      +'<button class="si-r" style="color:var(--dim)" onclick="diffSnap(\''+v.id+'\')">Diff</button>'
      +'<button class="si-r" onclick="restoreSnap(\''+v.id+'\')">Restore</button>'
      +'<button class="si-x" aria-label="Delete" onclick="delSnap(\''+v.id+'\')">✕</button></div>').join('')}

  /* diff — what changed since a saved version */
  function parseSecs(md){
    const out=[];let h='_intro',body=[];
    String(md||'').split('\n').forEach(l=>{
      const m=l.match(/^##\s+(.+)/);
      if(m){out.push({h,body:body.join('\n').trim()});h=m[1].trim();body=[]}
      else if(!/^#\s/.test(l))body.push(l)});
    out.push({h,body:body.join('\n').trim()});
    return out.filter(x=>x.h!=='_intro'||x.body)}
  function wordDiff(a,b){ // LCS on word tokens → html with <del>/<ins>
    const A=a.split(/(\s+)/).filter(x=>x!==''),B=b.split(/(\s+)/).filter(x=>x!=='');
    if(A.length*B.length>4e6)return null; // too big — fall back to plain replace view
    const n=A.length,m=B.length,dp=new Uint16Array((n+1)*(m+1));
    for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)
      dp[i*(m+1)+j]=A[i]===B[j]?dp[(i+1)*(m+1)+j+1]+1:Math.max(dp[(i+1)*(m+1)+j],dp[i*(m+1)+j+1]);
    let i=0,j=0,out='';
    const flushDel=t=>t&&(out+='<del>'+esc(t)+'</del>'),flushIns=t=>t&&(out+='<ins>'+esc(t)+'</ins>');
    let dBuf='',iBuf='';
    while(i<n&&j<m){
      if(A[i]===B[j]){flushDel(dBuf);flushIns(iBuf);dBuf='';iBuf='';out+=esc(A[i]);i++;j++}
      else if(dp[(i+1)*(m+1)+j]>=dp[i*(m+1)+j+1]){dBuf+=A[i++]}
      else{iBuf+=B[j++]}}
    while(i<n)dBuf+=A[i++];while(j<m)iBuf+=B[j++];
    flushDel(dBuf);flushIns(iBuf);
    return out}
  function diffSnap(id){
    const s=cur();if(!s||!s.snaps)return;const v=s.snaps.find(x=>x.id===id);if(!v)return;
    const oldS=parseSecs(v.md),newS=parseSecs(genMd());
    const oldMap=Object.fromEntries(oldS.map(x=>[x.h,x.body]));
    const newMap=Object.fromEntries(newS.map(x=>[x.h,x.body]));
    const keys=[...new Set([...newS.map(x=>x.h),...oldS.map(x=>x.h)])];
    let html='',changes=0;
    keys.forEach(h=>{
      const o=oldMap[h],nw=newMap[h];
      const label=h==='_intro'?'(intro)':h;
      if(o===undefined){changes++;html+='<div class="df-sec"><div class="df-h"><span class="df-tag add">added</span>'+esc(label)+'</div><div class="df-b"><ins>'+esc(nw.slice(0,600))+'</ins></div></div>'}
      else if(nw===undefined){changes++;html+='<div class="df-sec"><div class="df-h"><span class="df-tag del">removed</span>'+esc(label)+'</div><div class="df-b"><del>'+esc(o.slice(0,600))+'</del></div></div>'}
      else if(o!==nw){changes++;
        const d=wordDiff(o,nw);
        html+='<div class="df-sec"><div class="df-h"><span class="df-tag mod">changed</span>'+esc(label)+'</div><div class="df-b">'
          +(d!==null?d:('<del>'+esc(o.slice(0,400))+'</del> <ins>'+esc(nw.slice(0,400))+'</ins>'))+'</div></div>'}});
    $('diffSub').textContent='“'+v.name+'” ('+fmtAgo(v.ts)+') → current · '+(changes||'no')+' section'+(changes===1?'':'s')+' changed';
    $('diffBody').innerHTML=changes?html:'<div class="df-none">Identical — nothing changed since this version.</div>';
    $('diffView').classList.add('show')}
  function closeDiff(){$('diffView').classList.remove('show')}
  function restoreSnap(id){const s=cur();if(!s||!s.snaps)return;const v=s.snaps.find(x=>x.id===id);if(!v)return;
    ensureCanvases(s);
    if(v.cv&&v.cv!==s.cvId){
      if(s.canvases.find(c=>c.id===v.cv))switchCanvas(v.cv); // the version belongs to another canvas — go there first
      else{toast('This version belongs to a canvas that no longer exists');return}}
    pushUndo();setCanvasMd(s,v.md);s.updatedAt=Date.now();renderDoc(v.md);save();closeSnap();toast('Restored to “'+v.name+'” (hit “Undo” if you change your mind)')}
  function delSnap(id){const s=cur();if(!s||!s.snaps)return;s.snaps=s.snaps.filter(x=>x.id!==id);s.updatedAt=Date.now();save();renderSnaps()}

  /* ═══ undo ═══ */
  const undoStack=[];
  function pushUndo(){const s=cur();if(!s)return;ensureCanvases(s);undoStack.push({sid:s.id,cv:s.cvId,md:genMd()});if(undoStack.length>30)undoStack.shift();updateUndo()}
  function undoCanvas(){
    if(_busy){toast('Working…');return}
    for(let i=undoStack.length-1;i>=0;i--){if(undoStack[i].sid===currentSid){
      const u=undoStack.splice(i,1)[0];const s=cur();ensureCanvases(s);
      if(u.cv&&u.cv!==s.cvId){
        if(s.canvases.find(c=>c.id===u.cv))switchCanvas(u.cv); // the change happened on another canvas — undo it there
        else{updateUndo();continue}} // that canvas is gone — skip this entry
      setCanvasMd(s,u.md);renderDoc(u.md);save();updateUndo();toast('Reverted');return}}
    toast('Nothing to undo')}
  function updateUndo(){$('undoBtn').disabled=!undoStack.some(u=>u.sid===currentSid)}

  /* ═══ SUMMING ═══ */
  function projectContext(s){
    if(!s.projectId)return '';
    let out='';
    const p=projects.find(x=>x.id===s.projectId);
    if(p&&p.refs&&p.refs.length){ // reference library — permanent project context
      out+='\n\n# References for project "'+p.name+'" (permanent guidelines/reference — follow these)\n'
        +p.refs.map(r=>'## '+r.n+'\n'+capTxt(r.c,6000)).join('\n\n')}
    const sibs=sessions.filter(x=>x.projectId===s.projectId&&x.id!==s.id&&x.canvas&&x.canvas.trim()).slice(0,3);
    if(sibs.length)out+='\n\n# Context from other work in the same project (background only, don’t re-summarize)\n'
      +sibs.map(x=>'## '+x.title+'\n'+capTxt(x.canvas,1500)).join('\n\n');
    return out}
  // long-text cap with an explicit marker so the model knows it's partial
  const capTxt=(t,n)=>{t=String(t||'');return t.length>n?t.slice(0,n)+'\n…[truncated — file continues]':t};
  // build message content — attach downscaled images as vision blocks
  function msgContent(prompt,imgs){
    imgs=(imgs||[]).filter(f=>f.img).slice(0,6);
    if(!imgs.length)return prompt;
    return [{type:'text',text:prompt},
      ...imgs.map(f=>({type:'image',source:{type:'base64',media_type:'image/jpeg',data:f.img.split(',')[1]}}))]}
  // Crystallize entry — open the source picker when there's a choice to make, else sum the brief directly
  function runSumming(){
    if(ANON){anonWall('Sign up (free) to crystallize your chats into a document');return}
    if(_busy){toast('Working — one moment');return}
    if(_ideaBusy){toast('Galdr is replying — one moment');return}
    const s=cur();if(!s)return;
    s.brief=$('brief').value.trim();
    const liveChats=chatsOf(s).filter(c=>c.ideas.length);
    const srcs=[!!s.brief,s.files.length>0,(s.sparks||[]).length>0,liveChats.length>0].filter(Boolean).length;
    if(!srcs){toast('Chat with Galdr, paste a brief, or attach a file first');return}
    // 2+ sources, itemized ones, OR a re-crystallize over an existing document → show the picker
    // (the picker is also where the "this replaces your document · counts as one" note lives)
    if(srcs>1||s.files.length||(s.sparks||[]).length||liveChats.length>1||(s.canvas&&s.canvas.trim())){openSummingPicker();return}
    doSumming({brief:!!s.brief,files:[],topics:[],chats:liveChats.map(c=>c.id)})}
  function openSummingPicker(){
    const s=cur();if(!s)return;const rows=[];
    chatsOf(s).filter(c=>c.ideas.length).forEach(c=>rows.push('<label class="sum-r"><input type="checkbox" data-k="chat" data-id="'+c.id+'" checked><span class="sum-nm">'+esc(c.title||'Idea chat')+'</span><span class="sum-sub">'+c.ideas.length+' message'+(c.ideas.length>1?'s':'')+' · chat — saved sparks are never double-counted</span></label>'));
    if(s.brief)rows.push('<label class="sum-r"><input type="checkbox" data-k="brief" checked><span class="sum-nm">Brief</span><span class="sum-sub">'+esc(s.brief.replace(/\n/g,' ').slice(0,64))+(s.brief.length>64?'…':'')+'</span></label>');
    s.files.forEach((f,i)=>rows.push('<label class="sum-r"><input type="checkbox" data-k="file" data-i="'+i+'" checked><span class="sum-nm">'+(f.img?'▦ ':'')+esc(f.n)+'</span><span class="sum-sub">'+(f.img?'image':(f.paste?'paste tile':'file'))+'</span></label>'));
    const map=sparkTopics();Object.keys(map).forEach(t=>rows.push('<label class="sum-r on-topic"><input type="checkbox" data-k="topic" data-t="'+esc(t).replace(/"/g,'&quot;')+'" checked><span class="sum-nm">'+esc(t)+'</span><span class="sum-sub">'+map[t].length+' spark'+(map[t].length>1?'s':'')+'</span></label>'));
    const warn=(s.canvas&&s.canvas.trim())
      ? '<div class="sum-warn">You already have a document — crystallizing again <b>replaces it</b> and counts as one document. (Undo brings the old one back.)</div>' : '';
    $('sumSrc').innerHTML=warn+(rows.join('')||'<div style="color:var(--mute);font-size:13px">Nothing to sum yet.</div>');
    $('sumView').classList.add('show')}
  function closeSummingPicker(){$('sumView').classList.remove('show')}
  function doSummingFromPicker(){
    const sel={brief:false,files:[],topics:[],chats:[]};
    document.querySelectorAll('#sumSrc input:checked').forEach(cb=>{const k=cb.dataset.k;
      if(k==='brief')sel.brief=true;else if(k==='file')sel.files.push(+cb.dataset.i);else if(k==='topic')sel.topics.push(cb.dataset.t);else if(k==='chat')sel.chats.push(cb.dataset.id)});
    if(!sel.brief&&!sel.files.length&&!sel.topics.length&&!sel.chats.length){toast('Pick at least one source');return}
    closeSummingPicker();doSumming(sel)}
  // readable source names for the crystallize moment — chat titles, brief, files, spark topics
  function crystallizeSources(sel,imgs){
    const s=cur();if(!s)return [];const out=[];
    (sel.chats||[]).forEach(id=>{const c=chatsOf(s).find(x=>x.id===id);if(c)out.push(c.title||'Idea chat')});
    if(sel.brief&&s.brief)out.push('Brief');
    (sel.files||[]).forEach(i=>{const f=s.files[i];if(f)out.push((f.img?'▦ ':'')+f.n)});
    (sel.topics||[]).forEach(t=>out.push(t));
    return out.map(x=>String(x).slice(0,24))}
  async function doSumming(sel){
    if(_busy){toast('Working — one moment');return}
    const s=cur();if(!s)return;
    setBusy(true);const go=$('sumBtn');go.disabled=true;go.textContent='Crystallizing…';
    const hadCanvas=!!(s.canvas&&s.canvas.trim());if(hadCanvas)pushUndo();
    const chosen=(sel.files||[]).map(i=>s.files[i]).filter(Boolean);
    const imgs=chosen.filter(f=>f.img);
    const src=chosen.filter(f=>!f.img).map((f,i)=>'### File '+(i+1)+': '+f.n+'\n'+capTxt(f.c,20000)).join('\n\n');
    const prompt=((sel.brief&&s.brief)?('# Brief\n'+s.brief+'\n\n'):'')+(src?('# Sources\n'+src):'')
      +(imgs.length?('\n\n# Attached images (shown below): '+imgs.map(f=>f.n).join(', ')+' — read them as real visual references (mood, palette, typography, composition)'):'')
      +sparksContext(sel.topics)
      +chatsContext(sel.chats,new Set(((s.sparks||[]).map(sp=>(sp.text||'').trim()))))
      +projectContext(s);
    // switch to canvas with live streaming
    $('home').style.display='none';$('cvView').style.display='';$('topbar').style.display='flex';
    // the crystallize moment — name each source and let them converge, so the premise is visible:
    // scattered thinking becoming one document. Purely presentational; streaming starts underneath.
    const labels=crystallizeSources(sel,imgs);
    const conv=labels.length>1
      ? '<div class="gen-conv">'+labels.map((l,i)=>'<span class="gc-src" style="animation-delay:'+(i*90)+'ms">'+esc(l)+'</span>').join('<span class="gc-plus">+</span>')+'</div>'
      : '';
    $('doc').innerHTML='<div class="gen"><div class="gen-eye"><span class="pulse"></span> Crystallizing'+(labels.length>1?' '+labels.length+' sources':'')+'…</div>'+conv+'<div class="gen-body" id="genBody"></div></div>';
    try{
      const md=await streamAPI('summing',[{role:'user',content:msgContent(prompt,imgs)}],toneSys(),raf(full=>{const g=$('genBody');if(g){g.innerHTML=renderMd(full)+'<span class="cursor"></span>';softScroll($('cvView'))}}));
      const split=splitCanvases(md);
      if(split){s.canvases=split.map(p=>({id:uid('cv'),t:p.t,md:p.md}));s.cvId=s.canvases[0].id;s.canvas=s.canvases[0].md;
        toast('Split into '+split.length+' canvases — switch with the tabs up top')}
      else{s.canvas=md;s.canvases=[{id:uid('cv'),t:'Main',md:md}];s.cvId=s.canvases[0].id}
      const t=(s.canvas.match(/^#\s+(.+)/m)||[])[1];
      if(t&&(s.title==='New'||!s.title))s.title=t.trim().slice(0,60);
      s.updatedAt=Date.now();save();renderRail();showCanvas();
      if(document.hidden)notifyDone('Crystallize');
      if(s.chain){toast('Summed — Refine starting…');setTimeout(()=>{if(!_busy)runMastering('')},600)}
      else toast('Done — edit anything, or hit “Refine” and let VÆST polish it');
    }catch(e){
      $('doc').innerHTML='<div class="gen"><div class="gen-eye" style="color:var(--cin-d)">Failed — '+esc(e.message)+'</div>'
        +'<div style="display:flex;gap:10px;margin-top:14px"><button class="tb dark" onclick="backToBrief();setTimeout(runSumming,150)">Retry Crystallize</button>'
        +'<button class="tb" onclick="backToBrief()">← Back to brief</button></div><div style="margin-top:10px;font-size:12px;color:var(--mute)">Your brief and files are intact.</div>';
    }finally{setBusy(false);go.disabled=false;go.innerHTML='Crystallize <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>'}}

  /* ═══ SECTION IDEA (Odin writes) + THINK (Mimir proposes, Odin applies) — per section ═══ */
  function sectionIdea(btn){
    const sec=btn.closest('.sec');const ex=sec.querySelector('.sec-idea');
    if(ex){ex.remove();return}
    const box=document.createElement('div');box.className='sec-idea';
    box.innerHTML='<textarea rows="1" placeholder="Your idea for this section — a steer, an angle, a fix…"></textarea><button class="si-go">Add idea</button>';
    sec.querySelector('.sec-c').after(box);
    const ta=box.querySelector('textarea');ta.focus();
    const go=()=>runSectionIdea(sec,ta.value.trim(),box);
    ta.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();go()}});
    ta.addEventListener('input',()=>{ta.style.height='';ta.style.height=Math.min(ta.scrollHeight,140)+'px'});
    box.querySelector('.si-go').addEventListener('click',go)}
  function runSectionIdea(sec,idea,box){
    if(!idea){box.remove();return}
    if(_busy){toast('Working…');return}
    const hEl=sec.querySelector('.sec-h'),c=sec.querySelector('.sec-c');
    const h=hEl?hEl.innerText.trim():'',old=c.innerHTML,curTxt=c.innerText.trim();
    box.remove();pushUndo();setBusy(true);sec.classList.add('flash');
    const prompt='Document: "'+$('mhTitle').innerText.trim()+'"\n\nSection: "'+h+'"\nCurrent text:\n'+curTxt
      +'\n\nWork this idea into the section, keeping what still serves it: '+idea+'\n\nReturn ONLY the revised section body (markdown, no heading).';
    const r=raf(full=>{c.innerHTML=renderMd(full)+'<span class="cursor"></span>'});
    streamAPI('improve',[{role:'user',content:prompt}],toneSys(),r)
      .then(text=>{r.stop();c.innerHTML=renderMd(text);sec.classList.add('flash');setTimeout(()=>sec.classList.remove('flash'),1200);schedulePersist();toast('Idea woven into “'+h+'”')})
      .catch(e=>{r.stop();c.innerHTML=old;toast('Failed: '+e.message)})
      .finally(()=>{setBusy(false);sec.classList.remove('flash')})}
  // flow-trail "Think" → there is no global Think anymore; light the per-section buttons up instead
  function hintSectionThink(){
    const btns=document.querySelectorAll('#doc .sec-tools .st.think');
    if(!btns.length){toast('No sections yet');return}
    btns.forEach(b=>{b.classList.add('hint');setTimeout(()=>b.classList.remove('hint'),2400)});
    const first=btns[0].closest('.sec');
    if(first){const cv=$('cvView');smoothTo(cv,cv.scrollTop+first.getBoundingClientRect().top-cv.getBoundingClientRect().top-80)}
    toast('Think lives in each section now — pick the one to push')}
  /* Think per section — Mimir proposes pushes for this one section; nothing changes until
     the user approves a point, and then Odin rewrites only this section. Propose and write
     stay separate models on purpose: the critique comes from outside the document's voice. */
  function sectionThink(btn){
    if(_busy){toast('Working…');return}
    const sec=btn.closest('.sec'),hEl=sec.querySelector('.sec-h'),c=sec.querySelector('.sec-c');
    const h=hEl?hEl.innerText.trim():'',curTxt=c.innerText.trim();
    const ex=sec.querySelector('.sec-think');if(ex){ex.remove();return}
    setBusy(true);btn.disabled=true;btn.classList.add('busy');
    const box=document.createElement('div');box.className='sec-think';
    box.innerHTML='<div class="sth-hd">Think — pushing this section…</div><div class="sth-stream"><span class="cursor"></span></div>';
    c.after(box);
    const prompt='Document: "'+$('mhTitle').innerText.trim()+'"\n\nSection: "'+h+'"\nSection body:\n'+curTxt;
    const r=raf(full=>{const m=box.querySelector('.sth-stream');if(m)m.innerHTML=renderMd(full)+'<span class="cursor"></span>'});
    streamAPI('sectionthink',[{role:'user',content:prompt}],toneSys(),r)
      .then(text=>{r.stop();renderSectionThink(sec,box,h,parsePoints(text))})
      .catch(e=>{box.remove();toast('Think failed: '+e.message)})
      .finally(()=>{setBusy(false);btn.disabled=false;btn.classList.remove('busy')})}
  function renderSectionThink(sec,box,h,points){
    box.__pts=points;box.__done={};box.__h=h;
    paintSectionThink(box)}
  function paintSectionThink(box){
    const pts=box.__pts,done=box.__done;
    const remain=pts.filter((p,i)=>!done[i]).length;
    let html='<div class="sth-hd">Think · this section <span class="sth-count">'+(remain?remain+' pushes':'all done')+'</span></div>';
    pts.forEach((p,i)=>{const st=done[i];
      html+='<div class="sth-i'+(st?' done':'')+'"><div class="sth-t">'+mdInline(p.t)+'</div>'
        +(st==='fixed'?'<div class="mi-tag ok">✓ Applied</div>'
          :st==='skip'?'<div class="mi-tag skip">— Skipped</div>'
          :'<div class="mi-act"><button class="mi-ap" onclick="applySectionPush(this,'+i+')">Approve</button><button class="mi-sk" onclick="skipSectionPush(this,'+i+')">Skip</button></div>')
        +'</div>'});
    html+='<div class="sth-foot"><button class="mi-close" onclick="this.closest(\'.sec-think\').remove()">Close</button></div>';
    box.innerHTML=html}
  function skipSectionPush(el,i){
    const box=el.closest('.sec-think');if(!box)return;
    box.__done[i]='skip';tasteLog('skipped',box.__pts[i]);paintSectionThink(box)}
  function applySectionPush(el,i){
    if(_busy){toast('Working…');return}
    const box=el.closest('.sec-think'),sec=el.closest('.sec');if(!box||!sec)return;
    const c=sec.querySelector('.sec-c'),point=box.__pts[i],h=box.__h;
    const old=c.innerHTML,curTxt=c.innerText.trim();
    pushUndo();setBusy(true);
    const act=box.querySelector('.sth-i:not(.done) .mi-act');if(act)act.innerHTML='<span class="mi-run"><span class="pulse"></span> Applying…</span>';
    const prompt='Document: "'+$('mhTitle').innerText.trim()+'"\n\nSection: "'+h+'"\nCurrent text:\n'+curTxt
      +'\n\nWork this push into the section, keeping what still serves it: '+point.t
      +(point.q?(' (it concerns this part: "'+point.q+'")'):'')
      +'\n\nReturn ONLY the revised section body (markdown, no heading).';
    const r=raf(full=>{c.innerHTML=renderMd(full)+'<span class="cursor"></span>'});
    streamAPI('improve',[{role:'user',content:prompt}],toneSys(),r)
      .then(text=>{r.stop();c.innerHTML=renderMd(text);sec.classList.add('flash');setTimeout(()=>sec.classList.remove('flash'),1200);
        box.__done[i]='fixed';tasteLog('approved',point);schedulePersist();paintSectionThink(box)})
      .catch(e=>{r.stop();c.innerHTML=old;paintSectionThink(box);toast('Failed: '+e.message)})
      .finally(()=>{setBusy(false)})}
  // whole-document idea — weave a direction across the canvas (Odin)
  async function canvasIdea(){
    if(_busy){toast('Working…');return}
    const s=cur();if(!s)return;
    const ta=$('docIdeaIn');const idea=ta?ta.value.trim():'';
    if(!idea){toast('Type an idea first');if(ta)ta.focus();return}
    if(ta){ta.value='';ta.style.height=''}
    pushUndo();setBusy(true);
    const bar=document.querySelector('.doc-idea');if(bar)bar.classList.add('working');
    const prompt='Full document:\n\n'+genMd()+'\n\nWork this idea into the document where it fits, keeping the structure and everything that still serves the work:\n'+idea+'\n\nReturn the FULL markdown document.';
    try{const md=await streamAPI('apply',[{role:'user',content:prompt}],toneSys());
      applyMd(md);toast('Idea woven through the document')}
    catch(e){toast('Failed: '+e.message)}
    finally{setBusy(false);const b=document.querySelector('.doc-idea');if(b)b.classList.remove('working')}}

  /* ═══ MASTERING (Norrsken · final recheck · approve per item) ═══ */
  let _mast=null;
  const LENS={'':'',tone:'Focus only on "tone and feel" — is it consistent, does it fit the audience?',
    flow:'Focus only on "coherence and order" — do the parts flow, is anything self-contradicting?',
    complete:'Focus only on "completeness" — any important point missing, any section too thin?'};
  const LENS_LBL={'':'All',tone:'Tone',flow:'Coherence',complete:'Completeness'};
  // what the canvas was built FROM — so Refine can catch what the document *dropped*,
  // not just what it says. Compact digest: titles and names only, never full content.
  function sourcesDigest(){
    const s=cur();if(!s)return '';
    const bits=[];
    chatsOf(s).filter(c=>c.ideas.length).forEach(c=>bits.push('chat “'+(c.title||'untitled')+'” · '+c.ideas.length+' messages'));
    if(s.brief&&s.brief.trim())bits.push('brief: '+s.brief.replace(/\s+/g,' ').slice(0,140));
    (s.files||[]).forEach(f=>bits.push((f.img?'image: ':'file: ')+f.n));
    const tp=sparkTopics();Object.keys(tp).forEach(t=>bits.push('saved sparks · '+t+' ('+tp[t].length+')'));
    if(!bits.length)return '';
    return capTxt('This document was crystallized from these sources:\n- '+bits.join('\n- ')
      +'\nIf something a source clearly carries never made it into the document, flag it as one of your points.',1500)}
  function mastHead(lens){
    return '<div class="mast-hd"><div class="mast-ttl">Refine · '+LENS_LBL[lens||'']+'</div><div class="mast-sub">Make it cleaner — catch contradictions, repetition and broken logic. Approve to fix.</div></div>'}
  function mastHeader(){return mastHead(_mast&&_mast.lens)}
  function runMastering(lens){
    if(!canRefine()){toast('Refine is on Pro and above — upgrade to unlock the apex audit');return}
    lens=lens||'';const btn=$('mastBtn');
    if(_busy){toast('Working…');return}
    const s=cur();if(!s||!s.canvas.trim()){toast('No document yet');return}
    setBusy(true);if(btn)btn.disabled=true;
    const old=$('doc').querySelector('.mast');if(old)old.remove();unmarkFlaws();
    const box=document.createElement('div');box.className='mast';
    box.innerHTML='<div class="mast-top">'+mastHead(lens)+'<span class="mast-count" id="mastWait"></span></div><div class="mi"><span class="mi-dot"></span><div class="mi-b"><div class="mi-t" id="mastStream"><span class="cursor"></span></div></div></div>';
    $('doc').prepend(box);$('cvView').scrollTop=0;
    // persona-flavored waiting lines — the model is genuinely thinking, show it
    const waits=PERSONA_WAIT[personaKey()];let wi=0;
    const wEl=$('mastWait');wEl.textContent=waits[0];
    const wt=setInterval(()=>{wi++;const el=$('mastWait');if(el)el.textContent=waits[wi%waits.length]},2600);
    const prompt='Here is the full document:\n\n'+genMd();
    // toneSys carries persona + project voice + taste memory (every approve/skip so far) —
    // Refine judged blind to all of it before this. The sources digest closes the loop:
    // the final gate knows what the work was built from, not just what it became.
    const sys=[toneSys(),(LENS[lens]||''),sourcesDigest()].filter(Boolean).join('\n\n');
    streamAPI('mastering',[{role:'user',content:prompt}],sys,
        raf(full=>{const m=$('mastStream');if(m)m.innerHTML=renderMd(full)+'<span class="cursor"></span>'}))
      .then(text=>{_mast={points:parsePoints(text),done:{},lens:lens,kind:'mastering'};renderMast();if(document.hidden)notifyDone('Refine')})
      .catch(e=>{box.remove();toast('Refine failed: '+e.message)})
      .finally(()=>{clearInterval(wt);setBusy(false);if(btn)btn.disabled=false})}
  function parsePoints(t){
    const pts=String(t).split('\n').map(l=>l.trim()).filter(l=>/^[-*•]\s+/.test(l)).map(l=>l.replace(/^[-*•]\s+/,''));
    const raw=pts.length?pts:[String(t).trim()];
    return raw.map(p=>{const m=p.match(/\{\{(.+?)\}\}/);
      return {t:p.replace(/\s*\{\{.+?\}\}\s*/,' ').replace(/\s{2,}/g,' ').trim(),q:m?m[1].trim():null}})}
  function renderMast(){
    const old=$('doc').querySelector('.mast');if(old)old.remove();
    if(!_mast)return;
    const remain=_mast.points.filter((p,i)=>!_mast.done[i]).length;
    let h='<div class="mast-top">'+mastHeader()+'<span class="mast-count">'+(remain?remain+' points':'all done')+'</span></div>';
    _mast.points.forEach((p,i)=>{const st=_mast.done[i];
      h+='<div class="mi'+(st?' done':'')+(st==='fixed'?' fixed':'')+'" data-i="'+i+'"><span class="mi-dot f'+(i%3)+'"></span><div class="mi-b"><div class="mi-t'+(p.q&&!st?' hasq':'')+'"'+(p.q&&!st?' onclick="focusFlaw('+i+')" title="Jump to the highlighted spot"':'')+'>'+mdInline(p.t)+'</div>';
      if(st==='fixed')h+='<div class="mi-tag ok">✓ Applied'+((_mast.chg&&_mast.chg[i]&&_mast.chg[i].length)?' <button class="mi-peek" onclick="peekChanges('+i+')">View changes</button>':'')+'</div>';
      else if(st==='skip')h+='<div class="mi-tag skip">— Skipped</div>';
      else h+='<div class="mi-act"><button class="mi-ap" onclick="applyPoint('+i+')">Approve</button><button class="mi-sk" onclick="skipPoint('+i+')">Skip</button></div>';
      h+='</div></div>'});
    h+='<div class="mast-foot">'+(remain>1?'<button class="mi-all" onclick="applyAll()">Approve all ('+remain+')</button>':'')
      +'<button class="mi-close" onclick="closeMast()">Close</button></div>';
    const box=document.createElement('div');box.className='mast';box.innerHTML=h;$('doc').prepend(box);
    highlightFlaws()}
  /* flaw overlay — anchor each pending point's {{quote}} in the canvas with a colored mark */
  function unmarkFlaws(){document.querySelectorAll('#doc mark.flaw').forEach(m=>{m.replaceWith(document.createTextNode(m.textContent));})}
  function highlightFlaws(){
    unmarkFlaws();if(!_mast)return;
    _mast.points.forEach((p,i)=>{
      if(!p.q||_mast.done[i])return;
      const walker=document.createTreeWalker($('doc'),NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement.closest('.sec-c')&&!n.parentElement.closest('.mast')?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT});
      let node;while((node=walker.nextNode())){
        const idx=node.textContent.indexOf(p.q);
        if(idx>=0){
          const r=document.createRange();r.setStart(node,idx);r.setEnd(node,idx+p.q.length);
          const mk=document.createElement('mark');mk.className='flaw f'+(i%3);mk.setAttribute('data-fi',i);
          try{r.surroundContents(mk)}catch(e){}
          break}}})}
  function focusFlaw(i){
    const mk=document.querySelector('#doc mark.flaw[data-fi="'+i+'"]');
    if(!mk){toast('Spot not found in the current text');return}
    const cv=$('cvView');const top=cv.scrollTop+mk.getBoundingClientRect().top-cv.getBoundingClientRect().top-cv.clientHeight/2;
    smoothTo(cv,top);mk.classList.add('pulse');setTimeout(()=>mk.classList.remove('pulse'),1400)}
  // taste memory — every approve/skip teaches the system what this team wants
  function tasteLog(verdict,point){
    if(!point)return;const s=cur();if(!s||s.private)return;
    const tgt=(s.projectId&&projects.find(x=>x.id===s.projectId))||s;
    tgt.taste=(tgt.taste||[]).concat({v:verdict,t:String(point.t||'').replace(/\*\*/g,'').slice(0,90),k:(_mast&&_mast.kind)||'mastering',ts:Date.now()}).slice(-40);
    save()}
  function closeMast(){_mast=null;unmarkFlaws();const b=$('doc').querySelector('.mast');if(b)b.remove()}
  function skipPoint(i){if(_mast){_mast.done[i]='skip';tasteLog('skipped',_mast.points[i]);renderMast()}}
  function snapshot(){const b={};document.querySelectorAll('#doc .sec').forEach(s=>{const hh=s.querySelector('.sec-h');b[hh?hh.innerText.trim():'_']=s.querySelector('.sec-c').innerText.trim()});return b}
  function flashChanged(before){const chg=[];document.querySelectorAll('#doc .sec').forEach(s=>{const hh=s.querySelector('.sec-h');const k=hh?hh.innerText.trim():'_';
    if(before[k]===undefined||before[k]!==s.querySelector('.sec-c').innerText.trim()){chg.push(k);s.classList.add('flash');setTimeout(()=>s.classList.remove('flash'),1300)}});return chg}
  function peekChanges(i){
    const keys=(_mast&&_mast.chg&&_mast.chg[i])||[];if(!keys.length){toast('This one didn’t touch the content');return}
    let first=null;
    document.querySelectorAll('#doc .sec').forEach(s=>{const hh=s.querySelector('.sec-h');const k=hh?hh.innerText.trim():'_';
      if(keys.includes(k)){if(!first)first=s;s.classList.add('flash');setTimeout(()=>s.classList.remove('flash'),1300)}});
    if(first){const cv=$('cvView');const top=cv.scrollTop+first.getBoundingClientRect().top-cv.getBoundingClientRect().top-(cv.clientHeight-Math.min(first.offsetHeight,cv.clientHeight))/2;
      smoothTo(cv,top)}}
  function applyMd(md,marks){const s=cur();setCanvasMd(s,md);s.updatedAt=Date.now();renderDoc(md);save()}
  function applyPoint(i){
    if(_busy){toast('Working…');return}
    if(!_mast)return;const point=_mast.points[i];
    pushUndo();setBusy(true);unmarkFlaws();
    const it=$('doc').querySelector('.mi[data-i="'+i+'"] .mi-act');if(it)it.innerHTML='<span class="mi-run"><span class="pulse"></span> Applying…</span>';
    const before=snapshot();
    const prompt='Original document:\n\n'+genMd()+'\n\nApply just this one suggestion: '+point.t+(point.q?(' (it concerns this part: "'+point.q+'")'):'')+'\n\nReturn the full markdown (keep the "# title" and "## " structure; adjust only what’s relevant).';
    streamAPI('apply',[{role:'user',content:prompt}],toneSys())
      .then(md=>{applyMd(md);_mast.done[i]='fixed';tasteLog('approved',point);_mast.chg=_mast.chg||{};_mast.chg[i]=flashChanged(before);renderMast();toast('Applied')})
      .catch(e=>{renderMast();toast('Failed: '+e.message)})
      .finally(()=>{setBusy(false)})}
  function applyAll(){
    if(_busy){toast('Working…');return}
    if(!_mast)return;const rem=_mast.points.map((p,i)=>({p,i})).filter(x=>!_mast.done[x.i]);if(!rem.length)return;
    pushUndo();setBusy(true);unmarkFlaws();
    const foot=$('doc').querySelector('.mast-foot');if(foot)foot.innerHTML='<span class="mi-run"><span class="pulse"></span> Applying across the whole document…</span>';
    const before=snapshot();
    const prompt='Original document:\n\n'+genMd()+'\n\nApply all of these suggestions and make the whole document consistent:\n'+rem.map((x,k)=>(k+1)+'. '+x.p.t+(x.p.q?(' (concerns: "'+x.p.q+'")'):'')).join('\n')+'\n\nReturn the full markdown (keep the "# title" and "## " structure).';
    streamAPI('apply',[{role:'user',content:prompt}],toneSys())
      .then(md=>{applyMd(md);const chg=flashChanged(before);_mast.chg=_mast.chg||{};rem.forEach(x=>{_mast.done[x.i]='fixed';tasteLog('approved',x.p);_mast.chg[x.i]=chg});renderMast();toast('All applied — the whole document is consistent')})
      .catch(e=>{renderMast();toast('Failed: '+e.message)})
      .finally(()=>{setBusy(false)})}

  /* ═══ EXPORT ═══ */
  function docFilename(){return ($('mhTitle')?$('mhTitle').innerText.trim():'document').replace(/[^\w฀-๿ -]/g,'').trim().replace(/\s+/g,'_').slice(0,48)||'document'}
  function buildDocHTML(forPrint){
    const title=$('mhTitle')?$('mhTitle').innerText.trim():'Document';
    let body='';let n=0;
    document.querySelectorAll('#doc .sec').forEach(sec=>{
      const hEl=sec.querySelector('.sec-h');
      body+='<section>'+(hEl?('<div class="eye">'+String(++n).padStart(2,'0')+'</div><h2>'+esc(hEl.innerText.trim())+'</h2>'):'')
        +'<div class="c">'+sec.querySelector('.sec-c').innerHTML+'</div></section>'});
    const CSS=(forPrint?'@page{size:A4 portrait;margin:0}':'')
      +'*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}html,body{margin:0;padding:0}'
      +'body{font-family:"Newsreader","IBM Plex Sans Thai Looped",Georgia,serif;color:#26251f;background:#fdfdf9;line-height:1.85;font-size:'+(forPrint?'11.5pt':'17px')+'}'
      +'.page{padding:'+(forPrint?'22mm 20mm 18mm':'clamp(30px,7vw,80px) clamp(22px,7vw,80px)')+';max-width:'+(forPrint?'none':'760px')+';margin:0 auto}'
      +'.cover{border-bottom:2px solid #0e0e0e;padding-bottom:18px;margin-bottom:6px'+(forPrint?';display:flex;flex-direction:column;justify-content:flex-end;min-height:72vh;page-break-after:always':'')+'}'
      +'.cover .eyebrow{font-family:"IBM Plex Mono",monospace;font-size:'+(forPrint?'9pt':'11px')+';letter-spacing:.24em;text-transform:uppercase;color:#8e3a24;font-weight:600}'
      +'.cover h1{font-family:"Newsreader",Georgia,serif;font-style:italic;font-weight:500;font-size:'+(forPrint?'32pt':'clamp(34px,6vw,54px)')+';line-height:1.05;margin:12px 0 0;letter-spacing:-.01em}'
      +'.cover .rule{width:52px;height:4px;background:#d5542c;margin:18px 0 10px}'
      +'.cover .meta{font-family:"IBM Plex Mono",monospace;font-size:'+(forPrint?'8.5pt':'11px')+';color:#5a5a55;letter-spacing:.05em}'
      +'section{margin:'+(forPrint?'20px 0':'34px 0')+';page-break-inside:avoid}'
      +'.eye{font-family:"IBM Plex Mono",monospace;font-size:'+(forPrint?'8.5pt':'10px')+';letter-spacing:.2em;color:#8e8e88;font-weight:600}'
      +'h2{font-family:"Inter","IBM Plex Sans Thai Looped",sans-serif;font-size:'+(forPrint?'15pt':'23px')+';margin:6px 0 12px;letter-spacing:-.025em;font-weight:800;color:#0e0e0e}'
      +'.c p{margin:0 0 12px}.c strong{font-weight:600;color:#0e0e0e}'
      +'.c .ph{font-family:"Inter","IBM Plex Sans Thai Looped",sans-serif;font-weight:700;color:#0e0e0e;margin:16px 0 7px;font-size:'+(forPrint?'11.5pt':'15.5px')+'}'
      +'.c ul{margin:10px 0;padding-left:22px}.c ul li{margin:6px 0}.c ul li::marker{color:#8e8e88}'
      +'.c ol{margin:10px 0;padding-left:24px}.c ol li{margin:6px 0}.c ol li::marker{color:#8e3a24}'
      +'.c blockquote{border-left:3px solid #d5542c;padding-left:15px;margin:13px 0;color:#5a5a55;font-style:italic}'
      +'.c code{font-family:"IBM Plex Mono",monospace;font-size:.82em;background:rgba(27,24,21,.055);padding:2px 6px;border-radius:5px}'
      +'.c pre{background:rgba(27,24,21,.045);border:1px solid rgba(27,24,21,.09);border-radius:9px;padding:13px 15px;overflow-x:auto}'
      +'.c a{color:#8e3a24}'
      +'table{width:100%;border-collapse:collapse;margin:14px 0;font-size:'+(forPrint?'10pt':'15px')+'}'
      +'th{font-family:"Inter","IBM Plex Sans Thai Looped",sans-serif;text-align:left;font-weight:650;border-bottom:1.5px solid rgba(27,24,21,.16);padding:8px 16px 8px 0;font-size:'+(forPrint?'9pt':'13.5px')+'}'
      +'td{border-bottom:1px solid rgba(27,24,21,.09);padding:9px 16px 9px 0;vertical-align:top}'
      +'.foot{margin-top:34px;padding-top:12px;border-top:1px solid rgba(27,24,21,.12);font-family:"IBM Plex Mono",monospace;font-size:'+(forPrint?'8pt':'10.5px')+';color:#8e8e88;letter-spacing:.06em}';
    return '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title>'
      +'<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Thai+Looped:wght@400;500;600;700&family=Inter:wght@700;800&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,500&family=Noto+Serif+Thai:wght@400;500;600&display=swap" rel="stylesheet">'
      +'<style>'+CSS+'</style></head><body><div class="page">'
      +'<div class="cover"><div class="eyebrow">ORIONS.Agency · VÆST</div><h1>'+esc(title)+'</h1><div class="rule"></div><div class="meta">Summed &amp; refined by VÆST — Aesthetic Intelligence</div></div>'
      +body+'<div class="foot">Generated by VÆST 1.3 · ORIONS.Agency</div></div></body></html>'}
  function dl(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1500)}
  function downloadMD(){$('expMenu').classList.remove('show');dl(new Blob([genMd()],{type:'text/markdown;charset=utf-8'}),docFilename()+'.md');toast('Downloaded .md')}
  function downloadDOC(){$('expMenu').classList.remove('show');
    const html='<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">'
      +buildDocHTML(false).replace(/^<!doctype html><html lang="th">/i,'').replace(/<\/html>$/i,'')+'</html>';
    dl(new Blob(['﻿'+html],{type:'application/msword'}),docFilename()+'.doc');toast('Downloaded .doc (opens in Word)')}
  // read-only share — stores only the chosen title+canvas, no account data
  async function shareDoc(){
    $('expMenu').classList.remove('show');
    const s=cur();if(!s||!s.canvas.trim()){toast('No document to share yet');return}
    if(!s.shareId)s.shareId='sh'+Math.random().toString(36).slice(2,8)+Date.now().toString(36).slice(-4);
    toast('Creating share link…');
    try{await ensureAuth();
      const r=await fetch('/api/share',{method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+((AUTH&&AUTH.access_token)||'')},
        body:JSON.stringify({action:'create',id:s.shareId,title:$('mhTitle')?$('mhTitle').innerText.trim():s.title,canvas:genMd()})});
      if(!r.ok)throw new Error('share failed');
      save();const link=location.origin+'/app?s='+s.shareId;copyToClip(link);toast('Read-only link copied — paste to share')}
    catch(e){toast('Couldn’t create the link, try again')}}
  function exportPDF(){$('expMenu').classList.remove('show');
    const w=window.open('','_blank');
    if(!w){toast('The browser blocked the popup — allow it and try again');return}
    w.document.write(buildDocHTML(true));w.document.close();w.focus();setTimeout(()=>{try{w.print()}catch(e){}},500);
    toast('Opened the A4 print view — choose “Save as PDF”')}

  async function findReplace(){
    if($('cvView').style.display==='none'){toast('Open a document first');return}
    const find=await uiPrompt('Find in the document','',{ok:'Next',placeholder:'text to find'});
    if(!find)return;
    const md=genMd();if(md.indexOf(find)<0){toast('Not found');return}
    const rep=await uiPrompt('Replace “'+find.slice(0,30)+'” with','',{ok:'Replace all',placeholder:'replacement (blank = delete)'});
    if(rep===null)return;
    const n=md.split(find).length-1;
    pushUndo();applyMd(md.split(find).join(rep));
    toast('Replaced '+n+' occurrence'+(n>1?'s':''))}

  /* ═══ PRESENTATION — deck builder, rendered in VÆST CI ═══ */
  let _presOrient='landscape';
  function openPresent(){$('expMenu').classList.remove('show');
    const s=cur();if(!s||!s.canvas.trim()){toast('No document yet');return}
    $('presView').classList.add('show')}
  function closePresent(){$('presView').classList.remove('show')}
  function setPresOrient(o){_presOrient=o;document.querySelectorAll('#presOrient button').forEach(b=>b.classList.toggle('on',b.getAttribute('data-o')===o))}
  async function runPresent(){
    if(_busy){toast('Working…');return}
    const s=cur();if(!s||!s.canvas.trim())return;
    const btn=$('presGo');btn.disabled=true;btn.textContent='Building the deck…';setBusy(true);
    try{
      const raw=await streamAPI('present',[{role:'user',content:'Turn this into a presentation:\n\n'+genMd()}],toneSys());
      let slides;try{slides=JSON.parse(raw.replace(/^```json\s*|\s*```$/g,'').trim())}catch(e){
        const m=raw.match(/\[[\s\S]*\]/);slides=m?JSON.parse(m[0]):null}
      if(!Array.isArray(slides)||!slides.length)throw new Error('couldn’t shape the slides');
      const w=window.open('','_blank');
      if(!w){toast('Allow popups, then try again');return}
      w.document.write(buildDeckHTML(slides,$('mhTitle')?$('mhTitle').innerText.trim():s.title));w.document.close();w.focus();
      closePresent();toast('Deck ready — use ⌘P → Save as PDF ('+_presOrient+')')}
    catch(e){toast('Presentation failed: '+e.message)}
    finally{btn.disabled=false;btn.textContent='Build presentation';setBusy(false)}}
  function buildDeckHTML(slides,title){
    const land=_presOrient==='landscape';
    const page=land?'297mm 167mm':'210mm 297mm'; // 16:9-ish landscape / A4 portrait
    const esc2=t=>String(t==null?'':t).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    const slideHTML=s=>{
      if(s.kind==='cover')return '<section class="sl cover"><div class="sl-eye">ORIONS · VÆST</div><h1>'+esc2(s.title)+'</h1>'+(s.subtitle?'<p class="sub">'+esc2(s.subtitle)+'</p>':'')+'<div class="rule"></div></section>';
      if(s.kind==='quote')return '<section class="sl quote"><blockquote>“'+esc2(s.quote)+'”</blockquote>'+(s.by?'<cite>— '+esc2(s.by)+'</cite>':'')+'</section>';
      if(s.kind==='close')return '<section class="sl close"><div class="rule"></div><h2>'+esc2(s.title)+'</h2>'+(s.subtitle?'<p class="sub">'+esc2(s.subtitle)+'</p>':'')+'<div class="sl-foot">VÆST · ORIONS.Agency</div></section>';
      return '<section class="sl"><div class="sl-eye">'+esc2(s.title)+'</div><h2>'+esc2(s.title)+'</h2><ul>'+((s.bullets||[]).map(b=>'<li>'+esc2(b)+'</li>').join(''))+'</ul>'+(s.note?'<p class="note">'+esc2(s.note)+'</p>':'')+'</section>';
    };
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>'+esc2(title)+' — VÆST</title>'
      +'<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Newsreader:ital,opsz,wght@1,6..72,500&family=IBM+Plex+Mono:wght@400;500&family=Noto+Serif+Thai:wght@400;600;700&family=IBM+Plex+Sans+Thai+Looped:wght@400;500;600&display=swap" rel="stylesheet">'
      +'<style>'
      +'@page{size:'+page+';margin:0}*{box-sizing:border-box;margin:0;padding:0}'
      +'body{font-family:Inter,"IBM Plex Sans Thai Looped",sans-serif;background:#222}'
      +'.sl{position:relative;width:'+(land?'297mm':'210mm')+';height:'+(land?'167mm':'297mm')+';padding:'+(land?'20mm 24mm':'26mm 22mm')+';background:#050506;color:#f2f1ee;overflow:hidden;page-break-after:always;display:flex;flex-direction:column;justify-content:center}'
      +'.sl::before{content:"";position:absolute;top:0;bottom:0;right:0;width:34%;pointer-events:none;'
      +'background:repeating-linear-gradient(90deg,rgba(255,90,31,.28) 0 1.6px,transparent 1.6px 30px),repeating-linear-gradient(90deg,rgba(240,250,255,.34) 4px 5.6px,transparent 5.6px 33px),repeating-linear-gradient(90deg,rgba(79,195,255,.3) 8px 9.6px,transparent 9.6px 36px);'
      +'-webkit-mask-image:linear-gradient(180deg,transparent,#000 30%,#000 70%,transparent),linear-gradient(90deg,transparent,#000 60%);-webkit-mask-composite:source-in;mask-composite:intersect;opacity:.9}'
      +'.sl::after{content:"";position:absolute;inset:-20%;pointer-events:none;background:radial-gradient(40% 46% at 82% 26%,rgba(64,150,255,.18),transparent 72%),radial-gradient(32% 40% at 92% 74%,rgba(255,90,31,.15),transparent 72%);filter:blur(50px)}'
      +'.sl>*{position:relative;z-index:2}'
      +'.sl-eye{font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:#83827b;margin-bottom:18px}'
      +'.sl h1{font-weight:800;font-size:'+(land?'46px':'40px')+';line-height:1.04;letter-spacing:-.03em;max-width:16ch}'
      +'.sl h2{font-weight:750;font-size:'+(land?'32px':'28px')+';line-height:1.1;letter-spacing:-.02em;margin-bottom:18px;max-width:20ch}'
      +'.sl ul{list-style:none;display:flex;flex-direction:column;gap:13px;max-width:'+(land?'62%':'88%')+'}'
      +'.sl li{font-family:"IBM Plex Sans Thai Looped",Inter,sans-serif;font-size:'+(land?'18px':'17px')+';line-height:1.4;color:#d7d5ce;padding-left:20px;position:relative}'
      +'.sl li::before{content:"";position:absolute;left:0;top:.62em;width:8px;height:2px;border-radius:2px;background:linear-gradient(90deg,#4fc3ff,#ff5a1f)}'
      +'.sl .note{margin-top:22px;font-family:"Newsreader","Noto Serif Thai",serif;font-style:italic;font-size:16px;color:#a8a7a1}'
      +'.sl .sub{font-family:"Newsreader","Noto Serif Thai",serif;font-style:italic;font-size:19px;color:#a8a7a1;margin-top:16px;max-width:40ch}'
      +'.rule{width:56px;height:3px;border-radius:3px;background:linear-gradient(90deg,#4fc3ff,#dff4ff,#ffa14b,#ff5a1f);margin:22px 0}'
      +'.cover h1{font-size:'+(land?'58px':'48px')+'}'
      +'.quote{justify-content:center}.quote blockquote{font-family:"Newsreader","Noto Serif Thai",serif;font-style:italic;font-size:'+(land?'34px':'28px')+';line-height:1.3;max-width:20ch}'
      +'.quote cite{display:block;margin-top:20px;font-family:"IBM Plex Mono",monospace;font-style:normal;font-size:12px;letter-spacing:.1em;color:#83827b}'
      +'.close h2{font-size:'+(land?'40px':'34px')+'}.sl-foot{position:absolute;left:'+(land?'24mm':'22mm')+';bottom:'+(land?'16mm':'20mm')+';font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.16em;color:#66655f}'
      +'@media screen{body{padding:24px;display:flex;flex-direction:column;align-items:center;gap:20px}.sl{box-shadow:0 20px 60px rgba(0,0,0,.5);border-radius:6px}}'
      +'</style></head><body>'+slides.map(slideHTML).join('')+'</body></html>';
  }

  /* ═══ init — auth first, then boot ═══ */
  async function loadLegacy(){ // pre-login data — migrated into the account on first sign-in
    try{const r=await fetch(SB.url+'/rest/v1/vaest_state?email=eq.'+LEGACY_WHO+'&select=data',{headers:{apikey:SB.key,Authorization:'Bearer '+SB.key}});
      if(!r.ok)return null;const rows=await r.json();return (rows[0]&&rows[0].data)||null}catch(e){return null}}
  async function boot(){
    SB.who=AUTH.email; // per-user state
    // migrate any device-local profile from the previous build into synced state
    try{const legacy=JSON.parse(localStorage.getItem('vaest_profile:'+AUTH.email)||'null');
      if(legacy&&(legacy.name||legacy.pic)&&!(profile&&(profile.name||profile.pic))){profile=legacy;save();localStorage.removeItem('vaest_profile:'+AUTH.email)}}catch(e){}
    const _pf=getProfile();$('whoLbl').textContent=_pf.name||AUTH.email;paintAvatar();
    if(!loadLocal()){projects=[];sessions=[];usage=0;library=[]}
    if(!sessions.length){sessions=[{id:uid('s'),title:'New',projectId:null,brief:'',files:[],canvas:'',updatedAt:Date.now(),mode:'idea'}]}
    if(!currentSid||!cur())currentSid=sessions[0].id;
    renderRail();
    const s=cur();(s.canvas&&s.canvas.trim())?showCanvas():showHome();
    setSync('sync');
    try{let cloud=await cloudLoad();
      if(!cloud){const legacy=await loadLegacy();if(legacy){cloud=legacy}} // first-time migrate
      if(cloud){
        const localTime=Math.max(0,...sessions.map(x=>x.updatedAt||0));
        // local counts as "has content" when it has a real canvas/files/brief — if empty, cloud always wins (avoids overwrite)
        const localMeaningful=sessions.some(x=>(x.canvas&&x.canvas.trim())||x.files.length||(x.brief&&x.brief.trim()));
        const tmpP=projects,tmpS=sessions,tmpC=currentSid,tmpU=usage;
        if(applyBlob(cloud)){
          const cloudTime=Math.max(0,...sessions.map(x=>x.updatedAt||0));
          if(localMeaningful&&cloudTime<localTime){projects=tmpP;sessions=tmpS;currentSid=tmpC;usage=tmpU;cloudSave()}
          else{if(!cur())currentSid=(sessions[0]||{}).id||null;
            if(!sessions.length){sessions=[{id:uid('s'),title:'New',projectId:null,brief:'',files:[],canvas:'',updatedAt:Date.now(),mode:'idea'}];currentSid=sessions[0].id}
            save();renderRail();const c2=cur();(c2.canvas&&c2.canvas.trim())?showCanvas():showHome()}
        }else{projects=tmpP;sessions=tmpS;currentSid=tmpC;usage=tmpU}
        setSync('ok')}
      else{ // truly new account — no cloud or legacy
        const empty=!sessions.some(x=>(x.canvas&&x.canvas.trim())||x.files.length||(x.brief&&x.brief.trim()));
        if(empty){seedSample();renderRail();showCanvas()}
        cloudSave()}
    }catch(e){setSync('off')}
    // carry the free-trial chat in, if we just came from anonymous
    if(window._anonCarry){const carry=window._anonCarry;window._anonCarry=null;
      if(carry&&carry.length){try{
        sessions=carry.concat(sessions.filter(x=>(x.canvas&&x.canvas.trim())||x.files.length||(x.brief&&x.brief.trim())||chatsOf(x).some(c=>c.ideas.length)));
        currentSid=carry[0].id;save();cloudSave();renderRail();showHome();
        toast('Your trial chat is saved to your account')}catch(e){}}}
    sweepCommentCounts()}
  /* onboarding — sample work for new accounts */
  const SAMPLE_MD='# ARIYA Coffee — Rebrand Direction (sample)\n\n> This is a sample VÆST crystallized from a brief + files. Try editing it, highlight text and refine it, or hit Refine for a full-document check.\n\n---\n\n## Core idea: warm with intent, not another vintage retread\n\nThe 25–40 creative crowd doesn’t want another "cute cafe" — they want a place that feels **considered down to the inch**. Every element must answer one question: was this place actually thought through?\n\n## Visual tone: warm cream × burnt orange\n\n- Primary: warm cream as the base — clean but never cold\n- Accent: burnt orange, used sparingly — a signal, not decoration\n- Type: a confident serif for headings + a clean sans for body\n\n## Deliverables\n\n1. Logo system (primary + compact)\n2. Menu + price tags\n3. Storefront sign\n4. 3 social templates\n\n## Try these three moves\n\n1. **Highlight any sentence** above — a toolbar appears. Try *Ask VÆST* and type your own instruction.\n2. Hover any section and hit **Think** — Mimir, a second mind, pushes that section bolder. Approve what you like; VÆST remembers your taste from every decision.\n3. Hit **Refine** (top right) for the final coherence check, then **Export → Share link** to see exactly what a client sees.\n\n---\n\n**Then make it yours.** Hit **New** (top-left) and pick a mode up top: **Idea** to think out loud, **Brief** to get a brief airtight, or **Crystallize** to turn notes and files into a document like this one.';
  function seedSample(){currentSid=null;const s={id:uid('s'),title:'ARIYA Coffee — sample',projectId:null,brief:'',files:[],canvas:SAMPLE_MD,updatedAt:Date.now(),tone:'',mode:'crystallize'};sessions=[s];currentSid=s.id;save()}

  /* share view — read-only */
  async function loadShare(id){
    // read via the server-side broker (service key) — the public key can no longer touch share rows
    try{const r=await fetch('/api/share?id='+encodeURIComponent(id));
      if(!r.ok)return null;return await r.json()}catch(e){return null}}
  let _shareId=null;
  async function openShareView(id){
    hideAuth();$('app').classList.add('rail-off');_shareId=id;
    const data=await loadShare(id);
    $('home').style.display='none';$('cvView').style.display='';$('topbar').style.display='flex';
    document.querySelector('.main').classList.add('has-top');
    if(!data){$('doc').innerHTML='<div class="gen"><div class="gen-eye" style="color:var(--cin-d)">This link is invalid or has been revoked</div></div>';return}
    renderDoc(data.canvas||'');
    // disable editing + show read-only banner
    document.querySelectorAll('#doc [contenteditable]').forEach(e=>e.setAttribute('contenteditable','false'));
    document.querySelectorAll('#doc .sec-tools').forEach(e=>e.remove());
    $('topbar').innerHTML='<div class="tb" style="pointer-events:none"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg> <span class="sh-lbl">Read-only · shared from VÆST</span></div><div class="top-title" style="flex:1">'+esc(data.title||'Document')+'</div><button class="tb" id="shTheme" onclick="toggleShareTheme()" title="Reading theme" aria-label="Reading theme">☀︎</button><a class="tb dark sh-open" href="/app" style="text-decoration:none">Open VÆST →</a>';
    try{if(localStorage.getItem('vaest_share_theme')==='light')toggleShareTheme(true)}catch(e){}
    // privacy note — earn the client's trust in one line
    $('doc').insertAdjacentHTML('beforeend','<div style="margin:56px 0 24px;padding-top:18px;border-top:1px solid var(--line);font-family:var(--mono);font-size:10px;letter-spacing:.08em;color:var(--mute)">PRIVATE BY DESIGN — NO AI TRAINING ON YOUR DATA · <a href=\'/privacy\' style=\'color:inherit\'>PRIVACY</a> · BY ORIONS.AGENCY</div>');
    // comments — readers can leave one per section
    document.querySelectorAll('#doc .sec').forEach(sec=>{
      if(sec.getAttribute('data-h')==='_intro')return;
      const wrap=document.createElement('div');wrap.className='cmt-zone';sec.appendChild(wrap);
      const btn=document.createElement('button');btn.className='cmt-add';btn.textContent='Comment';
      btn.onclick=()=>shareCmtForm(sec,wrap);sec.appendChild(btn)});
    renderShareComments(data.comments||[])}
  function renderShareComments(comments){
    document.querySelectorAll('#doc .cmt-zone').forEach(z=>{z.innerHTML='';
      const h=z.closest('.sec').getAttribute('data-h');
      comments.filter(c=>c.h===h).forEach(c=>{
        z.insertAdjacentHTML('beforeend','<div class="cmt"><div class="ch"><b>'+esc(c.name||'Anonymous')+'</b>'+fmtAgo(c.ts)+'</div><div class="ct">'+esc(c.text)+'</div></div>')})})}
  function shareCmtForm(sec,zone){
    if(zone.querySelector('.cmt-form'))return;
    const f=document.createElement('div');f.className='cmt-form';
    f.innerHTML='<input class="cf-n" placeholder="Your name (optional)" maxlength="40">'
      +'<textarea class="cf-t" placeholder="Comment on this section…" maxlength="1200"></textarea>'
      +'<div class="row"><button class="cxl">Cancel</button><button class="send">Send</button></div>';
    zone.appendChild(f);f.querySelector('.cf-t').focus();
    f.querySelector('.cxl').onclick=()=>f.remove();
    f.querySelector('.send').onclick=async()=>{
      const text=f.querySelector('.cf-t').value.trim();if(!text)return;
      const name=f.querySelector('.cf-n').value.trim();
      const btn=f.querySelector('.send');btn.disabled=true;btn.textContent='Sending…';
      try{
        const r=await fetch('/api/share?id='+encodeURIComponent(_shareId),{method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({comment:{h:sec.getAttribute('data-h'),name,text}})});
        if(!r.ok)throw new Error('failed');
        const out=await r.json();
        f.remove();renderShareComments(out.comments||[]);toast('Comment sent')}
      catch(e){btn.disabled=false;btn.textContent='Send';toast('Failed to send, try again')}}}

  function toggleShareTheme(silent){
    const light=!document.body.classList.contains('share-light');
    document.body.classList.toggle('share-light',light);
    const b=$('shTheme');if(b)b.textContent=light?'☾':'☀︎';
    try{localStorage.setItem('vaest_share_theme',light?'light':'night')}catch(e){}
    if(!silent&&typeof toast==='function')toast(light?'Paper mode':'Night mode')}

  /* owner side — see & resolve comments from the share link */
  let _cmtCache={};
  async function fetchComments(s){
    if(!s||!s.shareId)return;
    const data=await loadShare(s.shareId);
    _cmtCache[s.id]=(data&&data.comments)||[];_cmtCounts[s.id]=_cmtCache[s.id].length;renderRail();
    if(cur()&&cur().id===s.id)renderOwnerComments()}
  function renderOwnerComments(){
    const s=cur();if(!s)return;
    const comments=_cmtCache[s.id]||[];
    document.querySelectorAll('#doc .own-cmts').forEach(e=>e.remove());
    if(!comments.length)return;
    const secs=[...document.querySelectorAll('#doc .sec')];
    const byH={};comments.forEach(c=>{(byH[c.h]=byH[c.h]||[]).push(c)});
    Object.entries(byH).forEach(([h,list])=>{
      const sec=secs.find(x=>x.getAttribute('data-h')===h)||secs[secs.length-1];if(!sec)return;
      const box=document.createElement('div');box.className='own-cmts';
      box.innerHTML=list.map(c=>'<div class="cmt"><div class="ch"><b>'+esc(c.name||'Anonymous')+'</b>'+fmtAgo(c.ts)
        +'<button class="cr ca" onclick="applyComment(\''+c.id+'\')">Apply with VÆST</button>'
        +'<button class="cr" onclick="resolveComment(\''+c.id+'\')">Resolve</button></div><div class="ct">'+esc(c.text)+'</div></div>').join('');
      sec.appendChild(box)})}
  // the client's note becomes the instruction — one click
  async function applyComment(cid){
    if(_busy){toast('Working…');return}
    const s=cur();const c=(_cmtCache[s.id]||[]).find(x=>x.id===cid);if(!c)return;
    pushUndo();setBusy(true);toast('Applying the client’s note…');
    const before=snapshot();
    const prompt='Original document:\n\n'+genMd()+'\n\nA client left this comment on the section "'+c.h+'":\n"'+c.text+'"\n\nRevise the document to address the comment (adjust only what’s relevant; keep the "# title" and "## " structure). Return the full markdown.';
    try{const md=await streamAPI('apply',[{role:'user',content:prompt}],toneSys());
      applyMd(md);flashChanged(before);toast('Client note applied — review it, then Resolve the comment')}
    catch(e){toast('Failed: '+e.message)}
    finally{setBusy(false)}}
  async function resolveComment(cid){
    const s=cur();if(!s||!s.shareId)return;
    try{await ensureAuth();
      const r=await fetch('/api/share',{method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+((AUTH&&AUTH.access_token)||'')},
        body:JSON.stringify({action:'resolve',id:s.shareId,cid})});
      if(!r.ok)throw new Error('failed');
      const out=await r.json();const comments=out.comments||[];
      _cmtCache[s.id]=comments;_cmtCounts[s.id]=comments.length;renderRail();renderOwnerComments();toast('Resolved')}
    catch(e){toast('Failed, try again')}}

  // paste an image into the canvas → embed as an image block in that section
  async function handleDocPaste(e){
    const items=[...((e.clipboardData||{}).items||[])].filter(it=>/^image\//.test(it.type));
    if(!items.length)return;
    const secEl=e.target.closest&&e.target.closest('.sec');if(!secEl)return;
    e.preventDefault();
    const files=items.map(it=>it.getAsFile()).filter(Boolean);
    if(files.length)await embedImages(secEl,files);
  }
  (async function init(){
    $('doc').addEventListener('input',schedulePersist);initScrollSpy();
    $('doc').addEventListener('paste',handleDocPaste);
    // 1) set a new password from the email link (recovery / invite)
    const rec=await detectRecovery();
    if(rec){window._recToken=rec;history.replaceState(null,'',location.pathname);$('npView').classList.add('show');setTimeout(()=>$('npPass').focus(),60);return}
    // 2) share link (read-only) — no login needed
    const sid=new URLSearchParams(location.search).get('s');
    if(sid){await openShareView(sid);return}
    // 3) normal — needs login; access = paid subscription, comp/invite, or internal
    const qp=new URLSearchParams(location.search);
    const wantPlan=qp.get('plan');                 // from a marketing "Get started" CTA
    const backFromCheckout=qp.get('checkout');     // success | cancel (Stripe return)
    loadAuth();
    if(AUTH&&await ensureAuth()){
      // just back from Stripe → confirm the session server-side to activate immediately
      // (no webhook needed for the pay→activate path)
      let boosted=false;
      if(backFromCheckout==='success'){
        const sessionId=qp.get('session_id');
        if(sessionId){toast('Payment received — one moment…');
          const confirmOnce=async()=>{try{const cr=await fetch('/api/confirm',{method:'POST',
            headers:{'Content-Type':'application/json',Authorization:'Bearer '+AUTH.access_token},
            body:JSON.stringify({session_id:sessionId})});return await cr.json().catch(()=>({}))}catch(e){return {}}};
          let cd=await confirmOnce();
          // PromptPay can settle just after redirect — keep retrying while it's pending
          for(let i=0;i<6&&!cd.activated&&cd.pending;i++){await new Promise(r=>setTimeout(r,2000));cd=await confirmOnce()}
          boosted=!!cd.boosted;}
      }
      let ok=await checkAccess();
      // fallback: if activation is a touch behind, retry a couple times
      if(!ok&&backFromCheckout==='success'){
        for(let i=0;i<4&&!ok;i++){await new Promise(r=>setTimeout(r,1500));ok=await checkAccess()}
      }
      if(backFromCheckout){history.replaceState(null,'',location.pathname)}
      if(ok){hideAuth();if(backFromCheckout==='success')toast(boosted?'Usage credit added — it carries over, use it anytime':'You’re in — welcome to VÆST');await boot()}
      else if(wantPlan&&['basic','pro','director'].includes(wantPlan)){history.replaceState(null,'',location.pathname);startCheckout(wantPlan)}
      else{hideAuth();await boot();renderTierNote()} // free account (or lapsed) — Galdr keeps working, engines wall on use
    }
    else{
      saveAuth(AUTH&&AUTH.refresh_token?AUTH:null);
      // came from a pricing CTA → they want to buy, go straight to signup+checkout
      if(wantPlan&&['basic','pro','director'].includes(wantPlan)){window._wantPlan=wantPlan;history.replaceState(null,'',location.pathname);if(_authMode!=='signup')toggleAuthMode();showAuth()}
      // otherwise land in the free Galdr trial — no wall until they've tried it
      else startAnon()}
  })();
