/* VÆST marketing site — shared nav, footer, interactions */
(function(){
  var page=(document.body.getAttribute('data-page')||'');
  var MARK='<svg class="mark" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#141417" stroke="rgba(255,255,255,.14)" stroke-width="1"/><defs><linearGradient id="ng" gradientUnits="userSpaceOnUse" x1="25.5" y1="8" x2="14.5" y2="32"><stop offset="0" stop-color="#4fc3ff"/><stop offset=".5" stop-color="#dff4ff"/><stop offset="1" stop-color="#ff5a1f"/></linearGradient></defs><path d="M25.5 8 14.5 32" stroke="url(#ng)" stroke-width="3.6" stroke-linecap="round"/></svg>';
  var LINKS=[['features','Features','/features'],['product','Product','/product'],['developers','Developers','/developers'],['company','Company','/company'],['news','News','/news']];

  var nav=document.createElement('nav');nav.className='nav';nav.id='siteNav';
  nav.innerHTML='<div class="wrap nav-in">'
    +'<a class="brand" href="/">'+MARK+'<span class="wm">V<i style="font-style:normal">Æ</i>ST</span></a>'
    +'<div class="nav-links" id="navLinks">'+LINKS.map(function(l){return '<a href="'+l[2]+'"'+(page===l[0]?' class="on"':'')+'>'+l[1]+'</a>'}).join('')+'</div>'
    +'<div class="nav-right"><a class="btn-try" href="/app">Try VÆST →</a>'
    +'<button class="nav-burger" id="navBurger" aria-label="Menu"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button></div>'
    +'</div>';
  document.body.insertBefore(nav,document.body.firstChild);
  var burger=document.getElementById('navBurger');
  burger.addEventListener('click',function(){nav.classList.toggle('open')});
  document.querySelectorAll('#navLinks a').forEach(function(a){a.addEventListener('click',function(){nav.classList.remove('open')})});

  var foot=document.createElement('footer');
  foot.innerHTML='<div class="wrap"><div class="foot">'
    +'<div class="fcol about"><div class="wm">V<i style="font-style:normal">Æ</i>ST</div><p>Aesthetic Intelligence — a studio instrument by ORIONS.Agency. Built from real briefs, tuned for taste.</p></div>'
    +'<div class="fcol"><h4>Product</h4><a href="/features">Features</a><a href="/product">Product</a><a href="/developers">Developers</a><a href="/app">Try VÆST</a></div>'
    +'<div class="fcol"><h4>Company</h4><a href="/company">About</a><a href="/news">News</a><a href="https://orions.agency" target="_blank" rel="noopener">ORIONS.Agency ↗</a><a href="/#access">Request access</a></div>'
    +'<div class="fcol"><h4>Legal</h4><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="mailto:rakan@orions.agency">Contact</a></div>'
    +'</div><div class="foot-base"><span>VÆST — Aesthetic Intelligence</span><span>Processed via Anthropic · no training on your data</span><span>© ORIONS.Agency</span></div></div>';
  document.body.appendChild(foot);

  if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.14});
    document.querySelectorAll('.reveal').forEach(function(el){io.observe(el)});
  } else document.querySelectorAll('.reveal').forEach(function(el){el.classList.add('in')});
})();
