// Inline boot guard: runs before/independent of the app bundle so a failed
// script/chunk fetch (stale cached HTML pointing at deleted hashed assets)
// self-heals instead of leaving a blank "Loading Failed" screen.
export const BOOT_FALLBACK_ID = "app-boot-fallback";

export const bootGuardScript = `(function(){
  var KEY='app-boot-recovered';
  var FALLBACK_ID='${BOOT_FALLBACK_ID}';
  var TIMEOUT=8000;
  function showFallback(){
    var el=document.getElementById(FALLBACK_ID);
    if(el) el.style.display='grid';
  }
  function alreadyTried(){
    try { return sessionStorage.getItem(KEY)==='1'; } catch(e) { return true; }
  }
  function markTried(){
    try { sessionStorage.setItem(KEY,'1'); } catch(e) {}
  }
  function recover(){
    if(alreadyTried()){ showFallback(); return; }
    markTried();
    var done=function(){ location.reload(); };
    try {
      if(window.caches && caches.keys){
        caches.keys().then(function(keys){
          return Promise.all(keys.map(function(k){ return caches.delete(k); }));
        }).then(done, done);
        return;
      }
    } catch(e) {}
    done();
  }
  window.addEventListener('error', function(e){
    var t=e && e.target;
    if(t && t!==window && (t.tagName==='SCRIPT' || t.tagName==='LINK')) recover();
  }, true);
  window.addEventListener('vite:preloadError', function(e){
    if(e && e.preventDefault) e.preventDefault();
    recover();
  });
  setTimeout(function(){
    if(!window.__APP_BOOTED__) showFallback();
  }, TIMEOUT);
  window.addEventListener('load', function(){
    // Successful boot clears the one-shot recovery flag for future sessions.
    setTimeout(function(){
      if(window.__APP_BOOTED__){ try { sessionStorage.removeItem(KEY); } catch(e) {} }
    }, 2000);
  });
})();`;
