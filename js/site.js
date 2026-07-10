/* VÆST marketing site — footer + interactions (nav is now static per page, no CLS) */
(function(){
  var nav=document.getElementById('siteNav');
  var burger=document.getElementById('navBurger');
  if(nav&&burger){
    burger.addEventListener('click',function(){nav.classList.toggle('open')});
    document.querySelectorAll('#navLinks a').forEach(function(a){a.addEventListener('click',function(){nav.classList.remove('open')})});
  }

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
